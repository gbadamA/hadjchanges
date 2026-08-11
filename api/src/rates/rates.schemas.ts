import { z } from 'zod';

/** Un taux se saisit en nombre décimal positif, jamais en flottant négatif. */
const rateValue = z
  .number()
  .positive('Un taux doit être strictement positif.')
  .max(1_000_000, 'Taux hors limites.');

export const publishRateSchema = z
  .object({
    currencyCode: z.string().trim().toUpperCase().length(3),
    /** Ce que le bureau PAIE au client qui apporte la devise. */
    buyRate: rateValue,
    /** Ce que le client PAIE pour obtenir la devise. */
    sellRate: rateValue,
    commissionPct: z.number().min(0).max(50).default(0),
    /** null / absent = taux global, toutes agences. */
    agencyId: z.string().cuid().nullish(),
    /** Publication différée possible ; par défaut, immédiate. */
    effectiveFrom: z.coerce.date().optional(),
  })
  .refine((input) => input.sellRate >= input.buyRate, {
    path: ['sellRate'],
    // Un bureau qui vend moins cher qu'il n'achète perd de l'argent à chaque
    // opération. C'est presque toujours une inversion de saisie.
    message: "Le taux de vente doit être supérieur ou égal au taux d'achat.",
  });

export type PublishRateInput = z.infer<typeof publishRateSchema>;
