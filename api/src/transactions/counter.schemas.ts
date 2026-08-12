import { DocumentType, TransactionDirection } from '@prisma/client';
import { z } from 'zod';

/**
 * Opération au guichet : le client est **physiquement là**, avec ses espèces
 * et sa pièce d'identité.
 *
 * Le formulaire est celui que l'agent remplit en le regardant. D'où les choix :
 * pas de mot de passe, pas d'email obligatoire, mais une **pièce d'identité
 * obligatoire** — c'est elle qui remplace tout le parcours KYC de
 * l'application, et c'est la seule chose que le régulateur demandera.
 */
export const counterTransactionSchema = z.object({
  // --- Le client qui se présente -------------------------------------------
  customer: z.object({
    firstName: z.string().trim().min(2, 'Prénom trop court.').max(60),
    lastName: z.string().trim().min(2, 'Nom trop court.').max(60),
    /** Sert à retrouver un habitué et à lui envoyer son reçu. */
    phone: z.string().trim().min(8, 'Téléphone incomplet.').max(20),
    email: z.string().trim().email().optional(),
    /** Pièce présentée au guichet — jamais facultative. */
    idType: z.nativeEnum(DocumentType).refine((type) => type !== DocumentType.SELFIE, {
      message: 'Un selfie n’est pas une pièce d’identité.',
    }),
    idNumber: z.string().trim().min(4, 'Numéro de pièce incomplet.').max(40),
    idExpiresAt: z.coerce.date().optional(),
  }),

  // --- Qui reçoit les fonds ------------------------------------------------
  /** Vide = le client lui-même, le cas ordinaire. */
  beneficiary: z
    .object({
      name: z.string().trim().min(2).max(80),
      phone: z.string().trim().max(20).optional(),
      relation: z.string().trim().max(60).optional(),
    })
    .optional(),

  // --- L'opération ---------------------------------------------------------
  direction: z.nativeEnum(TransactionDirection),
  currencyCode: z.string().trim().toUpperCase().length(3),
  amount: z.number().positive('Le montant doit être supérieur à zéro.').max(1_000_000_000),
  side: z.enum(['SOURCE', 'TARGET']).default('SOURCE'),
  /** Absente = l'agence de l'opérateur. Un admin peut en désigner une autre. */
  agencyId: z.string().cuid().optional(),
  note: z.string().trim().max(300).optional(),
});

export type CounterTransactionInput = z.infer<typeof counterTransactionSchema>;
