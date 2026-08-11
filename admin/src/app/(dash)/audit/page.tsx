'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, audit, type AuditEntry } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';

/** Familles d'actions — le filtre suit les questions qu'on se pose vraiment. */
const ENTITIES = [
  { value: 'TOUTES', label: 'Tout' },
  { value: 'Transaction', label: 'Transactions' },
  { value: 'ExchangeRate', label: 'Taux' },
  { value: 'KycDocument', label: 'Identités' },
  { value: 'PaymentReceipt', label: 'Reçus' },
  { value: 'CashBalance', label: 'Caisses' },
  { value: 'User', label: 'Comptes' },
];

const ACTION_LABEL: Record<string, string> = {
  'rate.publish': 'Publication d’un taux',
  'transaction.create': 'Création d’une opération',
  'transaction.execute': 'Exécution du change',
  'transaction.cancel': 'Annulation',
  'transaction.prete_pour_retrait': 'Fonds mis à disposition',
  'transaction.cloturee': 'Clôture',
  'receipt.submit': 'Dépôt d’un reçu',
  'receipt.approve': 'Validation d’un reçu',
  'receipt.reject': 'Rejet d’un reçu',
  'kyc.approve': 'Identité validée',
  'kyc.reject': 'Identité rejetée',
  'kyc.submit': 'Pièce déposée',
  'cash.alimentation': 'Alimentation de caisse',
  'cash.retrait': 'Retrait de caisse',
  'cash.ajustement': 'Ajustement de caisse',
  'cash.close_day': 'Clôture journalière',
  'client.block': 'Blocage d’un compte',
  'client.unblock': 'Déblocage d’un compte',
  'client.limits': 'Modification de plafonds',
  'staff.assign_agency': 'Affectation d’un opérateur',
  'compliance.resolve': 'Alerte traitée',
};

/**
 * Journal d'audit (cahier §3.1 « journal d'activité »).
 *
 * **Lecture seule, et c'est le point** : un journal qu'on peut modifier ne
 * prouve rien. L'API n'expose ni écriture ni suppression, et cet écran ne fait
 * que lire.
 */
export default function AuditPage() {
  const { token } = useAuth();
  const [entity, setEntity] = useState('TOUTES');
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setRows(await audit.list(token, entity === 'TOUTES' ? { take: '100' } : { entity, take: '100' }));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Journal illisible.');
    } finally {
      setLoading(false);
    }
  }, [token, entity]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <header className="animate-fade-up space-y-1">
        <h1 className="font-display text-h1">Journal d’audit</h1>
        <p className="text-light-muted dark:text-dark-muted">
          Qui a fait quoi, quand. Consultable, jamais modifiable.
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        {ENTITIES.map((option) => (
          <button
            key={option.value}
            onClick={() => setEntity(option.value)}
            className={`lift rounded-full px-4 py-2 text-body transition ${
              entity === option.value
                ? 'bg-primary text-white'
                : 'bg-light-surface text-light-muted hover:bg-light-surface-alt dark:bg-dark-surface dark:text-dark-muted'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {error ? (
        <p className="rounded-sm border-l-4 border-danger bg-danger/10 p-3 text-body text-danger">
          {error}
        </p>
      ) : null}

      {loading ? <p className="text-light-muted dark:text-dark-muted">Chargement…</p> : null}

      {!loading && rows.length === 0 ? (
        <div className="surface grid h-40 place-content-center text-center text-body text-light-muted dark:text-dark-muted">
          Aucune entrée dans cette vue.
        </div>
      ) : null}

      <ol className="space-y-2">
        {rows.map((row, index) => {
          const open = expanded === row.id;
          const hasDetail = row.before !== null || row.after !== null;
          return (
            <li
              key={row.id}
              className="surface lift animate-fade-up overflow-hidden"
              style={{ animationDelay: `${Math.min(index, 10) * 40}ms` }}
            >
              <button
                onClick={() => setExpanded(open ? null : row.id)}
                className="flex w-full flex-wrap items-center justify-between gap-3 p-4 text-left"
              >
                <div className="min-w-0">
                  <p className="text-body font-medium">
                    {ACTION_LABEL[row.action] ?? row.action}
                  </p>
                  <p className="truncate text-caption text-light-muted dark:text-dark-muted">
                    {row.user ? `${row.user.firstName} ${row.user.lastName} (${row.user.role})` : 'Système'}
                    {row.entityId ? ` · ${row.entity} ${row.entityId.slice(-6)}` : ` · ${row.entity}`}
                    {row.ip ? ` · ${row.ip}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="tabular text-caption text-light-muted dark:text-dark-muted">
                    {new Date(row.createdAt).toLocaleString('fr-FR', {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  {hasDetail ? (
                    <span className="text-caption text-tertiary">{open ? 'masquer' : 'détail'}</span>
                  ) : null}
                </div>
              </button>

              {/* Avant/après : c'est ce qui distingue un journal d'une simple
                  liste d'événements. On ne l'affiche qu'à la demande. */}
              {open && hasDetail ? (
                <div className="grid gap-3 border-t border-light-border p-4 sm:grid-cols-2 dark:border-dark-border">
                  <Snapshot title="Avant" value={row.before} />
                  <Snapshot title="Après" value={row.after} />
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Snapshot({ title, value }: { title: string; value: unknown }) {
  return (
    <div className="rounded-sm bg-light-surface-alt p-3 dark:bg-dark-surface-alt">
      <p className="mb-1 text-caption uppercase tracking-wide text-light-muted dark:text-dark-muted">
        {title}
      </p>
      <pre className="overflow-x-auto font-mono text-caption">
        {value === null || value === undefined ? '—' : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
