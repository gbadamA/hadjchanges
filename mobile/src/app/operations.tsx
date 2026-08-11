import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { downloadAndShare } from '../download';
import { money, type Transaction, type TransactionStatus } from '../models';
import { C, R, S, STATUS, T } from '../theme';
import { Badge, Button, Card, EmptyState, ErrorBanner, Loader, Screen } from '../ui';

/** Filtres proposés au client — les statuts qu'il distingue vraiment. */
const FILTERS: Array<{ value: TransactionStatus | 'TOUTES'; label: string }> = [
  { value: 'TOUTES', label: 'Toutes' },
  { value: 'CREEE', label: 'À payer' },
  { value: 'RECU_SOUMIS', label: 'En contrôle' },
  { value: 'PRETE_POUR_RETRAIT', label: 'À retirer' },
  { value: 'CLOTUREE', label: 'Terminées' },
];

/** Historique des opérations du client (cahier §3.2 « Suivi »). */
export default function Operations(): ReactNode {
  const { accessToken } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<TransactionStatus | 'TOUTES'>('TOUTES');
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    if (!accessToken) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setRows(await api.myTransactions(accessToken));
      setError(null);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Historique illisible.');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const exportHistory = async (): Promise<void> => {
    if (!accessToken) return;
    setExporting(true);
    setError(null);
    try {
      await downloadAndShare(
        '/transactions/export?format=csv',
        'mes-operations.csv',
        accessToken,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Export impossible.');
    } finally {
      setExporting(false);
    }
  };

  // Le filtre s'applique côté client : l'historique tient en une page, un
  // aller-retour réseau par bouton serait du gaspillage.
  const visible = filter === 'TOUTES' ? rows : rows.filter((row) => row.status === filter);

  if (loading) return <Loader label="Chargement de vos opérations…" />;

  return (
    <Screen>
      <View style={styles.body}>
        <View style={styles.head}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="arrow-back" size={24} color={C.ink} />
          </Pressable>
          <Text style={T.h1}>Mes opérations</Text>
        </View>

        {!accessToken ? (
          <EmptyState
            title="Aucune session"
            message="Connectez-vous pour retrouver vos opérations."
            action={<Button label="Se connecter" onPress={() => router.push('/connexion')} />}
          />
        ) : null}

        {accessToken && error ? (
          <EmptyState
            title="Historique indisponible"
            message={error}
            action={<Button label="Réessayer" onPress={() => void load()} />}
          />
        ) : null}

        {accessToken && rows.length > 0 ? (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filters}>
              {FILTERS.map((option) => {
                const active = option.value === filter;
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => setFilter(option.value)}
                    style={[styles.chip, active && styles.chipActive]}
                  >
                    <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <ErrorBanner message={error} />
          </>
        ) : null}

        {accessToken && !error && rows.length === 0 ? (
          <EmptyState
            title="Aucune opération"
            message="Vos changes apparaîtront ici dès votre première opération."
            action={<Button label="Simuler une conversion" onPress={() => router.push('/simulateur')} />}
          />
        ) : null}

        {visible.map((row) => (
          <Pressable
            key={row.id}
            onPress={() => router.push({ pathname: '/transaction/[id]', params: { id: row.id } })}
          >
            <Card style={styles.card}>
              <View style={styles.row}>
                <Text style={T.label}>{row.reference}</Text>
                <Badge
                  label={row.statusLabel}
                  color={STATUS[row.status]}
                  soft={`${STATUS[row.status]}22`}
                />
              </View>
              <Text style={styles.amount}>
                {money(row.targetAmount, row.targetCurrency === 'XOF' ? 0 : 2, row.targetCurrency)}
              </Text>
              <View style={styles.row}>
                <Text style={T.caption}>
                  {money(row.sourceAmount, row.sourceCurrency === 'XOF' ? 0 : 2, row.sourceCurrency)}
                </Text>
                <Text style={T.caption}>
                  {new Date(row.createdAt).toLocaleDateString('fr-FR')}
                </Text>
              </View>
            </Card>
          </Pressable>
        ))}

        {accessToken && rows.length > 0 ? (
          <Button
            label={exporting ? 'Préparation…' : 'Exporter mon historique'}
            onPress={() => void exportHistory()}
            variant="ghost"
            disabled={exporting}
          />
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: S.lg, gap: S.md, paddingTop: S.huge },
  head: { flexDirection: 'row', alignItems: 'center', gap: S.md },
  card: { gap: S.sm, borderRadius: R.md },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: S.sm },
  amount: { ...T.h2, color: C.navy },
  filters: { marginBottom: S.xs },
  chip: {
    paddingHorizontal: S.lg,
    paddingVertical: S.sm,
    borderRadius: R.pill,
    backgroundColor: C.surface,
    borderWidth: 1.5,
    borderColor: C.line,
    marginRight: S.sm,
  },
  chipActive: { backgroundColor: C.navy, borderColor: C.navy },
  chipLabel: { ...T.label, color: C.inkDim },
  chipLabelActive: { color: C.onDark },
});
