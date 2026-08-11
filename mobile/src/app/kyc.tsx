import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { api, ApiError, type KycState, type PickedFile } from '../api';
import { useAuth } from '../auth';
import { C, R, S, T } from '../theme';
import { Badge, Button, Card, ErrorBanner, Field, FormScreen, Loader, Segmented } from '../ui';

/** Pièces acceptées — mêmes valeurs que l'enum `DocumentType` côté API. */
const TYPES = [
  { value: 'CNI', label: 'CNI' },
  { value: 'PASSEPORT', label: 'Passeport' },
  { value: 'PERMIS', label: 'Permis' },
] as const;

/**
 * Vérification d'identité — l'étape qui débloque tout le reste.
 *
 * Le client doit comprendre d'un coup d'œil où il en est : rien déposé, en
 * cours d'examen, refusé (avec le motif, et le droit de recommencer), ou
 * validé. Un statut sans explication laisse quelqu'un bloqué sans savoir
 * pourquoi, et c'est un appel au service client.
 */
export default function Kyc(): ReactNode {
  const { accessToken, refreshProfile } = useAuth();
  const router = useRouter();

  const [state, setState] = useState<KycState | null>(null);
  const [loading, setLoading] = useState(true);
  const [type, setType] = useState<(typeof TYPES)[number]['value']>('CNI');
  const [documentNumber, setDocumentNumber] = useState('');
  const [document, setDocument] = useState<PickedFile | null>(null);
  const [selfie, setSelfie] = useState<PickedFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    // Sans session, il n'y a pas de dossier à ouvrir. Sortir SANS retomber sur
    // `setLoading(false)` laisserait l'écran figé sur son chargement — c'est
    // exactement ce qui arrivait avant ce garde-fou.
    if (!accessToken) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setState(await api.kyc(accessToken));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Dossier illisible.');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const pick = async (target: 'document' | 'selfie'): Promise<void> => {
    // La permission se demande au moment du besoin, pas au lancement : on
    // explique par l'action pourquoi on ouvre la galerie.
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('Autorisez l’accès aux photos pour déposer votre pièce.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      allowsEditing: target === 'selfie',
    });
    if (result.canceled || result.assets.length === 0) return;

    const asset = result.assets[0];
    const file: PickedFile = {
      uri: asset.uri,
      name: asset.fileName ?? `${target}.jpg`,
      type: asset.mimeType ?? 'image/jpeg',
    };
    setError(null);
    if (target === 'document') setDocument(file);
    else setSelfie(file);
  };

  const submit = async (): Promise<void> => {
    if (!accessToken || !document) return;
    setBusy(true);
    setError(null);
    try {
      await api.submitKyc(
        {
          type,
          documentNumber: documentNumber.trim() || undefined,
          document,
          selfie: selfie ?? undefined,
        },
        accessToken,
      );
      setDocument(null);
      setSelfie(null);
      await refreshProfile();
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Dépôt impossible.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loader label="Ouverture de votre dossier…" />;

  if (!accessToken) {
    return (
      <FormScreen>
        <View style={styles.head}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="arrow-back" size={24} color={C.ink} />
          </Pressable>
          <Text style={T.h1}>Vérifier mon identité</Text>
        </View>
        <Text style={T.bodyMute}>
          La vérification d’identité se fait depuis votre compte. Connectez-vous pour déposer votre
          pièce.
        </Text>
        <Button label="Se connecter" onPress={() => router.replace('/connexion')} />
        <Button label="Créer un compte" onPress={() => router.replace('/inscription')} variant="ghost" />
      </FormScreen>
    );
  }

  const status = state?.status ?? 'NON_SOUMIS';
  const canSubmit = status === 'NON_SOUMIS' || status === 'REJETE';

  return (
    <FormScreen>
      <View style={styles.head}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color={C.ink} />
        </Pressable>
        <Text style={T.h1}>Vérifier mon identité</Text>
      </View>

      {status === 'EN_ATTENTE' ? (
        <Card style={styles.state}>
          <Badge label="En cours de vérification" color={C.warn} soft={C.warnSoft} />
          <Text style={T.bodyMute}>
            Votre pièce est entre les mains d’un agent. Vous serez prévenu dès qu’elle est validée,
            en général sous quelques heures ouvrées.
          </Text>
        </Card>
      ) : null}

      {status === 'VALIDE' ? (
        <Card style={styles.state}>
          <Badge label="Identité vérifiée" color={C.ok} soft={C.okSoft} />
          <Text style={T.bodyMute}>
            Tout est en ordre. Vous pouvez effectuer vos opérations de change.
          </Text>
          <Button label="Simuler une conversion" onPress={() => router.replace('/simulateur')} />
        </Card>
      ) : null}

      {status === 'REJETE' ? (
        <Card style={[styles.state, styles.rejected]}>
          <Badge label="Pièce refusée" color={C.stop} soft={C.stopSoft} />
          <Text style={T.body}>{state?.document?.rejectReason}</Text>
          <Text style={T.caption}>Corrigez le point signalé, puis déposez une nouvelle pièce.</Text>
        </Card>
      ) : null}

      <ErrorBanner message={error} />

      {canSubmit ? (
        <>
          <Text style={T.bodyMute}>
            Une pièce d’identité en cours de validité est obligatoire avant toute opération de
            change. Vos documents ne servent qu’à cette vérification.
          </Text>

          <Segmented value={type} onChange={setType} options={[...TYPES]} />

          <Field
            label="Numéro de la pièce (facultatif)"
            value={documentNumber}
            onChangeText={setDocumentNumber}
            autoCapitalize="none"
            placeholder="CI0000000"
          />

          <PickSlot
            label="Pièce d’identité"
            hint="Les quatre coins doivent être visibles et le texte lisible."
            file={document}
            onPick={() => void pick('document')}
          />
          <PickSlot
            label="Selfie (recommandé)"
            hint="Une photo de votre visage accélère la vérification."
            file={selfie}
            onPick={() => void pick('selfie')}
          />

          <Button
            label={busy ? 'Envoi…' : 'Envoyer mon dossier'}
            onPress={() => void submit()}
            disabled={busy || !document}
          />
        </>
      ) : null}
    </FormScreen>
  );
}

function PickSlot({
  label,
  hint,
  file,
  onPick,
}: {
  label: string;
  hint: string;
  file: PickedFile | null;
  onPick: () => void;
}): ReactNode {
  return (
    <Pressable onPress={onPick} style={[styles.slot, file && styles.slotFilled]}>
      {file ? (
        <Image source={{ uri: file.uri }} style={styles.preview} resizeMode="cover" />
      ) : (
        <View style={styles.slotIcon}>
          <Ionicons name="camera-outline" size={24} color={C.navy} />
        </View>
      )}
      <View style={styles.slotText}>
        <Text style={T.label}>{label}</Text>
        <Text style={T.caption}>{file ? 'Appuyez pour remplacer' : hint}</Text>
      </View>
      <Ionicons
        name={file ? 'checkmark-circle' : 'chevron-forward'}
        size={22}
        color={file ? C.ok : C.textMute}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: S.md, paddingTop: S.xxl },
  state: { gap: S.sm, alignItems: 'flex-start' },
  rejected: { borderColor: C.stop, borderWidth: 1.5 },
  slot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.md,
    backgroundColor: C.surface,
    borderRadius: R.md,
    borderWidth: 1.5,
    borderColor: C.line,
    borderStyle: 'dashed',
    padding: S.md,
  },
  slotFilled: { borderStyle: 'solid', borderColor: C.ok },
  slotIcon: {
    width: 52,
    height: 52,
    borderRadius: R.sm,
    backgroundColor: C.navySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  preview: { width: 52, height: 52, borderRadius: R.sm, backgroundColor: C.surface2 },
  slotText: { flex: 1, gap: 2 },
});
