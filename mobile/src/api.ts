import { API_BASE_URL } from './api-url';
import type {
  Agency,
  DepositMethod,
  PayoutMethod,
  Profile,
  Quote,
  RateRow,
  Transaction,
  TransactionDirection,
  TransactionStatus,
} from './models';

export interface AppNotification {
  id: string;
  title: string;
  body: string;
  deepLink: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface RateAlert {
  id: string;
  currency: { code: string; symbol: string };
  thresholdRate: string;
  active: boolean;
  triggeredAt: string | null;
  createdAt: string;
}

export interface LimitsView {
  daily: { limitXof: string; usedXof: string; remainingXof: string; inherited: boolean };
  monthly: { limitXof: string; usedXof: string; remainingXof: string; inherited: boolean };
}

export interface PublicSettings {
  depositNumbers: Partial<Record<DepositMethod, string>>;
  /** Contenu du QR marchand du bureau, par réseau — absent s'il n'est pas enregistré. */
  merchantQr: Partial<Record<DepositMethod, string>>;
  rateLockMinutes: number;
}

/** Tableau du jour de l'agent, compté par l'API dans le périmètre de son agence. */
export interface StaffBoard {
  aEncaisser: number;
  aRemettre: number;
  clotureesAujourdhui: number;
  volumeXofAujourdhui: string;
}

/** Opération au guichet : le client est là, avec sa pièce et son argent. */
export interface CounterInput {
  customer: {
    firstName: string;
    lastName: string;
    phone: string;
    idType: 'CNI' | 'PASSEPORT' | 'PERMIS' | 'CARTE_CONSULAIRE';
    idNumber: string;
  };
  direction: TransactionDirection;
  currencyCode: string;
  amount: number;
  side: 'SOURCE' | 'TARGET';
  depositMethod: DepositMethod;
  paymentRef?: string;
  /** Exigée pour l'encadrement, qui n'a pas d'agence ; déduite pour un opérateur. */
  agencyId?: string;
}

export interface CreateTransactionInput {
  quoteId?: string;
  direction?: TransactionDirection;
  currencyCode?: string;
  amount?: number;
  side?: 'SOURCE' | 'TARGET';
  agencyId?: string | null;
  depositMethod: DepositMethod;
  payoutMethod: PayoutMethod;
  payoutDetails?: string;
  /** Renseigné seulement si les fonds vont à quelqu'un d'autre. */
  beneficiary?: { name: string; phone?: string; relation?: string };
}

/**
 * SEUL point d'accès réseau de l'application. Aucun `fetch` dans un écran :
 * quand l'URL, l'authentification ou la gestion d'erreur changent, ça se change
 * ici et nulle part ailleurs.
 *
 * L'adresse est **déduite de l'hôte Metro** (voir `api-url.ts`) : le téléphone
 * ou l'émulateur qui a chargé le bundle sait forcément joindre cette machine.
 * Plus besoin d'aller chercher son IP Wi-Fi à chaque changement de réseau.
 * `EXPO_PUBLIC_API_URL` reste prioritaire pour viser un autre serveur.
 */
export const BASE_URL = API_BASE_URL;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Renouvellement du jeton d'accès, branché par le contexte d'authentification.
 *
 * ⚠️ Le jeton d'accès vit 15 minutes et n'était renouvelé QU'AU DÉMARRAGE de
 * l'application. Passé ce délai, tout appel échouait en 401 — et l'utilisateur
 * lisait un message technique sans rapport avec la vraie cause. Le cas le plus
 * visible : télécharger son justificatif, qui arrive forcément longtemps après
 * l'opération, une fois que l'opérateur a validé.
 *
 * Une fonction posée ici plutôt qu'un import direct du contexte : `api.ts` ne
 * doit rien savoir de React, sinon la couche réseau devient intestable.
 */
type Renouvellement = () => Promise<string | null>;
let renouveler: Renouvellement | null = null;

export function brancherRenouvellement(fn: Renouvellement | null): void {
  renouveler = fn;
}

/** Jeton frais, ou `null` si la session est réellement morte. */
export async function jetonRenouvele(): Promise<string | null> {
  if (!renouveler) return null;
  try {
    return await renouveler();
  } catch {
    return null;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  token?: string | null;
}

/**
 * Message lisible quand la réponse n'est PAS du JSON.
 *
 * ⚠️ Tout ce qui se trouve entre l'application et l'API peut répondre à sa
 * place, en HTML : hébergeur en panne (page « 502 Bad Gateway »), portail
 * Wi-Fi d'hôtel, proxy d'entreprise. `JSON.parse` bute alors sur le `<` de
 * `<!DOCTYPE html>` et lève « JSON Parse error: Unexpected character » — une
 * erreur de bas niveau qui remontait telle quelle jusqu'à l'écran du client,
 * en contournant toute la gestion d'erreur ci-dessous.
 */
function messageReponseIllisible(status: number): string {
  if (status === 502 || status === 503 || status === 504) {
    return 'Service momentanément indisponible. Réessayez dans un instant.';
  }
  if (status === 404) {
    return "Service introuvable à cette adresse. Vérifiez la configuration de l'application.";
  }
  if (status >= 200 && status < 300) {
    // Réponse « réussie » mais illisible : l'application ne parle presque
    // sûrement pas au bon serveur (l'adresse du dashboard, par exemple, rend
    // du HTML avec un code 200 parfaitement valide).
    return "Réponse inattendue du serveur. L'application ne pointe peut-être pas sur la bonne adresse.";
  }
  return `Réponse inattendue du serveur (${status}).`;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, token } = options;

  const envoyer = async (jeton: string | null | undefined): Promise<Response> => {
    try {
      return await fetch(`${BASE_URL}/api${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(jeton ? { authorization: `Bearer ${jeton}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      // Distinguer « le serveur refuse » de « le réseau ne passe pas » : sur
      // mobile, le second cas est le plus fréquent et appelle un autre message.
      throw new ApiError('Connexion impossible. Vérifiez votre réseau.', 0);
    }
  };

  let response = await envoyer(token);

  // Jeton expiré (15 min) : on le renouvelle et on rejoue UNE fois. Sans ça,
  // toute action après un quart d'heure échouait sur un message opaque.
  // ⚠️ Une seule tentative : si le nouveau jeton est refusé lui aussi, la
  // session est morte, et boucler ne ferait que multiplier les appels.
  if (response.status === 401 && token) {
    const frais = await jetonRenouvele();
    if (frais) response = await envoyer(frais);
  }

  const text = await response.text();

  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new ApiError(messageReponseIllisible(response.status), response.status);
    }
  }

  if (!response.ok) {
    const payload = data as { message?: string | string[]; errors?: Array<{ message: string }> } | null;
    // L'API renvoie soit un message, soit une liste d'erreurs de champ (Zod) :
    // le client doit toujours avoir quelque chose de lisible à afficher.
    const message =
      payload?.errors?.map((issue) => issue.message).join('\n') ??
      payload?.message ??
      'Une erreur est survenue.';
    throw new ApiError(Array.isArray(message) ? message.join(', ') : message, response.status);
  }
  return data as T;
}

export interface AuthResponse {
  user: Profile;
  accessToken: string;
  refreshToken: string;
}

export interface QuoteRequest {
  direction: TransactionDirection;
  currencyCode: string;
  amount: number;
  side: 'SOURCE' | 'TARGET';
  agencyId?: string | null;
}

export interface KycState {
  status: 'NON_SOUMIS' | 'EN_ATTENTE' | 'VALIDE' | 'REJETE';
  document: {
    id: string;
    type: string;
    status: string;
    documentNumber: string | null;
    expiresAt: string | null;
    rejectReason: string | null;
    createdAt: string;
  } | null;
}

export const api = {
  /** Taux du jour — accessible sans compte (cahier §3.2). */
  rates: (agencyId?: string): Promise<RateRow[]> =>
    request<RateRow[]>(`/rates${agencyId ? `?agencyId=${agencyId}` : ''}`),

  /** Simulation libre, sans engagement ni compte. */
  simulate: (input: QuoteRequest): Promise<Quote> =>
    request<Quote>('/quotes/simulate', { method: 'POST', body: input }),

  /** Verrouiller le taux engage le bureau : compte obligatoire. */
  lockQuote: (input: QuoteRequest, token: string): Promise<Quote> =>
    request<Quote>('/quotes/lock', { method: 'POST', body: input, token }),

  quote: (id: string, token: string): Promise<Quote> => request<Quote>(`/quotes/${id}`, { token }),

  me: (token: string): Promise<Profile> => request<Profile>('/users/me', { token }),

  kyc: (token: string): Promise<KycState> => request<KycState>('/kyc/me', { token }),

  /** Numéros de dépôt et durée du verrou — publics, nécessaires pour payer. */
  publicSettings: (): Promise<PublicSettings> => request<PublicSettings>('/settings/public'),

  agencies: (): Promise<Agency[]> => request<Agency[]>('/agencies'),

  createTransaction: (input: CreateTransactionInput, token: string): Promise<Transaction> =>
    request<Transaction>('/transactions', { method: 'POST', body: input, token }),

  myTransactions: (token: string): Promise<Transaction[]> =>
    request<Transaction[]>('/transactions/mine', { token }),

  transaction: (id: string, token: string): Promise<Transaction> =>
    request<Transaction>(`/transactions/${id}`, { token }),

  cancelTransaction: (id: string, token: string): Promise<Transaction> =>
    request<Transaction>(`/transactions/${id}/cancel`, { method: 'POST', body: {}, token }),

  /** Déclaration de la pièce d'identité — sans photo, l'agent vérifie l'original. */
  submitKyc: (
    input: { type: string; documentNumber: string; expiresAt: string },
    token: string,
  ): Promise<KycState['document']> =>
    request<KycState['document']>('/kyc/documents', { method: 'POST', body: input, token }),

  register: (input: {
    firstName: string;
    lastName: string;
    phone: string;
    email?: string;
    password: string;
  }): Promise<AuthResponse> => request<AuthResponse>('/auth/register', { method: 'POST', body: input }),

  login: (identifier: string, password: string): Promise<AuthResponse> =>
    request<AuthResponse>('/auth/login', { method: 'POST', body: { identifier, password } }),

  refresh: (refreshToken: string): Promise<AuthResponse> =>
    request<AuthResponse>('/auth/refresh', { method: 'POST', body: { refreshToken } }),

  notifications: (token: string): Promise<AppNotification[]> =>
    request<AppNotification[]>('/notifications', { token }),

  unreadCount: (token: string): Promise<{ unread: number }> =>
    request<{ unread: number }>('/notifications/unread-count', { token }),

  markNotificationsRead: (token: string): Promise<{ marked: number }> =>
    request<{ marked: number }>('/notifications/read', { method: 'POST', body: {}, token }),

  registerDevice: (deviceToken: string, platform: string, token: string): Promise<unknown> =>
    request('/notifications/devices', {
      method: 'POST',
      body: { token: deviceToken, platform },
      token,
    }),

  forgetDevice: (deviceToken: string, token: string): Promise<unknown> =>
    request(`/notifications/devices?token=${encodeURIComponent(deviceToken)}`, {
      method: 'DELETE',
      token,
    }),

  rateAlerts: (token: string): Promise<RateAlert[]> =>
    request<RateAlert[]>('/notifications/rate-alerts', { token }),

  createRateAlert: (currencyCode: string, thresholdRate: number, token: string): Promise<RateAlert> =>
    request<RateAlert>('/notifications/rate-alerts', {
      method: 'POST',
      body: { currencyCode, thresholdRate },
      token,
    }),

  removeRateAlert: (id: string, token: string): Promise<unknown> =>
    request(`/notifications/rate-alerts/${id}`, { method: 'DELETE', token }),

  myLimits: (token: string): Promise<LimitsView> => request<LimitsView>('/compliance/limits/me', { token }),

  logout: (refreshToken: string): Promise<void> =>
    request<void>('/auth/logout', { method: 'POST', body: { refreshToken } }),

  // ------------------------------------------------------------ paiements --

  /**
   * Ouvre une session de paiement mobile money.
   *
   * ⚠️ L'adresse rendue doit être ouverte par le NAVIGATEUR du téléphone, pas
   * dans une vue web embarquée : l'opérateur n'assure pas le retour vers
   * l'application depuis une webview.
   */
  openCheckout: (transactionId: string, token: string): Promise<CheckoutSession> =>
    request<CheckoutSession>(`/payments/transactions/${transactionId}/checkout`, {
      method: 'POST',
      body: {},
      token,
    }),

  // ----------------------------------------------- réservé au personnel ----

  paymentsBoard: (token: string): Promise<PaymentsBoard> =>
    request<PaymentsBoard>('/payments/tableau', { token }),

  /** ⚠️ Fait SORTIR de l'argent. Toujours faire confirmer avant d'appeler. */
  sendPayout: (transactionId: string, token: string): Promise<PayoutView> =>
    request<PayoutView>(`/payments/transactions/${transactionId}/payout`, {
      method: 'POST',
      body: {},
      token,
    }),

  reconcile: (token: string): Promise<{ versements: number; encaissements: number }> =>
    request('/payments/reconciliation', { method: 'POST', body: {}, token }),

  /**
   * Encaissement au comptoir : l'agent atteste avoir reçu les fonds, et le
   * change s'exécute dans la foulée.
   *
   * ⚠️ `referencePaiement` est la SEULE trace vérifiable quand le client a
   * payé par mobile money — il n'y a plus de justificatif conservé. À saisir
   * dès qu'elle existe.
   */
  collect: (
    transactionId: string,
    input: { declaredAmount?: number; declaredRef?: string; depositMethod?: DepositMethod },
    token: string,
  ): Promise<Transaction> =>
    request<Transaction>(`/transactions/${transactionId}/encaissement`, {
      method: 'POST',
      body: input,
      token,
    }),

  /**
   * Retrouve une opération par sa référence, scannée ou saisie au comptoir.
   *
   * ⚠️ Recherche EXACTE côté API. Une correspondance partielle ferait remonter
   * les voisines d'un numéro mal lu, et l'agent agirait sur la mauvaise
   * opération. Le cloisonnement par agence s'applique : un opérateur ne
   * retrouve pas ainsi l'opération d'une autre agence.
   */
  findTransaction: (reference: string, token: string): Promise<Transaction[]> =>
    request<Transaction[]>(`/transactions?reference=${encodeURIComponent(reference)}`, { token }),

  /** Tableau du jour : à encaisser, à remettre, fait aujourd'hui. */
  staffBoard: (token: string): Promise<StaffBoard> =>
    request<StaffBoard>('/transactions/board', { token }),

  /**
   * Toutes les opérations visibles par l'agent — l'API restreint un opérateur
   * à son agence, l'écran n'a rien à filtrer de plus.
   */
  staffTransactions: (
    filters: { statuses?: TransactionStatus[]; from?: string; take?: number },
    token: string,
  ): Promise<Transaction[]> => {
    const query = new URLSearchParams({ take: String(filters.take ?? 100) });
    if (filters.statuses?.length) query.set('statuses', filters.statuses.join(','));
    if (filters.from) query.set('from', filters.from);
    return request<Transaction[]>(`/transactions?${query.toString()}`, { token });
  },

  /**
   * ⚠️ Exécute le change, mouvemente la caisse et clôture en un seul appel :
   * toujours faire confirmer le montant avant.
   */
  counter: (input: CounterInput, token: string): Promise<Transaction> =>
    request<Transaction>('/transactions/counter', { method: 'POST', body: input, token }),

  /** Réservé au super-administrateur (QR marchands, numéros de dépôt). */
  updateSetting: (key: string, value: string, token: string): Promise<{ key: string; value: string }> =>
    request(`/settings/${key}`, { method: 'PATCH', body: { value }, token }),

  /** Les fonds sont disponibles : le client peut venir les chercher. */
  markReady: (transactionId: string, token: string): Promise<Transaction> =>
    request<Transaction>(`/transactions/${transactionId}/ready`, {
      method: 'POST',
      body: {},
      token,
    }),

  /** Remis au client : l'opération est terminée et son justificatif émis. */
  closeTransaction: (transactionId: string, token: string): Promise<Transaction> =>
    request<Transaction>(`/transactions/${transactionId}/close`, {
      method: 'POST',
      body: {},
      token,
    }),
};

export interface CheckoutSession {
  urlPaiement: string;
  idSession: string;
  expireLe: string | null;
  /** Faux quand le paiement est simulé : à dire au client, jamais à cacher. */
  reel: boolean;
}

export interface PayoutPending {
  transactionId: string;
  reference: string;
  montantXof: string;
  beneficiaire: string;
  mobile: string | null;
  tentativesEchouees: number;
  agence: string | null;
}

export interface PaymentsBoard {
  fournisseur: string;
  reel: boolean;
  /** Nul quand le fournisseur ne répond pas : l'écran reste utilisable. */
  soldeXof: string | null;
  aVerser: PayoutPending[];
  journal: Array<{
    id: string;
    sens: 'ENTREE' | 'SORTIE';
    reference: string;
    statut: string;
    montantXof: string;
    fraisXof: string | null;
    tiers: string | null;
    codeEchec: string | null;
    le: string;
  }>;
  encaissementsEnAttente: number;
  versementsEnCours: number;
}

export interface PayoutView {
  id: string;
  statut: 'EN_COURS' | 'REUSSI' | 'ECHOUE' | 'ANNULE';
  montantRecuXof: string;
  fraisXof: string | null;
  mobile: string;
  tentatives: number;
  codeEchec: string | null;
  idFournisseur: string | null;
  creeLe: string;
}
