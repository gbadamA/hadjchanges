'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ApiError,
  compliance,
  RULE_LABEL,
  SEVERITY_CLASS,
  type ComplianceAlert,
  type Severity,
} from '../../../lib/api';
import { useAuth } from '../../../lib/auth';

const FILTERS: Array<{ value: Severity | 'TOUTES'; label: string }> = [
  { value: 'TOUTES', label: 'Toutes' },
  { value: 'CRITIQUE', label: 'Critiques' },
  { value: 'ALERTE', label: 'Alertes' },
  { value: 'INFO', label: 'Pour information' },
];

const fcfa = (value: string) =>
  `${Number(value).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA`;

/**
 * Vigilance LCB-FT (cahier §3.1).
 *
 * Une alerte **signale**, elle ne bloque pas : c'est l'agent qui décide, et sa
 * décision (traiter, plafonner, bloquer) laisse une trace. La file est ordonnée
 * du plus grave au plus ancien — une alerte critique qui dort trois jours est
 * pire qu'une information du matin.
 */
export default function ConformitePage() {
  const { token } = useAuth();
  const [severity, setSeverity] = useState<Severity | 'TOUTES'>('TOUTES');
  const [showResolved, setShowResolved] = useState(false);
  const [alerts, setAlerts] = useState<ComplianceAlert[]>([]);
  const [counts, setCounts] = useState({ total: 0, critique: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = { resolved: String(showResolved) };
      if (severity !== 'TOUTES') params.severity = severity;
      const [rows, tally] = await Promise.all([
        compliance.alerts(token, params),
        compliance.count(token),
      ]);
      setAlerts(rows);
      setCounts(tally);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Alertes illisibles.');
    } finally {
      setLoading(false);
    }
  }, [token, severity, showResolved]);

  useEffect(() => {
    void load();
  }, [load]);

  async function resolve(alert: ComplianceAlert) {
    if (!token) return;
    setBusy(alert.id);
    setError(null);
    try {
      await compliance.resolve(alert.id, token);
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Action impossible.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <header className="animate-fade-up flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-display text-h1">Conformité</h1>
          <p className="text-light-muted dark:text-dark-muted">
            Seuils réglementaires et opérations atypiques. Un signalement appelle un examen, pas un
            refus automatique.
          </p>
        </div>
        <div className="flex gap-3">
          <Tally label="Ouvertes" value={counts.total} />
          <Tally label="Critiques" value={counts.critique} danger />
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((filter) => (
          <button
            key={filter.value}
            onClick={() => setSeverity(filter.value)}
            className={`lift rounded-full px-4 py-2 text-body transition ${
              severity === filter.value
                ? 'bg-primary text-white'
                : 'bg-light-surface text-light-muted hover:bg-light-surface-alt dark:bg-dark-surface dark:text-dark-muted'
            }`}
          >
            {filter.label}
          </button>
        ))}
        <label className="ml-2 flex cursor-pointer items-center gap-2 text-body">
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(event) => setShowResolved(event.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          Afficher les alertes traitées
        </label>
      </div>

      {error ? (
        <p className="rounded-sm border-l-4 border-danger bg-danger/10 p-3 text-body text-danger">
          {error}
        </p>
      ) : null}

      {loading ? <p className="text-light-muted dark:text-dark-muted">Chargement…</p> : null}

      {!loading && alerts.length === 0 ? (
        <div className="surface grid h-40 place-content-center text-center">
          <p className="text-body text-light-muted dark:text-dark-muted">
            {showResolved ? 'Aucune alerte traitée.' : 'Aucune alerte ouverte. Rien à examiner.'}
          </p>
        </div>
      ) : null}

      <ul className="space-y-3">
        {alerts.map((alert, index) => (
          <li
            key={alert.id}
            className="surface lift animate-fade-up p-5"
            style={{ animationDelay: `${Math.min(index, 8) * 50}ms` }}
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-3 py-1 text-caption ${SEVERITY_CLASS[alert.severity]}`}>
                    {alert.severity}
                  </span>
                  <span className="text-body font-medium">
                    {RULE_LABEL[alert.rule] ?? alert.rule}
                  </span>
                  {alert.client?.blocked ? (
                    <span className="rounded-full bg-danger/15 px-3 py-1 text-caption text-danger">
                      compte bloqué
                    </span>
                  ) : null}
                </div>
                <p className="text-body">{alert.message}</p>
                <p className="text-caption text-light-muted dark:text-dark-muted">
                  {alert.client ? `${alert.client.firstName} ${alert.client.lastName} · ${alert.client.phone}` : 'Client inconnu'}
                  {alert.transaction
                    ? ` · ${alert.transaction.reference} · ${fcfa(alert.transaction.amountXof)}`
                    : ''}
                  {' · '}
                  {new Date(alert.createdAt).toLocaleString('fr-FR', {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </div>

              {alert.resolved ? (
                <span className="rounded-full bg-success/15 px-3 py-1 text-caption text-success">
                  traitée
                </span>
              ) : (
                <button
                  onClick={() => void resolve(alert)}
                  disabled={busy === alert.id}
                  className="lift rounded-sm border border-primary px-4 py-2 text-body font-medium text-primary transition hover:bg-primary/10 disabled:opacity-40"
                >
                  Marquer traitée
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Tally({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className={`surface lift px-5 py-3 text-center ${danger && value > 0 ? 'border-danger/40' : ''}`}>
      <p className="text-caption uppercase tracking-wide text-light-muted dark:text-dark-muted">
        {label}
      </p>
      <p className={`tabular text-h2 font-semibold ${danger && value > 0 ? 'text-danger' : 'text-primary'}`}>
        {value}
      </p>
    </div>
  );
}
