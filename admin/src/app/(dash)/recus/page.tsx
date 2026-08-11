'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ApiError,
  fetchReceiptImage,
  transactions,
  type ReceiptRow,
} from '../../../lib/api';
import { useAuth } from '../../../lib/auth';

const money = (value: string, currency: string) =>
  `${Number(value).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} ${currency}`;

const DEPOSIT_LABEL: Record<string, string> = {
  ORANGE_MONEY: 'Orange Money',
  MTN_MOMO: 'MTN MoMo',
  MOOV_MONEY: 'Moov Money',
  WAVE: 'Wave',
  CARTE_BANCAIRE: 'Carte bancaire',
  ESPECES_AGENCE: 'Espèces en agence',
};

/**
 * File de contrôle des reçus de paiement (cahier §3.1).
 *
 * C'est le poste de travail le plus fréquenté du dashboard. Deux exigences :
 *  - le **montant attendu** doit sauter aux yeux, à côté du justificatif, sinon
 *    l'agent valide de mémoire ;
 *  - valider ici **exécute le change** — le bouton le dit, parce qu'on ne
 *    revient pas en arrière.
 */
export default function ReceiptsQueuePage() {
  const { token } = useAuth();
  const [rows, setRows] = useState<ReceiptRow[]>([]);
  const [selected, setSelected] = useState<ReceiptRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [declared, setDeclared] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const data = await transactions.receiptQueue(token);
      setRows(data);
      setSelected(data[0] ?? null);
      setReason('');
      setDeclared('');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'File illisible.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(action: 'approve' | 'reject') {
    if (!token || !selected) return;
    if (action === 'reject' && reason.trim().length < 10) {
      setError('Le motif doit être explicite : c’est lui que le client recevra.');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (action === 'approve') {
        const result = await transactions.approveReceipt(
          selected.id,
          declared ? Number(declared) : undefined,
          token,
        );
        setNotice(`Change exécuté pour ${result.reference} — ${result.statusLabel}.`);
      } else {
        await transactions.rejectReceipt(selected.id, reason.trim(), token);
        setNotice('Reçu rejeté : le client a été prévenu et peut en déposer un autre.');
      }
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Décision impossible.');
    } finally {
      setBusy(false);
    }
  }

  const expected = selected
    ? money(selected.transaction.sourceAmount, selected.transaction.sourceCurrency)
    : '';
  const mismatch =
    selected && declared
      ? Math.abs(Number(declared) - Number(selected.transaction.sourceAmount)) > 0.01
      : false;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-display text-h1">Reçus de paiement</h1>
        <p className="text-light-muted dark:text-dark-muted">
          Valider un reçu exécute le change et mouvemente la caisse. Vérifiez le montant avant de
          trancher.
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

      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        <ul className="space-y-2">
          {loading ? <li className="text-light-muted dark:text-dark-muted">Chargement…</li> : null}
          {!loading && rows.length === 0 ? (
            <li className="rounded-md border border-dashed border-light-border p-6 text-center text-light-muted dark:border-dark-border dark:text-dark-muted">
              Aucun reçu en attente. Rien ne bloque côté clients.
            </li>
          ) : null}
          {rows.map((row) => (
            <li key={row.id}>
              <button
                onClick={() => {
                  setSelected(row);
                  setReason('');
                  setDeclared('');
                  setNotice(null);
                }}
                className={`w-full rounded-md border p-4 text-left transition ${
                  selected?.id === row.id
                    ? 'border-primary bg-primary/5'
                    : 'border-light-border bg-light-surface hover:border-tertiary dark:border-dark-border dark:bg-dark-surface'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-caption">{row.transaction.reference}</span>
                  <span className="text-caption text-light-muted dark:text-dark-muted">
                    {new Date(row.createdAt).toLocaleString('fr-FR', {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
                <p className="font-medium">
                  {row.transaction.client?.firstName} {row.transaction.client?.lastName}
                </p>
                <p className="tabular text-caption text-light-muted dark:text-dark-muted">
                  {money(row.transaction.sourceAmount, row.transaction.sourceCurrency)} →{' '}
                  {money(row.transaction.targetAmount, row.transaction.targetCurrency)}
                </p>
              </button>
            </li>
          ))}
        </ul>

        {selected ? (
          <section className="space-y-5 rounded-md border border-light-border bg-light-surface p-6 dark:border-dark-border dark:bg-dark-surface">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="font-display text-h2">{selected.transaction.reference}</h2>
                <p className="text-light-muted dark:text-dark-muted">
                  {selected.transaction.client?.firstName} {selected.transaction.client?.lastName} ·{' '}
                  {selected.transaction.client?.phone}
                </p>
              </div>
              <span className="rounded-full bg-primary/10 px-3 py-1 text-caption text-primary">
                {DEPOSIT_LABEL[selected.transaction.depositMethod] ?? selected.transaction.depositMethod}
              </span>
            </div>

            {/* Le montant attendu est le chiffre de référence du contrôle :
                il est mis en avant, pas noyé dans un tableau. */}
            <div className="grid gap-4 sm:grid-cols-3">
              <Figure label="Montant attendu" value={expected} strong />
              <Figure
                label="À remettre au client"
                value={money(selected.transaction.targetAmount, selected.transaction.targetCurrency)}
              />
              <Figure
                label="Commission"
                value={money(selected.transaction.commissionAmount, 'XOF')}
              />
            </div>

            <ReceiptPreview id={selected.id} />

            <div className="space-y-3 border-t border-light-border pt-4 dark:border-dark-border">
              <label className="block space-y-1">
                <span className="text-caption font-medium">Montant lu sur le reçu</span>
                <input
                  value={declared}
                  onChange={(event) => setDeclared(event.target.value)}
                  inputMode="decimal"
                  placeholder={selected.transaction.sourceAmount}
                  className="tabular w-full max-w-xs rounded-sm border border-light-border bg-light-bg px-4 py-2.5 outline-none focus:border-tertiary dark:border-dark-border dark:bg-dark-bg"
                />
              </label>
              {mismatch ? (
                <p className="text-caption text-warning">
                  Le montant saisi diffère du montant attendu. Rejetez plutôt que de valider un
                  paiement incomplet.
                </p>
              ) : null}

              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={2}
                placeholder="Motif du rejet — transmis au client, il doit dire quoi corriger."
                className="w-full rounded-sm border border-light-border bg-light-bg p-3 text-body outline-none focus:border-tertiary dark:border-dark-border dark:bg-dark-bg"
              />

              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => void decide('approve')}
                  disabled={busy}
                  className="rounded-sm bg-success px-5 py-2.5 font-medium text-white transition hover:opacity-90 disabled:opacity-40"
                >
                  Valider et exécuter le change
                </button>
                <button
                  onClick={() => void decide('reject')}
                  disabled={busy || reason.trim().length < 10}
                  className="rounded-sm border border-danger px-5 py-2.5 font-medium text-danger transition hover:bg-danger/10 disabled:opacity-40"
                >
                  Rejeter le reçu
                </button>
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function Figure({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div
      className={`rounded-sm p-4 ${
        strong ? 'bg-primary/10' : 'bg-light-surface-alt dark:bg-dark-surface-alt'
      }`}
    >
      <p className="text-caption text-light-muted dark:text-dark-muted">{label}</p>
      <p className={`tabular ${strong ? 'text-h3 font-semibold text-primary' : 'text-h3'}`}>
        {value}
      </p>
    </div>
  );
}

function ReceiptPreview({ id }: { id: string }) {
  const { token } = useAuth();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!token) return;
    let objectUrl: string | null = null;
    let cancelled = false;

    fetchReceiptImage(id, token)
      .then((result) => {
        objectUrl = result;
        if (cancelled) URL.revokeObjectURL(result);
        else setUrl(result);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id, token]);

  return (
    <div className="grid h-72 place-items-center overflow-hidden rounded-sm border border-light-border bg-light-bg dark:border-dark-border dark:bg-dark-bg">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- URL d'objet locale
        <img src={url} alt="Justificatif de paiement" className="h-full w-full object-contain" />
      ) : (
        <span className="text-caption text-light-muted dark:text-dark-muted">
          {failed ? 'Justificatif illisible' : 'Chargement du justificatif…'}
        </span>
      )}
    </div>
  );
}
