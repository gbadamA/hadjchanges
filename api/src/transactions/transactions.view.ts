import { Prisma, type TransactionStatus } from '@prisma/client';
import { LABELS, TIMELINE_ORDER } from './transaction-state-machine';

/** Ce qu'il faut charger pour construire une vue complète. */
export const transactionInclude = {
  sourceCurrency: true,
  targetCurrency: true,
  agency: { select: { id: true, name: true, city: true } },
  client: { select: { id: true, firstName: true, lastName: true, phone: true } },
  receipts: { orderBy: { createdAt: 'desc' } },
} satisfies Prisma.TransactionInclude;

export type TransactionWithRelations = Prisma.TransactionGetPayload<{
  include: typeof transactionInclude;
}>;

export interface TimelineStep {
  status: TransactionStatus;
  label: string;
  at: string | null;
  done: boolean;
  current: boolean;
}

export interface TransactionView {
  id: string;
  reference: string;
  status: TransactionStatus;
  statusLabel: string;
  direction: string;
  sourceCurrency: string;
  targetCurrency: string;
  sourceAmount: string;
  targetAmount: string;
  appliedRate: string;
  commissionPct: string;
  commissionAmount: string;
  amountXof: string;
  depositMethod: string;
  payoutMethod: string | null;
  payoutDetails: string | null;
  rateLockedUntil: string | null;
  cancelReason: string | null;
  createdAt: string;
  agency: { id: string; name: string; city: string } | null;
  client?: { id: string; firstName: string; lastName: string; phone: string };
  receipts: Array<{
    id: string;
    status: string;
    rejectReason: string | null;
    createdAt: string;
    validatedAt: string | null;
  }>;
  timeline: TimelineStep[];
}

/**
 * Vue réseau d'une transaction. **Les montants sortent en chaînes**, jamais en
 * `number` : un `Decimal` sérialisé en flottant perd des centimes.
 *
 * La timeline est calculée ici plutôt que côté client : les deux surfaces
 * (mobile et dashboard) doivent raconter exactement la même histoire.
 */
export function toTransactionView(
  transaction: TransactionWithRelations,
  options: { withClient?: boolean } = {},
): TransactionView {
  const dates: Partial<Record<TransactionStatus, Date | null>> = {
    CREEE: transaction.createdAt,
    RECU_SOUMIS: transaction.receiptSubmittedAt,
    RECU_VALIDE: transaction.receiptReviewedAt,
    CHANGE_EXECUTE: transaction.executedAt,
    PRETE_POUR_RETRAIT: transaction.readyAt,
    CLOTUREE: transaction.closedAt,
  };

  const reached = TIMELINE_ORDER.indexOf(transaction.status);
  const timeline: TimelineStep[] = TIMELINE_ORDER.map((status, index) => ({
    status,
    label: LABELS[status],
    at: dates[status]?.toISOString() ?? null,
    // Un reçu rejeté ou une annulation sortent de la ligne droite : dans ce cas
    // seules les étapes réellement horodatées sont marquées franchies.
    done: reached === -1 ? dates[status] != null : index < reached,
    current: status === transaction.status,
  }));

  return {
    id: transaction.id,
    reference: transaction.reference,
    status: transaction.status,
    statusLabel: LABELS[transaction.status],
    direction: transaction.direction,
    sourceCurrency: transaction.sourceCurrency.code,
    targetCurrency: transaction.targetCurrency.code,
    sourceAmount: transaction.sourceAmount.toString(),
    targetAmount: transaction.targetAmount.toString(),
    appliedRate: transaction.appliedRate.toString(),
    commissionPct: transaction.commissionPct.toString(),
    commissionAmount: transaction.commissionAmount.toString(),
    amountXof: transaction.amountXof.toString(),
    depositMethod: transaction.depositMethod,
    payoutMethod: transaction.payoutMethod,
    payoutDetails: transaction.payoutDetails,
    rateLockedUntil: transaction.rateLockedUntil?.toISOString() ?? null,
    cancelReason: transaction.cancelReason,
    createdAt: transaction.createdAt.toISOString(),
    agency: transaction.agency,
    ...(options.withClient ? { client: transaction.client } : {}),
    receipts: transaction.receipts.map((receipt) => ({
      id: receipt.id,
      status: receipt.status,
      rejectReason: receipt.rejectReason,
      createdAt: receipt.createdAt.toISOString(),
      validatedAt: receipt.validatedAt?.toISOString() ?? null,
    })),
    timeline,
  };
}
