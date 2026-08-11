'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ApiError,
  clients,
  compliance,
  type ClientRow,
  type LimitsView,
} from '../../../lib/api';
import { useAuth } from '../../../lib/auth';

const KYC_CLASS: Record<string, string> = {
  VALIDE: 'bg-success/15 text-success',
  EN_ATTENTE: 'bg-warning/15 text-warning',
  REJETE: 'bg-danger/15 text-danger',
  NON_SOUMIS: 'bg-light-surface-alt text-light-muted dark:bg-dark-surface-alt dark:text-dark-muted',
};

const KYC_LABEL: Record<string, string> = {
  VALIDE: 'Identité vérifiée',
  EN_ATTENTE: 'En attente',
  REJETE: 'Rejetée',
  NON_SOUMIS: 'Non soumise',
};

const fcfa = (value: string | null) =>
  value === null ? '—' : `${Number(value).toLocaleString('fr-FR', { maximumFractionDigits: 0 })}`;

/**
 * Fiche client (cahier §3.1) : plafonds et blocage.
 *
 * Les deux gestes engagent le bureau, donc les deux exigent un texte :
 * un plafond se justifie par le profil, un blocage par un motif écrit que le
 * collègue de garde pourra reprendre.
 */
export default function ClientsPage() {
  const { token } = useAuth();
  const [rows, setRows] = useState<ClientRow[]>([]);
  const [selected, setSelected] = useState<ClientRow | null>(null);
  const [limits, setLimits] = useState<LimitsView | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [daily, setDaily] = useState('');
  const [monthly, setMonthly] = useState('');
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const data = await clients.list(token, search ? { search } : {});
      setRows(data);
      setSelected((current) => data.find((row) => row.id === current?.id) ?? data[0] ?? null);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Liste illisible.');
    } finally {
      setLoading(false);
    }
  }, [token, search]);

  useEffect(() => {
    void load();
  }, [load]);

  // Les plafonds se rechargent à chaque changement de fiche : afficher ceux du
  // client précédent serait pire que ne rien afficher.
  useEffect(() => {
    if (!token || !selected) {
      setLimits(null);
      return;
    }
    setDaily(selected.dailyLimitXof ?? '');
    setMonthly(selected.monthlyLimitXof ?? '');
    setReason('');
    compliance
      .limits(selected.id, token)
      .then(setLimits)
      .catch(() => setLimits(null));
  }, [token, selected]);

  async function saveLimits() {
    if (!token || !selected) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await clients.setLimits(
        selected.id,
        {
          dailyLimitXof: daily.trim() === '' ? null : Number(daily.replace(/\s/g, '')),
          monthlyLimitXof: monthly.trim() === '' ? null : Number(monthly.replace(/\s/g, '')),
        },
        token,
      );
      setNotice('Plafonds enregistrés. Un champ vide rend la main au réglage global.');
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Enregistrement impossible.');
    } finally {
      setBusy(false);
    }
  }

  async function toggleBlock() {
    if (!token || !selected) return;
    if (!selected.blocked && reason.trim().length < 10) {
      setError('Le motif de blocage doit être explicite : un collègue doit pouvoir le reprendre.');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (selected.blocked) {
        await clients.unblock(selected.id, token);
        setNotice('Compte débloqué.');
      } else {
        await clients.block(selected.id, reason.trim(), token);
        setNotice('Compte bloqué. Le client ne peut plus accéder à l’application.');
      }
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Action impossible.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <header className="animate-fade-up space-y-1">
        <h1 className="font-display text-h1">Clients</h1>
        <p className="text-light-muted dark:text-dark-muted">
          Identité, plafonds et accès. Chaque décision est tracée au journal d’audit.
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

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <div className="space-y-3">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Nom, téléphone ou email"
            className="w-full rounded-sm border border-light-border bg-light-surface px-4 py-2.5 outline-none focus:border-tertiary dark:border-dark-border dark:bg-dark-surface"
          />
          <ul className="space-y-2">
            {loading ? <li className="text-light-muted dark:text-dark-muted">Chargement…</li> : null}
            {!loading && rows.length === 0 ? (
              <li className="rounded-md border border-dashed border-light-border p-6 text-center text-caption text-light-muted dark:border-dark-border dark:text-dark-muted">
                Aucun client ne correspond.
              </li>
            ) : null}
            {rows.map((row) => (
              <li key={row.id}>
                <button
                  onClick={() => setSelected(row)}
                  className={`lift w-full rounded-md border p-4 text-left ${
                    selected?.id === row.id
                      ? 'border-primary bg-primary/5'
                      : 'border-light-border bg-light-surface dark:border-dark-border dark:bg-dark-surface'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">
                      {row.firstName} {row.lastName}
                    </span>
                    {row.blocked ? (
                      <span className="rounded-full bg-danger/15 px-2 py-0.5 text-caption text-danger">
                        bloqué
                      </span>
                    ) : null}
                  </div>
                  <p className="text-caption text-light-muted dark:text-dark-muted">
                    {row.phone} · {row.transactions} opération{row.transactions > 1 ? 's' : ''}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {selected ? (
          <section className="surface lift space-y-5 p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="font-display text-h2">
                  {selected.firstName} {selected.lastName}
                </h2>
                <p className="text-light-muted dark:text-dark-muted">
                  {selected.phone}
                  {selected.email ? ` · ${selected.email}` : ''} · client depuis le{' '}
                  {new Date(selected.createdAt).toLocaleDateString('fr-FR')}
                </p>
              </div>
              <span className={`rounded-full px-3 py-1 text-caption ${KYC_CLASS[selected.kycStatus]}`}>
                {KYC_LABEL[selected.kycStatus] ?? selected.kycStatus}
              </span>
            </div>

            {selected.blocked && selected.blockedReason ? (
              <p className="rounded-sm border-l-4 border-danger bg-danger/10 p-3 text-body text-danger">
                Compte bloqué : {selected.blockedReason}
              </p>
            ) : null}

            {limits ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Gauge title="Plafond journalier" data={limits.daily} />
                <Gauge title="Plafond mensuel" data={limits.monthly} />
              </div>
            ) : null}

            <div className="space-y-3 border-t border-light-border pt-4 dark:border-dark-border">
              <h3 className="text-body font-medium">Fixer les plafonds</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-caption text-light-muted dark:text-dark-muted">
                    Journalier (XOF)
                  </span>
                  <input
                    value={daily}
                    onChange={(event) => setDaily(event.target.value)}
                    inputMode="numeric"
                    placeholder="réglage global"
                    className="tabular w-full rounded-sm border border-light-border bg-light-bg px-4 py-2.5 dark:border-dark-border dark:bg-dark-bg"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-caption text-light-muted dark:text-dark-muted">
                    Mensuel (XOF)
                  </span>
                  <input
                    value={monthly}
                    onChange={(event) => setMonthly(event.target.value)}
                    inputMode="numeric"
                    placeholder="réglage global"
                    className="tabular w-full rounded-sm border border-light-border bg-light-bg px-4 py-2.5 dark:border-dark-border dark:bg-dark-bg"
                  />
                </label>
              </div>
              <p className="text-caption text-light-muted dark:text-dark-muted">
                Laisser vide rend la main au réglage global — ce n’est pas un plafond à zéro.
              </p>
              <button
                onClick={() => void saveLimits()}
                disabled={busy}
                className="lift rounded-sm bg-primary px-5 py-2.5 font-medium text-white transition hover:bg-primary-hover disabled:opacity-40"
              >
                Enregistrer les plafonds
              </button>
            </div>

            <div className="space-y-3 border-t border-light-border pt-4 dark:border-dark-border">
              <h3 className="text-body font-medium">
                {selected.blocked ? 'Rétablir l’accès' : 'Bloquer le compte'}
              </h3>
              {!selected.blocked ? (
                <textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  rows={2}
                  placeholder="Motif du blocage — il restera au journal d’audit."
                  className="w-full rounded-sm border border-light-border bg-light-bg p-3 text-body dark:border-dark-border dark:bg-dark-bg"
                />
              ) : null}
              <button
                onClick={() => void toggleBlock()}
                disabled={busy || (!selected.blocked && reason.trim().length < 10)}
                className={`lift rounded-sm px-5 py-2.5 font-medium transition disabled:opacity-40 ${
                  selected.blocked
                    ? 'bg-success text-white'
                    : 'border border-danger text-danger hover:bg-danger/10'
                }`}
              >
                {selected.blocked ? 'Débloquer le compte' : 'Bloquer le compte'}
              </button>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

/** Jauge de consommation d'un plafond — la barre dit tout de suite s'il reste de la marge. */
function Gauge({ title, data }: { title: string; data: LimitsView['daily'] }) {
  const used = Number(data.usedXof);
  const limit = Number(data.limitXof);
  const ratio = limit > 0 ? Math.min(used / limit, 1) : 0;
  const tone = ratio >= 0.9 ? '#DC2626' : ratio >= 0.7 ? '#F59E0B' : '#12B76A';

  return (
    <div className="rounded-sm bg-light-surface-alt p-4 dark:bg-dark-surface-alt">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-caption text-light-muted dark:text-dark-muted">{title}</p>
        {data.inherited ? (
          <span className="text-caption text-light-muted dark:text-dark-muted">hérité</span>
        ) : null}
      </div>
      <p className="tabular text-h3 font-semibold">{fcfa(data.remainingXof)} restants</p>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-light-border dark:bg-dark-border">
        <div
          className="h-full origin-left rounded-full animate-rise"
          style={{ width: `${Math.max(ratio * 100, 2)}%`, backgroundColor: tone }}
        />
      </div>
      <p className="tabular mt-1 text-caption text-light-muted dark:text-dark-muted">
        {fcfa(data.usedXof)} consommés sur {fcfa(data.limitXof)}
      </p>
    </div>
  );
}
