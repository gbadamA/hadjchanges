'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ApiError,
  cash,
  MOVEMENT_LABEL,
  type Agency,
  type CashBalance,
  type CashClosure,
  type CashMovement,
} from '../../../lib/api';
import { useAuth } from '../../../lib/auth';

const amount = (value: string, decimals: number) =>
  Number(value).toLocaleString('fr-FR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

/**
 * Tenue de caisse (cahier §3.1).
 *
 * Trois gestes réels d'une agence, dans l'ordre où ils arrivent dans la
 * journée : voir l'encaisse, la mouvementer, la clôturer le soir. La clôture
 * est un formulaire de COMPTAGE — l'agent saisit ce qu'il a devant lui, et
 * c'est le système qui calcule l'écart. Lui demander l'écart directement
 * reviendrait à lui demander de se juger lui-même.
 */
export default function CaissesPage() {
  const { token, user } = useAuth();
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [agencyId, setAgencyId] = useState<string | null>(null);
  const [balances, setBalances] = useState<CashBalance[]>([]);
  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [closures, setClosures] = useState<CashClosure[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({ currencyCode: '', type: 'ALIMENTATION', amount: '', note: '' });
  const [counts, setCounts] = useState<Record<string, string>>({});

  const isManager = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';

  useEffect(() => {
    cash
      .agencies()
      .then((rows) => {
        setAgencies(rows);
        // Un opérateur n'a qu'une caisse : on l'ouvre directement sur la sienne.
        setAgencyId(user?.agencyId ?? rows[0]?.id ?? null);
      })
      .catch(() => setError('Agences illisibles.'));
  }, [user?.agencyId]);

  const load = useCallback(async () => {
    if (!token || !agencyId) return;
    setLoading(true);
    setError(null);
    try {
      const [b, m, c] = await Promise.all([
        cash.balances(agencyId, token),
        cash.movements(agencyId, token),
        cash.closures(agencyId, token),
      ]);
      setBalances(b);
      setMovements(m);
      setClosures(c);
      setForm((current) => ({ ...current, currencyCode: current.currencyCode || (b[0]?.currency.code ?? '') }));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Caisse illisible.');
    } finally {
      setLoading(false);
    }
  }, [token, agencyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const closedToday = useMemo(
    () => closures.some((closure) => closure.businessDay === new Date().toISOString().slice(0, 10)),
    [closures],
  );

  async function submitMovement() {
    if (!token || !agencyId) return;
    const value = Number(form.amount.replace(',', '.'));
    if (!Number.isFinite(value) || value === 0) {
      setError('Saisissez un montant non nul.');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await cash.move(
        agencyId,
        { currencyCode: form.currencyCode, type: form.type, amount: value, note: form.note || undefined },
        token,
      );
      setNotice(`Nouveau solde ${form.currencyCode} : ${amount(result.balance, 2)}.`);
      setForm((current) => ({ ...current, amount: '', note: '' }));
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Mouvement impossible.');
    } finally {
      setBusy(false);
    }
  }

  async function submitClosure() {
    if (!token || !agencyId) return;
    const lines = balances
      .filter((balance) => counts[balance.currency.code] !== undefined && counts[balance.currency.code] !== '')
      .map((balance) => ({
        currencyCode: balance.currency.code,
        countedAmount: Number(counts[balance.currency.code].replace(',', '.')),
      }));
    if (lines.length === 0) {
      setError('Comptez au moins une devise avant de clôturer.');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await cash.closeDay(agencyId, lines, token);
      setCounts({});
      setNotice('Caisse clôturée. Les écarts constatés ont été enregistrés et corrigés.');
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Clôture impossible.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <header className="animate-fade-up flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-display text-h1">Caisses</h1>
          <p className="text-light-muted dark:text-dark-muted">
            L’encaisse du bureau, devise par devise. La vérité est l’historique des mouvements.
          </p>
        </div>
        {isManager && agencies.length > 1 ? (
          <select
            value={agencyId ?? ''}
            onChange={(event) => setAgencyId(event.target.value)}
            className="rounded-sm border border-light-border bg-light-surface px-4 py-2 dark:border-dark-border dark:bg-dark-surface"
          >
            {agencies.map((agency) => (
              <option key={agency.id} value={agency.id}>
                {agency.name} — {agency.city}
              </option>
            ))}
          </select>
        ) : null}
      </header>

      {error ? (
        <p className="rounded-sm border-l-4 border-danger bg-danger/10 p-3 text-body text-danger">{error}</p>
      ) : null}
      {notice ? (
        <p className="rounded-sm border-l-4 border-success bg-success/10 p-3 text-body text-success">
          {notice}
        </p>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {loading && balances.length === 0 ? (
          <p className="text-light-muted dark:text-dark-muted">Chargement…</p>
        ) : null}
        {balances.map((balance) => (
          <div
            key={balance.currency.code}
            className="surface lift p-5"
          >
            <p className="text-caption text-light-muted dark:text-dark-muted">
              {balance.currency.code}
            </p>
            <p className="tabular text-h2 font-semibold text-primary">
              {amount(balance.amount, balance.currency.decimals)}
              <span className="ml-1 text-body font-normal">{balance.currency.symbol}</span>
            </p>
          </div>
        ))}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {isManager ? (
          <section className="surface lift space-y-4 p-6">
            <h2 className="font-display text-h2">Mouvementer la caisse</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="text-caption font-medium">Devise</span>
                <select
                  value={form.currencyCode}
                  onChange={(event) => setForm({ ...form, currencyCode: event.target.value })}
                  className="w-full rounded-sm border border-light-border bg-light-bg px-3 py-2.5 dark:border-dark-border dark:bg-dark-bg"
                >
                  {balances.map((balance) => (
                    <option key={balance.currency.code} value={balance.currency.code}>
                      {balance.currency.code}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-caption font-medium">Nature</span>
                <select
                  value={form.type}
                  onChange={(event) => setForm({ ...form, type: event.target.value })}
                  className="w-full rounded-sm border border-light-border bg-light-bg px-3 py-2.5 dark:border-dark-border dark:bg-dark-bg"
                >
                  <option value="ALIMENTATION">Alimentation</option>
                  <option value="RETRAIT">Retrait</option>
                  <option value="AJUSTEMENT">Ajustement</option>
                </select>
              </label>
            </div>
            <label className="block space-y-1">
              <span className="text-caption font-medium">Montant</span>
              <input
                value={form.amount}
                onChange={(event) => setForm({ ...form, amount: event.target.value })}
                inputMode="decimal"
                className="tabular w-full rounded-sm border border-light-border bg-light-bg px-4 py-2.5 dark:border-dark-border dark:bg-dark-bg"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-caption font-medium">Motif</span>
              <input
                value={form.note}
                onChange={(event) => setForm({ ...form, note: event.target.value })}
                placeholder="Réassort, remise en banque…"
                className="w-full rounded-sm border border-light-border bg-light-bg px-4 py-2.5 dark:border-dark-border dark:bg-dark-bg"
              />
            </label>
            <p className="text-caption text-light-muted dark:text-dark-muted">
              Le sens est déduit de la nature : un retrait diminue la caisse même saisi en positif.
            </p>
            <button
              onClick={() => void submitMovement()}
              disabled={busy || !form.currencyCode}
              className="rounded-sm bg-primary px-5 py-2.5 font-medium text-white transition hover:bg-primary-hover disabled:opacity-40"
            >
              Enregistrer le mouvement
            </button>
          </section>
        ) : null}

        <section className="surface lift space-y-4 p-6">
          <div>
            <h2 className="font-display text-h2">Clôture du jour</h2>
            <p className="text-light-muted dark:text-dark-muted">
              Saisissez ce que vous comptez réellement. L’écart est calculé, enregistré, puis corrigé.
            </p>
          </div>

          {closedToday ? (
            <p className="rounded-sm bg-success/10 p-3 text-body text-success">
              La caisse a déjà été clôturée aujourd’hui.
            </p>
          ) : (
            <>
              <div className="space-y-2">
                {balances.map((balance) => {
                  const typed = counts[balance.currency.code];
                  const diff =
                    typed !== undefined && typed !== ''
                      ? Number(typed.replace(',', '.')) - Number(balance.amount)
                      : null;
                  return (
                    <div key={balance.currency.code} className="flex items-center gap-3">
                      <span className="w-14 text-caption font-medium">{balance.currency.code}</span>
                      <span className="tabular w-32 text-caption text-light-muted dark:text-dark-muted">
                        attendu {amount(balance.amount, balance.currency.decimals)}
                      </span>
                      <input
                        value={typed ?? ''}
                        onChange={(event) =>
                          setCounts({ ...counts, [balance.currency.code]: event.target.value })
                        }
                        inputMode="decimal"
                        placeholder="compté"
                        className="tabular w-32 rounded-sm border border-light-border bg-light-bg px-3 py-1.5 dark:border-dark-border dark:bg-dark-bg"
                      />
                      {diff !== null && diff !== 0 ? (
                        <span
                          className={`tabular text-caption ${diff < 0 ? 'text-danger' : 'text-warning'}`}
                        >
                          {diff > 0 ? '+' : ''}
                          {amount(String(diff), balance.currency.decimals)}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              <button
                onClick={() => void submitClosure()}
                disabled={busy}
                className="rounded-sm bg-secondary px-5 py-2.5 font-medium text-light-text transition hover:bg-secondary-hover disabled:opacity-40"
              >
                Clôturer la journée
              </button>
            </>
          )}

          {closures.length > 0 ? (
            <div className="space-y-2 border-t border-light-border pt-4 dark:border-dark-border">
              <h3 className="text-caption font-medium uppercase tracking-wide text-light-muted dark:text-dark-muted">
                Dernières clôtures
              </h3>
              {closures.slice(0, 4).map((closure) => {
                const gaps = closure.lines.filter((line) => Number(line.difference) !== 0);
                return (
                  <p key={closure.id} className="text-body">
                    {new Date(closure.businessDay).toLocaleDateString('fr-FR')} · {closure.closedBy} ·{' '}
                    {gaps.length === 0 ? (
                      <span className="text-success">aucun écart</span>
                    ) : (
                      <span className="text-danger">
                        {gaps
                          .map((line) => `${line.difference} ${line.currency.code}`)
                          .join(', ')}
                      </span>
                    )}
                  </p>
                );
              })}
            </div>
          ) : null}
        </section>
      </div>

      <section className="space-y-3">
        <h2 className="font-display text-h2">Mouvements</h2>
        <div className="surface overflow-x-auto">
          <table className="w-full min-w-[760px] text-body">
            <thead className="border-b border-light-border text-caption uppercase tracking-wide text-light-muted dark:border-dark-border dark:text-dark-muted">
              <tr>
                <th className="p-4 text-left font-medium">Date</th>
                <th className="p-4 text-left font-medium">Nature</th>
                <th className="p-4 text-left font-medium">Devise</th>
                <th className="p-4 text-right font-medium">Montant</th>
                <th className="p-4 text-right font-medium">Solde après</th>
                <th className="p-4 text-left font-medium">Origine</th>
              </tr>
            </thead>
            <tbody>
              {movements.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-light-muted dark:text-dark-muted">
                    Aucun mouvement.
                  </td>
                </tr>
              ) : null}
              {movements.map((movement) => (
                <tr
                  key={movement.id}
                  className="border-b border-light-border last:border-0 dark:border-dark-border"
                >
                  <td className="p-4 text-caption">
                    {new Date(movement.createdAt).toLocaleString('fr-FR', {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td className="p-4">{MOVEMENT_LABEL[movement.type] ?? movement.type}</td>
                  <td className="p-4">{movement.currency.code}</td>
                  <td
                    className={`tabular p-4 text-right ${
                      Number(movement.amount) < 0 ? 'text-danger' : 'text-success'
                    }`}
                  >
                    {Number(movement.amount) > 0 ? '+' : ''}
                    {amount(movement.amount, movement.currency.decimals)}
                  </td>
                  <td className="tabular p-4 text-right">
                    {amount(movement.balanceAfter, movement.currency.decimals)}
                  </td>
                  <td className="p-4 text-caption text-light-muted dark:text-dark-muted">
                    {movement.reference ?? movement.note ?? movement.author}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
