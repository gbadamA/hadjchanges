import { DepositMethod, PayoutMethod, TransactionStatus } from '@prisma/client';
import { z } from 'zod';
import { simulateSchema } from '../quotes/quotes.schemas';

/**
 * Création d'une transaction. Deux entrées possibles :
 *  - depuis un **devis verrouillé** (`quoteId`) : le prix est déjà garanti ;
 *  - depuis une **simulation** : le prix est celui du moment.
 * Le client choisit ; l'API ne devine pas.
 */
export const createTransactionSchema = z
  .object({
    quoteId: z.string().cuid().optional(),
    direction: simulateSchema.shape.direction.optional(),
    currencyCode: simulateSchema.shape.currencyCode.optional(),
    amount: simulateSchema.shape.amount.optional(),
    side: simulateSchema.shape.side.optional(),
    agencyId: z.string().cuid().nullish(),
    depositMethod: z.nativeEnum(DepositMethod),
    payoutMethod: z.nativeEnum(PayoutMethod),
    /** Numéro mobile money ou RIB de versement, selon le mode de retrait. */
    payoutDetails: z.string().trim().max(120).optional(),
  })
  .refine(
    (value) => Boolean(value.quoteId) || Boolean(value.direction && value.currencyCode && value.amount),
    { message: 'Fournissez un devis verrouillé, ou le détail de la conversion souhaitée.' },
  );

export const receiptRejectSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(10, 'Le motif doit être explicite (10 caractères minimum).')
    .max(500),
});

export const receiptReviewSchema = z.object({
  /** Montant lu sur le justificatif par l'agent — comparé au montant attendu. */
  declaredAmount: z.coerce.number().positive().optional(),
  declaredRef: z.string().trim().max(120).optional(),
});

export const transactionListSchema = z.object({
  status: z.nativeEnum(TransactionStatus).optional(),
  currencyCode: z.string().trim().toUpperCase().length(3).optional(),
  agencyId: z.string().cuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  take: z.coerce.number().int().positive().max(200).default(50),
});

export const cancelSchema = z.object({
  reason: z.string().trim().max(300).optional(),
});

export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;
export type ReceiptRejectInput = z.infer<typeof receiptRejectSchema>;
export type ReceiptReviewInput = z.infer<typeof receiptReviewSchema>;
export type TransactionListInput = z.infer<typeof transactionListSchema>;
export type CancelInput = z.infer<typeof cancelSchema>;
