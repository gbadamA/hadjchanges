import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { api, ApiError, type PaymentsBoard, type PayoutPending, type StaffBoard } from '../api';
import { useAuth } from '../auth';
import { money } from '../models';
import { ScanOverlay } from '../scan';
import { C, R, S, T, shadow } from '../theme';
import { Button, Card, EmptyState, ErrorBanner, Field, Loader, Screen } from '../ui';
import { useTransactionUpdates } from '../useTransactionUpdates';

/**
 * Espace de service — ce qu'un agent a à faire, sur son téléphone.
 *
 * De haut en bas, dans l'ordre de la journée :
 *  1. **le tableau du jour** — ce qui attend, ce qui est fait, d'un coup d'œil ;
 *     chaque case ouvre la liste correspondante ;
 *  2. **les trois gestes** — scanner le code d'un client, ouvrir une opération
 *     au guichet, suivre toutes les opérations ;
 *  3. les versements mobile money à envoyer.
 *
 * Toute action sur une opération se fait sur SA fiche (`/agent/[id]`) : un
 * seul endroit où l'on encaisse, prépare et remet, quel que soit le chemin
 * par lequel on l'a retrouvée (scan, numéro, liste).
 *
 * ⚠️ Envoyer des fonds les fait sortir sans retour possible passé trois jours :
 * la confirmation redit le montant et nomme le bénéficiaire. Il n'existe pas
 * de double validation à deux personnes : sur un téléphone perdu ou prêté, un
 * compte ouvert suffit. C'est un choix assumé, pas un oubli.
 */
export default function Service(): ReactNode {
  const { profile, accessToken } = useAuth();
  const router = useRouter();

  const [jour, setJour] = useState<StaffBoard | null>(null);
  const [board, setBoard] = useState<PaymentsBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [aVerserConfirme, setAVerserConfirme] = useState<string | null>(null);
  const [numero, setNumero] = useState('');
  const [scanOuvert, setScanOuvert] = useState(false);
  const [introuvable, setIntrouvable] = useState(false);

  const staff = profile !== null && profile.role !== 'CLIENT';

  const load = useCallback(async (): Promise<void> => {
    if (!accessToken || !staff) {
      setLoading(false);
      return;
    }
    setError(null);
    try {
      // Le tableau du jour d'abord : c'est lui que l'agent regarde. Le
      // fournisseur de paiement peut être lent ou injoignable sans bloquer.
      setJour(await api.staffBoard(accessToken));
      setBoard(await api.paymentsBoard(accessToken).catch(() => null));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Données de service illisibles.');
    } finally {
      setLoading(false);
    }
  }, [accessToken, staff]);

  // Relu à chaque retour sur l'écran : une opération encaissée sur sa fiche
  // doit déjà être décomptée quand l'agent revient ici.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // Et en direct : un paiement confirmé par l'opérateur, un geste d'un
  // collègue, et les compteurs bougent sans rien toucher.
  useTransactionUpdates(
    () => void load(),
    () => void load(),
  );

  /**
   * Retrouve une opération par son numéro, scanné ou saisi, et ouvre sa fiche.
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
      setIntrouvable(false);
      try {
        const resultats = await api.findTransaction(propre, accessToken);
        if (resultats.length === 0) {
          setIntrouvable(true);
        } else {
          setNumero('');
          router.push({ pathname: '/agent/[id]', params: { id: resultats[0].id } });
        }
      } catch (cause) {
        setError(cause instanceof ApiError ? cause.message : 'Recherche impossible.');
      } finally {
        setBusy(false);
      }
    },
    [accessToken, router],
  );

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

  const ouvrirListe = (filtre: string): void =>
    router.push({ pathname: '/agent/operations', params: { filtre } });

  return (
    <Screen>
      <View style={styles.page}>
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

        {/* --------------------------------------------- tableau du jour -- */}
        <Text style={T.title}>Aujourd’hui</Text>
        <View style={styles.tuiles}>
          <Tuile
            libelle="À encaisser"
            valeur={String(jour?.aEncaisser ?? '—')}
            couleur={C.warn}
            onPress={() => ouvrirListe('A_ENCAISSER')}
          />
          <Tuile
            libelle="À remettre"
            valeur={String(jour?.aRemettre ?? '—')}
            couleur={C.accent}
            onPress={() => ouvrirListe('A_REMETTRE')}
          />
        </View>
        <View style={styles.tuiles}>
          <Tuile
            libelle="Terminées"
            valeur={String(jour?.clotureesAujourdhui ?? '—')}
            couleur={C.ok}
            onPress={() => ouvrirListe('TERMINEES')}
          />
          <Tuile
            libelle="Volume réalisé"
            valeur={jour ? xof(jour.volumeXofAujourdhui) : '—'}
            couleur={C.navy}
            onPress={() => ouvrirListe('TERMINEES')}
          />
        </View>

        {/* ------------------------------------------------ les gestes -- */}
        <Geste
          icone="qr-code-outline"
          titre="Scanner le code d’un client"
          detail="Retrouver son opération et l’encaisser"
          onPress={() => {
            setNotice(null);
            setScanOuvert(true);
          }}
          principal
        />
        <Geste
          icone="storefront-outline"
          titre="Nouvelle opération au guichet"
          detail="Client présent : espèces ou QR mobile money"
          onPress={() => router.push('/agent/guichet')}
        />
        <Geste
          icone="list-outline"
          titre="Toutes les opérations"
          detail="Suivi en direct, filtres par statut et période"
          onPress={() => ouvrirListe('TOUTES')}
        />
        {profile?.role === 'SUPER_ADMIN' ? (
          <Geste
            icone="scan-outline"
            titre="QR marchands"
            detail="Enregistrer le QR Wave, Orange, MTN, Moov du bureau"
            onPress={() => router.push('/agent/qr-marchands')}
          />
        ) : null}

        {/* Le scan ne remplace pas la saisie, il l'accélère : caméra refusée
            ou écran fissuré, l'agent doit pouvoir continuer. */}
        <Card style={styles.block}>
          <Text style={T.title}>Ou saisir le numéro</Text>
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
          <Button
            label={busy ? 'Recherche…' : 'Ouvrir l’opération'}
            onPress={() => void chercher(numero)}
            disabled={busy || numero.trim().length < 3}
          />
          {introuvable ? (
            <Text style={[T.bodyMute, { color: C.stop }]}>
              Aucune opération ne porte ce numéro
              {profile?.role === 'OPERATEUR' ? ' dans votre agence' : ''}. Vérifiez la saisie.
            </Text>
          ) : null}
        </Card>

        {scanOuvert ? (
          <ScanOverlay
            onCode={(valeur) => {
              setScanOuvert(false);
              void chercher(valeur);
            }}
            onClose={() => setScanOuvert(false)}
          />
        ) : null}

        {/* --------------------------------------------- paiements mobile -- */}
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
                    <Button label="Annuler" onPress={() => setAVerserConfirme(null)} variant="ghost" />
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
      </View>
    </Screen>
  );
}

/** XOF n'a pas de décimales : les afficher donnerait un faux air de précision. */
const xof = (value: string): string => money(value, 0, 'XOF');

function Tuile({
  libelle,
  valeur,
  couleur,
  onPress,
}: {
  libelle: string;
  valeur: string;
  couleur: string;
  onPress: () => void;
}): ReactNode {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.tuile, shadow.card, pressed && styles.enfonce]}>
      <View style={[styles.pastille, { backgroundColor: couleur }]} />
      <Text style={T.caption} numberOfLines={1}>
        {libelle}
      </Text>
      <Text style={T.h2} numberOfLines={1} adjustsFontSizeToFit>
        {valeur}
      </Text>
    </Pressable>
  );
}

function Geste({
  icone,
  titre,
  detail,
  onPress,
  principal = false,
}: {
  icone: keyof typeof Ionicons.glyphMap;
  titre: string;
  detail: string;
  onPress: () => void;
  principal?: boolean;
}): ReactNode {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.geste,
        principal ? styles.gestePrincipal : shadow.card,
        pressed && styles.enfonce,
      ]}
    >
      <View style={[styles.icone, principal && styles.iconePrincipale]}>
        <Ionicons name={icone} size={24} color={principal ? C.navy : C.navy} />
      </View>
      <View style={styles.gesteTexte}>
        <Text style={[T.title, principal && { color: C.onDark }]}>{titre}</Text>
        <Text style={[T.caption, principal && { color: C.onDarkDim }]}>{detail}</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={principal ? C.onDark : C.textMute} />
    </Pressable>
  );
}

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
  page: { padding: S.lg, paddingTop: S.huge, gap: S.md },
  block: { gap: S.sm },
  notice: { backgroundColor: C.okSoft, gap: S.xs },
  warn: { backgroundColor: C.warnSoft, gap: S.xs },
  tuiles: { flexDirection: 'row', gap: S.sm },
  tuile: {
    flex: 1,
    gap: 2,
    padding: S.md,
    borderRadius: R.md,
    backgroundColor: C.surface,
  },
  pastille: { width: 8, height: 8, borderRadius: 4, marginBottom: S.xs },
  geste: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.md,
    padding: S.md,
    borderRadius: R.md,
    backgroundColor: C.surface,
  },
  gestePrincipal: { backgroundColor: C.navy, ...shadow.navy },
  icone: {
    width: 44,
    height: 44,
    borderRadius: R.sm,
    backgroundColor: C.navySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconePrincipale: { backgroundColor: C.onDark },
  gesteTexte: { flex: 1, gap: 2 },
  enfonce: { transform: [{ scale: 0.98 }], opacity: 0.92 },
  figures: { flexDirection: 'row', gap: S.sm },
  figure: { flex: 1, gap: 2 },
  row: {
    gap: 4,
    paddingTop: S.sm,
    borderTopWidth: 1,
    borderTopColor: C.line,
  },
  confirm: {
    gap: S.xs,
    paddingTop: S.xs,
    paddingHorizontal: S.sm,
    paddingBottom: S.sm,
    backgroundColor: C.warnSoft,
    borderRadius: R.sm,
  },
});
