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

/** « il y a 2 h », « il y a 3 j » — fraîcheur d'un taux. */
export const timeAgo = (iso: string): string => {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  return `il y a ${Math.floor(hours / 24)} j`;
};
