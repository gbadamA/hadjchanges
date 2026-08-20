import * as FileSystem from 'expo-file-system/legacy';
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
  rateLockMinutes: number;
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
 * Dépôt de fichiers, via `uploadAsync` d'expo-file-system.
 *
 * ⚠️ PAS `fetch` + `FormData`. C'est ce qu'on faisait, et ça échouait sur tout
 * appareil en Android 13 ou plus : le moteur réseau de React Native doit ouvrir
 * lui-même le fichier rendu par le sélecteur, or l'application n'a aucune
 * permission de lecture dessus — `READ_EXTERNAL_STORAGE` est plafonnée à
 * Android 12 (`maxSdkVersion=32`) et `READ_MEDIA_IMAGES` n'est pas déclarée.
 * L'ouverture échouait, `fetch` levait une exception, et l'utilisateur lisait
 * « Envoi impossible. Vérifiez votre réseau. » — un message qui accusait le
 * réseau alors que le réseau n'y était pour rien.
 *
 * `uploadAsync` lit le fichier CÔTÉ NATIF, avec les droits accordés au
 * sélecteur, puis compose le multipart lui-même (et y place sa propre frontière
 * `boundary` : ne jamais poser `content-type` à la main ici).
 *
 * Un fichier par appel — contrainte de l'API, sans conséquence : la pièce
 * d'identité et le selfie partent déjà en deux envois distincts.
 */
async function upload<T>(
  path: string,
  { token, fields, files }: { token: string; fields: Record<string, string>; files: Record<string, PickedFile> },
): Promise<T> {
  const entrees = Object.entries(files);
  if (entrees.length === 0) throw new ApiError('Aucun fichier à envoyer.', 0);

  let dernier: FileSystem.FileSystemUploadResult | null = null;
  let jeton = token;

  for (const [champ, fichier] of entrees) {
    const envoyer = (avec: string): Promise<FileSystem.FileSystemUploadResult> =>
      FileSystem.uploadAsync(`${BASE_URL}/api${path}`, fichier.uri, {
        httpMethod: 'POST',
        uploadType: FileSystem.FileSystemUploadType.MULTIPART,
        fieldName: champ,
        mimeType: fichier.type,
        headers: { authorization: `Bearer ${avec}` },
        parameters: fields,
      });

    let resultat: FileSystem.FileSystemUploadResult;
    try {
      resultat = await envoyer(jeton);
      // Même renouvellement que pour les appels JSON : déposer une pièce
      // d'identité prend du temps, le jeton peut expirer entre-temps.
      if (resultat.status === 401) {
        const frais = await jetonRenouvele();
        if (frais) {
          jeton = frais;
          resultat = await envoyer(frais);
        }
      }
    } catch (cause) {
      // Distinguer « fichier illisible » de « réseau coupé » : un message qui
      // accuse le réseau à tort envoie chercher au mauvais endroit, ce qui est
      // précisément le défaut que ce changement corrige.
      const detail = cause instanceof Error ? cause.message : '';
      throw new ApiError(
        /file|uri|read|permission|access/i.test(detail)
          ? 'Impossible de lire ce fichier. Choisissez-le à nouveau.'
          : 'Envoi impossible. Vérifiez votre réseau.',
        0,
      );
    }

    if (resultat.status < 200 || resultat.status >= 300) {
      let message = 'Envoi refusé.';
      try {
        const corps = JSON.parse(resultat.body) as {
          message?: string;
          errors?: Array<{ message: string }>;
        };
        message = corps.errors?.map((issue) => issue.message).join('\n') ?? corps.message ?? message;
      } catch {
        // Corps illisible (page d'erreur d'un proxy) : on garde le générique.
      }
      throw new ApiError(message, resultat.status);
    }

    dernier = resultat;
  }

  return JSON.parse(dernier!.body) as T;
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

  /** Dépôt de la preuve de paiement (photo ou PDF du reçu). */
  submitReceipt: (id: string, receipt: PickedFile, token: string): Promise<Transaction> =>
    upload<Transaction>(`/transactions/${id}/receipt`, { token, fields: {}, files: { receipt } }),

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
};
