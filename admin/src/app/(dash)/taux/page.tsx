'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ApiError,
  cash,
  rates,
  type Agency,
  type RateRow,
  type RateVersion,
} from '../../../lib/api';
import { useAuth } from '../../../lib/auth';

const rate = (value: string) =>
  Number(value).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 6 });

const TREND_CLASS: Record<RateRow['trend'], string> = {
  up: 'text-trend-up',
  down: 'text-trend-down',
  flat: 'text-trend-flat',
};

const TREND_SIGN: Record<RateRow['trend'], string> = { up: '▲', down: '▼', flat: '—' };

/**
 * Publication des taux (cahier §3.1) — **le geste quotidien de l'exploitant**.
 *
 * Trois partis pris :
 *  - la saisie part **du taux en vigueur**, pré-rempli : on corrige un cours,
 *    on ne le retape pas de mémoire ;
 *  - la **marge** entre achat et vente est calculée pendant la frappe, parce
 *    que c'est elle qui fait le revenu, pas les deux nombres pris séparément ;
 *  - les taux périmés remontent en tête avec leur ancienneté, puisque le seul
 *    vrai risque ici est d'oublier une devise.
 */
export default function TauxPage() {
  const { token } = useAuth();
  const [board, setBoard] = useState<RateRow[]>([]);
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [scope, setScope] = useState<string>('GLOBAL');
  const [selected, setSelected] = useState<string | null>(null);
  const [history, setHistory] = useState<RateVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ buyRate: '', sellRate: '', commissionPct: '' });

  const agencyId = scope === 'GLOBAL' ? undefined : scope;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rows, agencyList] = await Promise.all([rates.board(agencyId), cash.agencies()]);
      setBoard(rows);
      setAgencies(agencyList);
      setSelected((current) => current ?? rows[0]?.currency.code ?? null);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Taux illisibles.');
    } finally {
      setLoading(false);
    }
  }, [agencyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const current = useMemo(
    () => board.find((row) => row.currency.code === selected) ?? null,
    [board, selected],
  );

  // Le formulaire se recharge sur le taux en vigueur à chaque changement de
  // devise : laisser les chiffres de la devise précédente inviterait la faute.
  useEffect(() => {
    if (!current) return;
    setForm({
      buyRate: current.buyRate,
      sellRate: current.sellRate,
      commissionPct: current.commissionPct,
    });
    setNotice(null);
    if (token) {
      rates
        .history(current.currency.code, token)
        .then(setHistory)
        .catch(() => setHistory([]));
    }
  }, [current, token]);

  const parsed = {
    buy: Number(form.buyRate.replace(',', '.')),
    sell: Number(form.sellRate.replace(',', '.')),
    commission: Number(form.commissionPct.replace(',', '.')),
  };
  const marginPct =
    parsed.buy > 0 && parsed.sell > 0 ? ((parsed.sell - parsed.buy) / parsed.buy) * 100 : null;
  const inverted = parsed.buy > 0 && parsed.sell > 0 && parsed.sell < parsed.buy;
  const unchanged =
    current !== null &&
    parsed.buy === Number(current.buyRate) &&
    parsed.sell === Number(current.sellRate) &&
    parsed.commission === Number(current.commissionPct);

  async function publish() {
    if (!token || !current) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await rates.publish(
        {
          currencyCode: current.currency.code,
          buyRate: parsed.buy,
          sellRate: parsed.sell,
          commissionPct: parsed.commission,
          agencyId: agencyId ?? null,
        },
        token,
      );
      setNotice(
        `${current.currency.code} publié${agencyId ? ' pour cette agence' : ''}. Les téléphones sont déjà à jour.`,
      );
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Publication impossible.');
    } finally {
      setBusy(false);
    }
  }

  const staleCount = board.filter((row) => row.stale).length;

  return (
    <div className="space-y-6">
      <header className="animate-fade-up flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-display text-h1">Taux</h1>
          <p className="text-light-muted dark:text-dark-muted">
            Publier un taux crée une nouvelle version : rien n’est écrasé, et la diffusion vers les
            clients est immédiate.
          </p>
        </div>
        <select
          value={scope}
          onChange={(event) => setScope(event.target.value)}
          className="rounded-sm border border-light-border bg-light-surface px-4 py-2 dark:border-dark-border dark:bg-dark-surface"
        >
          <option value="GLOBAL">Taux global — toutes agences</option>
          {agencies.map((agency) => (
            <option key={agency.id} value={agency.id}>
              Taux propre à {agency.name}
            </option>
          ))}
        </select>
      </header>

      {staleCount > 0 ? (
        <p className="rounded-sm border-l-4 border-warning bg-warning/10 p-3 text-body text-warning">
          {staleCount} taux n’{staleCount > 1 ? 'ont' : 'a'} pas été republié{staleCount > 1 ? 's' : ''}{' '}
          depuis plus de 12 heures. Un taux oublié se vend au mauvais prix.
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

      {loading && board.length === 0 ? (
        <p className="text-light-muted dark:text-dark-muted">Chargement…</p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,340px)_1fr]">
        <ul className="space-y-2">
          {board.map((row) => (
            <li key={row.currency.code}>
              <button
                onClick={() => setSelected(row.currency.code)}
                className={`lift w-full rounded-md border p-4 text-left ${
                  selected === row.currency.code
                    ? 'border-primary bg-primary/5'
                    : 'border-light-border bg-light-surface dark:border-dark-border dark:bg-dark-surface'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    {row.currency.symbol} {row.currency.code}
                  </span>
                  <span className={`tabular text-caption ${TREND_CLASS[row.trend]}`}>
                    {TREND_SIGN[row.trend]} {row.trendPct} %
                  </span>
                </div>
                <p className="tabular text-caption text-light-muted dark:text-dark-muted">
                  {rate(row.buyRate)} / {rate(row.sellRate)} FCFA
                </p>
                <div className="mt-1 flex flex-wrap gap-2">
                  {row.stale ? (
                    <span className="rounded-full bg-warning/15 px-2 py-0.5 text-caption text-warning">
                      à republier
                    </span>
                  ) : null}
                  {row.agencyId ? (
                    <span className="rounded-full bg-secondary/20 px-2 py-0.5 text-caption text-secondary-hover">
                      taux d’agence
                    </span>
                  ) : null}
                </div>
              </button>
            </li>
          ))}
        </ul>

        {current ? (
          <div className="space-y-6">
            <section className="surface lift space-y-5 p-6">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h2 className="font-display text-h2">
                  {current.currency.name} ({current.currency.code})
                </h2>
                <span className="text-caption text-light-muted dark:text-dark-muted">
                  en vigueur depuis le{' '}
                  {new Date(current.effectiveFrom).toLocaleString('fr-FR', {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <label className="space-y-1">
                  <span className="text-caption font-medium">Nous achetons (FCFA)</span>
                  <input
                    value={form.buyRate}
                    onChange={(event) => setForm({ ...form, buyRate: event.target.value })}
                    inputMode="decimal"
                    className="tabular w-full rounded-sm border border-light-border bg-light-bg px-4 py-2.5 outline-none focus:border-tertiary dark:border-dark-border dark:bg-dark-bg"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-caption font-medium">Nous vendons (FCFA)</span>
                  <input
                    value={form.sellRate}
                    onChange={(event) => setForm({ ...form, sellRate: event.target.value })}
                    inputMode="decimal"
                    className={`tabular w-full rounded-sm border bg-light-bg px-4 py-2.5 outline-none dark:bg-dark-bg ${
                      inverted
                        ? 'border-danger'
                        : 'border-light-border focus:border-tertiary dark:border-dark-border'
                    }`}
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-caption font-medium">Commission (%)</span>
                  <input
                    value={form.commissionPct}
                    onChange={(event) => setForm({ ...form, commissionPct: event.target.value })}
                    inputMode="decimal"
                    className="tabular w-full rounded-sm border border-light-border bg-light-bg px-4 py-2.5 outline-none focus:border-tertiary dark:border-dark-border dark:bg-dark-bg"
                  />
                </label>
              </div>

              {/* La marge est le vrai chiffre de pilotage : on l'affiche pendant
                  la frappe, avant publication. */}
              <div className="flex flex-wrap items-center gap-4 rounded-sm bg-light-surface-alt p-4 dark:bg-dark-surface-alt">
                <div>
                  <p className="text-caption text-light-muted dark:text-dark-muted">
                    Marge achat / vente
                  </p>
                  <p className={`tabular text-h3 font-semibold ${inverted ? 'text-danger' : 'text-primary'}`}>
                    {marginPct === null ? '—' : `${marginPct.toFixed(2)} %`}
                  </p>
                </div>
                {inverted ? (
                  <p className="text-body text-danger">
                    Le taux de vente est inférieur au taux d’achat : le bureau perdrait de l’argent
                    à chaque opération. C’est presque toujours une inversion de saisie.
                  </p>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={() => void publish()}
                  disabled={busy || inverted || unchanged || !(parsed.buy > 0 && parsed.sell > 0)}
                  className="lift rounded-sm bg-primary px-5 py-2.5 font-medium text-white transition hover:bg-primary-hover disabled:opacity-40"
                >
                  Publier ce taux
                </button>
                {unchanged ? (
                  <span className="text-caption text-light-muted dark:text-dark-muted">
                    Identique au taux en vigueur — rien à publier.
                  </span>
                ) : null}
              </div>
            </section>

            <section className="surface lift p-6">
              <h2 className="mb-4 font-display text-h2">Historique des variations</h2>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-body">
                  <thead className="border-b border-light-border text-caption uppercase tracking-wide text-light-muted dark:border-dark-border dark:text-dark-muted">
                    <tr>
                      <th className="py-3 text-left font-medium">Date</th>
                      <th className="py-3 text-right font-medium">Achat</th>
                      <th className="py-3 text-right font-medium">Vente</th>
                      <th className="py-3 text-right font-medium">Comm.</th>
                      <th className="py-3 text-left font-medium">Publié par</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-6 text-center text-light-muted dark:text-dark-muted">
                          Aucune version enregistrée.
                        </td>
                      </tr>
                    ) : null}
                    {history.map((version) => (
                      <tr
                        key={version.id}
                        className="border-b border-light-border last:border-0 dark:border-dark-border"
                      >
                        <td className="py-3 text-caption">
                          {new Date(version.effectiveFrom).toLocaleString('fr-FR', {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                        <td className="tabular py-3 text-right">{rate(version.buyRate)}</td>
                        <td className="tabular py-3 text-right">{rate(version.sellRate)}</td>
                        <td className="tabular py-3 text-right">{version.commissionPct} %</td>
                        <td className="py-3 text-caption">
                          {version.createdBy
                            ? `${version.createdBy.firstName} ${version.createdBy.lastName}`
                            : '—'}
                          {version.agency ? ` · ${version.agency.name}` : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </div>
  );
}
