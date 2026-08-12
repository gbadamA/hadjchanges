import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
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
} from '../../models';
import { C, R, S, T } from '../../theme';
import { Button, Card, ErrorBanner, Field, FormScreen, Loader, Segmented } from '../../ui';

/** Moyens de dépôt proposés au client, dans l'ordre d'usage réel à Abidjan. */
const DEPOSITS: DepositMethod[] = ['ORANGE_MONEY', 'MTN_MOMO', 'MOOV_MONEY', 'WAVE', 'CARTE_BANCAIRE'];

/**
 * Confirmation d'une opération : comment je paie, comment je récupère.
 *
 * L'écran arrive avec un **devis déjà verrouillé** : le prix est acquis, il ne
 * reste que la logistique. C'est aussi le dernier point de sortie avant
 * engagement, donc le récapitulatif est en haut, pas en bas.
 */
export default function NouvelleOperation(): ReactNode {
  const { quoteId } = useLocalSearchParams<{ quoteId: string }>();
  const { accessToken } = useAuth();
  const router = useRouter();

  const [quote, setQuote] = useState<Quote | null>(null);
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
    if (!accessToken || !quote?.id) return;
    setBusy(true);
    setError(null);
    try {
      const transaction = await api.createTransaction(
        {
          quoteId: quote.id,
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

  return (
    <FormScreen>
      <View style={styles.head}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color={C.ink} />
        </Pressable>
        <Text style={T.h1}>Confirmer l’opération</Text>
      </View>

      <ErrorBanner message={error} />

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
            <Text style={T.bodyMute}>Taux garanti</Text>
            <Text style={T.rate}>{quote.appliedRate} FCFA</Text>
          </View>
          <View style={styles.line}>
            <Text style={T.bodyMute}>Commission ({quote.commissionPct} %)</Text>
            <Text style={T.rate}>{money(quote.commissionAmount, 0, 'FCFA')}</Text>
          </View>
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
        label={busy ? 'Création…' : 'Confirmer l’opération'}
        onPress={() => void confirm()}
        variant="gold"
        disabled={
          busy ||
          !quote ||
          (payout === 'ESPECES_AGENCE' ? !agencyId : payoutDetails.trim().length < 6) ||
          (forSomeoneElse && beneficiaryName.trim().length < 2)
        }
      />
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
