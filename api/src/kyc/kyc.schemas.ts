import { DocumentType, KycStatus } from '@prisma/client';
import { z } from 'zod';

/** Types de pièce acceptés à la déclaration. */
export const IDENTITY_TYPES = [
  DocumentType.CNI,
  DocumentType.PASSEPORT,
  DocumentType.PERMIS,
  DocumentType.CARTE_CONSULAIRE,
] as const;

/**
 * Déclaration de la pièce par le client — SANS photo.
 *
 * Plus aucun fichier n'est déposé depuis l'application : l'agent vérifie
 * l'original de visu. Le numéro et l'expiration deviennent donc obligatoires,
 * puisqu'ils sont désormais la seule trace écrite de la pièce présentée.
 */
export const submitKycSchema = z.object({
  type: z.enum(IDENTITY_TYPES),
  documentNumber: z
    .string()
    .trim()
    .toUpperCase()
    .min(4, 'Numéro de pièce requis (4 caractères minimum).')
    .max(32),
  /** Date d'expiration de la pièce, au format ISO. */
  expiresAt: z.coerce
    .date({ errorMap: () => ({ message: 'Date d’expiration invalide.' }) })
    .refine((date) => date.getTime() > Date.now(), 'Cette pièce est expirée.'),
});

export const rejectKycSchema = z.object({
  // Un rejet sans motif est un rejet incompréhensible : le client doit savoir
  // quoi corriger pour re-soumettre.
  reason: z.string().trim().min(10, 'Le motif doit être explicite (10 caractères minimum).').max(500),
});

export const kycQueueSchema = z.object({
  status: z.nativeEnum(KycStatus).default(KycStatus.EN_ATTENTE),
  take: z.coerce.number().int().positive().max(100).default(50),
});

export type SubmitKycInput = z.infer<typeof submitKycSchema>;
export type RejectKycInput = z.infer<typeof rejectKycSchema>;
