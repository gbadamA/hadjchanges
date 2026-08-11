'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ApiError,
  downloadProtected,
  STATUS_CLASS,
  transactions,
  type TransactionRow,
  type TransactionStatus,
} from '../../../lib/api';
import { useAuth } from '../../../lib/auth';

const FILTERS: Array<{ value: TransactionStatus | 'TOUTES'; label: string }> = [
  { value: 'TOUTES', label: 'Toutes' },
  { value: 'CREEE', label: 'En attente de paiement' },
  { value: 'RECU_SOUMIS', label: 'Reçu à contrôler' },
  { value: 'CHANGE_EXECUTE', label: 'Change exécuté' },
  { value: 'PRETE_POUR_RETRAIT', label: 'Prêtes pour retrait' },
  { value: 'CLOTUREE', label: 'Clôturées' },
];

const money = (value: string, currency: string) =>
  `${Number(value).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} ${currency}`;

/**
 * Liste des transactions (cahier §3.1) avec les deux actions de fin de course.
 *
 * « Prête pour retrait » et « Clôturée » sont ici et pas dans la file des
 * reçus : ce sont des gestes de guichet, faits au moment où le client se
 * présente, pas au moment du contrôle.
 */
export default function TransactionsPage() {
  const { token } = useAuth();
  const [status, setStatus] = useState<TransactionStatus | 'TOUTES'>('TOUTES');
  const [rows, setRows] = useState<TransactionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setRows(await transactions.list(token, status === 'TOUTES' ? {} : { status }));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Liste illisible.');
    } finally {
      setLoading(false);
    }
  }, [token, status]);

  useEffect(() => {
    void load();
  }, [load]);

  async function advance(row: TransactionRow, action: 'ready' | 'close') {
    if (!token) return;
    setBusy(row.id);
    setError(null);
    try {
      if (action === 'ready') await transactions.markReady(row.id, token);
      else await transactions.close(row.id, token);
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Action impossible.');
    } finally {
      setBusy(null);
    }
  }

  async function exportAs(format: 'xlsx' | 'csv') {
    if (!token) return;
    setExporting(true);
    setError(null);
    try {
      const filters = status === 'TOUTES' ? '' : `&status=${status}`;
      // L'export suit le filtre affiché : exporter autre chose que ce qu'on a
      // sous les yeux serait déroutant en réunion.
      await downloadProtected(
        `/api/transactions/export?format=${format}${filters}`,
        `transactions.${format}`,
        token,
      );
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Export impossible.');
    } finally {
      setExporting(false);
    }
  }

  async function downloadJustificatif(row: TransactionRow) {
    if (!token) return;
    setBusy(row.id);
    setError(null);
    try {
      await downloadProtected(
        `/api/transactions/${row.id}/justificatif.pdf`,
        `justificatif-${row.reference}.pdf`,
        token,
      );
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Justificatif indisponible.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-display text-h1">Transactions</h1>
          <p className="text-light-muted dark:text-dark-muted">
            Toutes les opérations de change, du dépôt du reçu à la remise des fonds.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => void exportAs('xlsx')}
            disabled={exporting || rows.length === 0}
            className="rounded-sm bg-primary px-4 py-2 text-body font-medium text-white transition hover:bg-primary-hover disabled:opacity-40"
          >
            Export Excel
          </button>
          <button
            onClick={() => void exportAs('csv')}
            disabled={exporting || rows.length === 0}
            className="rounded-sm border border-light-border px-4 py-2 text-body font-medium transition hover:border-tertiary disabled:opacity-40 dark:border-dark-border"
          >
            CSV
          </button>
        </div>
      </header>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((filter) => (
          <button
            key={filter.value}
            onClick={() => setStatus(filter.value)}
            className={`rounded-full px-4 py-2 text-body transition ${
              status === filter.value
                ? 'bg-primary text-white'
                : 'bg-light-surface text-light-muted hover:bg-light-surface-alt dark:bg-dark-surface dark:text-dark-muted'
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {error ? (
        <p className="rounded-sm border-l-4 border-danger bg-danger/10 p-3 text-body text-danger">
          {error}
        </p>
      ) : null}

      {/* Le tableau défile dans son propre conteneur : la page, elle, ne doit
          jamais défiler horizontalement. */}
      <div className="overflow-x-auto rounded-md border border-light-border bg-light-surface dark:border-dark-border dark:bg-dark-surface">
        <table className="w-full min-w-[860px] text-body">
          <thead className="border-b border-light-border text-caption uppercase tracking-wide text-light-muted dark:border-dark-border dark:text-dark-muted">
            <tr>
              <th className="p-4 text-left font-medium">Référence</th>
              <th className="p-4 text-left font-medium">Client</th>
              <th className="p-4 text-right font-medium">Reçu</th>
              <th className="p-4 text-right font-medium">Remis</th>
              <th className="p-4 text-left font-medium">Statut</th>
              <th className="p-4 text-right font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="p-6 text-center text-light-muted dark:text-dark-muted">
                  Chargement…
                </td>
              </tr>
            ) : null}
            {!loading && rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-6 text-center text-light-muted dark:text-dark-muted">
                  Aucune transaction dans cette vue.
                </td>
              </tr>
            ) : null}
            {rows.map((row) => (
              <tr
                key={row.id}
                className="border-b border-light-border last:border-0 dark:border-dark-border"
              >
                <td className="p-4">
                  <span className="font-mono text-caption">{row.reference}</span>
                  <p className="text-caption text-light-muted dark:text-dark-muted">
                    {new Date(row.createdAt).toLocaleDateString('fr-FR')}
                  </p>
                </td>
                <td className="p-4">
                  {row.client?.firstName} {row.client?.lastName}
                  <p className="text-caption text-light-muted dark:text-dark-muted">
                    {row.agency?.name}
                  </p>
                </td>
                <td className="tabular p-4 text-right">
                  {money(row.sourceAmount, row.sourceCurrency)}
                </td>
                <td className="tabular p-4 text-right">
                  {money(row.targetAmount, row.targetCurrency)}
                </td>
                <td className="p-4">
                  <span className={`rounded-full px-3 py-1 text-caption ${STATUS_CLASS[row.status]}`}>
                    {row.statusLabel}
                  </span>
                </td>
                <td className="p-4 text-right">
                  {row.status === 'CHANGE_EXECUTE' ? (
                    <button
                      onClick={() => void advance(row, 'ready')}
                      disabled={busy === row.id}
                      className="rounded-sm border border-primary px-3 py-1.5 text-caption font-medium text-primary transition hover:bg-primary/10 disabled:opacity-40"
                    >
                      Fonds disponibles
                    </button>
                  ) : null}
                  {row.status === 'PRETE_POUR_RETRAIT' ? (
                    <button
                      onClick={() => void advance(row, 'close')}
                      disabled={busy === row.id}
                      className="rounded-sm bg-primary px-3 py-1.5 text-caption font-medium text-white transition hover:bg-primary-hover disabled:opacity-40"
                    >
                      Remis au client
                    </button>
                  ) : null}
                  {row.status === 'CLOTUREE' ? (
                    <button
                      onClick={() => void downloadJustificatif(row)}
                      disabled={busy === row.id}
                      className="rounded-sm border border-light-border px-3 py-1.5 text-caption font-medium transition hover:border-tertiary disabled:opacity-40 dark:border-dark-border"
                    >
                      Justificatif
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
