/**
 * Types et helpers de formatage côté client.
 *
 * Ces types sont le MIROIR du contrat de l'API, recopiés à dessein : la
 * frontière réseau est un contrat, pas un import. Si l'API change, ce fichier
 * change — et le compilateur montre où.
 */

export type Trend = 'up' | 'down' | 'flat';

export interface CurrencyRef {
  code: string;
  name: string;
  symbol: string;
  decimals: number;
}

/** Une ligne du tableau des taux, telle que la renvoie GET /rates. */
export interface RateRow {
  currency: CurrencyRef;
  /** Chaînes et non nombres : l'API sérialise les décimaux en texte, exprès. */
  buyRate: string;
  sellRate: string;
  commissionPct: string;
  trend: Trend;
  trendPct: string;
  effectiveFrom: string;
  stale: boolean;
  agencyId: string | null;
}

/** Sens de l'opération, vu du bureau (identique à l'enum Prisma). */
export type TransactionDirection = 'ACHAT_DEVISE' | 'VENTE_DEVISE';

/**
 * Résultat d'une simulation. `lockedUntil` et `id` valent null tant que le
 * client n'a pas verrouillé : une simulation n'est pas une promesse.
 */
export interface Quote {
  id: string | null;
  reference: string | null;
  direction: TransactionDirection;
  sourceCurrency: string;
  targetCurrency: string;
  sourceAmount: string;
  targetAmount: string;
  appliedRate: string;
  commissionPct: string;
  commissionAmount: string;
  amountXof: string;
  lockedUntil: string | null;
}

export type TransactionStatus =
  | 'CREEE'
  | 'RECU_SOUMIS'
  | 'RECU_VALIDE'
  | 'RECU_REJETE'
  | 'CHANGE_EXECUTE'
  | 'PRETE_POUR_RETRAIT'
  | 'CLOTUREE'
  | 'ANNULEE';

export type DepositMethod =
  | 'ORANGE_MONEY'
  | 'MTN_MOMO'
  | 'MOOV_MONEY'
  | 'WAVE'
  | 'CARTE_BANCAIRE'
  | 'ESPECES_AGENCE';

export type PayoutMethod = 'ESPECES_AGENCE' | 'MOBILE_MONEY' | 'VIREMENT_BANCAIRE';

export interface Agency {
  id: string;
  code: string;
  name: string;
  city: string;
  address: string | null;
  phone: string | null;
}

export interface TimelineStep {
  status: TransactionStatus;
  label: string;
  at: string | null;
  done: boolean;
  current: boolean;
}

export interface Transaction {
  id: string;
  reference: string;
  status: TransactionStatus;
  statusLabel: string;
  direction: TransactionDirection;
  sourceCurrency: string;
  targetCurrency: string;
  sourceAmount: string;
  targetAmount: string;
  appliedRate: string;
  commissionPct: string;
  commissionAmount: string;
  amountXof: string;
  depositMethod: DepositMethod;
  payoutMethod: PayoutMethod | null;
  payoutDetails: string | null;
  cancelReason: string | null;
  createdAt: string;
  agency: { id: string; name: string; city: string } | null;
  receipts: Array<{
    id: string;
    status: string;
    rejectReason: string | null;
    createdAt: string;
    validatedAt: string | null;
  }>;
  timeline: TimelineStep[];
}

/** Libellés des moyens de dépôt — jamais l'enum brute à l'écran. */
export const DEPOSIT_LABEL: Record<DepositMethod, string> = {
  ORANGE_MONEY: 'Orange Money',
  MTN_MOMO: 'MTN MoMo',
  MOOV_MONEY: 'Moov Money',
  WAVE: 'Wave',
  CARTE_BANCAIRE: 'Carte bancaire',
  ESPECES_AGENCE: 'Espèces en agence',
};

export const PAYOUT_LABEL: Record<PayoutMethod, string> = {
  ESPECES_AGENCE: 'Espèces en agence',
  MOBILE_MONEY: 'Mobile money',
  VIREMENT_BANCAIRE: 'Virement bancaire',
};

export type KycStatus = 'NON_SOUMIS' | 'EN_ATTENTE' | 'VALIDE' | 'REJETE';

export interface Profile {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  role: 'CLIENT' | 'OPERATEUR' | 'ADMIN' | 'SUPER_ADMIN';
  kycStatus: KycStatus;
  kycRejectReason: string | null;
}

/** Libellé lisible d'un statut KYC — un seul endroit pour tout le mobile. */
export const KYC_LABEL: Record<KycStatus, string> = {
  NON_SOUMIS: 'Identité à vérifier',
  EN_ATTENTE: 'Vérification en cours',
  VALIDE: 'Identité vérifiée',
  REJETE: 'Pièce refusée',
};

/** Montant en FCFA : pas de décimale, séparateur d'espace insécable. */
export const fcfa = (value: number | string): string => {
  const amount = typeof value === 'string' ? Number(value) : value;
  if (Number.isNaN(amount)) return '—';
  return `${Math.round(amount).toLocaleString('fr-FR').replace(/ |\s/g, ' ')} FCFA`;
};

/** Taux affiché : on garde 2 décimales, c'est ce qui parle au client. */
export const formatRate = (value: string): string => {
  const amount = Number(value);
  if (Number.isNaN(amount)) return value;
  return amount.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

/** Montant dans une devise quelconque, avec le bon nombre de décimales. */
export const money = (value: string | number, decimals: number, symbol: string): string => {
  const amount = typeof value === 'string' ? Number(value) : value;
  if (Number.isNaN(amount)) return '—';
  const formatted = amount.toLocaleString('fr-FR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${formatted} ${symbol}`;
};

/** Compte à rebours d'un verrou : « 28 min 04 s ». Vide si l'échéance est passée. */
export const countdown = (iso: string, now: number = Date.now()): string => {
  const remaining = Math.max(0, new Date(iso).getTime() - now);
  if (remaining === 0) return '';
  const minutes = Math.floor(remaining / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1000);
  return `${minutes} min ${String(seconds).padStart(2, '0')} s`;
};

/** « il y a 2 h », « il y a 3 j » — fraîcheur d'un taux. */
export const timeAgo = (iso: string): string => {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  return `il y a ${Math.floor(hours / 24)} j`;
};
