import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { api, ApiError, type PickedFile, type PublicSettings } from '../../api';
import { useAuth } from '../../auth';
import { downloadAndShare } from '../../download';
import { DEPOSIT_LABEL, money, type Transaction } from '../../models';
import { C, R, S, STATUS, STATUS_HINT, T } from '../../theme';
import { Badge, Button, Card, EmptyState, ErrorBanner, Loader, Screen } from '../../ui';

/**
 * Suivi d'une opération : où j'en suis, et quoi faire maintenant.
 *
 * L'écran est construit autour de **l'action du moment** : tant que le reçu
 * n'est pas déposé, c'est le numéro de dépôt et le bouton d'import qui
 * dominent. Une timeline seule laisserait le client spectateur de sa propre
 * transaction.
 */
export default function TransactionDetail(): ReactNode {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { accessToken } = useAuth();
  const router = useRouter();

  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    if (!accessToken || !id) {
      setLoading(false);
      return;
    }
    try {
      const [loaded, publicSettings] = await Promise.all([
        api.transaction(id, accessToken),
        api.publicSettings(),
      ]);
      setTransaction(loaded);
      setSettings(publicSettings);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Opération introuvable.');
    } finally {
      setLoading(false);
    }
  }, [accessToken, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const sendReceipt = async (): Promise<void> => {
    if (!accessToken || !transaction) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('Autorisez l’accès aux photos pour importer votre reçu.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (result.canceled || result.assets.length === 0) return;

    const asset = result.assets[0];
    const file: PickedFile = {
      uri: asset.uri,
      name: asset.fileName ?? 'recu.jpg',
      type: asset.mimeType ?? 'image/jpeg',
    };

    setBusy(true);
    setError(null);
    try {
      setTransaction(await api.submitReceipt(transaction.id, file, accessToken));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Envoi du reçu impossible.');
    } finally {
      setBusy(false);
    }
  };

  const getJustificatif = async (): Promise<void> => {
    if (!accessToken || !transaction) return;
    setBusy(true);
    setError(null);
    try {
      await downloadAndShare(
        `/transactions/${transaction.id}/justificatif.pdf`,
        `justificatif-${transaction.reference}.pdf`,
        accessToken,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Justificatif indisponible.');
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (): Promise<void> => {
    if (!accessToken || !transaction) return;
    setBusy(true);
    try {
      setTransaction(await api.cancelTransaction(transaction.id, accessToken));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Annulation impossible.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loader label="Ouverture de l’opération…" />;

  if (!transaction) {
    return (
      <Screen>
        <EmptyState
          title="Opération introuvable"
          message={error ?? 'Cette opération n’existe pas ou ne vous appartient pas.'}
          action={<Button label="Retour" onPress={() => router.replace('/operations')} />}
        />
      </Screen>
    );
  }

  const color = STATUS[transaction.status];
  const depositNumber = settings?.depositNumbers[transaction.depositMethod];
  const lastReceipt = transaction.receipts[0];
  const awaitingReceipt = transaction.status === 'CREEE' || transaction.status === 'RECU_REJETE';

  return (
    <Screen>
      <View style={styles.body}>
        <View style={styles.head}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="arrow-back" size={24} color={C.ink} />
          </Pressable>
          <Text style={T.h1}>{transaction.reference}</Text>
        </View>

        <ErrorBanner message={error} />

        <Card elevated style={styles.summary}>
          <Badge label={transaction.statusLabel} color={color} soft={`${color}22`} />
          <Text style={styles.amount}>
            {money(
              transaction.targetAmount,
              transaction.targetCurrency === 'XOF' ? 0 : 2,
              transaction.targetCurrency,
            )}
          </Text>
          <Text style={T.bodyMute}>{STATUS_HINT[transaction.status]}</Text>
          <View style={styles.line}>
            <Text style={T.bodyMute}>Vous payez</Text>
            <Text style={T.rate}>
              {money(
                transaction.sourceAmount,
                transaction.sourceCurrency === 'XOF' ? 0 : 2,
                transaction.sourceCurrency,
              )}
            </Text>
          </View>
          <View style={styles.line}>
            <Text style={T.bodyMute}>Taux appliqué</Text>
            <Text style={T.rate}>{transaction.appliedRate} FCFA</Text>
          </View>
          {transaction.agency ? (
            <View style={styles.line}>
              <Text style={T.bodyMute}>Retrait</Text>
              <Text style={T.rate}>{transaction.agency.name}</Text>
            </View>
          ) : null}
        </Card>

        {awaitingReceipt ? (
          <Card style={styles.action}>
            <Text style={T.title}>
              {transaction.status === 'RECU_REJETE' ? 'Déposez un nouveau reçu' : 'Effectuez votre dépôt'}
            </Text>
            {lastReceipt?.rejectReason ? (
              <Text style={[T.bodyMute, { color: C.stop }]}>{lastReceipt.rejectReason}</Text>
            ) : null}
            {depositNumber ? (
              <View style={styles.deposit}>
                <Text style={T.caption}>{DEPOSIT_LABEL[transaction.depositMethod]}</Text>
                <Text style={styles.depositNumber}>{depositNumber}</Text>
                <Text style={T.caption}>
                  Montant exact :{' '}
                  {money(
                    transaction.sourceAmount,
                    transaction.sourceCurrency === 'XOF' ? 0 : 2,
                    transaction.sourceCurrency,
                  )}
                </Text>
              </View>
            ) : (
              <Text style={T.bodyMute}>
                Présentez-vous en agence avec le montant, muni de votre référence.
              </Text>
            )}
            <Button
              label={busy ? 'Envoi…' : 'Importer mon reçu'}
              onPress={() => void sendReceipt()}
              variant="gold"
              disabled={busy}
            />
            <Button label="Annuler l’opération" onPress={() => void cancel()} variant="ghost" />
          </Card>
        ) : null}

        {transaction.status === 'CLOTUREE' ? (
          <Card style={styles.action}>
            <Text style={T.title}>Justificatif</Text>
            <Text style={T.bodyMute}>
              Conservez ce document : il peut vous être demandé en cas de contrôle.
            </Text>
            <Button
              label={busy ? 'Préparation…' : 'Télécharger le justificatif'}
              onPress={() => void getJustificatif()}
              disabled={busy}
            />
          </Card>
        ) : null}

        <Card style={styles.timeline}>
          <Text style={T.title}>Suivi</Text>
          {transaction.timeline.map((step) => (
            <View key={step.status} style={styles.step}>
              <View
                style={[
                  styles.dot,
                  step.done && styles.dotDone,
                  step.current && { backgroundColor: STATUS[step.status] },
                ]}
              />
              <View style={styles.stepText}>
                <Text style={step.current ? T.label : T.bodyMute}>{step.label}</Text>
                {step.at ? (
                  <Text style={T.caption}>
                    {new Date(step.at).toLocaleString('fr-FR', {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </Text>
                ) : null}
              </View>
            </View>
          ))}
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: S.lg, gap: S.md, paddingTop: S.huge },
  head: { flexDirection: 'row', alignItems: 'center', gap: S.md },
  summary: { gap: S.sm, alignItems: 'flex-start' },
  amount: { ...T.amount, color: C.navy },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignSelf: 'stretch' },
  action: { gap: S.md },
  deposit: { backgroundColor: C.navySoft, borderRadius: R.md, padding: S.md, gap: 2 },
  depositNumber: { ...T.h2, color: C.navy, fontVariant: ['tabular-nums'] },
  timeline: { gap: S.md },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: S.md },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: C.line, marginTop: 4 },
  dotDone: { backgroundColor: C.ok },
  stepText: { flex: 1, gap: 2 },
});
