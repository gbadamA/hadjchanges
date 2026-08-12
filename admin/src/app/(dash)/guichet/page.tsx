'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  agencies as agenciesApi,
  ApiError,
  downloadProtected,
  rates as ratesApi,
  transactions,
  type Agency,
  type QuotePreview,
  type RateRow,
  type TransactionRow,
} from '../../../lib/api';
import { useAuth } from '../../../lib/auth';

const ID_TYPES = [
  { value: 'CNI', label: 'Carte nationale d’identité' },
  { value: 'PASSEPORT', label: 'Passeport' },
  { value: 'PERMIS', label: 'Permis de conduire' },
  { value: 'CARTE_CONSULAIRE', label: 'Carte consulaire' },
];

const EMPTY = {
  firstName: '',
  lastName: '',
  phone: '',
  idType: 'CNI',
  idNumber: '',
  beneficiaryName: '',
  beneficiaryPhone: '',
  beneficiaryRelation: '',
  amount: '',
};

const money = (value: string, code: string) =>
  `${Number(value).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} ${code}`;

/**
 * Guichet — le client est **devant l'agent**, avec ses espèces et sa pièce.
 *
 * Tout tient sur un écran, et l'aperçu de la conversion se met à jour pendant
 * la frappe : l'agent doit pouvoir annoncer le montant à voix haute avant de
 * valider. Une opération validée ici est **immédiatement close** — l'argent est
 * remis séance tenante, il n'y a pas de reçu à contrôler ni de retrait à
 * attendre. D'où le reçu qui s'imprime dans la foulée.
 */
export default function GuichetPage() {
  const { token, user } = useAuth();
  const [board, setBoard] = useState<RateRow[]>([]);
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [agencyId, setAgencyId] = useState('');
  const [direction, setDirection] = useState<'ACHAT_DEVISE' | 'VENTE_DEVISE'>('ACHAT_DEVISE');
  const [currency, setCurrency] = useState('');
  const [form, setForm] = useState(EMPTY);
  const [withBeneficiary, setWithBeneficiary] = useState(false);
  const [preview, setPreview] = useState<QuotePreview | null>(null);
  const [done, setDone] = useState<TransactionRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isOperator = user?.role === 'OPERATEUR';

  useEffect(() => {
    Promise.all([ratesApi.board(), agenciesApi.list()])
      .then(([rows, list]) => {
        setBoard(rows);
        setAgencies(list);
        setCurrency((code) => code || (rows[0]?.currency.code ?? ''));
        setAgencyId((id) => id || user?.agencyId || list[0]?.id || '');
      })
      .catch(() => setError('Taux ou agences indisponibles.'));
  }, [user?.agencyId]);

  // Aperçu temporisé : l'agent tape un montant, le résultat suit sans qu'il
  // ait à valider quoi que ce soit.
  useEffect(() => {
    const value = Number(form.amount.replace(',', '.'));
    if (!currency || !Number.isFinite(value) || value <= 0) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      transactions
        .simulate({ direction, currencyCode: currency, amount: value, side: 'SOURCE' })
        .then((result) => {
          if (!cancelled) setPreview(result);
        })
        .catch(() => {
          if (!cancelled) setPreview(null);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [form.amount, currency, direction]);

  const complete =
    form.firstName.trim().length >= 2 &&
    form.lastName.trim().length >= 2 &&
    form.phone.trim().length >= 8 &&
    form.idNumber.trim().length >= 4 &&
    preview !== null &&
    (!withBeneficiary || form.beneficiaryName.trim().length >= 2);

  const submit = useCallback(async () => {
    if (!token || !complete) return;
    setBusy(true);
    setError(null);
    try {
      const result = await transactions.counter(
        {
          customer: {
            firstName: form.firstName.trim(),
            lastName: form.lastName.trim(),
            phone: form.phone.trim(),
            idType: form.idType,
            idNumber: form.idNumber.trim(),
          },
          beneficiary: withBeneficiary
            ? {
                name: form.beneficiaryName.trim(),
                phone: form.beneficiaryPhone.trim() || undefined,
                relation: form.beneficiaryRelation.trim() || undefined,
              }
            : undefined,
          direction,
          currencyCode: currency,
          amount: Number(form.amount.replace(',', '.')),
          side: 'SOURCE',
          agencyId: isOperator ? undefined : agencyId,
        },
        token,
      );
      setDone(result);
      setForm(EMPTY);
      setWithBeneficiary(false);
      setPreview(null);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Opération impossible.');
    } finally {
      setBusy(false);
    }
  }, [token, complete, form, withBeneficiary, direction, currency, agencyId, isOperator]);

  async function print(row: TransactionRow) {
    if (!token) return;
    try {
      await downloadProtected(
        `/api/transactions/${row.id}/justificatif.pdf`,
        `recu-${row.reference}.pdf`,
        token,
      );
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Reçu indisponible.');
    }
  }

  const selected = useMemo(
    () => board.find((row) => row.currency.code === currency) ?? null,
    [board, currency],
  );
  const isPurchase = direction === 'ACHAT_DEVISE';

  return (
    <div className="space-y-6">
      <header className="animate-fade-up flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-display text-h1">Guichet</h1>
          <p className="text-light-muted dark:text-dark-muted">
            Le client est devant vous avec ses espèces. Sa pièce d’identité est obligatoire.
          </p>
        </div>
        {!isOperator && agencies.length > 1 ? (
          <select
            value={agencyId}
            onChange={(event) => setAgencyId(event.target.value)}
            className="rounded-sm border border-light-border bg-light-surface px-4 py-2 dark:border-dark-border dark:bg-dark-surface"
          >
            {agencies.map((agency) => (
              <option key={agency.id} value={agency.id}>
                {agency.name}
              </option>
            ))}
          </select>
        ) : null}
      </header>

      {error ? (
        <p className="rounded-sm border-l-4 border-danger bg-danger/10 p-3 text-body text-danger">
          {error}
        </p>
      ) : null}

      {/* Opération conclue : le seul geste qui reste est l'impression. */}
      {done ? (
        <div className="surface animate-fade-up border-success/50 p-5">
          <p className="text-body font-medium">
            {done.reference} — opération terminée. Remettez{' '}
            <strong>{money(done.targetAmount, done.targetCurrency)}</strong> au client.
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button
              onClick={() => void print(done)}
              className="lift rounded-sm bg-primary px-5 py-2.5 font-medium text-white transition hover:bg-primary-hover"
            >
              Imprimer le reçu
            </button>
            <button
              onClick={() => setDone(null)}
              className="lift rounded-sm border border-light-border px-5 py-2.5 font-medium dark:border-dark-border"
            >
              Client suivant
            </button>
          </div>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_minmax(0,340px)]">
        <div className="space-y-6">
          <section className="surface lift space-y-4 p-6">
            <h2 className="font-display text-h2">L’opération</h2>

            <div className="flex flex-wrap gap-2">
              {(
                [
                  ['ACHAT_DEVISE', 'Le client apporte des devises'],
                  ['VENTE_DEVISE', 'Le client achète des devises'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setDirection(value)}
                  className={`lift rounded-full px-4 py-2 text-body transition ${
                    direction === value
                      ? 'bg-primary text-white'
                      : 'bg-light-surface-alt text-light-muted dark:bg-dark-surface-alt dark:text-dark-muted'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="text-caption font-medium">Devise</span>
                <select
                  value={currency}
                  onChange={(event) => setCurrency(event.target.value)}
                  className="w-full rounded-sm border border-light-border bg-light-bg px-4 py-2.5 dark:border-dark-border dark:bg-dark-bg"
                >
                  {board.map((row) => (
                    <option key={row.currency.code} value={row.currency.code}>
                      {row.currency.code} — {row.currency.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-caption font-medium">
                  {isPurchase
                    ? `Montant apporté (${selected?.currency.code ?? ''})`
                    : 'Montant versé (FCFA)'}
                </span>
                <input
                  value={form.amount}
                  onChange={(event) => setForm({ ...form, amount: event.target.value })}
                  inputMode="decimal"
                  autoFocus
                  className="tabular w-full rounded-sm border border-light-border bg-light-bg px-4 py-2.5 text-h3 outline-none focus:border-tertiary dark:border-dark-border dark:bg-dark-bg"
                />
              </label>
            </div>
          </section>

          <section className="surface lift space-y-4 p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-display text-h2">Le client</h2>
              <span className="text-caption text-light-muted dark:text-dark-muted">
                Un habitué est reconnu à son numéro de téléphone.
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="text-caption font-medium">Prénom</span>
                <input
                  value={form.firstName}
                  onChange={(event) => setForm({ ...form, firstName: event.target.value })}
                  className="w-full rounded-sm border border-light-border bg-light-bg px-4 py-2.5 outline-none focus:border-tertiary dark:border-dark-border dark:bg-dark-bg"
                />
              </label>
              <label className="space-y-1">
                <span className="text-caption font-medium">Nom</span>
                <input
                  value={form.lastName}
                  onChange={(event) => setForm({ ...form, lastName: event.target.value })}
                  className="w-full rounded-sm border border-light-border bg-light-bg px-4 py-2.5 outline-none focus:border-tertiary dark:border-dark-border dark:bg-dark-bg"
                />
              </label>
              <label className="space-y-1">
                <span className="text-caption font-medium">Téléphone</span>
                <input
                  value={form.phone}
                  onChange={(event) => setForm({ ...form, phone: event.target.value })}
                  inputMode="tel"
                  placeholder="0700000000"
                  className="tabular w-full rounded-sm border border-light-border bg-light-bg px-4 py-2.5 outline-none focus:border-tertiary dark:border-dark-border dark:bg-dark-bg"
                />
              </label>
              <label className="space-y-1">
                <span className="text-caption font-medium">Pièce présentée</span>
                <select
                  value={form.idType}
                  onChange={(event) => setForm({ ...form, idType: event.target.value })}
                  className="w-full rounded-sm border border-light-border bg-light-bg px-4 py-2.5 dark:border-dark-border dark:bg-dark-bg"
                >
                  {ID_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 sm:col-span-2">
                <span className="text-caption font-medium">Numéro de la pièce</span>
                <input
                  value={form.idNumber}
                  onChange={(event) => setForm({ ...form, idNumber: event.target.value })}
                  className="w-full rounded-sm border border-light-border bg-light-bg px-4 py-2.5 outline-none focus:border-tertiary dark:border-dark-border dark:bg-dark-bg"
                />
              </label>
            </div>
          </section>

          <section className="surface lift space-y-4 p-6">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={withBeneficiary}
                onChange={(event) => setWithBeneficiary(event.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              <span className="font-display text-h2">Les fonds vont à quelqu’un d’autre</span>
            </label>

            {withBeneficiary ? (
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="space-y-1">
                  <span className="text-caption font-medium">Nom du bénéficiaire</span>
                  <input
                    value={form.beneficiaryName}
                    onChange={(event) => setForm({ ...form, beneficiaryName: event.target.value })}
                    className="w-full rounded-sm border border-light-border bg-light-bg px-4 py-2.5 outline-none focus:border-tertiary dark:border-dark-border dark:bg-dark-bg"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-caption font-medium">Téléphone</span>
                  <input
                    value={form.beneficiaryPhone}
                    onChange={(event) => setForm({ ...form, beneficiaryPhone: event.target.value })}
                    inputMode="tel"
                    className="tabular w-full rounded-sm border border-light-border bg-light-bg px-4 py-2.5 outline-none focus:border-tertiary dark:border-dark-border dark:bg-dark-bg"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-caption font-medium">Lien avec le client</span>
                  <input
                    value={form.beneficiaryRelation}
                    onChange={(event) =>
                      setForm({ ...form, beneficiaryRelation: event.target.value })
                    }
                    placeholder="frère, employeur…"
                    className="w-full rounded-sm border border-light-border bg-light-bg px-4 py-2.5 outline-none focus:border-tertiary dark:border-dark-border dark:bg-dark-bg"
                  />
                </label>
              </div>
            ) : (
              <p className="text-body text-light-muted dark:text-dark-muted">
                Par défaut, c’est le client lui-même qui reçoit les fonds.
              </p>
            )}
          </section>
        </div>

        {/* Colonne de droite : ce que l'agent annonce au client, et le bouton
            qui engage la caisse. Elle reste visible pendant la saisie. */}
        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <section className="surface lift p-6">
            <p className="text-caption uppercase tracking-wide text-light-muted dark:text-dark-muted">
              Le client repart avec
            </p>
            <p className="tabular mt-1 text-display font-semibold text-primary">
              {preview
                ? money(preview.targetAmount, preview.targetCurrency)
                : '—'}
            </p>

            {preview ? (
              <dl className="mt-4 space-y-2 border-t border-light-border pt-4 text-body dark:border-dark-border">
                <Line label="Il remet" value={money(preview.sourceAmount, preview.sourceCurrency)} />
                <Line label="Taux appliqué" value={`${preview.appliedRate} FCFA`} />
                <Line
                  label={`Commission (${preview.commissionPct} %)`}
                  value={money(preview.commissionAmount, 'XOF')}
                />
                <Line label="Contre-valeur" value={money(preview.amountXof, 'XOF')} />
              </dl>
            ) : (
              <p className="mt-3 text-caption text-light-muted dark:text-dark-muted">
                Saisissez un montant pour voir la conversion.
              </p>
            )}

            <button
              onClick={() => void submit()}
              disabled={busy || !complete}
              className="lift mt-5 w-full rounded-sm bg-secondary px-5 py-3 font-medium text-light-text transition hover:bg-secondary-hover disabled:opacity-40"
            >
              {busy ? 'Enregistrement…' : 'Valider et remettre les fonds'}
            </button>
            <p className="mt-2 text-caption text-light-muted dark:text-dark-muted">
              La caisse est mouvementée immédiatement et l’opération est close.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-light-muted dark:text-dark-muted">{label}</dt>
      <dd className="tabular font-medium">{value}</dd>
    </div>
  );
}
