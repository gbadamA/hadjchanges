import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { C, R, S, T } from './theme';
import { Button } from './ui';

/**
 * Lecture d'un code d'opération par la caméra.
 *
 * Dans son propre fichier : il porte une permission système et un composant
 * natif plein écran, deux choses qui n'ont rien à faire dans `ui.tsx` à côté
 * d'un bouton.
 *
 * ⚠️ Ne remplace JAMAIS la saisie du numéro, elle reste offerte à côté. Une
 * caméra refusée, un écran fissuré, un éclairage de guichet trop faible : le
 * scan échoue régulièrement en conditions réelles, et un agent bloqué devant
 * un client ne peut pas attendre qu'on règle sa permission.
 */
export function ScanOverlay({
  onCode,
  onClose,
  brut = false,
  consigne = 'Présentez le code de l’opération dans le cadre',
}: {
  onCode: (valeur: string) => void;
  onClose: () => void;
  /**
   * Rend le contenu TEL QUEL. Indispensable pour un QR marchand : une adresse
   * Wave ou un champ EMVCo distinguent la casse, et la mise en majuscules d'un
   * numéro d'opération les rendrait invalides.
   */
  brut?: boolean;
  consigne?: string;
}): ReactNode {
  const [permission, demander] = useCameraPermissions();
  /**
   * ⚠️ La caméra émet en CONTINU tant que le code reste dans le cadre : sans
   * ce verrou, une seule présentation déclencherait des dizaines de
   * recherches, et pire, autant d'actions si l'écran en enchaînait une.
   */
  const dejaLu = useRef(false);

  if (!permission) {
    return (
      <Modal visible transparent animationType="fade">
        <View style={styles.fond}>
          <Text style={[T.body, styles.texteClair]}>Préparation de la caméra…</Text>
        </View>
      </Modal>
    );
  }

  if (!permission.granted) {
    return (
      <Modal visible transparent animationType="fade" onRequestClose={onClose}>
        <View style={styles.fond}>
          <View style={styles.message}>
            <Text style={T.title}>Caméra non autorisée</Text>
            <Text style={T.bodyMute}>
              {permission.canAskAgain
                ? 'Autorisez la caméra pour scanner le code d’une opération. Vous pouvez aussi saisir le numéro à la main.'
                : 'La caméra est refusée pour cette application. Saisissez le numéro de l’opération à la main, ou changez l’autorisation dans les réglages du téléphone.'}
            </Text>
            {permission.canAskAgain ? (
              <Button label="Autoriser la caméra" onPress={() => void demander()} />
            ) : null}
            <Button label="Saisir le numéro plutôt" onPress={onClose} variant="ghost" />
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={styles.plein}>
        <CameraView
          style={styles.camera}
          facing="back"
          // QR seulement : les codes-barres linéaires d'un emballage n'ont rien
          // à voir avec une opération, et les lire ferait chercher dans le vide.
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={({ data }) => {
            if (dejaLu.current || !data) return;
            dejaLu.current = true;
            onCode(brut ? data.trim() : data.trim().toUpperCase());
          }}
        />

        {/* Cadre de visée : sans repère, l'agent ne sait pas où présenter le
            code et promène le téléphone. */}
        <View pointerEvents="none" style={styles.viseur}>
          <View style={styles.cadre} />
          <Text style={[T.body, styles.texteClair]}>{consigne}</Text>
        </View>

        <Pressable style={styles.fermer} onPress={onClose} hitSlop={12}>
          <Ionicons name="close" size={28} color={C.onDark} />
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fond: {
    flex: 1,
    backgroundColor: 'rgba(11,42,74,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: S.lg,
  },
  message: {
    backgroundColor: C.surface,
    borderRadius: R.md,
    padding: S.lg,
    gap: S.sm,
    width: '100%',
  },
  plein: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1 },
  viseur: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: S.md,
  },
  cadre: {
    width: 232,
    height: 232,
    borderWidth: 3,
    borderColor: C.onDark,
    borderRadius: R.md,
    backgroundColor: 'transparent',
  },
  texteClair: { color: C.onDark, textAlign: 'center' },
  fermer: {
    position: 'absolute',
    top: S.xl,
    right: S.lg,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 999,
    padding: S.xs,
  },
});
