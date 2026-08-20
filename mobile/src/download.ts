import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { BASE_URL, jetonRenouvele } from './api';

/**
 * Téléchargement d'un fichier protégé, puis partage.
 *
 * Une URL de justificatif exige un jeton en en-tête : impossible de l'ouvrir
 * avec `Linking.openURL`, qui n'en transporte aucun. On télécharge donc dans le
 * cache de l'app, puis on passe la main à la feuille de partage du système —
 * c'est elle qui sait enregistrer, imprimer ou envoyer par WhatsApp, sans qu'on
 * ait à réimplémenter quoi que ce soit.
 */
export async function downloadAndShare(
  path: string,
  filename: string,
  token: string,
): Promise<void> {
  if (Platform.OS === 'web') {
    // Sur le web, le partage natif n'existe pas : on télécharge le binaire et
    // on déclenche la sauvegarde par une ancre, comme le dashboard.
    const response = await fetch(`${BASE_URL}/api${path}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error('Téléchargement impossible.');
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    return;
  }

  const cache = FileSystem.cacheDirectory;
  if (!cache) throw new Error('Stockage local indisponible sur cet appareil.');

  // ⚠️ `downloadAsync` (API legacy) plutôt que `File.downloadFileAsync` : cette
  // dernière REJETTE sur toute réponse non-2xx, sans transmettre le corps. Le
  // client voyait alors « Call to function 'FileSystem.downloadFileAsync' has
  // been rejected » — une erreur native opaque, là où l'API expliquait
  // précisément la cause (jeton expiré, opération pas encore clôturée…).
  // Ici on récupère le STATUT, donc on peut lire le message et le montrer.
  const destination = cache + encodeURIComponent(filename);
  const telecharger = (avec: string) =>
    FileSystem.downloadAsync(`${BASE_URL}/api${path}`, destination, {
      headers: { authorization: `Bearer ${avec}` },
    });

  let resultat = await telecharger(token);

  // Le justificatif se télécharge forcément LONGTEMPS après l'opération —
  // l'opérateur doit d'abord valider — donc bien au-delà des 15 minutes de vie
  // du jeton. C'est l'action la plus exposée à l'expiration de toute l'app.
  if (resultat.status === 401) {
    const frais = await jetonRenouvele();
    if (frais) resultat = await telecharger(frais);
  }

  if (resultat.status < 200 || resultat.status >= 300) {
    // Le corps d'erreur a été écrit dans le fichier : on le lit pour rendre au
    // client le message que l'API avait pris la peine de formuler.
    let message = `Téléchargement refusé (${resultat.status}).`;
    try {
      const corps = await FileSystem.readAsStringAsync(resultat.uri);
      const json = JSON.parse(corps) as { message?: string };
      if (json.message) message = json.message;
    } catch {
      // Corps illisible ou absent : on garde le message avec le code.
    }
    await FileSystem.deleteAsync(resultat.uri, { idempotent: true });
    throw new Error(message);
  }

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(resultat.uri, {
      mimeType: 'application/pdf',
      dialogTitle: filename,
      UTI: 'com.adobe.pdf',
    });
  }
}
