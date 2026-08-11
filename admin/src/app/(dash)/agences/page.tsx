'use client';

import { useCallback, useEffect, useState } from 'react';
import { agencies, ApiError, cash, staff, type Agency, type StaffMember } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';

const EMPTY = { code: '', name: '', city: '', address: '', phone: '' };

const amount = (value: string, decimals: number) =>
  Number(value).toLocaleString('fr-FR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

/**
 * Réseau d'agences (cahier §3.1).
 *
 * L'écran réunit ce qui va ensemble dans la tête de l'exploitant : l'agence,
 * **son encaisse** et **les opérateurs qui y travaillent**. Séparer ces trois
 * choses en trois pages obligerait à faire des allers-retours pour une décision
 * unique — « qui tient la caisse d'Adjamé, et combien y a-t-il dedans ».
 */
export default function AgencesPage() {
  const { token } = useAuth();
  const [rows, setRows] = useState<Agency[]>([]);
  const [team, setTeam] = useState<StaffMember[]>([]);
  const [balances, setBalances] = useState<Array<{ currency: { code: string; decimals: number }; amount: string }>>([]);
  const [selected, setSelected] = useState<Agency | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      const [list, members] = await Promise.all([agencies.list(), staff.list(token)]);
      setRows(list);
      setTeam(members);
      setSelected((current) => list.find((row) => row.id === current?.id) ?? list[0] ?? null);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Agences illisibles.');
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  // L'encaisse suit la sélection : afficher celle de l'agence précédente
  // pendant le chargement induirait en erreur.
  useEffect(() => {
    if (!token || !selected) {
      setBalances([]);
      return;
    }
    setBalances([]);
    cash
      .balances(selected.id, token)
      .then(setBalances)
      .catch(() => setBalances([]));
  }, [token, selected]);

  async function submitAgency() {
    if (!token) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (creating) {
        const created = await agencies.create(
          {
            code: form.code.trim().toUpperCase(),
            name: form.name.trim(),
            city: form.city.trim(),
            address: form.address.trim() || undefined,
            phone: form.phone.trim() || undefined,
          },
          token,
        );
        setNotice(`Agence ${created.name} créée.`);
        setCreating(false);
        setForm(EMPTY);
      } else if (selected) {
        await agencies.update(
          selected.id,
          {
            name: form.name.trim(),
            city: form.city.trim(),
            address: form.address.trim() || null,
            phone: form.phone.trim() || null,
          },
          token,
        );
        setNotice('Agence mise à jour.');
      }
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Enregistrement impossible.');
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(agency: Agency) {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await agencies.update(agency.id, { active: !agency.active }, token);
      setNotice(
        agency.active
          ? 'Agence fermée : elle disparaît des choix de retrait proposés aux clients.'
          : 'Agence rouverte.',
      );
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Action impossible.');
    } finally {
      setBusy(false);
    }
  }

  async function moveOperator(member: StaffMember, agencyId: string | null) {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await staff.assignAgency(member.id, agencyId, token);
      setNotice(`${member.firstName} ${member.lastName} affecté.`);
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Affectation impossible.');
    } finally {
      setBusy(false);
    }
  }

  const operators = team.filter((member) => member.role === 'OPERATEUR');
  const here = operators.filter((member) => member.agencyId === selected?.id);
  const elsewhere = operators.filter((member) => member.agencyId !== selected?.id);

  return (
    <div className="space-y-6">
      <header className="animate-fade-up flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-display text-h1">Agences</h1>
          <p className="text-light-muted dark:text-dark-muted">
            Le réseau, son encaisse et ses opérateurs.
          </p>
        </div>
        <button
          onClick={() => {
            setCreating(true);
            setForm(EMPTY);
            setNotice(null);
          }}
          className="lift rounded-sm bg-primary px-5 py-2.5 font-medium text-white transition hover:bg-primary-hover"
        >
          Nouvelle agence
        </button>
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

      <div className="grid gap-6 lg:grid-cols-[minmax(0,300px)_1fr]">
        <ul className="space-y-2">
          {rows.map((agency) => (
            <li key={agency.id}>
              <button
                onClick={() => {
                  setCreating(false);
                  setSelected(agency);
                  setForm({
                    code: agency.code,
                    name: agency.name,
                    city: agency.city,
                    address: agency.address ?? '',
                    phone: agency.phone ?? '',
                  });
                }}
                className={`lift w-full rounded-md border p-4 text-left ${
                  !creating && selected?.id === agency.id
                    ? 'border-primary bg-primary/5'
                    : 'border-light-border bg-light-surface dark:border-dark-border dark:bg-dark-surface'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{agency.name}</span>
                  <span className="font-mono text-caption text-light-muted dark:text-dark-muted">
                    {agency.code}
                  </span>
                </div>
                <p className="text-caption text-light-muted dark:text-dark-muted">
                  {agency.city} ·{' '}
                  {operators.filter((member) => member.agencyId === agency.id).length} opérateur(s)
                </p>
              </button>
            </li>
          ))}
        </ul>

        <div className="space-y-6">
          <section className="surface lift space-y-4 p-6">
            <h2 className="font-display text-h2">
              {creating ? 'Nouvelle agence' : (selected?.name ?? 'Aucune agence')}
            </h2>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="text-caption font-medium">Code</span>
                <input
                  value={form.code}
                  onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })}
                  disabled={!creating}
                  placeholder="PLT"
                  className="w-full rounded-sm border border-light-border bg-light-bg px-4 py-2.5 uppercase outline-none focus:border-tertiary disabled:opacity-50 dark:border-dark-border dark:bg-dark-bg"
                />
                {!creating ? (
                  <span className="text-caption text-light-muted dark:text-dark-muted">
                    Le code identifie l’agence dans les écritures : il ne se change pas.
                  </span>
                ) : null}
              </label>
              <label className="space-y-1">
                <span className="text-caption font-medium">Nom</span>
                <input
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  className="w-full rounded-sm border border-light-border bg-light-bg px-4 py-2.5 outline-none focus:border-tertiary dark:border-dark-border dark:bg-dark-bg"
                />
              </label>
              <label className="space-y-1">
                <span className="text-caption font-medium">Ville</span>
                <input
                  value={form.city}
                  onChange={(event) => setForm({ ...form, city: event.target.value })}
                  className="w-full rounded-sm border border-light-border bg-light-bg px-4 py-2.5 outline-none focus:border-tertiary dark:border-dark-border dark:bg-dark-bg"
                />
              </label>
              <label className="space-y-1">
                <span className="text-caption font-medium">Téléphone</span>
                <input
                  value={form.phone}
                  onChange={(event) => setForm({ ...form, phone: event.target.value })}
                  className="w-full rounded-sm border border-light-border bg-light-bg px-4 py-2.5 outline-none focus:border-tertiary dark:border-dark-border dark:bg-dark-bg"
                />
              </label>
              <label className="space-y-1 sm:col-span-2">
                <span className="text-caption font-medium">Adresse</span>
                <input
                  value={form.address}
                  onChange={(event) => setForm({ ...form, address: event.target.value })}
                  className="w-full rounded-sm border border-light-border bg-light-bg px-4 py-2.5 outline-none focus:border-tertiary dark:border-dark-border dark:bg-dark-bg"
                />
              </label>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => void submitAgency()}
                disabled={busy || !form.name.trim() || !form.city.trim() || (creating && !form.code.trim())}
                className="lift rounded-sm bg-primary px-5 py-2.5 font-medium text-white transition hover:bg-primary-hover disabled:opacity-40"
              >
                {creating ? 'Créer l’agence' : 'Enregistrer'}
              </button>
              {creating ? (
                <button
                  onClick={() => setCreating(false)}
                  className="lift rounded-sm border border-light-border px-5 py-2.5 font-medium dark:border-dark-border"
                >
                  Annuler
                </button>
              ) : selected ? (
                <button
                  onClick={() => void toggleActive(selected)}
                  disabled={busy}
                  className={`lift rounded-sm px-5 py-2.5 font-medium transition disabled:opacity-40 ${
                    selected.active
                      ? 'border border-danger text-danger hover:bg-danger/10'
                      : 'bg-success text-white'
                  }`}
                >
                  {selected.active ? 'Fermer l’agence' : 'Rouvrir l’agence'}
                </button>
              ) : null}
            </div>
          </section>

          {!creating && selected ? (
            <>
              <section className="surface lift p-6">
                <h2 className="mb-4 font-display text-h2">Encaisse</h2>
                {balances.length === 0 ? (
                  <p className="text-body text-light-muted dark:text-dark-muted">
                    Aucune caisse alimentée pour cette agence.
                  </p>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-4">
                    {balances.map((balance) => (
                      <div
                        key={balance.currency.code}
                        className="rounded-sm bg-light-surface-alt p-3 dark:bg-dark-surface-alt"
                      >
                        <p className="text-caption text-light-muted dark:text-dark-muted">
                          {balance.currency.code}
                        </p>
                        <p className="tabular text-h3 font-semibold text-primary">
                          {amount(balance.amount, balance.currency.decimals)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="surface lift space-y-4 p-6">
                <h2 className="font-display text-h2">Opérateurs affectés</h2>
                {here.length === 0 ? (
                  <p className="text-body text-light-muted dark:text-dark-muted">
                    Personne n’est affecté ici — la caisse ne peut pas être clôturée.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {here.map((member) => (
                      <li
                        key={member.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-sm bg-light-surface-alt p-3 dark:bg-dark-surface-alt"
                      >
                        <div>
                          <p className="font-medium">
                            {member.firstName} {member.lastName}
                          </p>
                          <p className="text-caption text-light-muted dark:text-dark-muted">
                            {member.phone}
                            {member.blocked ? ' · accès suspendu' : ''}
                          </p>
                        </div>
                        <button
                          onClick={() => void moveOperator(member, null)}
                          disabled={busy}
                          className="lift rounded-sm border border-light-border px-3 py-1.5 text-caption font-medium disabled:opacity-40 dark:border-dark-border"
                        >
                          Détacher
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {elsewhere.length > 0 ? (
                  <div className="border-t border-light-border pt-4 dark:border-dark-border">
                    <p className="mb-2 text-caption uppercase tracking-wide text-light-muted dark:text-dark-muted">
                      Affecter quelqu’un d’autre
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {elsewhere.map((member) => (
                        <button
                          key={member.id}
                          onClick={() => void moveOperator(member, selected.id)}
                          disabled={busy}
                          className="lift rounded-full border border-light-border px-4 py-2 text-body disabled:opacity-40 dark:border-dark-border"
                        >
                          {member.firstName} {member.lastName}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </section>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
