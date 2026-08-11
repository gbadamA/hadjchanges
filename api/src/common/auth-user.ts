import { Role } from '@prisma/client';

/** Ce que porte un access token, et rien de plus. */
export interface AuthUser {
  id: string;
  role: Role;
  /** Agence de rattachement — renseignée pour un OPERATEUR. */
  agencyId: string | null;
}

/** Rôles internes : tout sauf le client final. */
export const STAFF_ROLES: Role[] = [Role.OPERATEUR, Role.ADMIN, Role.SUPER_ADMIN];

/** Rôles qui peuvent administrer le paramétrage (taux, clients, agences). */
export const ADMIN_ROLES: Role[] = [Role.ADMIN, Role.SUPER_ADMIN];
