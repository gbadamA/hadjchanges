'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, payments, type PaymentsBoard, type PayoutPending } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';

const xof = (value: string) =>
  `${Number(value).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} XOF`;

const heure = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

/** Un statut, une couleur — mêmes conventions que partout dans le dashboard. */
const STATUT_CLASS: Record<string, string> = {
  REUSSI: 'bg-success/10 text-success',
  EN_COURS: 'bg-warning/10 text-warning',
  ECHOUE: 'bg-danger/10 text-danger',
  EXPIRE: 'bg-light-border/40 text-light-muted dark:bg-dark-border/40 dark:text-dark-muted',
  ANNULE: 'bg-light-border/40 text-light-muted dark:bg-dark-border/40 dark:text-dark-muted',
};

const STATUT_LABEL: Record<string, string> = {
  REUSSI: 'réussi',
  EN_COURS: 'en cours',
  ECHOUE: 'échoué',
  EXPIRE: 'expiré',
  ANNULE: 'annulé',
};

/**
 * Paiements mobile money — un seul écran, volontairement.
 *
 * L'essentiel est la file **« fonds à envoyer »** : le reste (flottant,
 * journal) sert à décider, pas à travailler. Les encaissements, eux, ne
 * demandent aucun geste — ils se confirment seuls par événement signé, et
 * c'est tout l'intérêt : il n'y a plus de reçu à contrôler.
 *
 * ⚠️ Envoyer des fonds est **irréversible passé trois jours** chez le
 * fournisseur. D'où une confirmation nominative — pas un simple `confirm()`
 * anonyme — qui redit le bénéficiaire et le montant avant d'engager l'argent.
 */
export default function PaiementsPage() {
  const { token } = useAuth();
  const [board, setBoard] = useState<PaymentsBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [aConfirmer, setAConfirmer] = useState<PayoutPending | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setBoard(await payments.board(token));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Tableau des paiements illisible.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function envoyer(ligne: PayoutPending) {
    if (!token) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const resultat = await payments.send(ligne.transactionId, token);
      setNotice(
        resultat.statut === 'REUSSI'
          ? `${xof(resultat.montantRecuXof)} envoyés à ${ligne.beneficiaire} (frais ${resultat.fraisXof ? xof(resultat.fraisXof) : 'inconnus'}).`
          : `Versement ${STATUT_LABEL[resultat.statut] ?? resultat.statut} — le rapprochement suivra son sort.`,
      );
      setAConfirmer(null);
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Envoi impossible.');
    } finally {
      setBusy(false);
    }
  }

  async function rapprocher() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const { versements, encaissements } = await payments.reconcile(token);
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

  return (
    <div className="space-y-6">
      <header className="animate-fade-up space-y-1">
        <h1 className="font-display text-h1">Paiements mobile</h1>
        <p className="text-light-muted dark:text-dark-muted">
          Les encaissements se confirment seuls, sans reçu à contrôler. Ce qui demande une décision,
          c’est l’envoi des fonds.
        </p>
      </header>

      {/* ⚠️ Un paiement simulé doit se voir immédiatement : laisser croire à un
          encaissement réel ferait livrer des devises contre rien. */}
      {board && !board.reel ? (
        <p className="rounded-sm border-l-4 border-warning bg-warning/10 p-3 text-body text-warning">
          <strong>Paiements simulés</strong> — aucun argent ne circule. Fournisseur :{' '}
          {board.fournisseur}.
        </p>
      ) : null}

      {error ? (
        <p className="rounded-sm border-l-4 border-danger bg-danger/10 p-3 text-body text-danger">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-sm border-l-4 border-success bg-success/10 p-3 text-body text-success">
          {notice}
        </p>
      ) : null}

      {/* -------------------------------------------------------- chiffres -- */}
      <section className="grid gap-4 sm:grid-cols-3">
        <div className="surface lift p-5">
          <p className="text-caption text-light-muted dark:text-dark-muted">
            Flottant {board?.fournisseur ?? ''}
          </p>
          <p className="tabular font-display text-h2">
            {board?.soldeXof === null || board?.soldeXof === undefined
              ? '—'
              : xof(board.soldeXof)}
          </p>
          {board && board.soldeXof === null ? (
            <p className="text-caption text-light-muted dark:text-dark-muted">
              Fournisseur injoignable — le reste de la page reste utilisable.
            </p>
          ) : null}
        </div>
        <div className="surface lift p-5">
          <p className="text-caption text-light-muted dark:text-dark-muted">
            Encaissements en attente
          </p>
          <p className="tabular font-display text-h2">{board?.encaissementsEnAttente ?? '—'}</p>
          <p className="text-caption text-light-muted dark:text-dark-muted">
            Clients qui n’ont pas encore payé.
          </p>
        </div>
        <div className="surface lift p-5">
          <p className="text-caption text-light-muted dark:text-dark-muted">Versements en cours</p>
          <p className="tabular font-display text-h2">{board?.versementsEnCours ?? '—'}</p>
          <p className="text-caption text-light-muted dark:text-dark-muted">
            Issue inconnue — ne pas relancer, le rapprochement tranche.
          </p>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => void rapprocher()}
          disabled={busy || !token}
          className="rounded-sm border border-light-border px-4 py-2 font-medium transition hover:bg-light-border/30 disabled:opacity-40 dark:border-dark-border dark:hover:bg-dark-border/30"
        >
          Rapprocher maintenant
        </button>
        <span className="text-caption text-light-muted dark:text-dark-muted">
          Le fournisseur n’avertit pas de l’issue d’un versement : il faut aller la lui demander.
          C’est automatique chaque minute, ce bouton ne fait que ne pas attendre.
        </span>
      </div>

      {/* --------------------------------------------------- fonds à envoyer */}
      <section className="space-y-3">
        <h2 className="font-display text-h2">Fonds à envoyer</h2>

        {loading ? (
          <p className="text-light-muted dark:text-dark-muted">Chargement…</p>
        ) : (board?.aVerser.length ?? 0) === 0 ? (
          <p className="rounded-md border border-dashed border-light-border p-6 text-center text-light-muted dark:border-dark-border dark:text-dark-muted">
            Rien à envoyer. Les opérations apparaissent ici dès que les fonds sont disponibles.
          </p>
        ) : (
          <ul className="space-y-2">
            {board?.aVerser.map((ligne) => (
              <li key={ligne.transactionId} className="surface lift p-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="space-y-1">
                    <p className="font-mono text-caption">{ligne.reference}</p>
                    <p className="font-medium">{ligne.beneficiaire}</p>
                    <p className="tabular text-caption text-light-muted dark:text-dark-muted">
                      {ligne.mobile ?? 'numéro manquant'}
                      {ligne.agence ? ` · ${ligne.agence}` : ''}
                    </p>
                    {ligne.tentativesEchouees > 0 ? (
                      <p className="text-caption text-danger">
                        {ligne.tentativesEchouees} tentative(s) déjà échouée(s) — chacune coûte des
                        frais.
                      </p>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-4">
                    <p className="tabular font-display text-h2">{xof(ligne.montantXof)}</p>
                    {ligne.mobile ? (
                      <button
                        onClick={() => {
                          setAConfirmer(ligne);
                          setNotice(null);
                        }}
                        disabled={busy}
                        className="rounded-sm bg-success px-5 py-2.5 font-medium text-white transition hover:opacity-90 disabled:opacity-40"
                      >
                        Envoyer
                      </button>
                    ) : (
                      <span className="text-caption text-danger">
                        Numéro à corriger avant envoi
                      </span>
                    )}
                  </div>
                </div>

                {/* Confirmation nominative, dépliée sous la ligne concernée :
                    elle redit QUI reçoit COMBIEN, parce qu'un envoi ne se
                    reprend pas. */}
                {aConfirmer?.transactionId === ligne.transactionId ? (
                  <div className="mt-4 space-y-3 rounded-sm border border-warning bg-warning/5 p-4">
                    <p className="text-body">
                      Envoyer <strong>{xof(ligne.montantXof)}</strong> à{' '}
                      <strong>{ligne.beneficiaire}</strong> au{' '}
                      <strong className="tabular">{ligne.mobile}</strong> ?
                    </p>
                    <p className="text-caption text-light-muted dark:text-dark-muted">
                      Des frais s’ajoutent au montant, à la charge du bureau. L’opération sera
                      clôturée dès l’arrivée des fonds.
                    </p>
                    <div className="flex flex-wrap gap-3">
                      <button
                        onClick={() => void envoyer(ligne)}
                        disabled={busy}
                        className="rounded-sm bg-success px-5 py-2.5 font-medium text-white transition hover:opacity-90 disabled:opacity-40"
                      >
                        {busy ? 'Envoi…' : 'Confirmer l’envoi'}
                      </button>
                      <button
                        onClick={() => setAConfirmer(null)}
                        disabled={busy}
                        className="rounded-sm border border-light-border px-5 py-2.5 font-medium transition hover:bg-light-border/30 disabled:opacity-40 dark:border-dark-border dark:hover:bg-dark-border/30"
                      >
                        Annuler
                      </button>
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ----------------------------------------------------------- journal */}
      <section className="space-y-3">
        <h2 className="font-display text-h2">Derniers mouvements</h2>
        {(board?.journal.length ?? 0) === 0 ? (
          <p className="rounded-md border border-dashed border-light-border p-6 text-center text-light-muted dark:border-dark-border dark:text-dark-muted">
            Aucun paiement mobile pour l’instant.
          </p>
        ) : (
          <div className="surface overflow-x-auto">
            <table className="w-full text-body">
              <thead className="border-b border-light-border text-caption text-light-muted dark:border-dark-border dark:text-dark-muted">
                <tr>
                  <th className="p-3 text-left font-medium">Sens</th>
                  <th className="p-3 text-left font-medium">Opération</th>
                  <th className="p-3 text-right font-medium">Montant</th>
                  <th className="p-3 text-right font-medium">Frais</th>
                  <th className="p-3 text-left font-medium">État</th>
                  <th className="p-3 text-left font-medium">Quand</th>
                </tr>
              </thead>
              <tbody>
                {board?.journal.map((ligne) => (
                  <tr
                    key={`${ligne.sens}-${ligne.id}`}
                    className="border-b border-light-border/60 last:border-0 dark:border-dark-border/60"
                  >
                    <td className="p-3">{ligne.sens === 'ENTREE' ? 'Encaissement' : 'Versement'}</td>
                    <td className="p-3 font-mono text-caption">
                      {ligne.reference}
                      {ligne.tiers ? (
                        <span className="tabular block text-light-muted dark:text-dark-muted">
                          {ligne.tiers}
                        </span>
                      ) : null}
                    </td>
                    <td className="tabular p-3 text-right">{xof(ligne.montantXof)}</td>
                    <td className="tabular p-3 text-right">
                      {ligne.fraisXof ? xof(ligne.fraisXof) : '—'}
                    </td>
                    <td className="p-3">
                      <span
                        className={`rounded-sm px-2 py-1 text-caption ${STATUT_CLASS[ligne.statut] ?? ''}`}
                      >
                        {STATUT_LABEL[ligne.statut] ?? ligne.statut}
                      </span>
                      {ligne.codeEchec ? (
                        <span className="block text-caption text-danger">{ligne.codeEchec}</span>
                      ) : null}
                    </td>
                    <td className="p-3 text-caption text-light-muted dark:text-dark-muted">
                      {heure(ligne.le)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
