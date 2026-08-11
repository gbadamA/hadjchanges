import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from './api';

/**
 * Notifications poussées.
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
export async function registerForPush(accessToken: string): Promise<string | null> {
  if (!Device.isDevice) return null;

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
      lightColor: '#C9A227',
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

/** Une notification reçue application ouverte doit quand même s'afficher. */
export function configureForeground(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
}
