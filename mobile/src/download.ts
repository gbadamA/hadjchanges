import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { BASE_URL } from './api';

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

  const destination = new File(new Directory(Paths.cache), filename);
  // `idempotent` : retélécharger le même justificatif ne doit pas échouer
  // parce qu'un fichier du même nom traîne déjà dans le cache.
  const file = await File.downloadFileAsync(`${BASE_URL}/api${path}`, destination, {
    headers: { authorization: `Bearer ${token}` },
    idempotent: true,
  });

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/pdf',
      dialogTitle: filename,
      UTI: 'com.adobe.pdf',
    });
  }
}
