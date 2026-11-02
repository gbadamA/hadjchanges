'use client';

import { useState } from 'react';
import { ApiError, transactions, type TransactionRow } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';

const money = (value: string, currency: string) =>
  `${Number(value).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} ${currency}`;

/** États depuis lesquels un agent peut encaisser — les mêmes que l'API. */
const ENCAISSABLE = ['CREEE'];

/**
 * Encaissement au comptoir.
 *
 * Le client n'importe plus de justificatif et il n'y a plus de file de
 * contrôle : l'agent saisit le numéro que le client présente — ou le scanne
 * depuis l'application mobile —, constate le paiement, et encaisse. Le change
 * s'exécute dans la foulée et la caisse est mouvementée.
 *
 * ⚠️ Plus aucun document n'est conservé. Ce qui fait foi : l'identité de
 * l'agent, l'horodatage, et la **référence du paiement** relevée sur le
 * téléphone du client. D'où le champ, à remplir dès qu'elle existe.
 */
export default function EncaissementPage() {
  const { token } = useAuth();
  const [numero, setNumero] = useState('');
  const [trouvee, setTrouvee] = useState<TransactionRow | null>(null);
  const [introuvable, setIntrouvable] = useState(false);
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** Recherche EXACTE : au comptoir on agit sur une opération précise, pas sur
   *  les voisines d'un numéro mal lu. */
  async function chercher() {
    if (!token) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    setTrouvee(null);
    setIntrouvable(false);
    try {
      const resultats = await transactions.byReference(numero.trim().toUpperCase(), token);
      if (resultats.length === 0) setIntrouvable(true);
      else setTrouvee(resultats[0]);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Recherche impossible.');
    } finally {
      setBusy(false);
    }
  }

  async function encaisser() {
    if (!token || !trouvee) return;
    setBusy(true);
    setError(null);
    try {
      const miseAJour = await transactions.collect(
        trouvee.id,
        reference.trim().length >= 3 ? { declaredRef: reference.trim() } : {},
        token,
      );
      setTrouvee(miseAJour);
      setReference('');
      setNotice(`Paiement constaté, change exécuté (${miseAJour.reference}).`);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Encaissement impossible.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <header className="animate-fade-up space-y-1">
        <h1 className="font-display text-h1">Encaissement</h1>
        <p className="text-light-muted dark:text-dark-muted">
          Saisissez le numéro que le client présente, constatez le paiement, encaissez. Le change
          s’exécute dans la foulée et la caisse est mouvementée.
        </p>
      </header>

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

      <section className="surface lift space-y-4 p-6">
        <h2 className="font-display text-h2">Trouver l’opération du client</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex-1 space-y-1">
            <span className="text-caption text-light-muted dark:text-dark-muted">
              Numéro d’opération
            </span>
            <input
              value={numero}
              onChange={(event) => {
                setNumero(event.target.value);
                setTrouvee(null);
                setIntrouvable(false);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void chercher();
              }}
              placeholder="HC-2026-000123"
              className="w-full rounded-sm border border-light-border bg-transparent px-3 py-2 font-mono dark:border-dark-border"
            />
          </label>
          <button
            onClick={() => void chercher()}
            disabled={busy || numero.trim().length < 3}
            className="rounded-sm border border-light-border px-5 py-2.5 font-medium transition hover:bg-light-border/30 disabled:opacity-40 dark:border-dark-border dark:hover:bg-dark-border/30"
          >
            Rechercher
          </button>
        </div>

        {introuvable ? (
          <p className="text-body text-danger">
            Aucune opération ne porte ce numéro. Vérifiez la saisie.
          </p>
        ) : null}

        {trouvee ? (
          <div className="space-y-3 rounded-sm border border-light-border p-4 dark:border-dark-border">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-mono text-caption">{trouvee.reference}</p>
                <p className="font-medium">{trouvee.statusLabel}</p>
                <p className="text-caption text-light-muted dark:text-dark-muted">
                  {trouvee.client
                    ? `${trouvee.client.firstName} ${trouvee.client.lastName}`
                    : 'client inconnu'}
                </p>
              </div>
              <div className="text-right">
                <p className="text-caption text-light-muted dark:text-dark-muted">
                  Montant attendu
                </p>
                {/* Le montant attendu en évidence : c'est ce que l'agent compare
                    à ce qu'il a sous les yeux avant de confirmer. */}
                <p className="tabular font-display text-h2">
                  {money(trouvee.sourceAmount, trouvee.sourceCurrency)}
                </p>
              </div>
            </div>

            {ENCAISSABLE.includes(trouvee.status) ? (
              <>
                <label className="block space-y-1">
                  <span className="text-caption text-light-muted dark:text-dark-muted">
                    Référence du paiement, si mobile money
                  </span>
                  <input
                    value={reference}
                    onChange={(event) => setReference(event.target.value)}
                    placeholder="relevée sur le téléphone du client"
                    className="w-full rounded-sm border border-light-border bg-transparent px-3 py-2 dark:border-dark-border"
                  />
                  <span className="block text-caption text-light-muted dark:text-dark-muted">
                    Seule trace vérifiable : aucun justificatif n’est conservé.
                  </span>
                </label>
                <button
                  onClick={() => void encaisser()}
                  disabled={busy}
                  className="rounded-sm bg-success px-5 py-2.5 font-medium text-white transition hover:opacity-90 disabled:opacity-40"
                >
                  {busy ? 'Encaissement…' : 'J’ai reçu les fonds — encaisser'}
                </button>
              </>
            ) : (
              <p className="text-body text-light-muted dark:text-dark-muted">
                Cette opération n’est plus en attente de paiement.
              </p>
            )}
          </div>
        ) : null}
      </section>
    </div>
  );
}
