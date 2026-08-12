import { Injectable, NotFoundException } from '@nestjs/common';
import { CashMovementType, TransactionDirection, TransactionStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { CashService } from '../cash/cash.service';
import type { AuthUser } from '../common/auth-user';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionStateMachine } from './transaction-state-machine';
import { toTransactionView, transactionInclude, type TransactionView } from './transactions.view';

/**
 * Exécution du change — le moment où l'argent bouge réellement.
 *
 * Responsabilité unique : passer une transaction de `RECU_VALIDE` à
 * `CHANGE_EXECUTE` **en générant les mouvements de caisse correspondants**.
 * Le tout dans une seule transaction base : un statut qui avance sans que la
 * caisse bouge (ou l'inverse) laisserait un trou impossible à rattraper à la
 * clôture journalière.
 *
 * Le taux appliqué est celui **figé dans la ligne**, jamais le taux courant :
 * entre la simulation et la validation du reçu, le marché a pu bouger, mais le
 * client a payé sur la base qu'on lui a promise.
 */
@Injectable()
export class ExchangeExecutor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cash: CashService,
    private readonly machine: TransactionStateMachine,
    private readonly audit: AuditService,
  ) {}

  async execute(transactionId: string, operator: AuthUser, ip?: string): Promise<TransactionView> {
    const transaction = await this.prisma.transaction.findUnique({ where: { id: transactionId } });
    if (!transaction) throw new NotFoundException('Transaction introuvable.');
    this.machine.assert(transaction.status, TransactionStatus.CHANGE_EXECUTE, transaction.channel);

    if (!transaction.agencyId) {
      throw new NotFoundException('Aucune agence rattachée : impossible de mouvementer une caisse.');
    }
    const agencyId = transaction.agencyId;
    const isSale = transaction.direction === TransactionDirection.VENTE_DEVISE;

    const executed = await this.prisma.$transaction(async (tx) => {
      // Le client remet la devise source : elle ENTRE en caisse.
      await this.cash.move(tx, {
        agencyId,
        currencyId: transaction.sourceCurrencyId,
        type: CashMovementType.ENTREE_TRANSACTION,
        amount: transaction.sourceAmount,
        transactionId,
        note: `Encaissement ${transaction.reference}`,
        createdById: operator.id,
      });

      // Le bureau remet la devise cible : elle SORT de la caisse. Si le solde
      // ne suffit pas, `move` refuse et toute l'exécution est annulée — la
      // transaction reste au statut « reçu validé », prête à repartir une fois
      // la caisse alimentée.
      await this.cash.move(tx, {
        agencyId,
        currencyId: transaction.targetCurrencyId,
        type: CashMovementType.SORTIE_TRANSACTION,
        amount: transaction.targetAmount.negated(),
        transactionId,
        note: `Décaissement ${transaction.reference}`,
        createdById: operator.id,
      });

      return tx.transaction.update({
        where: { id: transactionId },
        data: {
          status: TransactionStatus.CHANGE_EXECUTE,
          executedAt: new Date(),
          operatorId: operator.id,
        },
        include: transactionInclude,
      });
    });

    await this.audit.record({
      userId: operator.id,
      action: 'transaction.execute',
      entity: 'Transaction',
      entityId: transactionId,
      before: { status: TransactionStatus.RECU_VALIDE },
      after: {
        status: TransactionStatus.CHANGE_EXECUTE,
        sens: isSale ? 'vente de devise' : 'achat de devise',
        appliedRate: transaction.appliedRate.toString(),
        commissionAmount: transaction.commissionAmount.toString(),
      },
      ip,
    });

    return toTransactionView(executed, { withClient: true });
  }
}
