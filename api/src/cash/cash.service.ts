import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CashMovementType, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/auth-user';
import { PrismaService } from '../prisma/prisma.service';

export interface MovementFilters {
  currencyCode?: string;
  type?: CashMovementType;
  from?: Date;
  to?: Date;
  take: number;
}

export interface ManualMovementInput {
  agencyId: string;
  currencyCode: string;
  type: CashMovementType;
  amount: number;
  note?: string;
}

export interface CloseDayInput {
  agencyId: string;
  businessDay?: Date;
  note?: string;
  counts: Array<{ currencyCode: string; countedAmount: number }>;
}

/** Minuit local : le jour comptable est une DATE, pas un instant. */
const startOfDay = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

export interface MovementInput {
  agencyId: string;
  currencyId: string;
  type: CashMovementType;
  /** Signé : positif = entrée en caisse, négatif = sortie. */
  amount: Prisma.Decimal;
  transactionId?: string | null;
  note?: string | null;
  createdById: string;
}

/**
 * Tenue de caisse.
 *
 * **La vérité est la suite des `CashMovement`** ; `CashBalance` n'est qu'un
 * cache pour l'affichage. D'où deux règles :
 *  - chaque mouvement fige le `balanceAfter` qu'il produit, pour que
 *    l'historique reste lisible même si le cache est reconstruit ;
 *  - `recompute()` permet de rebâtir le cache et de détecter un écart.
 *
 * Tout passe dans la transaction Prisma de l'appelant (`tx`) : un mouvement de
 * caisse et le changement de statut qui le justifie doivent réussir ou échouer
 * ensemble. Une caisse qui bouge sans transaction, c'est un trou.
 */
@Injectable()
export class CashService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async move(tx: Prisma.TransactionClient, input: MovementInput): Promise<Prisma.Decimal> {
    const balance = await tx.cashBalance.findUnique({
      where: { agencyId_currencyId: { agencyId: input.agencyId, currencyId: input.currencyId } },
    });
    const current = balance?.amount ?? new Prisma.Decimal(0);
    const next = current.plus(input.amount);

    // Une caisse ne passe pas en négatif : on ne remet pas au client des
    // billets qu'on n'a pas. L'agent doit alimenter la caisse d'abord.
    if (next.lessThan(0)) {
      throw new ConflictException(
        'Solde de caisse insuffisant pour cette opération. Alimentez la caisse avant de poursuivre.',
      );
    }

    await tx.cashMovement.create({
      data: {
        agencyId: input.agencyId,
        currencyId: input.currencyId,
        type: input.type,
        amount: input.amount,
        balanceAfter: next,
        transactionId: input.transactionId ?? null,
        note: input.note ?? null,
        createdById: input.createdById,
      },
    });

    await tx.cashBalance.upsert({
      where: { agencyId_currencyId: { agencyId: input.agencyId, currencyId: input.currencyId } },
      create: { agencyId: input.agencyId, currencyId: input.currencyId, amount: next },
      update: { amount: next },
    });

    return next;
  }

  /** Soldes d'une agence, devise par devise. */
  balances(agencyId: string) {
    return this.prisma.cashBalance.findMany({
      where: { agencyId },
      include: { currency: true },
      orderBy: { currency: { sortOrder: 'asc' } },
    });
  }

  /** Historique des mouvements, filtrable (cahier §3.1). */
  async movements(agencyId: string, filters: MovementFilters) {
    const currency = filters.currencyCode
      ? await this.prisma.currency.findUnique({ where: { code: filters.currencyCode } })
      : null;

    return this.prisma.cashMovement.findMany({
      where: {
        agencyId,
        currencyId: currency?.id,
        type: filters.type,
        createdAt: { gte: filters.from, lte: filters.to },
      },
      orderBy: { createdAt: 'desc' },
      take: filters.take,
      include: {
        currency: true,
        createdBy: { select: { firstName: true, lastName: true } },
        transaction: { select: { reference: true } },
      },
    });
  }

  /**
   * Alimentation, retrait ou ajustement manuel de caisse.
   *
   * Le signe est déduit du TYPE, pas laissé à l'appelant : une alimentation
   * saisie en négatif par erreur viderait la caisse au lieu de la remplir.
   * L'ajustement, lui, garde le signe fourni — c'est sa raison d'être.
   */
  async adjust(input: ManualMovementInput, actor: AuthUser, ip?: string) {
    const currency = await this.prisma.currency.findUnique({
      where: { code: input.currencyCode },
    });
    if (!currency) throw new NotFoundException(`Devise ${input.currencyCode} inconnue.`);

    const magnitude = new Prisma.Decimal(input.amount).abs();
    const signed =
      input.type === CashMovementType.RETRAIT
        ? magnitude.negated()
        : input.type === CashMovementType.AJUSTEMENT
          ? new Prisma.Decimal(input.amount)
          : magnitude;

    const balance = await this.prisma.$transaction((tx) =>
      this.move(tx, {
        agencyId: input.agencyId,
        currencyId: currency.id,
        type: input.type,
        amount: signed,
        note: input.note ?? null,
        createdById: actor.id,
      }),
    );

    await this.audit.record({
      userId: actor.id,
      action: `cash.${input.type.toLowerCase()}`,
      entity: 'CashBalance',
      entityId: `${input.agencyId}:${currency.code}`,
      after: { amount: signed.toString(), balanceAfter: balance.toString(), note: input.note ?? null },
      ip,
    });

    return { currency: currency.code, amount: signed.toString(), balance: balance.toString() };
  }

  /**
   * Clôture journalière : l'agent compte, le système confronte.
   *
   * **L'écart n'est jamais masqué.** Il est enregistré ligne à ligne, puis
   * corrigé par un mouvement d'ajustement pour que le lendemain reparte du
   * réel. Une caisse qu'on « recale » en silence, c'est un vol qu'on ne voit
   * jamais.
   */
  async closeDay(input: CloseDayInput, actor: AuthUser, ip?: string) {
    const day = startOfDay(input.businessDay ?? new Date());

    const existing = await this.prisma.cashClosure.findUnique({
      where: { agencyId_businessDay: { agencyId: input.agencyId, businessDay: day } },
    });
    if (existing) {
      throw new ConflictException('Cette caisse a déjà été clôturée pour cette journée.');
    }

    const currencies = await this.prisma.currency.findMany({
      where: { code: { in: input.counts.map((line) => line.currencyCode) } },
    });
    const byCode = new Map(currencies.map((currency) => [currency.code, currency]));
    for (const line of input.counts) {
      if (!byCode.has(line.currencyCode)) {
        throw new NotFoundException(`Devise ${line.currencyCode} inconnue.`);
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const closure = await tx.cashClosure.create({
        data: {
          agencyId: input.agencyId,
          businessDay: day,
          closedById: actor.id,
          note: input.note ?? null,
        },
      });

      const lines = [];
      for (const line of input.counts) {
        const currency = byCode.get(line.currencyCode)!;
        const balance = await tx.cashBalance.findUnique({
          where: { agencyId_currencyId: { agencyId: input.agencyId, currencyId: currency.id } },
        });
        const expected = balance?.amount ?? new Prisma.Decimal(0);
        const counted = new Prisma.Decimal(line.countedAmount);
        const difference = counted.minus(expected);

        lines.push(
          await tx.cashClosureLine.create({
            data: { closureId: closure.id, currencyId: currency.id, expected, counted, difference },
          }),
        );

        // L'ajustement ne se fait que s'il y a un écart : un mouvement de zéro
        // polluerait l'historique sans rien dire.
        if (!difference.isZero()) {
          await this.move(tx, {
            agencyId: input.agencyId,
            currencyId: currency.id,
            type: CashMovementType.AJUSTEMENT,
            amount: difference,
            note: `Écart de clôture du ${day.toLocaleDateString('fr-FR')}`,
            createdById: actor.id,
          });
        }
      }

      await this.audit.record({
        userId: actor.id,
        action: 'cash.close_day',
        entity: 'CashClosure',
        entityId: closure.id,
        after: {
          agencyId: input.agencyId,
          businessDay: day.toISOString().slice(0, 10),
          ecarts: lines
            .filter((line) => !line.difference.isZero())
            .map((line) => ({ currencyId: line.currencyId, difference: line.difference.toString() })),
        },
        ip,
      });

      return { closureId: closure.id, businessDay: day.toISOString().slice(0, 10), lines };
    });
  }

  /** Historique des clôtures d'une agence. */
  closures(agencyId: string, take: number) {
    return this.prisma.cashClosure.findMany({
      where: { agencyId },
      orderBy: { businessDay: 'desc' },
      take,
      include: {
        closedBy: { select: { firstName: true, lastName: true } },
        lines: { include: { currency: true } },
      },
    });
  }

  /**
   * Reconstruit le cache depuis les mouvements et signale les écarts.
   * Sert de filet : si un solde affiché ne correspond plus à son historique,
   * c'est un bug qu'il vaut mieux voir tôt.
   */
  async recompute(agencyId: string): Promise<Array<{ currencyId: string; drift: string }>> {
    const sums = await this.prisma.cashMovement.groupBy({
      by: ['currencyId'],
      where: { agencyId },
      _sum: { amount: true },
    });

    const drifts: Array<{ currencyId: string; drift: string }> = [];
    for (const row of sums) {
      const truth = row._sum.amount ?? new Prisma.Decimal(0);
      const cached = await this.prisma.cashBalance.findUnique({
        where: { agencyId_currencyId: { agencyId, currencyId: row.currencyId } },
      });
      const before = cached?.amount ?? new Prisma.Decimal(0);
      if (!before.equals(truth)) drifts.push({ currencyId: row.currencyId, drift: truth.minus(before).toString() });

      await this.prisma.cashBalance.upsert({
        where: { agencyId_currencyId: { agencyId, currencyId: row.currencyId } },
        create: { agencyId, currencyId: row.currencyId, amount: truth },
        update: { amount: truth },
      });
    }
    return drifts;
  }
}
