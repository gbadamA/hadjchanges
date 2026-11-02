import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { api, ApiError, type PaymentsBoard, type PayoutPending } from '../api';
import { useAuth } from '../auth';
import { money, type Transaction } from '../models';
import { ScanOverlay } from '../scan';
import { C, R, S, T } from '../theme';
import { Button, Card, EmptyState, ErrorBanner, Field, Loader, Screen } from '../ui';

/**
 * Espace de service — ce qu'un agent a à faire, sur son téléphone.
 *
 * Le geste central est en haut : **retrouver l'opération du client** en
 * scannant son code ou en saisissant son numéro, puis encaisser. Il n'y a plus
 * de file de reçus à contrôler — le client n'importe plus de photo, c'est
 * l'agent qui constate le paiement, client devant lui.
 *
 * ⚠️ Les deux gestes de cet écran engagent de l'argent — encaisser exécute le
 * change et mouvemente la caisse, envoyer des fonds les fait sortir sans retour
 * possible passé trois jours. Chacun demande donc une confirmation qui redit le
 * montant, et le second nomme aussi le bénéficiaire. Il n'existe pas encore de
 * double validation à deux personnes : sur un téléphone perdu ou prêté, un
 * compte ouvert suffit. C'est un choix assumé, pas un oubli.
 */
/**
 * États depuis lesquels un agent peut encaisser au comptoir.
 *
 * Les mêmes que ceux acceptés par l'API : un justificatif déjà déposé ou
 * refusé n'empêche pas le client de venir payer en personne.
 */
const EN_ATTENTE_DE_PAIEMENT: ReadonlyArray<Transaction['status']> = [
  'CREEE',
  'RECU_SOUMIS',
  'RECU_REJETE',
];

export default function Service(): ReactNode {
  const { profile, accessToken } = useAuth();

  const [board, setBoard] = useState<PaymentsBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [aVerserConfirme, setAVerserConfirme] = useState<string | null>(null);
  const [aEncaisser, setAEncaisser] = useState(false);
  const [referencePaiement, setReferencePaiement] = useState('');

  const [numero, setNumero] = useState('');
  const [scanOuvert, setScanOuvert] = useState(false);
  const [trouvee, setTrouvee] = useState<Transaction | null>(null);
  const [introuvable, setIntrouvable] = useState(false);

  const staff = profile !== null && profile.role !== 'CLIENT';

  const load = useCallback(async (): Promise<void> => {
    if (!accessToken || !staff) {
      setLoading(false);
      return;
    }
    setError(null);
    try {
      setBoard(await api.paymentsBoard(accessToken));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Données de service illisibles.');
    } finally {
      setLoading(false);
    }
  }, [accessToken, staff]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Retrouve une opération par son numéro, scanné ou saisi.
   *
   * ⚠️ L'API cherche en correspondance EXACTE : au comptoir on agit sur une
   * opération précise. Une recherche approchante remonterait les voisines d'un
   * numéro mal lu, et l'agent validerait la mauvaise.
   */
  const chercher = useCallback(
    async (reference: string): Promise<void> => {
      const propre = reference.trim().toUpperCase();
      if (!accessToken || propre.length < 3) return;
      setBusy(true);
      setError(null);
      setNotice(null);
      setTrouvee(null);
      setIntrouvable(false);
      try {
        const resultats = await api.findTransaction(propre, accessToken);
        if (resultats.length === 0) setIntrouvable(true);
        else setTrouvee(resultats[0]);
      } catch (cause) {
        setError(cause instanceof ApiError ? cause.message : 'Recherche impossible.');
      } finally {
        setBusy(false);
      }
    },
    [accessToken],
  );

  /** Fait avancer l'opération trouvée d'un cran, selon où elle en est. */
  async function avancer(
    operation: Transaction,
    geste: 'ready' | 'close',
  ): Promise<void> {
    if (!accessToken) return;
    setBusy(true);
    setError(null);
    try {
      const miseAJour =
        geste === 'ready'
          ? await api.markReady(operation.id, accessToken)
          : await api.closeTransaction(operation.id, accessToken);
      setTrouvee(miseAJour);
      setNotice(
        geste === 'ready'
          ? `Fonds disponibles, le client peut venir (${operation.reference}).`
          : `Opération clôturée et justificatif émis (${operation.reference}).`,
      );
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Action impossible.');
    } finally {
      setBusy(false);
    }
  }

  /**
   * Encaissement au comptoir : l'agent constate le paiement et l'atteste.
   *
   * ⚠️ Exécute le change et mouvemente la caisse dans la foulée. La référence
   * du paiement est la SEULE trace vérifiable quand le client a réglé par
   * mobile money — plus aucun justificatif n'est conservé.
   */
  async function encaisser(operation: Transaction): Promise<void> {
    if (!accessToken) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const miseAJour = await api.collect(
        operation.id,
        referencePaiement.trim().length >= 3
          ? { declaredRef: referencePaiement.trim() }
          : {},
        accessToken,
      );
      setTrouvee(miseAJour);
      setAEncaisser(false);
      setReferencePaiement('');
      setNotice(`Paiement constaté, change exécuté (${operation.reference}).`);
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Encaissement impossible.');
    } finally {
      setBusy(false);
    }
  }

  async function verser(ligne: PayoutPending): Promise<void> {
    if (!accessToken) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const resultat = await api.sendPayout(ligne.transactionId, accessToken);
      setNotice(
        resultat.statut === 'REUSSI'
          ? `${xof(resultat.montantRecuXof)} envoyés à ${ligne.beneficiaire}.`
          : `Versement ${resultat.statut.toLowerCase()} — le rapprochement suivra son sort.`,
      );
      setAVerserConfirme(null);
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Envoi impossible.');
    } finally {
      setBusy(false);
    }
  }

  async function rapprocher(): Promise<void> {
    if (!accessToken) return;
    setBusy(true);
    setError(null);
    try {
      const { versements, encaissements } = await api.reconcile(accessToken);
      setNotice(
        versements + encaissements === 0
          ? 'Rien à rapprocher : tout est à jour.'
          : `${versements} versement(s) et ${encaissements} encaissement(s) mis à jour.`,
      );
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Rapprochement impossible.');
    } finally {
      setBusy(false);
    }
  }

  if (!staff) {
    return (
      <Screen>
        <Text style={T.h1}>Service</Text>
        <EmptyState
          title="Réservé au personnel"
          message="Cet espace est destiné aux agents du bureau. Votre compte client n’y a pas accès."
        />
      </Screen>
    );
  }

  if (loading) {
    return (
      <Screen>
        <Text style={T.h1}>Service</Text>
        <Loader label="Ouverture de votre poste…" />
      </Screen>
    );
  }

  return (
    <Screen>
      <Text style={T.h1}>Service</Text>
      <ErrorBanner message={error} />
      {notice ? (
        <Card style={styles.notice}>
          <Text style={[T.body, { color: C.ok }]}>{notice}</Text>
        </Card>
      ) : null}

      {/* Un paiement simulé doit se voir : livrer des devises contre un
          encaissement qui n'existe pas serait une perte sèche. */}
      {board && !board.reel ? (
        <Card style={styles.warn}>
          <Text style={[T.body, { color: C.warn }]}>
            Paiements simulés ({board.fournisseur}) — aucun argent ne circule.
          </Text>
        </Card>
      ) : null}

      <Card style={styles.block}>
        <Text style={T.title}>Paiements mobile</Text>
        <View style={styles.figures}>
          <Figure
            label="Flottant"
            value={board?.soldeXof === null || board?.soldeXof === undefined ? '—' : xof(board.soldeXof)}
          />
          <Figure label="À encaisser" value={String(board?.encaissementsEnAttente ?? '—')} />
          <Figure label="Versements en cours" value={String(board?.versementsEnCours ?? '—')} />
        </View>
        <Text style={T.caption}>
          Le fournisseur n’avertit pas de l’issue d’un versement : elle se demande. C’est
          automatique chaque minute.
        </Text>
        <Button
          label={busy ? 'Vérification…' : 'Rapprocher maintenant'}
          onPress={() => void rapprocher()}
          variant="ghost"
          disabled={busy}
        />
      </Card>

      {/* ------------------------------------------ trouver une opération -- */}
      <Card style={styles.block}>
        <Text style={T.title}>Trouver une opération</Text>
        <Text style={T.caption}>
          Scannez le code que le client présente, ou saisissez son numéro.
        </Text>
        <Field
          label="Numéro d’opération"
          value={numero}
          onChangeText={(texte) => {
            setNumero(texte);
            setIntrouvable(false);
          }}
          placeholder="HC-2026-000123"
          autoCapitalize="none"
        />
        <View style={styles.actions}>
          <Button
            label={busy ? 'Recherche…' : 'Rechercher'}
            onPress={() => void chercher(numero)}
            disabled={busy || numero.trim().length < 3}
          />
          {/* Le scan ne remplace pas la saisie, il l'accélère : caméra refusée
              ou écran fissuré, l'agent doit pouvoir continuer. */}
          <Button label="Scanner le code" onPress={() => setScanOuvert(true)} variant="ghost" />
        </View>

        {introuvable ? (
          <Text style={[T.bodyMute, { color: C.stop }]}>
            Aucune opération ne porte ce numéro
            {profile?.role === 'OPERATEUR' ? ' dans votre agence' : ''}. Vérifiez la saisie.
          </Text>
        ) : null}

        {trouvee ? (
          <View style={styles.row}>
            <Text style={T.label}>{trouvee.reference}</Text>
            <Text style={T.rate}>
              {money(
                trouvee.targetAmount,
                trouvee.targetCurrency === 'XOF' ? 0 : 2,
                trouvee.targetCurrency,
              )}
            </Text>
            <Text style={T.caption}>
              {trouvee.statusLabel}
              {trouvee.agency ? ` · ${trouvee.agency.name}` : ''}
            </Text>

            {/* Un seul geste proposé : celui que l'opération attend. Offrir
                toutes les actions possibles ferait chercher la bonne, et se
                tromper. */}
            {EN_ATTENTE_DE_PAIEMENT.includes(trouvee.status) ? (
              aEncaisser ? (
                <View style={styles.confirm}>
                  <Text style={T.body}>
                    Confirmer avoir reçu{' '}
                    {money(
                      trouvee.sourceAmount,
                      trouvee.sourceCurrency === 'XOF' ? 0 : 2,
                      trouvee.sourceCurrency,
                    )}{' '}
                    pour {trouvee.reference} ?
                  </Text>
                  <Text style={T.caption}>
                    Le change sera exécuté immédiatement et la caisse mouvementée.
                  </Text>
                  {/* ⚠️ Plus aucun justificatif n'est conservé : cette
                      référence est la seule trace vérifiable d'un paiement
                      mobile money. La saisir dès qu'elle existe. */}
                  <Field
                    label="Référence du paiement (si mobile money)"
                    value={referencePaiement}
                    onChangeText={setReferencePaiement}
                    placeholder="relevée sur le téléphone du client"
                    autoCapitalize="none"
                  />
                  <Button
                    label={busy ? 'Encaissement…' : 'Confirmer l’encaissement'}
                    onPress={() => void encaisser(trouvee)}
                    variant="accent"
                    disabled={busy}
                  />
                  <Button
                    label="Annuler"
                    onPress={() => {
                      setAEncaisser(false);
                      setReferencePaiement('');
                    }}
                    variant="ghost"
                  />
                </View>
              ) : (
                <Button
                  label="Encaisser — j’ai reçu les fonds"
                  onPress={() => {
                    setAEncaisser(true);
                    setReferencePaiement('');
                    setNotice(null);
                  }}
                  disabled={busy}
                />
              )
            ) : trouvee.status === 'CHANGE_EXECUTE' ? (
              <Button
                label="Marquer les fonds disponibles"
                onPress={() => void avancer(trouvee, 'ready')}
                disabled={busy}
              />
            ) : trouvee.status === 'PRETE_POUR_RETRAIT' ? (
              trouvee.payoutMethod === 'MOBILE_MONEY' ? (
                <Text style={T.caption}>
                  Fonds à envoyer par mobile money — l’opération figure plus bas, avec sa
                  confirmation.
                </Text>
              ) : (
                <Button
                  label="Remis au client — clôturer"
                  onPress={() => void avancer(trouvee, 'close')}
                  disabled={busy}
                />
              )
            ) : (
              <Text style={T.caption}>Rien à faire sur cette opération pour l’instant.</Text>
            )}
          </View>
        ) : null}
      </Card>

      {scanOuvert ? (
        <ScanOverlay
          onCode={(valeur) => {
            setScanOuvert(false);
            setNumero(valeur);
            void chercher(valeur);
          }}
          onClose={() => setScanOuvert(false)}
        />
      ) : null}

      {/* ------------------------------------------------ fonds à envoyer -- */}
      <Card style={styles.block}>
        <Text style={T.title}>Fonds à envoyer ({board?.aVerser.length ?? 0})</Text>
        {(board?.aVerser.length ?? 0) === 0 ? (
          <Text style={T.bodyMute}>
            Rien à envoyer. Les opérations apparaissent dès que les fonds sont disponibles.
          </Text>
        ) : (
          board?.aVerser.map((ligne) => (
            <View key={ligne.transactionId} style={styles.row}>
              <Text style={T.label}>{ligne.reference}</Text>
              <Text style={T.rate}>{xof(ligne.montantXof)}</Text>
              <Text style={T.caption}>
                {ligne.beneficiaire}
                {ligne.mobile ? ` · ${ligne.mobile}` : ' · numéro manquant'}
              </Text>
              {ligne.tentativesEchouees > 0 ? (
                <Text style={[T.caption, { color: C.stop }]}>
                  {ligne.tentativesEchouees} tentative(s) échouée(s) — chacune coûte des frais.
                </Text>
              ) : null}

              {!ligne.mobile ? (
                <Text style={[T.caption, { color: C.stop }]}>
                  Numéro à corriger au dashboard avant tout envoi.
                </Text>
              ) : aVerserConfirme === ligne.transactionId ? (
                <View style={styles.confirm}>
                  <Text style={T.body}>
                    Envoyer {xof(ligne.montantXof)} à {ligne.beneficiaire} au {ligne.mobile} ?
                  </Text>
                  <Text style={T.caption}>
                    Des frais s’ajoutent, à la charge du bureau. Irréversible passé trois jours.
                  </Text>
                  <Button
                    label={busy ? 'Envoi…' : 'Confirmer l’envoi'}
                    onPress={() => void verser(ligne)}
                    variant="accent"
                    disabled={busy}
                  />
                  <Button
                    label="Annuler"
                    onPress={() => setAVerserConfirme(null)}
                    variant="ghost"
                  />
                </View>
              ) : (
                <Button
                  label="Envoyer les fonds"
                  onPress={() => {
                    setAVerserConfirme(ligne.transactionId);
                    setNotice(null);
                  }}
                  disabled={busy}
                />
              )}
            </View>
          ))
        )}
      </Card>
    </Screen>
  );
}

/** XOF n'a pas de décimales : les afficher donnerait un faux air de précision. */
const xof = (value: string): string => money(value, 0, 'XOF');

function Figure({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <View style={styles.figure}>
      <Text style={T.caption} numberOfLines={1}>
        {label}
      </Text>
      <Text style={T.rate} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: S.sm },
  notice: { backgroundColor: C.okSoft, gap: S.xs },
  warn: { backgroundColor: C.warnSoft, gap: S.xs },
  figures: { flexDirection: 'row', gap: S.sm },
  figure: { flex: 1, gap: 2 },
  row: {
    gap: 4,
    paddingTop: S.sm,
    borderTopWidth: 1,
    borderTopColor: C.line,
  },
  actions: { gap: S.xs, paddingTop: S.xs },
  confirm: {
    gap: S.xs,
    paddingTop: S.xs,
    paddingHorizontal: S.sm,
    paddingBottom: S.sm,
    backgroundColor: C.warnSoft,
    borderRadius: R.sm,
  },
});
