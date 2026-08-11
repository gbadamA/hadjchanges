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
  const response = await fetch(`${API_URL}/api/kyc/documents/${documentId}/file?kind=${kind}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new ApiError('Pièce illisible.', response.status);
  return URL.createObjectURL(await response.blob());
}
