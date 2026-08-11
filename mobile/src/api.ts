import type { Profile, RateRow } from './models';

/**
 * SEUL point d'accès réseau de l'application. Aucun `fetch` dans un écran :
 * quand l'URL, l'authentification ou la gestion d'erreur changent, ça se change
 * ici et nulle part ailleurs.
 *
 * ⚠️ `localhost` désigne le TÉLÉPHONE, pas le PC. En développement sur appareil
 * réel, renseigner l'IP Wi-Fi du poste dans `mobile/.env` :
 *   EXPO_PUBLIC_API_URL="http://192.168.1.10:3061"
 */
const BASE_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3061').replace(/\/$/, '');

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
    const message =
      (data as { message?: string | string[] } | null)?.message ?? 'Une erreur est survenue.';
    throw new ApiError(Array.isArray(message) ? message.join(', ') : message, response.status);
  }
  return data as T;
}

export const api = {
  /** Taux du jour — accessible sans compte (cahier §3.2). */
  rates: (agencyId?: string): Promise<RateRow[]> =>
    request<RateRow[]>(`/rates${agencyId ? `?agencyId=${agencyId}` : ''}`),

  me: (token: string): Promise<Profile> => request<Profile>('/users/me', { token }),
};
