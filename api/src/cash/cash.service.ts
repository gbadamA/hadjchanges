import { ConflictException, Injectable } from '@nestjs/common';
import { CashMovementType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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
  constructor(private readonly prisma: PrismaService) {}

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
