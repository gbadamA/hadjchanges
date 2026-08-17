import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { downloadAndShare } from '../download';
import { money, type Transaction, type TransactionStatus } from '../models';
import { C, R, S, STATUS, T } from '../theme';
import { Badge, Button, EmptyState, ErrorBanner, Loader, PressableCard, Screen } from '../ui';
import { useTransactionUpdates } from '../useTransactionUpdates';

/**
 * Périodes proposées plutôt qu'un sélecteur de dates.
 *
 * Le cahier demande un filtre « par date » ; sur mobile, deux calendriers à
 * remplir pour retrouver une opération du mois dernier est un geste que
 * personne ne fait. Les bornes usuelles couvrent le besoin réel en un tap.
 */
const PERIODS: Array<{ value: string; label: string; days: number | null }> = [
  { value: 'TOUTES', label: 'Toute période', days: null },
  { value: '30J', label: '30 jours', days: 30 },
  { value: '3M', label: '3 mois', days: 90 },
  { value: '12M', label: '12 mois', days: 365 },
];

/**
 * La devise d'une opération est sa jambe ÉTRANGÈRE : l'autre est toujours le
 * franc CFA, devise de référence du bureau. Filtrer sur « XOF » ne trierait
 * rien puisque toutes les opérations le portent.
 */
const currencyOf = (row: Transaction): string =>
  row.sourceCurrency === 'XOF' ? row.targetCurrency : row.sourceCurrency;

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
  const [currency, setCurrency] = useState<string>('TOUTES');
  const [period, setPeriod] = useState<string>('TOUTES');
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

  // Mise à jour sur place. Une transaction inconnue de la liste est ajoutée en
  // tête : elle vient forcément d'être créée, et la voir apparaître vaut mieux
  // que de laisser croire qu'elle s'est perdue.
  useTransactionUpdates((row) => {
    setRows((current) => {
      const index = current.findIndex((item) => item.id === row.id);
      if (index === -1) return [row, ...current];
      const next = [...current];
      next[index] = row;
      return next;
    });
  }, () => void load());

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

  // Les filtres s'appliquent côté client : l'historique tient en une page, un
  // aller-retour réseau par bouton serait du gaspillage.
  // Les devises proposées sont celles réellement présentes dans l'historique :
  // offrir un filtre qui ne renvoie jamais rien est une fausse piste.
  const currencies = Array.from(new Set(rows.map(currencyOf))).sort();
  const days = PERIODS.find((option) => option.value === period)?.days ?? null;
  const since = days === null ? null : Date.now() - days * 24 * 60 * 60 * 1000;

  const visible = rows.filter(
    (row) =>
      (filter === 'TOUTES' || row.status === filter) &&
      (currency === 'TOUTES' || currencyOf(row) === currency) &&
      (since === null || new Date(row.createdAt).getTime() >= since),
  );

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
            <ChipRow
              options={FILTERS.map((option) => ({ value: option.value, label: option.label }))}
              value={filter}
              onChange={(next) => setFilter(next as TransactionStatus | 'TOUTES')}
            />
            {/* Une seule devise dans l'historique : le filtre n'aurait rien à
                trier, on ne l'affiche pas. */}
            {currencies.length > 1 ? (
              <ChipRow
                options={[
                  { value: 'TOUTES', label: 'Toutes devises' },
                  ...currencies.map((code) => ({ value: code, label: code })),
                ]}
                value={currency}
                onChange={setCurrency}
              />
            ) : null}
            <ChipRow
              options={PERIODS.map((option) => ({ value: option.value, label: option.label }))}
              value={period}
              onChange={setPeriod}
            />
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

        {accessToken && !error && rows.length > 0 && visible.length === 0 ? (
          <EmptyState
            title="Aucune opération ne correspond"
            message="Aucune de vos opérations ne remplit ces critères. Élargissez la recherche pour les revoir."
            action={
              <Button
                label="Tout afficher"
                variant="ghost"
                onPress={() => {
                  setFilter('TOUTES');
                  setCurrency('TOUTES');
                  setPeriod('TOUTES');
                }}
              />
            }
          />
        ) : null}

        {visible.map((row) => (
          <PressableCard
            key={row.id}
            onPress={() => router.push({ pathname: '/transaction/[id]', params: { id: row.id } })}
            style={styles.card}
          >
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
          </PressableCard>
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

/** Une rangée de filtres défilante. Même rendu pour statut, devise et période. */
function ChipRow({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
}): ReactNode {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filters}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            style={[styles.chip, active && styles.chipActive]}
          >
            <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
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
