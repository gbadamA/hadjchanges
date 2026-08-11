import { DocumentType, KycStatus } from '@prisma/client';
import { z } from 'zod';

/** Types de pièce acceptés au dépôt — le selfie n'en est pas un, c'est un complément. */
export const IDENTITY_TYPES = [
  DocumentType.CNI,
  DocumentType.PASSEPORT,
  DocumentType.PERMIS,
  DocumentType.CARTE_CONSULAIRE,
] as const;

export const submitKycSchema = z.object({
  type: z.enum(IDENTITY_TYPES),
  documentNumber: z.string().trim().min(4).max(32).optional(),
  /** Date d'expiration de la pièce, au format ISO. */
  expiresAt: z.coerce.date().optional(),
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
