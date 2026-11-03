import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, ApiError } from '../../api';
import { useAuth } from '../../auth';
import { DEPOSIT_LABEL, money, type Transaction, type TransactionStatus } from '../../models';
import { C, R, S, STATUS, T } from '../../theme';
import { Badge, EmptyState, ErrorBanner, Loader, PressableCard, Segmented } from '../../ui';
import { useTransactionUpdates } from '../../useTransactionUpdates';

/**
 * Filtres par ce que l'agent a À FAIRE, pas par statut technique : « à
 * remettre » couvre trois statuts, que l'agent n'a pas à distinguer pour
 * savoir qu'un client attend ses fonds.
 */
const FILTRES: Array<{ value: string; label: string; statuts: TransactionStatus[] | null }> = [
  { value: 'TOUTES', label: 'Toutes', statuts: null },
  { value: 'A_ENCAISSER', label: 'À encaisser', statuts: ['CREEE'] },
  {
    value: 'A_REMETTRE',
    label: 'À remettre',
    statuts: ['PAIEMENT_CONFIRME', 'CHANGE_EXECUTE', 'PRETE_POUR_RETRAIT'],
  },
  { value: 'TERMINEES', label: 'Terminées', statuts: ['CLOTUREE'] },
];

const PERIODES = [
  { value: 'JOUR', label: 'Aujourd’hui', jours: 0 },
  { value: '7J', label: '7 jours', jours: 7 },
  { value: '30J', label: '30 jours', jours: 30 },
] as const;

type Periode = (typeof PERIODES)[number]['value'];

/** Début de la période, à minuit (Abidjan = UTC toute l'année). */
const debutDe = (periode: Periode): Date => {
  const jours = PERIODES.find((p) => p.value === periode)?.jours ?? 0;
  const debut = new Date();
  debut.setUTCHours(0, 0, 0, 0);
  debut.setUTCDate(debut.getUTCDate() - jours);
  return debut;
};

const xof = (value: string | number): string => money(value, 0, 'XOF');

/**
 * Toutes les opérations, côté agent — le suivi de l'agence en un écran.
 *
 * L'API borne déjà un opérateur à son agence : l'écran ne filtre rien de
 * plus en douce. Les changements arrivent EN DIRECT (paiement confirmé par
 * l'opérateur, geste d'un collègue) et la ligne bouge sans rechargement ; une
 * ligne qui sort du filtre courant disparaît, une qui y entre apparaît.
 */
export default function OperationsAgence(): ReactNode {
  const params = useLocalSearchParams<{ filtre?: string }>();
  const { accessToken } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [filtre, setFiltre] = useState<string>(
    FILTRES.some((f) => f.value === params.filtre) ? (params.filtre as string) : 'TOUTES',
  );
  // « À encaisser » et « à remettre » ne se bornent pas au jour : une
  // opération d'hier pas encore payée attend toujours quelqu'un.
  const [periode, setPeriode] = useState<Periode>('JOUR');
  const [lignes, setLignes] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const statuts = FILTRES.find((f) => f.value === filtre)?.statuts ?? null;
  const borneParDate = filtre === 'TOUTES' || filtre === 'TERMINEES';

  const load = useCallback(async (): Promise<void> => {
    if (!accessToken) return;
    setError(null);
    try {
      setLignes(
        await api.staffTransactions(
          {
            statuses: statuts ?? undefined,
            from: borneParDate ? debutDe(periode).toISOString() : undefined,
            take: 200,
          },
          accessToken,
        ),
      );
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Liste illisible.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
    // `statuts` dérive de `filtre` : le suivre lui suffit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, filtre, periode, borneParDate]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  useTransactionUpdates(
    (ligne) => {
      setLignes((courantes) => {
        const sans = courantes.filter((l) => l.id !== ligne.id);
        const dansLeFiltre = statuts === null || statuts.includes(ligne.status);
        return dansLeFiltre ? [ligne, ...sans] : sans;
      });
    },
    () => void load(),
  );

  const total = useMemo(
    () => lignes.reduce((somme, l) => somme + Number(l.amountXof), 0),
    [lignes],
  );

  return (
    <View style={styles.ecran}>
      <View style={[styles.entete, { paddingTop: insets.top + S.md }]}>
        <View style={styles.titre}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="arrow-back" size={24} color={C.ink} />
          </Pressable>
          <Text style={T.h1}>Opérations</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.puces}>
          {FILTRES.map((f) => (
            <Pressable
              key={f.value}
              onPress={() => setFiltre(f.value)}
              style={[styles.puce, filtre === f.value && styles.puceActive]}
            >
              <Text style={[T.label, filtre === f.value && { color: C.onDark }]}>{f.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
        {borneParDate ? (
          <Segmented value={periode} onChange={setPeriode} options={[...PERIODES]} />
        ) : null}
        <Text style={T.caption}>
          {lignes.length} opération(s) · {xof(total)}
        </Text>
      </View>

      <ErrorBanner message={error} />

      {loading ? (
        <Loader label="Chargement des opérations…" />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.liste, { paddingBottom: insets.bottom + S.xl }]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load();
              }}
            />
          }
        >
          {lignes.length === 0 ? (
            <EmptyState
              title="Rien ici"
              message={
                filtre === 'A_ENCAISSER'
                  ? 'Aucune opération n’attend de paiement.'
                  : filtre === 'A_REMETTRE'
                    ? 'Aucun client n’attend ses fonds.'
                    : 'Aucune opération sur cette période.'
              }
            />
          ) : (
            lignes.map((ligne) => <LigneOperation key={ligne.id} ligne={ligne} />)
          )}
        </ScrollView>
      )}
    </View>
  );
}

function LigneOperation({ ligne }: { ligne: Transaction }): ReactNode {
  const router = useRouter();
  const couleur = STATUS[ligne.status];
  const devise = ligne.sourceCurrency === 'XOF' ? ligne.targetCurrency : ligne.sourceCurrency;
  const montantDevise = ligne.sourceCurrency === 'XOF' ? ligne.targetAmount : ligne.sourceAmount;
  return (
    <PressableCard
      onPress={() => router.push({ pathname: '/agent/[id]', params: { id: ligne.id } })}
      style={styles.carte}
    >
      <View style={styles.rangee}>
        <Text style={T.label}>{ligne.reference}</Text>
        <Badge label={ligne.statusLabel} color={couleur} soft={`${couleur}22`} />
      </View>
      <Text style={T.title}>
        {ligne.client ? `${ligne.client.firstName} ${ligne.client.lastName}` : 'Client'}
      </Text>
      <View style={styles.rangee}>
        <Text style={T.rate}>{money(montantDevise, 2, devise)}</Text>
        <Text style={T.bodyMute}>{xof(ligne.amountXof)}</Text>
      </View>
      <Text style={T.caption}>
        {ligne.direction === 'VENTE_DEVISE' ? 'Vente' : 'Achat'} · {DEPOSIT_LABEL[ligne.depositMethod]} ·{' '}
        {new Date(ligne.createdAt).toLocaleString('fr-FR', {
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        })}
      </Text>
    </PressableCard>
  );
}

const styles = StyleSheet.create({
  ecran: { flex: 1, backgroundColor: C.bg },
  entete: { paddingHorizontal: S.lg, gap: S.sm, paddingBottom: S.sm },
  titre: { flexDirection: 'row', alignItems: 'center', gap: S.md },
  puces: { gap: S.xs },
  puce: {
    paddingHorizontal: S.md,
    paddingVertical: S.xs,
    borderRadius: R.pill,
    backgroundColor: C.surface2,
  },
  puceActive: { backgroundColor: C.navy },
  liste: { paddingHorizontal: S.lg, gap: S.sm, paddingTop: S.xs },
  carte: { gap: 4 },
  rangee: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: S.sm },
});
