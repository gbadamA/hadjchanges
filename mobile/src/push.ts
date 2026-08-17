import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { api } from './api';

/**
 * Notifications poussées.
 *
 * ⚠️⚠️ **`expo-notifications` ne doit JAMAIS être importé en haut de fichier.**
 * Depuis le SDK 53, Expo Go a perdu la fonction de notification distante, et le
 * module **lève dès son évaluation** sur Android. Comme ce fichier est importé
 * par `auth.tsx`, lui-même importé par `_layout.tsx`, un import statique
 * empêchait **l'application entière de démarrer** dans Expo Go — pas seulement
 * le push. D'où le chargement à la demande ci-dessous.
 *
 * ⚠️ **Un émulateur ne reçoit pas de push** : Expo exige un appareil réel.
 * On sort silencieusement plutôt que d'afficher une erreur au développeur qui
 * teste sur simulateur — ce n'est pas une panne.
 *
 * ⚠️ **On ne redemande jamais une permission refusée.** Le système ne
 * réaffiche pas la fenêtre, et insister ne produit qu'une boucle : si l'accord
 * n'est pas donné, l'application fonctionne sans push, tout simplement. Les
 * notifications restent lisibles dans l'écran dédié.
 */

/**
 * Vrai uniquement dans **Expo Go**.
 *
 * On s'appuie sur `appOwnership` bien qu'il soit marqué déprécié : son
 * remplaçant `executionEnvironment` vaut `storeClient` **aussi bien pour Expo
 * Go que pour un build de développement**, alors que c'est précisément ces deux
 * cas qu'il faut distinguer — le push marche dans l'un, pas dans l'autre.
 */
const IS_EXPO_GO = Constants.appOwnership === 'expo';

type NotificationsModule = typeof import('expo-notifications');

/** Charge le module seulement là où il fonctionne. Ailleurs : `null`. */
async function loadNotifications(): Promise<NotificationsModule | null> {
  if (IS_EXPO_GO) return null;
  try {
    return await import('expo-notifications');
  } catch {
    // Module absent ou refusant de s'initialiser : l'app continue sans push.
    return null;
  }
}

/** Ce que l'app peut dire à l'utilisateur sur l'état du push. */
export const pushUnavailableReason = (): string | null => {
  if (IS_EXPO_GO) {
    return 'Les notifications poussées ne fonctionnent pas dans Expo Go depuis le SDK 53. Elles arriveront dans l’application installée.';
  }
  if (!Device.isDevice) return 'Les notifications poussées exigent un appareil réel.';
  return null;
};

export async function registerForPush(accessToken: string): Promise<string | null> {
  if (!Device.isDevice) return null;

  const Notifications = await loadNotifications();
  if (!Notifications) return null;

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== 'granted' && existing.canAskAgain) {
    status = (await Notifications.requestPermissionsAsync()).status;
  }
  if (status !== 'granted') return null;

  // Android exige un canal déclaré, sinon la notification arrive muette et
  // sans priorité.
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Opérations de change',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#D81E27',
    });
  }

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? undefined;

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    await api.registerDevice(token, Platform.OS === 'ios' ? 'ios' : 'android', accessToken);
    return token;
  } catch {
    // Jeton indisponible (projet non configuré, réseau) : l'app doit continuer.
    return null;
  }
}

export async function unregisterPush(token: string, accessToken: string): Promise<void> {
  await api.forgetDevice(token, accessToken).catch(() => undefined);
}

/**
 * Une notification reçue application ouverte doit quand même s'afficher.
 * Appelé au démarrage : la promesse est volontairement ignorée, il n'y a rien
 * à attendre et rien à rattraper si le module n'est pas disponible.
 */
export function configureForeground(): void {
  void loadNotifications().then((Notifications) => {
    Notifications?.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
      }),
    });
  });
}
