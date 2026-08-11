import { TransactionDirection } from '@prisma/client';
import { z } from 'zod';

export const simulateSchema = z.object({
  /** Sens vu du bureau : VENTE_DEVISE = le client achète de la devise. */
  direction: z.nativeEnum(TransactionDirection),
  /** Devise étrangère de l'opération. La contrepartie est toujours le XOF. */
  currencyCode: z.string().trim().toUpperCase().length(3),
  amount: z.number().positive('Le montant doit être supérieur à zéro.').max(1_000_000_000),
  /** SOURCE = « je donne ce montant », TARGET = « je veux recevoir ce montant ». */
  side: z.enum(['SOURCE', 'TARGET']).default('SOURCE'),
  /** Agence choisie : certains taux sont différenciés (aéroport, par exemple). */
  agencyId: z.string().cuid().nullish(),
});

export const lockSchema = simulateSchema;

export type SimulateInput = z.infer<typeof simulateSchema>;
export type LockInput = z.infer<typeof lockSchema>;
