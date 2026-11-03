import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { api, ApiError, type KycState } from '../api';
import { useAuth } from '../auth';
import { C, S, T } from '../theme';
import { Badge, Button, Card, ErrorBanner, Field, FormScreen, Loader, Segmented } from '../ui';

/** Pièces acceptées — mêmes valeurs que l'enum `DocumentType` côté API. */
const TYPES = [
  { value: 'CNI', label: 'CNI' },
  { value: 'PASSEPORT', label: 'Passeport' },
  { value: 'PERMIS', label: 'Permis' },
] as const;

const TYPE_LABEL: Record<string, string> = {
  CNI: 'Carte nationale d’identité',
  PASSEPORT: 'Passeport',
  PERMIS: 'Permis de conduire',
  CARTE_CONSULAIRE: 'Carte consulaire',
};

/**
 * Saisie JJ/MM/AAAA au fil de la frappe : les barres se posent seules, le
 * client ne tape que des chiffres (clavier numérique, pas de sélecteur de date
 * à trois molettes pour une date qu'il lit sur sa carte).
 */
function maskDate(text: string): string {
  const digits = text.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

/** JJ/MM/AAAA → AAAA-MM-JJ, ou null si la date n'existe pas (31/02…). */
function toIsoDate(text: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (!match) return null;
  const [, day, month, year] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCDate() !== Number(day) || date.getUTCMonth() !== Number(month) - 1) return null;
  return `${year}-${month}-${day}`;
}

/**
 * Vérification d'identité — l'étape qui débloque tout le reste.
 *
 * Plus aucune photo : le client DÉCLARE sa pièce (type, numéro, expiration) et
 * présente l'original en agence, où un agent le compare à la déclaration.
 *
 * Le client doit comprendre d'un coup d'œil où il en est : rien déclaré, en
 * attente de vérification, refusé (avec le motif, et le droit de recommencer),
 * ou validé. Un statut sans explication laisse quelqu'un bloqué sans savoir
 * pourquoi, et c'est un appel au service client.
 */
export default function Kyc(): ReactNode {
  const { accessToken, refreshProfile } = useAuth();
  const router = useRouter();

  const [state, setState] = useState<KycState | null>(null);
  const [loading, setLoading] = useState(true);
  const [type, setType] = useState<(typeof TYPES)[number]['value']>('CNI');
  const [documentNumber, setDocumentNumber] = useState('');
  const [expiry, setExpiry] = useState('');
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

  const expiresAt = toIsoDate(expiry);
  const expired = expiresAt !== null && new Date(expiresAt).getTime() <= Date.now();
  const expiryError =
    expiry.length === 10 && expiresAt === null
      ? 'Cette date n’existe pas.'
      : expired
        ? 'Cette pièce est expirée : une pièce en cours de validité est obligatoire.'
        : null;
  const ready = documentNumber.trim().length >= 4 && expiresAt !== null && !expired;

  const submit = async (): Promise<void> => {
    if (!accessToken || !expiresAt || !ready) return;
    setBusy(true);
    setError(null);
    try {
      await api.submitKyc({ type, documentNumber: documentNumber.trim(), expiresAt }, accessToken);
      setDocumentNumber('');
      setExpiry('');
      await refreshProfile();
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Envoi impossible.');
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
          La vérification d’identité se fait depuis votre compte. Connectez-vous pour déclarer votre
          pièce.
        </Text>
        <Button label="Se connecter" onPress={() => router.replace('/connexion')} />
        <Button label="Créer un compte" onPress={() => router.replace('/inscription')} variant="ghost" />
      </FormScreen>
    );
  }

  const status = state?.status ?? 'NON_SOUMIS';
  const declared = state?.document;
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
          <Badge label="En attente de vérification" color={C.warn} soft={C.warnSoft} />
          {declared ? (
            <Text style={T.label}>
              {TYPE_LABEL[declared.type] ?? declared.type}
              {declared.documentNumber ? ` · nº ${declared.documentNumber}` : ''}
            </Text>
          ) : null}
          <Text style={T.bodyMute}>
            Présentez l’original de cette pièce en agence : un agent la compare à votre déclaration
            et active votre compte. Vous serez prévenu dès que c’est fait.
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
          <Badge label="Déclaration refusée" color={C.stop} soft={C.stopSoft} />
          <Text style={T.body}>{declared?.rejectReason}</Text>
          <Text style={T.caption}>Corrigez le point signalé, puis déclarez à nouveau votre pièce.</Text>
        </Card>
      ) : null}

      <ErrorBanner message={error} />

      {canSubmit ? (
        <>
          <Card style={styles.how}>
            <View style={styles.howRow}>
              <Ionicons name="document-text-outline" size={20} color={C.navy} />
              <Text style={[T.body, styles.howText]}>Déclarez votre pièce ici — aucune photo.</Text>
            </View>
            <View style={styles.howRow}>
              <Ionicons name="business-outline" size={20} color={C.navy} />
              <Text style={[T.body, styles.howText]}>
                Présentez l’original en agence : l’agent valide votre compte.
              </Text>
            </View>
          </Card>

          <Segmented value={type} onChange={setType} options={[...TYPES]} />

          <Field
            label="Numéro de la pièce"
            value={documentNumber}
            onChangeText={setDocumentNumber}
            autoCapitalize="none"
            placeholder="CI0000000"
          />

          <Field
            label="Date d’expiration"
            value={expiry}
            onChangeText={(text) => setExpiry(maskDate(text))}
            keyboardType="numeric"
            placeholder="JJ/MM/AAAA"
            error={expiryError}
          />

          <Button
            label={busy ? 'Envoi…' : 'Envoyer ma déclaration'}
            onPress={() => void submit()}
            disabled={busy || !ready}
          />
        </>
      ) : null}
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: S.md, paddingTop: S.xxl },
  state: { gap: S.sm, alignItems: 'flex-start' },
  rejected: { borderColor: C.stop, borderWidth: 1.5 },
  how: { gap: S.sm },
  howRow: { flexDirection: 'row', alignItems: 'center', gap: S.sm },
  howText: { flex: 1 },
});
