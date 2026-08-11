import { z } from 'zod';

/**
 * Schémas d'entrée de l'authentification.
 * ⚠️ Ces schémas sont destinés à être RECOPIÉS tels quels côté mobile et
 * dashboard : la règle de validation s'écrit une fois, elle se vérifie des deux
 * côtés de la frontière réseau.
 */

/** Numéro ivoirien : 10 chiffres, avec ou sans +225, espaces tolérés. */
export const phoneSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s.-]/g, ''))
  .refine((value) => /^(\+?225)?[0-9]{10}$/.test(value), {
    message: 'Numéro invalide. Format attendu : 0700000000 ou +2250700000000.',
  })
  .transform((value) => (value.startsWith('+225') ? value.slice(4) : value.replace(/^225/, '')));

export const passwordSchema = z
  .string()
  .min(8, 'Le mot de passe doit faire au moins 8 caractères.')
  .max(72, 'Mot de passe trop long.')
  .regex(/[A-Za-z]/, 'Le mot de passe doit contenir au moins une lettre.')
  .regex(/[0-9]/, 'Le mot de passe doit contenir au moins un chiffre.');

export const registerSchema = z.object({
  firstName: z.string().trim().min(2, 'Prénom trop court.').max(60),
  lastName: z.string().trim().min(2, 'Nom trop court.').max(60),
  phone: phoneSchema,
  email: z.string().trim().toLowerCase().email('Email invalide.').optional(),
  password: passwordSchema,
});

export const loginSchema = z.object({
  /** Numéro de téléphone OU email — le client se connecte comme il s'est inscrit. */
  identifier: z.string().trim().min(4, 'Identifiant requis.'),
  password: z.string().min(1, 'Mot de passe requis.'),
});

export const refreshSchema = z.object({
  /** Optionnel : le dashboard envoie le jeton par cookie, le mobile par le corps. */
  refreshToken: z.string().min(10).optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
