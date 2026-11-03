import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api, ApiError, type CounterInput, type PublicSettings } from '../../api';
import { useAuth } from '../../auth';
import { money, type Agency, type Quote, type TransactionDirection } from '../../models';
import { estMobileMoney, paiementComplet, PaiementComptoir, type ChoixPaiement } from '../../paiement-qr';
import { C, R, S, T } from '../../theme';
import { Button, Card, ErrorBanner, Field, FormScreen, Segmented } from '../../ui';
import { useRates } from '../../useRates';

const PIECES = [
  { value: 'CNI', label: 'CNI' },
  { value: 'PASSEPORT', label: 'Passeport' },
  { value: 'PERMIS', label: 'Permis' },
] as const;

/**
 * Le sens est dit DU POINT DE VUE DU CLIENT, pas du bureau : au comptoir,
 * l'agent pense « il veut des euros », pas « le bureau vend ». L'API, elle,
 * raisonne côté bureau — la traduction est faite ici, une fois.
 */
const SENS: Array<{ value: TransactionDirection; label: string }> = [
  { value: 'VENTE_DEVISE', label: 'Il achète des devises' },
  { value: 'ACHAT_DEVISE', label: 'Il vend des devises' },
];

/**
 * Opération au guichet, depuis le téléphone de l'agent.
 *
 * Le client est là : l'agent relève son identité sur la pièce présentée,
 * saisit le montant en devise, voit le prix se calculer, encaisse (espèces ou
 * QR marchand du réseau du client) et valide. L'API exécute le change,
 * mouvemente la caisse et clôture **en un seul geste** — d'où la confirmation
 * qui redit les deux montants avant.
 *
 * Le montant se saisit TOUJOURS en devise étrangère : c'est la grandeur que le
 * client annonce (« 500 euros »), quel que soit le sens.
 */
export default function Guichet(): ReactNode {
  const { accessToken, profile } = useAuth();
  const router = useRouter();
  const { rows } = useRates();

  const [prenom, setPrenom] = useState('');
  const [nom, setNom] = useState('');
  const [telephone, setTelephone] = useState('');
  const [piece, setPiece] = useState<(typeof PIECES)[number]['value']>('CNI');
  const [numeroPiece, setNumeroPiece] = useState('');

  const [sens, setSens] = useState<TransactionDirection>('VENTE_DEVISE');
  const [devise, setDevise] = useState('EUR');
  const [saisie, setSaisie] = useState('');
  const [prix, setPrix] = useState<Quote | null>(null);

  const [choix, setChoix] = useState<ChoixPaiement>({ methode: 'ESPECES_AGENCE', reference: '' });
  const [reglages, setReglages] = useState<PublicSettings | null>(null);
  const [agences, setAgences] = useState<Agency[]>([]);
  const [agence, setAgence] = useState<string | null>(profile?.agencyId ?? null);

  const [aConfirmer, setAConfirmer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const montant = Number(saisie.replace(',', '.'));
  const montantValide = Number.isFinite(montant) && montant > 0;
  // Le client qui VEND des devises paie en devises : le mobile money (FCFA
  // seulement) n'a rien à faire ici.
  const especesSeules = sens === 'ACHAT_DEVISE';
  const sansAgence = !profile?.agencyId;

  useEffect(() => {
    void api.publicSettings().then(setReglages).catch(() => setReglages(null));
    if (sansAgence) void api.agencies().then(setAgences).catch(() => setAgences([]));
  }, [sansAgence]);

  useEffect(() => {
    if (especesSeules) setChoix({ methode: 'ESPECES_AGENCE', reference: '' });
  }, [especesSeules]);

  // Prix recalculé pendant la frappe, avec un léger délai : un appel par
  // touche saturerait le réseau d'un téléphone en 3G pour rien.
  useEffect(() => {
    setAConfirmer(false);
    if (!montantValide) {
      setPrix(null);
      return;
    }
    const minuterie = setTimeout(() => {
      api
        .simulate({
          direction: sens,
          currencyCode: devise,
          amount: montant,
          side: sens === 'VENTE_DEVISE' ? 'TARGET' : 'SOURCE',
          agencyId: agence,
        })
        .then((resultat) => {
          setPrix(resultat);
          setError(null);
        })
        .catch((cause: unknown) => {
          setPrix(null);
          setError(cause instanceof ApiError ? cause.message : 'Prix indisponible.');
        });
    }, 350);
    return () => clearTimeout(minuterie);
  }, [sens, devise, montant, montantValide, agence]);

  const identiteComplete =
    prenom.trim().length >= 2 &&
    nom.trim().length >= 2 &&
    telephone.replace(/\D/g, '').length >= 8 &&
    numeroPiece.trim().length >= 4;
  const pret = identiteComplete && prix !== null && paiementComplet(choix) && (!sansAgence || agence);

  const valider = async (): Promise<void> => {
    if (!accessToken || !prix) return;
    setBusy(true);
    setError(null);
    const entree: CounterInput = {
      customer: {
        firstName: prenom.trim(),
        lastName: nom.trim(),
        phone: telephone.replace(/\s/g, ''),
        idType: piece,
        idNumber: numeroPiece.trim().toUpperCase(),
      },
      direction: sens,
      currencyCode: devise,
      amount: montant,
      side: sens === 'VENTE_DEVISE' ? 'TARGET' : 'SOURCE',
      depositMethod: choix.methode,
      ...(estMobileMoney(choix.methode) ? { paymentRef: choix.reference.trim() } : {}),
      ...(agence ? { agencyId: agence } : {}),
    };
    try {
      const fait = await api.counter(entree, accessToken);
      // La fiche de l'opération close offre le justificatif à partager.
      router.replace({ pathname: '/agent/[id]', params: { id: fait.id } });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Opération impossible.');
      setAConfirmer(false);
    } finally {
      setBusy(false);
    }
  };

  const devises = rows.map((row) => row.currency.code);

  return (
    <FormScreen>
      <View style={styles.head}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color={C.ink} />
        </Pressable>
        <Text style={T.h1}>Guichet</Text>
      </View>

      {/* ------------------------------------------------------ client -- */}
      <Card style={styles.bloc}>
        <Text style={T.title}>Client</Text>
        <Field label="Téléphone" value={telephone} onChangeText={setTelephone} keyboardType="phone-pad" placeholder="07 00 00 00 00" />
        <Field label="Prénom" value={prenom} onChangeText={setPrenom} autoCapitalize="words" />
        <Field label="Nom" value={nom} onChangeText={setNom} autoCapitalize="words" />
        <Text style={T.label}>Pièce présentée (original en main)</Text>
        <Segmented value={piece} onChange={setPiece} options={[...PIECES]} />
        <Field label="Numéro de la pièce" value={numeroPiece} onChangeText={setNumeroPiece} autoCapitalize="none" placeholder="CI0000000" />
      </Card>

      {/* --------------------------------------------------- opération -- */}
      <Card style={styles.bloc}>
        <Text style={T.title}>Opération</Text>
        <Segmented value={sens} onChange={setSens} options={SENS} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.puces}>
          {devises.map((code) => (
            <Pressable key={code} onPress={() => setDevise(code)} style={[styles.puce, devise === code && styles.puceActive]}>
              <Text style={[T.label, devise === code && { color: C.onDark }]}>{code}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <Field
          label={`Montant en ${devise}`}
          value={saisie}
          onChangeText={setSaisie}
          keyboardType="numeric"
          placeholder="500"
          suffix={devise}
        />
        {sansAgence ? (
          <>
            <Text style={T.label}>Agence de l’opération</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.puces}>
              {agences.map((a) => (
                <Pressable key={a.id} onPress={() => setAgence(a.id)} style={[styles.puce, agence === a.id && styles.puceActive]}>
                  <Text style={[T.label, agence === a.id && { color: C.onDark }]}>{a.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </>
        ) : null}
        {prix ? (
          <View style={styles.prix}>
            <Ligne libelle="Le client remet" valeur={money(prix.sourceAmount, prix.sourceCurrency === 'XOF' ? 0 : 2, prix.sourceCurrency)} />
            <Ligne libelle="Le client reçoit" valeur={money(prix.targetAmount, prix.targetCurrency === 'XOF' ? 0 : 2, prix.targetCurrency)} fort />
            <Ligne libelle="Taux" valeur={`${prix.appliedRate} FCFA`} />
            <Ligne libelle="Commission" valeur={money(prix.commissionAmount, 0, 'XOF')} />
          </View>
        ) : null}
      </Card>

      {/* ---------------------------------------------------- paiement -- */}
      {prix ? (
        <Card style={styles.bloc}>
          <PaiementComptoir
            montant={prix.sourceAmount}
            devise={prix.sourceCurrency}
            reglages={reglages}
            choix={choix}
            onChange={(suivant) => {
              setChoix(suivant);
              setAConfirmer(false);
            }}
            especesSeules={especesSeules}
          />
        </Card>
      ) : null}

      <ErrorBanner message={error} />

      {aConfirmer && prix ? (
        <Card style={styles.confirm}>
          <Text style={T.body}>
            Vous avez reçu {money(prix.sourceAmount, prix.sourceCurrency === 'XOF' ? 0 : 2, prix.sourceCurrency)} et
            remettez {money(prix.targetAmount, prix.targetCurrency === 'XOF' ? 0 : 2, prix.targetCurrency)} à{' '}
            {prenom.trim()} {nom.trim()} ?
          </Text>
          <Text style={T.caption}>Le change, la caisse et la clôture se font en une fois.</Text>
          <Button label={busy ? 'Validation…' : 'Valider l’opération'} variant="accent" disabled={busy} onPress={() => void valider()} />
          <Button label="Corriger" variant="ghost" onPress={() => setAConfirmer(false)} />
        </Card>
      ) : (
        <Button label="Vérifier et valider" disabled={!pret || busy} onPress={() => setAConfirmer(true)} />
      )}
      {!identiteComplete ? (
        <Text style={T.caption}>Identité complète requise : téléphone, prénom, nom et numéro de pièce.</Text>
      ) : null}
    </FormScreen>
  );
}

function Ligne({ libelle, valeur, fort = false }: { libelle: string; valeur: string; fort?: boolean }): ReactNode {
  return (
    <View style={styles.ligne}>
      <Text style={T.bodyMute}>{libelle}</Text>
      <Text style={fort ? T.title : T.body}>{valeur}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: S.md, paddingTop: S.xxl },
  bloc: { gap: S.sm },
  puces: { gap: S.xs },
  puce: { paddingHorizontal: S.md, paddingVertical: S.xs, borderRadius: R.pill, backgroundColor: C.surface2 },
  puceActive: { backgroundColor: C.navy },
  prix: { gap: 4, paddingTop: S.xs, borderTopWidth: 1, borderTopColor: C.line },
  ligne: { flexDirection: 'row', justifyContent: 'space-between' },
  confirm: { gap: S.xs, backgroundColor: C.warnSoft },
});
