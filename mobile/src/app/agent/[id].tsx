import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { api, ApiError, type PublicSettings } from '../../api';
import { useAuth } from '../../auth';
import { downloadAndShare } from '../../download';
import { DEPOSIT_LABEL, money, type Transaction } from '../../models';
import {
  estMobileMoney,
  paiementComplet,
  PaiementComptoir,
  type ChoixPaiement,
} from '../../paiement-qr';
import { C, R, S, STATUS, T } from '../../theme';
import { Badge, Button, Card, EmptyState, ErrorBanner, FormScreen, Loader } from '../../ui';
import { useTransactionUpdates } from '../../useTransactionUpdates';

const montant = (value: string, devise: string): string =>
  money(value, devise === 'XOF' ? 0 : 2, devise);

/** Réseau proposé d'office : celui choisi par le client, sinon les espèces. */
const choixInitial = (operation: Transaction): ChoixPaiement => ({
  methode:
    estMobileMoney(operation.depositMethod) && operation.sourceCurrency === 'XOF'
      ? operation.depositMethod
      : 'ESPECES_AGENCE',
  reference: '',
});

/**
 * Fiche d'une opération, côté agent.
 *
 * Tout ce qu'il faut pour agir sans quitter l'écran : qui, combien, où en est
 * l'opération, et **un seul geste proposé — celui qu'elle attend**. Offrir
 * toutes les actions possibles ferait chercher la bonne, et se tromper.
 *
 * Mise à jour en direct : un paiement confirmé par l'opérateur, ou l'action
 * d'un collègue, s'affiche sans recharger.
 */
export default function FicheOperation(): ReactNode {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { accessToken, profile } = useAuth();
  const router = useRouter();

  const [operation, setOperation] = useState<Transaction | null>(null);
  const [reglages, setReglages] = useState<PublicSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [choix, setChoix] = useState<ChoixPaiement>({ methode: 'ESPECES_AGENCE', reference: '' });
  const [aConfirmer, setAConfirmer] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    if (!accessToken || !id) return;
    try {
      const [ligne, publics] = await Promise.all([
        api.transaction(id, accessToken),
        api.publicSettings(),
      ]);
      setOperation(ligne);
      setReglages(publics);
      setChoix(choixInitial(ligne));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Opération illisible.');
    } finally {
      setLoading(false);
    }
  }, [accessToken, id]);

  useEffect(() => {
    void load();
  }, [load]);

  useTransactionUpdates(
    (ligne) => {
      if (ligne.id === id) setOperation(ligne);
    },
    () => void load(),
  );

  /** Enveloppe commune : verrou, erreur lisible, message de réussite. */
  const agir = async (geste: () => Promise<Transaction>, reussite: string): Promise<void> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setOperation(await geste());
      setNotice(reussite);
      setAConfirmer(false);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Action impossible.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loader label="Ouverture de l’opération…" />;
  if (!operation || !accessToken) {
    return (
      <FormScreen>
        <EmptyState
          title="Opération introuvable"
          message={error ?? 'Elle n’existe pas, ou elle est rattachée à une autre agence.'}
          action={<Button label="Retour" onPress={() => router.back()} />}
        />
      </FormScreen>
    );
  }

  const couleur = STATUS[operation.status];
  const enDevises = operation.sourceCurrency !== 'XOF';
  const preuve = operation.proofs[0];

  return (
    <FormScreen>
      <View style={styles.head}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color={C.ink} />
        </Pressable>
        <Text style={T.h1}>{operation.reference}</Text>
      </View>

      <ErrorBanner message={error} />
      {notice ? (
        <Card style={styles.notice}>
          <Text style={[T.body, { color: C.ok }]}>{notice}</Text>
        </Card>
      ) : null}

      <Card elevated style={styles.resume}>
        <Badge label={operation.statusLabel} color={couleur} soft={`${couleur}22`} />
        {operation.client ? (
          <Text style={T.title}>
            {operation.client.firstName} {operation.client.lastName} · {operation.client.phone}
          </Text>
        ) : null}
        <Ligne libelle="Le client remet" valeur={montant(operation.sourceAmount, operation.sourceCurrency)} />
        <Ligne libelle="Le client reçoit" valeur={montant(operation.targetAmount, operation.targetCurrency)} fort />
        <Ligne libelle="Taux" valeur={`${operation.appliedRate} FCFA`} />
        <Ligne libelle="Commission" valeur={montant(operation.commissionAmount, 'XOF')} />
        <Ligne libelle="Paiement" valeur={DEPOSIT_LABEL[operation.depositMethod]} />
        <Ligne libelle="Canal" valeur={operation.channel === 'GUICHET' ? 'Guichet' : 'Application'} />
        {operation.agency ? <Ligne libelle="Agence" valeur={operation.agency.name} /> : null}
        {operation.beneficiary ? (
          <Ligne
            libelle="Bénéficiaire"
            valeur={`${operation.beneficiary.name}${operation.beneficiary.relation ? ` (${operation.beneficiary.relation})` : ''}`}
          />
        ) : null}
        {preuve?.declaredRef ? <Ligne libelle="ID de paiement" valeur={preuve.declaredRef} /> : null}
      </Card>

      {/* ------------------------------------------- le geste attendu -- */}
      {operation.status === 'CREEE' ? (
        <Card style={styles.action}>
          <Text style={T.title}>Encaisser</Text>
          <PaiementComptoir
            montant={operation.sourceAmount}
            devise={operation.sourceCurrency}
            reglages={reglages}
            choix={choix}
            onChange={(suivant) => {
              setChoix(suivant);
              setAConfirmer(false);
            }}
            especesSeules={enDevises}
          />
          {aConfirmer ? (
            <View style={styles.confirm}>
              <Text style={T.body}>
                Confirmer avoir reçu {montant(operation.sourceAmount, operation.sourceCurrency)}
                {estMobileMoney(choix.methode) ? ` par ${DEPOSIT_LABEL[choix.methode]}` : ' en espèces'} ?
              </Text>
              <Text style={T.caption}>Le change sera exécuté et la caisse mouvementée.</Text>
              <Button
                label={busy ? 'Encaissement…' : 'Confirmer l’encaissement'}
                variant="accent"
                disabled={busy}
                onPress={() =>
                  void agir(
                    () =>
                      api.collect(
                        operation.id,
                        {
                          depositMethod: choix.methode,
                          ...(choix.reference.trim() ? { declaredRef: choix.reference.trim() } : {}),
                        },
                        accessToken,
                      ),
                    'Paiement constaté, change exécuté.',
                  )
                }
              />
              <Button label="Annuler" variant="ghost" onPress={() => setAConfirmer(false)} />
            </View>
          ) : (
            <Button
              label="J’ai reçu les fonds"
              disabled={busy || !paiementComplet(choix)}
              onPress={() => setAConfirmer(true)}
            />
          )}
        </Card>
      ) : null}

      {operation.status === 'PAIEMENT_CONFIRME' ? (
        <Card style={styles.action}>
          <Text style={T.title}>Change en attente</Text>
          <Text style={T.bodyMute}>
            Le paiement est confirmé mais le change n’a pas pu s’exécuter — le plus souvent, une
            encaisse insuffisante. Faites alimenter la caisse de l’agence depuis le tableau de bord.
          </Text>
        </Card>
      ) : null}

      {operation.status === 'CHANGE_EXECUTE' ? (
        <Card style={styles.action}>
          <Text style={T.title}>Préparer les fonds</Text>
          <Button
            label={busy ? 'Enregistrement…' : 'Marquer les fonds disponibles'}
            disabled={busy}
            onPress={() =>
              void agir(
                () => api.markReady(operation.id, accessToken),
                'Fonds disponibles : le client est prévenu.',
              )
            }
          />
        </Card>
      ) : null}

      {operation.status === 'PRETE_POUR_RETRAIT' ? (
        <Card style={styles.action}>
          <Text style={T.title}>Remettre les fonds</Text>
          {operation.payoutMethod === 'MOBILE_MONEY' ? (
            <>
              <Text style={T.bodyMute}>
                Fonds à envoyer par mobile money : l’envoi se fait depuis le Service, avec sa propre
                confirmation.
              </Text>
              <Button label="Ouvrir le Service" variant="ghost" onPress={() => router.push('/service')} />
            </>
          ) : (
            <Button
              label={busy ? 'Clôture…' : `Remis au client — ${montant(operation.targetAmount, operation.targetCurrency)}`}
              disabled={busy}
              onPress={() =>
                void agir(
                  () => api.closeTransaction(operation.id, accessToken),
                  'Opération clôturée, justificatif émis.',
                )
              }
            />
          )}
        </Card>
      ) : null}

      {operation.status === 'CLOTUREE' ? (
        <Card style={styles.action}>
          <Text style={T.title}>Justificatif</Text>
          <Button
            label={busy ? 'Préparation…' : 'Partager le justificatif'}
            disabled={busy}
            onPress={() => {
              setBusy(true);
              setError(null);
              downloadAndShare(
                `/transactions/${operation.id}/justificatif.pdf`,
                `justificatif-${operation.reference}.pdf`,
                accessToken,
              )
                .catch((cause: unknown) =>
                  setError(cause instanceof Error ? cause.message : 'Téléchargement impossible.'),
                )
                .finally(() => setBusy(false));
            }}
          />
        </Card>
      ) : null}

      {/* ------------------------------------------------- historique -- */}
      <Card style={styles.action}>
        <Text style={T.title}>Suivi</Text>
        {operation.timeline.map((etape) => (
          <View key={etape.status} style={styles.etape}>
            <Ionicons
              name={etape.done ? 'checkmark-circle' : etape.current ? 'ellipse' : 'ellipse-outline'}
              size={18}
              color={etape.done ? C.ok : etape.current ? C.navy : C.line}
            />
            <Text style={[T.body, styles.etapeTexte, !etape.done && !etape.current && { color: C.textMute }]}>
              {etape.label}
            </Text>
            {etape.at ? (
              <Text style={T.caption}>
                {new Date(etape.at).toLocaleString('fr-FR', {
                  day: '2-digit',
                  month: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </Text>
            ) : null}
          </View>
        ))}
      </Card>

      {profile?.role === 'OPERATEUR' && operation.agency === null ? (
        <Text style={T.caption}>Opération sans agence : seul l’encadrement peut l’encaisser.</Text>
      ) : null}
    </FormScreen>
  );
}

function Ligne({ libelle, valeur, fort = false }: { libelle: string; valeur: string; fort?: boolean }): ReactNode {
  return (
    <View style={styles.ligne}>
      <Text style={T.bodyMute}>{libelle}</Text>
      <Text style={[fort ? T.title : T.body, styles.valeur]} numberOfLines={2}>
        {valeur}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: S.md, paddingTop: S.xxl },
  notice: { backgroundColor: C.okSoft },
  resume: { gap: S.xs, alignItems: 'stretch' },
  action: { gap: S.sm },
  confirm: {
    gap: S.xs,
    padding: S.sm,
    backgroundColor: C.warnSoft,
    borderRadius: R.sm,
  },
  ligne: { flexDirection: 'row', justifyContent: 'space-between', gap: S.md },
  valeur: { flexShrink: 1, textAlign: 'right' },
  etape: { flexDirection: 'row', alignItems: 'center', gap: S.sm },
  etapeTexte: { flex: 1 },
});
