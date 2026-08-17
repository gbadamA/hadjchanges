import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { countdown, money, type Quote, type RateRow, type TransactionDirection } from '../models';
import { C, R, S, T } from '../theme';
import { Button, Card, EmptyState, ErrorBanner, Field, FormScreen, Loader, Segmented } from '../ui';
import { useRates } from '../useRates';

/** Délai avant d'appeler l'API : on ne simule pas à chaque frappe. */
const DEBOUNCE_MS = 350;

/**
 * Simulateur de conversion.
 *
 * Deux règles de conception portées par cet écran :
 * 1. Le taux ET la commission sont affichés AVANT tout engagement (cahier §3.2).
 * 2. Verrouiller est une action séparée, explicite, avec un compte à rebours
 *    visible — le client doit voir que la promesse a une durée.
 */
export default function Simulateur(): ReactNode {
  const { rows, loading: ratesLoading, error: ratesError, reload: reloadRates } = useRates();
  const { accessToken } = useAuth();
  const router = useRouter();

  const [direction, setDirection] = useState<TransactionDirection>('VENTE_DEVISE');
  const [currencyCode, setCurrencyCode] = useState<string | null>(null);
  const [amount, setAmount] = useState('100000');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [computing, setComputing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState<Quote | null>(null);
  const [locking, setLocking] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [watching, setWatching] = useState<string | null>(null);

  const selected: RateRow | null = useMemo(
    () => rows.find((row) => row.currency.code === currencyCode) ?? rows[0] ?? null,
    [rows, currencyCode],
  );
  const isSale = direction === 'VENTE_DEVISE';

  useEffect(() => {
    if (!currencyCode && rows.length > 0) setCurrencyCode(rows[0].currency.code);
  }, [rows, currencyCode]);

  // Simulation à la volée, temporisée. Chaque frappe annule la précédente :
  // sans ça, une réponse lente peut écraser un résultat plus récent.
  useEffect(() => {
    if (!selected) return;
    const value = Number(amount.replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0) {
      setQuote(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setComputing(true);
    const timer = setTimeout(() => {
      api
        .simulate({ direction, currencyCode: selected.currency.code, amount: value, side: 'SOURCE' })
        .then((result) => {
          if (!cancelled) {
            setQuote(result);
            setError(null);
          }
        })
        .catch((cause: unknown) => {
          if (cancelled) return;
          setQuote(null);
          setError(cause instanceof ApiError ? cause.message : 'Simulation impossible.');
        })
        .finally(() => {
          if (!cancelled) setComputing(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [amount, direction, selected]);

  // Changer un paramètre invalide le verrou : il portait sur l'ancien prix.
  useEffect(() => setLocked(null), [amount, direction, currencyCode]);

  useEffect(() => {
    if (!locked) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [locked]);

  const onLock = async (): Promise<void> => {
    if (!selected) return;
    if (!accessToken) {
      // Verrouiller engage le bureau sur un prix : il faut savoir qui.
      router.push('/connexion');
      return;
    }
    setLocking(true);
    setError(null);
    try {
      setLocked(
        await api.lockQuote(
          {
            direction,
            currencyCode: selected.currency.code,
            amount: Number(amount.replace(',', '.')),
            side: 'SOURCE',
          },
          accessToken,
        ),
      );
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Verrouillage impossible.');
    } finally {
      setLocking(false);
    }
  };

  const watchRate = async (): Promise<void> => {
    if (!accessToken || !selected || !quote) return;
    setError(null);
    try {
      await api.createRateAlert(selected.currency.code, Number(quote.appliedRate), accessToken);
      setWatching(selected.currency.code);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Alerte impossible.');
    }
  };

  if (ratesLoading) return <Loader label="Chargement des taux…" />;

  const sourceLabel = isSale ? 'FCFA' : (selected?.currency.symbol ?? '');
  const remaining = locked?.lockedUntil ? countdown(locked.lockedUntil, now) : '';

  // Sans taux, il n'y a rien à simuler — mais un écran muet laisse croire à une
  // panne de l'application. On dit ce qui manque et on offre de réessayer.
  if (rows.length === 0) {
    return (
      <FormScreen>
        <View style={styles.head}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="arrow-back" size={24} color={C.ink} />
          </Pressable>
          <Text style={T.h1}>Simuler</Text>
        </View>
        <EmptyState
          title="Taux indisponibles"
          message={
            ratesError
              ? `${ratesError}\nLa simulation a besoin des taux du jour pour calculer.`
              : 'Aucun taux n’est publié pour le moment. Réessayez dans un instant.'
          }
          action={<Button label="Réessayer" onPress={reloadRates} />}
        />
      </FormScreen>
    );
  }

  return (
    <FormScreen>
      <View style={styles.head}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color={C.ink} />
        </Pressable>
        <Text style={T.h1}>Simuler</Text>
      </View>

      <Segmented
        value={direction}
        onChange={setDirection}
        options={[
          { value: 'VENTE_DEVISE', label: 'J’achète des devises' },
          { value: 'ACHAT_DEVISE', label: 'Je vends mes devises' },
        ]}
      />

      <View>
        <Text style={T.label}>Devise</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
          {rows.map((row) => {
            const active = row.currency.code === selected?.currency.code;
            return (
              <Pressable
                key={row.currency.code}
                onPress={() => setCurrencyCode(row.currency.code)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>
                  {row.currency.symbol} {row.currency.code}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <Field
        label={isSale ? 'Montant que je donne' : 'Montant que j’apporte'}
        value={amount}
        onChangeText={setAmount}
        keyboardType="numeric"
        placeholder="0"
        suffix={sourceLabel}
      />

      <ErrorBanner message={error} />

      {quote ? (
        <Card elevated style={styles.result}>
          {/* Les DEUX jambes de l'échange, toujours ensemble. « Vous recevez »
              seul ne dit pas ce que l'opération coûte, et le sens — j'achète
              des devises / je vends les miennes — devient illisible dès qu'on
              quitte le sélecteur des yeux. */}
          <Text style={T.overline}>
            {isSale
              ? `VOUS ACHETEZ DES ${selected?.currency.code ?? ''}`
              : `VOUS VENDEZ VOS ${selected?.currency.code ?? ''}`}
          </Text>

          <View style={styles.legs}>
            <View style={styles.leg}>
              <Text style={T.caption}>Vous donnez</Text>
              <Text style={styles.given}>
                {money(
                  quote.sourceAmount,
                  isSale ? 0 : (selected?.currency.decimals ?? 2),
                  sourceLabel,
                )}
              </Text>
            </View>

            <Ionicons name="arrow-down" size={18} color={C.accentDeep} />

            <View style={styles.leg}>
              <Text style={T.caption}>Vous recevez</Text>
              <Text style={styles.amount}>
                {money(
                  quote.targetAmount,
                  isSale ? (selected?.currency.decimals ?? 2) : 0,
                  isSale ? (selected?.currency.symbol ?? '') : 'FCFA',
                )}
              </Text>
            </View>
          </View>

          <View style={styles.detail}>
            <Line label="Taux appliqué" value={`1 ${selected?.currency.code} = ${quote.appliedRate} FCFA`} />
            <Line label={`Commission (${quote.commissionPct} %)`} value={money(quote.commissionAmount, 0, 'FCFA')} />
            <Line label="Contre-valeur" value={money(quote.amountXof, 0, 'FCFA')} />
          </View>

          {locked ? (
            <>
              <View style={styles.lockedBox}>
                <Ionicons name="lock-closed" size={16} color={C.accentDeep} />
                <Text style={[T.label, styles.lockedText]}>
                  {remaining
                    ? `Taux garanti ${remaining} · ${locked.reference}`
                    : 'Verrou expiré — relancez la simulation'}
                </Text>
              </View>
              {/* Le verrou ne vaut que s'il débouche : le pas suivant est ici,
                  tant que l'échéance n'est pas passée. */}
              {remaining ? (
                <Button
                  label="Poursuivre l’opération"
                  onPress={() => router.push(`/operation/nouvelle?quoteId=${locked.id}`)}
                />
              ) : null}
            </>
          ) : (
            <Button
              label={locking ? 'Verrouillage…' : 'Verrouiller ce taux 30 min'}
              onPress={() => void onLock()}
              variant="accent"
              disabled={locking || computing}
            />
          )}

          <Text style={T.caption}>
            {accessToken
              ? 'Le taux verrouillé est garanti jusqu’à l’échéance affichée.'
              : 'La connexion est requise pour verrouiller un taux.'}
          </Text>

          {/* Alerte de taux : proposée au moment où le client regarde le cours,
              pas enterrée dans un écran de réglages. */}
          {accessToken && selected ? (
            <Pressable onPress={() => void watchRate()} hitSlop={8} style={styles.watch}>
              <Ionicons
                name={watching === selected.currency.code ? 'notifications' : 'notifications-outline'}
                size={18}
                color={C.navy}
              />
              <Text style={[T.label, styles.watchText]}>
                {watching === selected.currency.code
                  ? `Vous serez prévenu sous ${quote.appliedRate} FCFA`
                  : `Me prévenir si ${selected.currency.code} passe sous ${quote.appliedRate} FCFA`}
              </Text>
            </Pressable>
          ) : null}
        </Card>
      ) : computing ? (
        <Card style={styles.pending}>
          <Text style={T.bodyMute}>Calcul en cours…</Text>
        </Card>
      ) : !error ? (
        // Ni résultat, ni calcul, ni erreur : c'est que le montant saisi n'en
        // est pas un. Le dire vaut mieux que de laisser la carte disparaître.
        <Card style={styles.pending}>
          <Text style={T.bodyMute}>Saisissez un montant pour voir le résultat.</Text>
        </Card>
      ) : null}
    </FormScreen>
  );
}

function Line({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <View style={styles.line}>
      <Text style={T.bodyMute}>{label}</Text>
      <Text style={T.rate}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: S.md, paddingTop: S.xxl },
  chips: { marginTop: S.sm },
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
  result: { gap: S.md },
  legs: { alignItems: 'center', gap: S.xs },
  leg: { alignItems: 'center', gap: 2 },
  given: { ...T.title, color: C.inkDim },
  amount: { ...T.amount, color: C.navy },
  pending: { alignItems: 'center' },
  detail: { gap: S.sm, borderTopWidth: 1, borderTopColor: C.lineSoft, paddingTop: S.md },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: S.md },
  lockedBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.sm,
    backgroundColor: C.accentSoft,
    borderRadius: R.md,
    padding: S.md,
  },
  lockedText: { color: C.accentDeep, flex: 1 },
  watch: { flexDirection: 'row', alignItems: 'center', gap: S.sm, paddingTop: S.xs },
  watchText: { color: C.navy, flex: 1 },
});
