import type { Profile, Quote, RateRow, TransactionDirection } from './models';

/**
 * SEUL point d'accès réseau de l'application. Aucun `fetch` dans un écran :
 * quand l'URL, l'authentification ou la gestion d'erreur changent, ça se change
 * ici et nulle part ailleurs.
 *
 * ⚠️ `localhost` désigne le TÉLÉPHONE, pas le PC. En développement sur appareil
 * réel, renseigner l'IP Wi-Fi du poste dans `mobile/.env` :
 *   EXPO_PUBLIC_API_URL="http://192.168.1.10:3061"
 */
export const BASE_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3061').replace(
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

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  token?: string | null;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, token } = options;
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/api${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    // Distinguer « le serveur refuse » de « le réseau ne passe pas » : sur
    // mobile, le second cas est le plus fréquent et appelle un autre message.
    throw new ApiError('Connexion impossible. Vérifiez votre réseau.', 0);
  }

  const text = await response.text();
  const data: unknown = text ? JSON.parse(text) : null;

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

/** Fichier choisi dans la galerie ou pris à l'appareil photo. */
export interface PickedFile {
  uri: string;
  name: string;
  type: string;
}

export interface KycState {
  status: 'NON_SOUMIS' | 'EN_ATTENTE' | 'VALIDE' | 'REJETE';
  document: {
    id: string;
    type: string;
    status: string;
    hasSelfie: boolean;
    rejectReason: string | null;
    createdAt: string;
  } | null;
}

/**
 * Dépôt de fichiers. **Ne jamais poser soi-même l'en-tête `content-type`** sur
 * un envoi multipart : le moteur doit y placer sa frontière (`boundary`), sinon
 * le serveur ne sait pas découper le corps et rejette tout.
 */
async function upload<T>(
  path: string,
  { token, fields, files }: { token: string; fields: Record<string, string>; files: Record<string, PickedFile> },
): Promise<T> {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  for (const [key, file] of Object.entries(files)) {
    form.append(key, { uri: file.uri, name: file.name, type: file.type } as unknown as Blob);
  }

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/api${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: form,
    });
  } catch {
    throw new ApiError('Envoi impossible. Vérifiez votre réseau.', 0);
  }

  const text = await response.text();
  const data: unknown = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const payload = data as { message?: string; errors?: Array<{ message: string }> } | null;
    throw new ApiError(
      payload?.errors?.map((issue) => issue.message).join('\n') ??
        payload?.message ??
        'Envoi refusé.',
      response.status,
    );
  }
  return data as T;
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

  /** Dépôt de la pièce d'identité — le selfie est facultatif mais recommandé. */
  submitKyc: (
    input: { type: string; documentNumber?: string; document: PickedFile; selfie?: PickedFile },
    token: string,
  ): Promise<KycState['document']> =>
    upload<KycState['document']>('/kyc/documents', {
      token,
      fields: {
        type: input.type,
        ...(input.documentNumber ? { documentNumber: input.documentNumber } : {}),
      },
      files: { document: input.document, ...(input.selfie ? { selfie: input.selfie } : {}) },
    }),

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

  logout: (refreshToken: string): Promise<void> =>
    request<void>('/auth/logout', { method: 'POST', body: { refreshToken } }),
};
