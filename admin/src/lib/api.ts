/**
 * SEUL point d'accès réseau du dashboard. Aucun `fetch` dans un composant.
 *
 * Le jeton d'accès vit en mémoire (jamais en localStorage : un XSS le lirait),
 * et le rafraîchissement s'appuie sur le refresh token gardé par le contexte
 * d'authentification.
 */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3061').replace(
  /\/$/,
  '',
);

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface Options {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  token?: string | null;
}

export async function apiFetch<T>(path: string, options: Options = {}): Promise<T> {
  const { method = 'GET', body, token } = options;
  let response: Response;
  try {
    response = await fetch(`${API_URL}/api${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('API injoignable. Vérifiez qu’elle tourne sur le port 3061.', 0);
  }

  const text = await response.text();
  const data: unknown = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const payload = data as { message?: string; errors?: Array<{ message: string }> } | null;
    throw new ApiError(
      payload?.errors?.map((issue) => issue.message).join(' ') ??
        payload?.message ??
        'Une erreur est survenue.',
      response.status,
    );
  }
  return data as T;
}

// --- Types partagés avec l'API (frontière réseau : un contrat, pas un import) --

export type Role = 'CLIENT' | 'OPERATEUR' | 'ADMIN' | 'SUPER_ADMIN';
export type KycStatus = 'NON_SOUMIS' | 'EN_ATTENTE' | 'VALIDE' | 'REJETE';

export interface StaffUser {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  role: Role;
  agencyId: string | null;
}

export interface AuthResponse {
  user: StaffUser;
  accessToken: string;
  refreshToken: string;
}

export interface KycDocumentRow {
  id: string;
  type: string;
  status: KycStatus;
  documentNumber: string | null;
  expiresAt: string | null;
  hasSelfie: boolean;
  rejectReason: string | null;
  createdAt: string;
  reviewedAt: string | null;
  client?: {
    id: string;
    firstName: string;
    lastName: string;
    phone: string;
    email: string | null;
  };
}

export const auth = {
  login: (identifier: string, password: string) =>
    apiFetch<AuthResponse>('/auth/login', { method: 'POST', body: { identifier, password } }),
  refresh: (refreshToken: string) =>
    apiFetch<AuthResponse>('/auth/refresh', { method: 'POST', body: { refreshToken } }),
  logout: (refreshToken: string) =>
    apiFetch<void>('/auth/logout', { method: 'POST', body: { refreshToken } }),
};

export type TransactionStatus =
  | 'CREEE'
  | 'RECU_SOUMIS'
  | 'RECU_VALIDE'
  | 'RECU_REJETE'
  | 'CHANGE_EXECUTE'
  | 'PRETE_POUR_RETRAIT'
  | 'CLOTUREE'
  | 'ANNULEE';

export interface TransactionRow {
  id: string;
  reference: string;
  status: TransactionStatus;
  statusLabel: string;
  direction: 'ACHAT_DEVISE' | 'VENTE_DEVISE';
  sourceCurrency: string;
  targetCurrency: string;
  sourceAmount: string;
  targetAmount: string;
  appliedRate: string;
  commissionPct: string;
  commissionAmount: string;
  amountXof: string;
  depositMethod: string;
  payoutMethod: string | null;
  payoutDetails: string | null;
  createdAt: string;
  agency: { id: string; name: string; city: string } | null;
  client?: { id: string; firstName: string; lastName: string; phone: string };
  receipts: Array<{
    id: string;
    status: string;
    rejectReason: string | null;
    createdAt: string;
    validatedAt: string | null;
  }>;
  timeline: Array<{
    status: TransactionStatus;
    label: string;
    at: string | null;
    done: boolean;
    current: boolean;
  }>;
}

export interface ReceiptRow {
  id: string;
  status: string;
  createdAt: string;
  declaredAmount: string | null;
  declaredRef: string | null;
  transaction: TransactionRow;
}

export const transactions = {
  list: (token: string, params: Record<string, string> = {}) =>
    apiFetch<TransactionRow[]>(`/transactions?${new URLSearchParams(params).toString()}`, { token }),
  receiptQueue: (token: string, status = 'EN_ATTENTE') =>
    apiFetch<ReceiptRow[]>(`/transactions/receipts/queue?status=${status}`, { token }),
  approveReceipt: (id: string, declaredAmount: number | undefined, token: string) =>
    apiFetch<TransactionRow>(`/transactions/receipts/${id}/approve`, {
      method: 'POST',
      body: declaredAmount === undefined ? {} : { declaredAmount },
      token,
    }),
  rejectReceipt: (id: string, reason: string, token: string) =>
    apiFetch<TransactionRow>(`/transactions/receipts/${id}/reject`, {
      method: 'POST',
      body: { reason },
      token,
    }),
  markReady: (id: string, token: string) =>
    apiFetch<TransactionRow>(`/transactions/${id}/ready`, { method: 'POST', token }),
  close: (id: string, token: string) =>
    apiFetch<TransactionRow>(`/transactions/${id}/close`, { method: 'POST', token }),
};

/**
 * Téléchargement d'un fichier protégé (export, justificatif).
 *
 * L'URL exige un jeton en en-tête : on ne peut donc pas se contenter d'un
 * `<a href>`. On récupère le binaire, on déclenche la sauvegarde par une ancre
 * temporaire, et **on révoque l'URL d'objet** — sans quoi le fichier reste en
 * mémoire tant que l'onglet vit.
 */
export async function downloadProtected(
  path: string,
  fallbackName: string,
  token: string,
): Promise<void> {
  const response = await fetch(`${API_URL}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new ApiError(
      (JSON.parse(detail || '{}') as { message?: string }).message ?? 'Téléchargement impossible.',
      response.status,
    );
  }

  // Le serveur nomme le fichier ; l'en-tête fait foi sur le nom local.
  const disposition = response.headers.get('content-disposition') ?? '';
  const named = /filename="([^"]+)"/.exec(disposition)?.[1];

  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = named ?? fallbackName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Couleur de statut — miroir de `statusColors` dans `tokens.ts`. */
export const STATUS_CLASS: Record<TransactionStatus, string> = {
  CREEE: 'bg-status-creee/15 text-status-creee',
  RECU_SOUMIS: 'bg-status-recu-soumis/15 text-status-recu-soumis',
  RECU_VALIDE: 'bg-status-recu-valide/15 text-status-recu-valide',
  RECU_REJETE: 'bg-status-recu-rejete/15 text-status-recu-rejete',
  CHANGE_EXECUTE: 'bg-status-execute/15 text-status-execute',
  PRETE_POUR_RETRAIT: 'bg-status-prete/20 text-secondary-hover',
  CLOTUREE: 'bg-status-cloturee/15 text-status-cloturee',
  ANNULEE: 'bg-status-annulee/15 text-status-annulee',
};

export interface Agency {
  id: string;
  code: string;
  name: string;
  city: string;
}

export interface CashBalance {
  currency: { code: string; symbol: string; decimals: number };
  amount: string;
  updatedAt: string;
}

export interface CashMovement {
  id: string;
  type: string;
  currency: { code: string; decimals: number };
  amount: string;
  balanceAfter: string;
  note: string | null;
  reference: string | null;
  author: string;
  createdAt: string;
}

export interface CashClosure {
  id: string;
  businessDay: string;
  closedBy: string;
  note: string | null;
  lines: Array<{
    currency: { code: string; decimals: number };
    expected: string;
    counted: string;
    difference: string;
  }>;
}

export const MOVEMENT_LABEL: Record<string, string> = {
  ALIMENTATION: 'Alimentation',
  RETRAIT: 'Retrait',
  ENTREE_TRANSACTION: 'Encaissement',
  SORTIE_TRANSACTION: 'Décaissement',
  AJUSTEMENT: 'Ajustement',
  CLOTURE_JOURNALIERE: 'Clôture',
};

export const cash = {
  agencies: () => apiFetch<Agency[]>('/agencies'),
  balances: (agencyId: string, token: string) =>
    apiFetch<CashBalance[]>(`/cash/${agencyId}/balances`, { token }),
  movements: (agencyId: string, token: string) =>
    apiFetch<CashMovement[]>(`/cash/${agencyId}/movements`, { token }),
  closures: (agencyId: string, token: string) =>
    apiFetch<CashClosure[]>(`/cash/${agencyId}/closures`, { token }),
  move: (
    agencyId: string,
    body: { currencyCode: string; type: string; amount: number; note?: string },
    token: string,
  ) => apiFetch<{ balance: string }>(`/cash/${agencyId}/movements`, { method: 'POST', body, token }),
  closeDay: (
    agencyId: string,
    counts: Array<{ currencyCode: string; countedAmount: number }>,
    token: string,
  ) =>
    apiFetch<{ closureId: string }>(`/cash/${agencyId}/close-day`, {
      method: 'POST',
      body: { counts },
      token,
    }),
};

export const kyc = {
  queue: (status: KycStatus, token: string) =>
    apiFetch<KycDocumentRow[]>(`/kyc/queue?status=${status}`, { token }),
  approve: (id: string, token: string) =>
    apiFetch<KycDocumentRow>(`/kyc/documents/${id}/approve`, { method: 'POST', token }),
  reject: (id: string, reason: string, token: string) =>
    apiFetch<KycDocumentRow>(`/kyc/documents/${id}/reject`, {
      method: 'POST',
      body: { reason },
      token,
    }),
};

/**
 * URL d'une pièce déposée. Elle n'est PAS publique : le jeton part en en-tête,
 * donc l'image se charge par `fetch` puis `URL.createObjectURL`, jamais par un
 * `<img src>` direct.
 */
export async function fetchProtectedImage(
  documentId: string,
  kind: 'document' | 'selfie',
  token: string,
): Promise<string> {
  return protectedBlob(`/api/kyc/documents/${documentId}/file?kind=${kind}`, token);
}

/** Justificatif de paiement — même règle : l'URL exige un jeton. */
export async function fetchReceiptImage(receiptId: string, token: string): Promise<string> {
  return protectedBlob(`/api/transactions/receipts/${receiptId}/file`, token);
}

async function protectedBlob(path: string, token: string): Promise<string> {
  const response = await fetch(`${API_URL}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new ApiError('Document illisible.', response.status);
  return URL.createObjectURL(await response.blob());
}
