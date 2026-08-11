import type { Role } from './api';

/**
 * Matrice de navigation — **la même que celle appliquée par l'API**.
 *
 * Un module invisible dans le menu doit aussi être refusé côté serveur : le
 * menu n'est pas une sécurité, c'est une commodité. Quand on ajoute une entrée
 * ici, on vérifie que le `@Roles` du contrôleur correspondant dit la même chose.
 */
export interface NavItem {
  href: string;
  label: string;
  roles: Role[];
  /** Faux tant que la page n'existe pas — affichée en grisé, jamais cliquable. */
  ready: boolean;
}

const ALL_STAFF: Role[] = ['OPERATEUR', 'ADMIN', 'SUPER_ADMIN'];
const MANAGERS: Role[] = ['ADMIN', 'SUPER_ADMIN'];

export const NAVIGATION: NavItem[] = [
  { href: '/kyc', label: 'Identités', roles: ALL_STAFF, ready: true },
  { href: '/recus', label: 'Reçus de paiement', roles: ALL_STAFF, ready: false },
  { href: '/transactions', label: 'Transactions', roles: ALL_STAFF, ready: false },
  { href: '/taux', label: 'Taux', roles: MANAGERS, ready: false },
  { href: '/clients', label: 'Clients', roles: MANAGERS, ready: false },
  { href: '/caisses', label: 'Caisses', roles: ALL_STAFF, ready: false },
  { href: '/agences', label: 'Agences', roles: MANAGERS, ready: false },
  { href: '/rapports', label: 'Rapports', roles: MANAGERS, ready: false },
  { href: '/equipe', label: 'Équipe', roles: ['SUPER_ADMIN'], ready: false },
  { href: '/audit', label: 'Journal d’audit', roles: MANAGERS, ready: false },
];

export const navigationFor = (role: Role): NavItem[] =>
  NAVIGATION.filter((item) => item.roles.includes(role));

/** Libellé du rôle tel qu'affiché à l'agent. */
export const ROLE_LABEL: Record<Role, string> = {
  CLIENT: 'Client',
  OPERATEUR: 'Opérateur',
  ADMIN: 'Administrateur',
  SUPER_ADMIN: 'Super-administrateur',
};
