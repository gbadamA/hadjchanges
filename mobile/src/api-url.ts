import Constants from 'expo-constants';
import { Platform } from 'react-native';

/** Port de l'API — le même que `api/.env`. */
const API_PORT = 3061;

/**
 * Adresse de l'hôte vue **depuis un émulateur Android**.
 *
 * Sur un émulateur, `localhost` désigne l'émulateur lui-même : l'API tourne sur
 * le PC, pas dedans. Android expose la machine hôte sur cette adresse réservée.
 */
const ANDROID_EMULATOR_HOST = '10.0.2.2';

export interface ResolveInput {
  /** `EXPO_PUBLIC_API_URL` s'il est renseigné — il gagne toujours. */
  explicit?: string | null;
  /** Hôte de Metro, ex. `192.168.1.10:8081` ou `localhost:8081`. */
  hostUri?: string | null;
  platform: 'android' | 'ios' | 'web' | string;
}

/**
 * Où joindre l'API, sans que personne n'ait à éditer un fichier.
 *
 * Fonction **pure** : c'est elle qui est testée, pas l'enrobage Expo autour.
 *
 * L'ordre de résolution :
 *  1. `EXPO_PUBLIC_API_URL` s'il est renseigné — pour pointer une préproduction
 *     ou un vrai serveur, il faut pouvoir forcer.
 *  2. Sinon, **l'hôte de Metro** : le téléphone qui a réussi à charger le
 *     bundle sait forcément joindre cette machine. C'est ce qui évite d'aller
 *     chercher son IP Wi-Fi à la main à chaque changement de réseau.
 *  3. Sur **Android**, un hôte en `localhost` est réécrit en `10.0.2.2`, sans
 *     quoi l'émulateur s'appelle lui-même et la connexion échoue — le symptôme
 *     étant « impossible de se connecter » alors que le serveur tourne.
 */
export function resolveApiUrl({ explicit, hostUri, platform }: ResolveInput): string {
  const forced = explicit?.trim();
  if (forced) return forced.replace(/\/$/, '');

  const host = (hostUri ?? '').split(':')[0].trim() || 'localhost';
  const isLoopback = host === 'localhost' || host === '127.0.0.1';
  const resolved = isLoopback && platform === 'android' ? ANDROID_EMULATOR_HOST : host;

  return `http://${resolved}:${API_PORT}`;
}

/** Hôte de Metro, quel que soit le canal par lequel Expo le publie. */
const metroHost = (): string | null =>
  Constants.expoConfig?.hostUri ??
  (Constants as unknown as { expoGoConfig?: { debuggerHost?: string } }).expoGoConfig
    ?.debuggerHost ??
  null;

export const API_BASE_URL = resolveApiUrl({
  explicit: process.env.EXPO_PUBLIC_API_URL,
  hostUri: metroHost(),
  platform: Platform.OS,
});
