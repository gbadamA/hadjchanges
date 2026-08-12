import {
  ArrowLeftRight,
  BadgeCheck,
  Banknote,
  BarChart3,
  Building2,
  ReceiptText,
  ScrollText,
  Settings,
  ShieldAlert,
  Store,
  TrendingUp,
  UserCog,
  Users,
  type LucideIcon,
} from 'lucide-react';
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
  /**
   * Icône de l'entrée. Choisie pour être reconnaissable **sans lire le
   * libellé** : au bout d'une semaine, l'agent vise la forme, pas le mot.
   */
  icon: LucideIcon;
}

export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

const ALL_STAFF: Role[] = ['OPERATEUR', 'ADMIN', 'SUPER_ADMIN'];
const MANAGERS: Role[] = ['ADMIN', 'SUPER_ADMIN'];

/**
 * Les groupes suivent la JOURNÉE d'un bureau de change, pas l'organigramme :
 * ce qu'on fait au comptoir d'abord, ce qu'on suit ensuite, ce qu'on pilote,
 * et enfin ce à quoi on touche rarement.
 */
export const NAVIGATION_GROUPS: NavGroup[] = [
  {
    id: 'comptoir',
    label: 'Au comptoir',
    items: [
      { href: '/guichet', label: 'Guichet', roles: ALL_STAFF, ready: true, icon: Store },
      { href: '/recus', label: 'Reçus de paiement', roles: ALL_STAFF, ready: true, icon: ReceiptText },
      { href: '/kyc', label: 'Identités', roles: ALL_STAFF, ready: true, icon: BadgeCheck },
    ],
  },
  {
    id: 'suivi',
    label: 'Suivi',
    items: [
      {
        href: '/transactions',
        label: 'Transactions',
        roles: ALL_STAFF,
        ready: true,
        icon: ArrowLeftRight,
      },
      { href: '/clients', label: 'Clients', roles: MANAGERS, ready: true, icon: Users },
    ],
  },
  {
    id: 'marche',
    label: 'Marché et réseau',
    items: [
      { href: '/taux', label: 'Taux', roles: MANAGERS, ready: true, icon: TrendingUp },
      { href: '/caisses', label: 'Caisses', roles: ALL_STAFF, ready: true, icon: Banknote },
      { href: '/agences', label: 'Agences', roles: MANAGERS, ready: true, icon: Building2 },
    ],
  },
  {
    id: 'pilotage',
    label: 'Pilotage',
    items: [
      { href: '/rapports', label: 'Rapports', roles: ALL_STAFF, ready: true, icon: BarChart3 },
      { href: '/conformite', label: 'Conformité', roles: MANAGERS, ready: true, icon: ShieldAlert },
      {
        href: '/audit',
        label: 'Journal d’audit',
        roles: MANAGERS,
        ready: true,
        icon: ScrollText,
      },
    ],
  },
  {
    id: 'administration',
    label: 'Administration',
    items: [
      { href: '/equipe', label: 'Équipe', roles: ['SUPER_ADMIN'], ready: true, icon: UserCog },
      { href: '/reglages', label: 'Réglages', roles: ['SUPER_ADMIN'], ready: true, icon: Settings },
    ],
  },
];

/** Toutes les entrées à plat — la garde de route s'en sert. */
export const NAVIGATION: NavItem[] = NAVIGATION_GROUPS.flatMap((group) => group.items);

/**
 * Groupes visibles pour un rôle. **Un groupe vidé par le filtrage disparaît** :
 * un opérateur ne doit pas voir un intitulé « Administration » qui ne s'ouvre
 * sur rien.
 */
export const navigationGroupsFor = (role: Role): NavGroup[] =>
  NAVIGATION_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => item.roles.includes(role)),
  })).filter((group) => group.items.length > 0);

export const navigationFor = (role: Role): NavItem[] =>
  NAVIGATION.filter((item) => item.roles.includes(role));

/** Groupe contenant la page ouverte — il doit être déplié à l'arrivée. */
export const groupOf = (pathname: string): string | null =>
  NAVIGATION_GROUPS.find((group) => group.items.some((item) => pathname.startsWith(item.href)))?.id ??
  null;

/** Libellé du rôle tel qu'affiché à l'agent. */
export const ROLE_LABEL: Record<Role, string> = {
  CLIENT: 'Client',
  OPERATEUR: 'Opérateur',
  ADMIN: 'Administrateur',
  SUPER_ADMIN: 'Super-administrateur',
};
