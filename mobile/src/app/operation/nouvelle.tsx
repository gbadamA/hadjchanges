import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api, ApiError } from '../../api';
import { useAuth } from '../../auth';
import {
  DEPOSIT_LABEL,
  money,
  PAYOUT_LABEL,
  type Agency,
  type DepositMethod,
  type PayoutMethod,
  type Quote,
  type RateRow,
  type TransactionDirection,
} from '../../models';
import { C, R, S, T } from '../../theme';
import { Button, Card, EmptyState, ErrorBanner, Field, FormScreen, Loader, Segmented } from '../../ui';
import { useRates } from '../../useRates';

/** Moyens de dépôt proposés au client, dans l'ordre d'usage réel à Abidjan. */
const DEPOSITS: DepositMethod[] = ['ORANGE_MONEY', 'MTN_MOMO', 'MOOV_MONEY', 'WAVE', 'CARTE_BANCAIRE'];

/** Délai avant d'appeler l'API : on ne simule pas à chaque frappe. */
const DEBOUNCE_MS = 350;

/**
 * LE formulaire d'opération du client : combien, pour qui, dans quel bureau.
 *
 * Il fonctionne dans les deux sens d'entrée, et c'est délibéré :
 *  - **avec un devis verrouillé** (depuis le simulateur), le prix est acquis et
 *    seule la logistique reste à remplir ;
 *  - **sans devis**, le client saisit son montant ici même. C'est le chemin
 *    direct depuis l'accueil : exiger un passage par le simulateur puis un
 *    verrouillage manuel enterrait le formulaire à cinq niveaux de profondeur,
 *    et personne ne le trouvait.
 *
 * C'est aussi le dernier point de sortie avant engagement, donc le
 * récapitulatif est en haut, pas en bas.
 */
export default function NouvelleOperation(): ReactNode {
  const { quoteId } = useLocalSearchParams<{ quoteId: string }>();
  const { accessToken, profile } = useAuth();
  const router = useRouter();

  const [quote, setQuote] = useState<Quote | null>(null);
  // Saisie libre : utilisée seulement quand l'écran est ouvert sans devis.
  const [direction, setDirection] = useState<TransactionDirection>('VENTE_DEVISE');
  const [currencyCode, setCurrencyCode] = useState<string | null>(null);
  const [amount, setAmount] = useState('100000');
  const [computing, setComputing] = useState(false);
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [loading, setLoading] = useState(true);
  const [deposit, setDeposit] = useState<DepositMethod>('ORANGE_MONEY');
  const [payout, setPayout] = useState<PayoutMethod>('ESPECES_AGENCE');
  const [agencyId, setAgencyId] = useState<string | null>(null);
  const [payoutDetails, setPayoutDetails] = useState('');
  const [forSomeoneElse, setForSomeoneElse] = useState(false);
  const [beneficiaryName, setBeneficiaryName] = useState('');
  const [beneficiaryPhone, setBeneficiaryPhone] = useState('');
  const [beneficiaryRelation, setBeneficiaryRelation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { rows } = useRates();
  const libre = !quoteId;
  const selected: RateRow | null =
    rows.find((row) => row.currency.code === currencyCode) ?? rows[0] ?? null;
  const isSale = direction === 'VENTE_DEVISE';

  useEffect(() => {
    if (!currencyCode && rows.length > 0) setCurrencyCode(rows[0].currency.code);
  }, [rows, currencyCode]);

  // Sans devis, l'écran n'a que les agences à charger : le prix se calcule au
  // fil de la saisie, juste en dessous.
  useEffect(() => {
    if (!libre) return;
    api
      .agencies()
      .then((loaded) => {
        setAgencies(loaded);
        setAgencyId(loaded[0]?.id ?? null);
      })
      .catch((cause: unknown) =>
        setError(
          cause instanceof ApiError
            ? cause.message
            : 'Impossible de charger la liste des agences.',
        ),
      )
      .finally(() => setLoading(false));
  }, [libre]);

  // Conversion à la volée, temporisée. Chaque frappe annule la précédente :
  // sans ça, une réponse lente écraserait un résultat plus récent.
  useEffect(() => {
    if (!libre || !selected) return;
    const value = Number(amount.replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0) {
      setQuote(null);
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
          setError(cause instanceof ApiError ? cause.message : 'Conversion impossible.');
        })
        .finally(() => {
          if (!cancelled) setComputing(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [libre, amount, direction, selected]);

  useEffect(() => {
    if (!accessToken || !quoteId) {
      setLoading(false);
      return;
    }
    Promise.all([api.quote(quoteId, accessToken), api.agencies()])
      .then(([loadedQuote, loadedAgencies]) => {
        setQuote(loadedQuote);
        setAgencies(loadedAgencies);
        setAgencyId(loadedAgencies[0]?.id ?? null);
      })
      .catch((cause: unknown) =>
        setError(cause instanceof ApiError ? cause.message : 'Devis introuvable.'),
      )
      .finally(() => setLoading(false));
  }, [accessToken, quoteId]);

  const confirm = async (): Promise<void> => {
    if (!accessToken || !quote) return;
    setBusy(true);
    setError(null);
    try {
      const transaction = await api.createTransaction(
        {
          // Un devis verrouillé fige le prix ; sans lui, l'API reprend le taux
          // du moment à partir des mêmes paramètres.
          ...(quote.id
            ? { quoteId: quote.id }
            : {
                direction,
                currencyCode: selected?.currency.code,
                amount: Number(amount.replace(',', '.')),
                side: 'SOURCE' as const,
              }),
          depositMethod: deposit,
          payoutMethod: payout,
          agencyId: payout === 'ESPECES_AGENCE' ? agencyId : null,
          payoutDetails: payout === 'ESPECES_AGENCE' ? undefined : payoutDetails.trim() || undefined,
          beneficiary: forSomeoneElse
            ? {
                name: beneficiaryName.trim(),
                phone: beneficiaryPhone.trim() || undefined,
                relation: beneficiaryRelation.trim() || undefined,
              }
            : undefined,
        },
        accessToken,
      );
      // `replace` : revenir sur cet écran après création n'aurait aucun sens,
      // le devis est consommé.
      // Route dynamique = forme objet obligatoire avec les routes typées ;
      // une chaîne interpolée ne compile pas.
      router.replace({ pathname: '/transaction/[id]', params: { id: transaction.id } });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Création impossible.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loader label="Préparation de l’opération…" />;

  // Garde-fou KYC (cahier §3.2 : « aucune transaction ne peut être INITIÉE »).
  // Le serveur refuse déjà — c'est lui la vraie barrière — mais laisser le
  // client remplir agence, mode de dépôt et bénéficiaire pour lui opposer un
  // refus à la dernière seconde est une impasse. On le dit d'entrée, avec le
  // seul geste qui débloque la situation.
  if (profile && profile.kycStatus !== 'VALIDE') {
    const attente = profile.kycStatus === 'EN_ATTENTE';
    return (
      <FormScreen>
        <View style={styles.head}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="arrow-back" size={24} color={C.ink} />
          </Pressable>
          <Text style={T.h1}>Identité requise</Text>
        </View>
        <EmptyState
          title={attente ? 'Vérification en cours' : 'Pièce d’identité à fournir'}
          message={
            attente
              ? 'Votre pièce est en cours de contrôle par un opérateur. Vous serez prévenu dès qu’elle est validée, et vous pourrez alors lancer votre opération.'
              : 'Le change exige une pièce d’identité valide. Déposez-la une fois : vos opérations suivantes ne la redemanderont pas.'
          }
          action={
            attente ? (
              <Button label="Voir mes opérations" variant="ghost" onPress={() => router.replace('/operations')} />
            ) : (
              <Button label="Vérifier mon identité" onPress={() => router.replace('/kyc')} />
            )
          }
        />
      </FormScreen>
    );
  }

  /**
   * Ce qui manque encore pour pouvoir valider, ou `null` si tout est réuni.
   *
   * ⚠️ Un bouton grisé SANS explication est une impasse : le client ne sait pas
   * ce qu'on attend de lui, et un dégradé atténué ne se lit même plus comme un
   * bouton — il croit alors que le bouton de validation n'existe pas.
   */
  const montantSaisi = Number(amount.replace(',', '.')) > 0;
  const manquant: string | null = !quote
    ? computing
      ? 'Calcul du montant en cours…'
      : !montantSaisi
        ? 'Saisissez le montant à changer.'
        : // ⚠️ Le montant EST saisi et le calcul est fini sans résultat : c'est
          // la conversion qui a échoué. Réclamer un montant déjà rempli ferait
          // douter le client de sa propre saisie au lieu de désigner la panne.
          'La conversion n’a pas pu être calculée. Vérifiez votre connexion.'
    : payout === 'ESPECES_AGENCE'
      ? agencies.length === 0
        ? 'Aucune agence n’est disponible pour le moment.'
        : !agencyId
          ? 'Choisissez votre agence de retrait.'
          : null
      : payoutDetails.trim().length < 6
        ? payout === 'MOBILE_MONEY'
          ? 'Indiquez le numéro à créditer.'
          : 'Indiquez votre IBAN / RIB.'
        : forSomeoneElse && beneficiaryName.trim().length < 2
          ? 'Indiquez le nom du bénéficiaire.'
          : null;

  // Le bénéficiaire est exigé quel que soit le mode de retrait.
  const bloquant =
    manquant ??
    (forSomeoneElse && beneficiaryName.trim().length < 2
      ? 'Indiquez le nom du bénéficiaire.'
      : null);

  return (
    <FormScreen>
      <View style={styles.head}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color={C.ink} />
        </Pressable>
        <Text style={T.h1}>{libre ? 'Changer de l’argent' : 'Confirmer l’opération'}</Text>
      </View>

      <ErrorBanner message={error} />

      {/* Le montant se saisit ICI quand on vient directement de l'accueil. Avec
          un devis verrouillé, le prix est acquis : le remettre en question à ce
          stade viderait le verrou de son sens. */}
      {libre ? (
        <>
          <Segmented
            value={direction}
            onChange={setDirection}
            options={[
              { value: 'VENTE_DEVISE' as TransactionDirection, label: 'J’achète des devises' },
              { value: 'ACHAT_DEVISE' as TransactionDirection, label: 'Je vends mes devises' },
            ]}
          />

          <View style={styles.block}>
            <Text style={T.label}>Devise</Text>
            {rows.length === 0 ? (
              <Text style={T.bodyMute}>Taux indisponibles — les devises ne peuvent pas être listées.</Text>
            ) : null}
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
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
            label="Montant à changer"
            value={amount}
            onChangeText={setAmount}
            keyboardType="numeric"
            placeholder="0"
            suffix={isSale ? 'FCFA' : (selected?.currency.symbol ?? '')}
          />
        </>
      ) : null}

      {quote ? (
        <Card elevated style={styles.recap}>
          <Text style={T.overline}>VOUS RECEVREZ</Text>
          <Text style={styles.amount}>
            {money(quote.targetAmount, quote.targetCurrency === 'XOF' ? 0 : 2, quote.targetCurrency)}
          </Text>
          <View style={styles.line}>
            <Text style={T.bodyMute}>À payer</Text>
            <Text style={T.rate}>
              {money(quote.sourceAmount, quote.sourceCurrency === 'XOF' ? 0 : 2, quote.sourceCurrency)}
            </Text>
          </View>
          <View style={styles.line}>
            <Text style={T.bodyMute}>{libre ? 'Taux du moment' : 'Taux garanti'}</Text>
            <Text style={T.rate}>{quote.appliedRate} FCFA</Text>
          </View>
          <View style={styles.line}>
            <Text style={T.bodyMute}>Commission ({quote.commissionPct} %)</Text>
            <Text style={T.rate}>{money(quote.commissionAmount, 0, 'FCFA')}</Text>
          </View>
        </Card>
      ) : null}

      {libre && !quote ? (
        <Card style={styles.pending}>
          <Text style={T.bodyMute}>
            {computing
              ? 'Calcul en cours…'
              : montantSaisi
                ? 'Conversion indisponible pour le moment.'
                : 'Saisissez un montant pour voir la conversion.'}
          </Text>
        </Card>
      ) : null}

      <View style={styles.block}>
        <Text style={T.label}>Comment payez-vous ?</Text>
        <View style={styles.chips}>
          {DEPOSITS.map((method) => {
            const active = method === deposit;
            return (
              <Pressable
                key={method}
                onPress={() => setDeposit(method)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>
                  {DEPOSIT_LABEL[method]}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.block}>
        <Text style={T.label}>Comment récupérez-vous vos fonds ?</Text>
        <Segmented
          value={payout}
          onChange={setPayout}
          options={[
            { value: 'ESPECES_AGENCE' as PayoutMethod, label: 'En agence' },
            { value: 'MOBILE_MONEY' as PayoutMethod, label: 'Mobile money' },
            { value: 'VIREMENT_BANCAIRE' as PayoutMethod, label: 'Virement' },
          ]}
        />
      </View>

      {payout === 'ESPECES_AGENCE' ? (
        <View style={styles.block}>
          <Text style={T.label}>Agence de retrait</Text>
          {agencies.length === 0 ? (
            <Text style={T.bodyMute}>Aucune agence n’a pu être chargée.</Text>
          ) : null}
          {agencies.map((agency) => {
            const active = agency.id === agencyId;
            return (
              <Pressable
                key={agency.id}
                onPress={() => setAgencyId(agency.id)}
                style={[styles.agency, active && styles.agencyActive]}
              >
                <View style={styles.agencyText}>
                  <Text style={T.title}>{agency.name}</Text>
                  <Text style={T.caption}>
                    {agency.city}
                    {agency.address ? ` · ${agency.address}` : ''}
                  </Text>
                </View>
                <Ionicons
                  name={active ? 'radio-button-on' : 'radio-button-off'}
                  size={20}
                  color={active ? C.navy : C.textMute}
                />
              </Pressable>
            );
          })}
        </View>
      ) : (
        <Field
          label={payout === 'MOBILE_MONEY' ? 'Numéro à créditer' : 'IBAN / RIB'}
          value={payoutDetails}
          onChangeText={setPayoutDetails}
          autoCapitalize="none"
          keyboardType={payout === 'MOBILE_MONEY' ? 'phone-pad' : 'default'}
        />
      )}

      {/* « Qui bénéficie » : demandé au moment où le client choisit son retrait,
          pas dans un écran séparé qu'il ne rouvrira jamais. */}
      <View style={styles.block}>
        <Pressable onPress={() => setForSomeoneElse(!forSomeoneElse)} style={styles.toggle}>
          <Ionicons
            name={forSomeoneElse ? 'checkbox' : 'square-outline'}
            size={22}
            color={forSomeoneElse ? C.navy : C.textMute}
          />
          <Text style={[T.label, styles.toggleText]}>Les fonds sont pour quelqu’un d’autre</Text>
        </Pressable>

        {forSomeoneElse ? (
          <>
            <Field
              label="Nom du bénéficiaire"
              value={beneficiaryName}
              onChangeText={setBeneficiaryName}
              autoCapitalize="words"
            />
            <Field
              label="Son téléphone (facultatif)"
              value={beneficiaryPhone}
              onChangeText={setBeneficiaryPhone}
              keyboardType="phone-pad"
            />
            <Field
              label="Votre lien avec lui (facultatif)"
              value={beneficiaryRelation}
              onChangeText={setBeneficiaryRelation}
              placeholder="frère, employeur…"
            />
          </>
        ) : null}
      </View>

      <Button
        label={busy ? 'Création…' : libre ? 'Lancer mon opération' : 'Confirmer l’opération'}
        onPress={() => void confirm()}
        variant="accent"
        disabled={busy || bloquant !== null}
      />
      {bloquant ? (
        <View style={styles.manque}>
          <Ionicons name="information-circle-outline" size={18} color={C.navy} />
          <Text style={[T.label, styles.manqueTexte]}>{bloquant}</Text>
        </View>
      ) : null}
      <Text style={T.caption}>
        Vous paierez après confirmation, puis vous importerez votre reçu dans l’application.
        {payout !== 'ESPECES_AGENCE' ? ` Retrait par ${PAYOUT_LABEL[payout].toLowerCase()}.` : ''}
      </Text>
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: S.md, paddingTop: S.xxl },
  recap: { gap: S.sm },
  pending: { alignItems: 'center' },
  manque: { flexDirection: 'row', alignItems: 'center', gap: S.sm },
  manqueTexte: { color: C.navy, flex: 1 },
  amount: { ...T.amount, color: C.navy },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  block: { gap: S.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: S.sm },
  chip: {
    paddingHorizontal: S.lg,
    paddingVertical: S.sm,
    borderRadius: R.pill,
    backgroundColor: C.surface,
    borderWidth: 1.5,
    borderColor: C.line,
  },
  chipActive: { backgroundColor: C.navy, borderColor: C.navy },
  chipLabel: { ...T.label, color: C.inkDim },
  chipLabelActive: { color: C.onDark },
  agency: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.md,
    backgroundColor: C.surface,
    borderRadius: R.md,
    borderWidth: 1.5,
    borderColor: C.line,
    padding: S.md,
  },
  agencyActive: { borderColor: C.navy, backgroundColor: C.navySoft },
  agencyText: { flex: 1, gap: 2 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: S.sm },
  toggleText: { flex: 1 },
});
