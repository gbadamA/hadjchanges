import { Injectable } from '@nestjs/common';
import { Prisma, Role, TransactionStatus } from '@prisma/client';
import type { AuthUser } from '../common/auth-user';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Statuts qui comptent comme du **chiffre réalisé** : l'argent a effectivement
 * changé de mains. Une opération créée mais non exécutée est une intention, pas
 * du volume — les confondre gonflerait les chiffres de direction.
 */
const REALISED: TransactionStatus[] = [
  TransactionStatus.CHANGE_EXECUTE,
  TransactionStatus.PRETE_POUR_RETRAIT,
  TransactionStatus.CLOTUREE,
];

const PENDING: TransactionStatus[] = [
  TransactionStatus.CREEE,
  TransactionStatus.RECU_SOUMIS,
  TransactionStatus.RECU_VALIDE,
  TransactionStatus.RECU_REJETE,
];

export interface ReportingQuery {
  from?: Date;
  to?: Date;
  agencyId?: string;
}

export interface ReportingOverview {
  period: { from: string; to: string };
  totals: {
    operations: number;
    volumeXof: string;
    commissionXof: string;
    averageXof: string;
    clients: number;
    /** Opérations engagées mais pas encore exécutées — la file d'attente. */
    pendingOperations: number;
    pendingXof: string;
  };
  /** Un point par jour : c'est la courbe d'activité. */
  series: Array<{ day: string; operations: number; volumeXof: string; commissionXof: string }>;
  byCurrency: Array<{ code: string; operations: number; volumeXof: string; commissionXof: string }>;
  byDeposit: Array<{ method: string; operations: number; volumeXof: string }>;
  byAgency: Array<{ agencyId: string; name: string; operations: number; volumeXof: string }>;
  byDirection: Array<{ direction: string; operations: number; volumeXof: string }>;
}

@Injectable()
export class ReportingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Tableau de bord de l'exploitant (cahier §3.1 « Reporting et statistiques »).
   *
   * Tout est calculé **en base** (groupBy et date_trunc) plutôt qu'en chargeant
   * les lignes pour les additionner en JavaScript : sur un an d'activité, la
   * seconde approche ramènerait des dizaines de milliers de lignes pour en
   * afficher douze.
   */
  async overview(query: ReportingQuery, viewer: AuthUser): Promise<ReportingOverview> {
    // Fenêtre par défaut : les 30 derniers jours, bornes incluses.
    const to = query.to ?? new Date();
    const from = query.from ?? new Date(to.getTime() - 29 * 86_400_000);
    const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    const end = new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59, 999);

    // Un opérateur ne voit que son agence — même règle que partout ailleurs.
    const agencyId =
      viewer.role === Role.OPERATEUR ? (viewer.agencyId ?? undefined) : query.agencyId;

    const scope: Prisma.TransactionWhereInput = {
      agencyId,
      createdAt: { gte: start, lte: end },
    };
    const realised: Prisma.TransactionWhereInput = { ...scope, status: { in: REALISED } };

    const [aggregate, clients, pending, series, byCurrency, byDeposit, byAgency, byDirection] =
      await Promise.all([
        this.prisma.transaction.aggregate({
          where: realised,
          _count: { _all: true },
          _sum: { amountXof: true, commissionAmount: true },
          _avg: { amountXof: true },
        }),
        this.prisma.transaction.findMany({
          where: realised,
          distinct: ['clientId'],
          select: { clientId: true },
        }),
        this.prisma.transaction.aggregate({
          where: { ...scope, status: { in: PENDING } },
          _count: { _all: true },
          _sum: { amountXof: true },
        }),
        this.dailySeries(start, end, agencyId),
        this.groupByCurrency(realised),
        this.groupByDeposit(realised),
        this.groupByAgency(realised, agencyId),
        this.groupByDirection(realised),
      ]);

    return {
      period: { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) },
      totals: {
        operations: aggregate._count._all,
        volumeXof: (aggregate._sum.amountXof ?? new Prisma.Decimal(0)).toString(),
        commissionXof: (aggregate._sum.commissionAmount ?? new Prisma.Decimal(0)).toString(),
        averageXof: (aggregate._avg.amountXof ?? new Prisma.Decimal(0)).toFixed(0),
        clients: clients.length,
        pendingOperations: pending._count._all,
        pendingXof: (pending._sum.amountXof ?? new Prisma.Decimal(0)).toString(),
      },
      series,
      byCurrency,
      byDeposit,
      byAgency,
      byDirection,
    };
  }

  /**
   * Série journalière. `generate_series` remplit les **jours sans activité** :
   * sans eux, une courbe relierait le 3 au 11 en ligne droite et laisserait
   * croire à une activité continue pendant une semaine creuse.
   */
  private async dailySeries(
    start: Date,
    end: Date,
    agencyId?: string,
  ): Promise<ReportingOverview['series']> {
    const rows = await this.prisma.$queryRaw<
      Array<{ day: Date; operations: bigint; volume: Prisma.Decimal | null; commission: Prisma.Decimal | null }>
    >`
      SELECT d.day::date AS day,
             COUNT(t.id) AS operations,
             COALESCE(SUM(t."amountXof"), 0) AS volume,
             COALESCE(SUM(t."commissionAmount"), 0) AS commission
      FROM generate_series(${start}::date, ${end}::date, '1 day') AS d(day)
      LEFT JOIN "Transaction" t
        ON date_trunc('day', t."createdAt") = d.day
       AND t.status IN ('CHANGE_EXECUTE', 'PRETE_POUR_RETRAIT', 'CLOTUREE')
       AND (${agencyId ?? null}::text IS NULL OR t."agencyId" = ${agencyId ?? null}::text)
      GROUP BY d.day
      ORDER BY d.day ASC
    `;

    return rows.map((row) => ({
      day: row.day.toISOString().slice(0, 10),
      operations: Number(row.operations),
      volumeXof: (row.volume ?? new Prisma.Decimal(0)).toString(),
      commissionXof: (row.commission ?? new Prisma.Decimal(0)).toString(),
    }));
  }

  private async groupByCurrency(where: Prisma.TransactionWhereInput) {
    // Le volume est porté par la devise ÉTRANGÈRE de l'opération : selon le
    // sens, elle est à la source ou à la cible. On regroupe donc sur les deux
    // colonnes puis on fusionne côté service.
    const [asSource, asTarget, currencies] = await Promise.all([
      this.prisma.transaction.groupBy({
        by: ['sourceCurrencyId'],
        where,
        _count: { _all: true },
        _sum: { amountXof: true, commissionAmount: true },
      }),
      this.prisma.transaction.groupBy({
        by: ['targetCurrencyId'],
        where,
        _count: { _all: true },
        _sum: { amountXof: true, commissionAmount: true },
      }),
      this.prisma.currency.findMany(),
    ]);

    const base = currencies.find((currency) => currency.isBase);
    const totals = new Map<string, { operations: number; volume: Prisma.Decimal; commission: Prisma.Decimal }>();

    const add = (currencyId: string, count: number, volume: Prisma.Decimal | null, commission: Prisma.Decimal | null) => {
      if (currencyId === base?.id) return; // le XOF est la contrepartie de tout : le compter fausserait le classement
      const current = totals.get(currencyId) ?? {
        operations: 0,
        volume: new Prisma.Decimal(0),
        commission: new Prisma.Decimal(0),
      };
      totals.set(currencyId, {
        operations: current.operations + count,
        volume: current.volume.plus(volume ?? 0),
        commission: current.commission.plus(commission ?? 0),
      });
    };

    for (const row of asSource) {
      add(row.sourceCurrencyId, row._count._all, row._sum.amountXof, row._sum.commissionAmount);
    }
    for (const row of asTarget) {
      add(row.targetCurrencyId, row._count._all, row._sum.amountXof, row._sum.commissionAmount);
    }

    return [...totals.entries()]
      .map(([currencyId, value]) => ({
        code: currencies.find((currency) => currency.id === currencyId)?.code ?? '???',
        operations: value.operations,
        volumeXof: value.volume.toString(),
        commissionXof: value.commission.toString(),
      }))
      .sort((a, b) => Number(b.volumeXof) - Number(a.volumeXof));
  }

  private async groupByDeposit(where: Prisma.TransactionWhereInput) {
    const rows = await this.prisma.transaction.groupBy({
      by: ['depositMethod'],
      where,
      _count: { _all: true },
      _sum: { amountXof: true },
    });
    return rows
      .map((row) => ({
        method: row.depositMethod,
        operations: row._count._all,
        volumeXof: (row._sum.amountXof ?? new Prisma.Decimal(0)).toString(),
      }))
      .sort((a, b) => Number(b.volumeXof) - Number(a.volumeXof));
  }

  private async groupByAgency(where: Prisma.TransactionWhereInput, agencyId?: string) {
    const [rows, agencies] = await Promise.all([
      this.prisma.transaction.groupBy({
        by: ['agencyId'],
        where,
        _count: { _all: true },
        _sum: { amountXof: true },
      }),
      this.prisma.agency.findMany({ where: agencyId ? { id: agencyId } : undefined }),
    ]);

    return rows
      .filter((row) => row.agencyId !== null)
      .map((row) => ({
        agencyId: row.agencyId as string,
        name: agencies.find((agency) => agency.id === row.agencyId)?.name ?? 'Agence inconnue',
        operations: row._count._all,
        volumeXof: (row._sum.amountXof ?? new Prisma.Decimal(0)).toString(),
      }))
      .sort((a, b) => Number(b.volumeXof) - Number(a.volumeXof));
  }

  private async groupByDirection(where: Prisma.TransactionWhereInput) {
    const rows = await this.prisma.transaction.groupBy({
      by: ['direction'],
      where,
      _count: { _all: true },
      _sum: { amountXof: true },
    });
    return rows.map((row) => ({
      direction: row.direction,
      operations: row._count._all,
      volumeXof: (row._sum.amountXof ?? new Prisma.Decimal(0)).toString(),
    }));
  }
}
