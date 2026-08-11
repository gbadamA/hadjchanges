'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  agencies as agenciesApi,
  ApiError,
  staff,
  type Agency,
  type Role,
  type StaffMember,
} from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { ROLE_LABEL } from '../../../lib/navigation';

const ROLES: Role[] = ['OPERATEUR', 'ADMIN', 'SUPER_ADMIN'];

const ROLE_CLASS: Record<string, string> = {
  OPERATEUR: 'bg-tertiary/15 text-tertiary',
  ADMIN: 'bg-primary/15 text-primary',
  SUPER_ADMIN: 'bg-secondary/20 text-secondary-hover',
};

const EMPTY = {
  firstName: '',
  lastName: '',
  phone: '',
  email: '',
  role: 'OPERATEUR' as Role,
  agencyId: '',
};

/**
 * Comptes internes (cahier §3.1). **Réservé au super-administrateur.**
 *
 * Le mot de passe provisoire est **tiré par le serveur et affiché une seule
 * fois** : il n'est jamais renvoyé ensuite, et l'écran le dit franchement.
 * Laisser l'administrateur choisir un mot de passe produirait le même
 * « Passer123 » sur tous les postes de l'agence.
 */
export default function EquipePage() {
  const { token, user } = useAuth();
  const [members, setMembers] = useState<StaffMember[]>([]);
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [created, setCreated] = useState<{ name: string; password: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [suspendTarget, setSuspendTarget] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      const [list, agencyList] = await Promise.all([staff.list(token), agenciesApi.list()]);
      setMembers(list);
      setAgencies(agencyList);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Équipe illisible.');
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit() {
    if (!token) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await staff.create(
        {
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          phone: form.phone.trim(),
          email: form.email.trim() || undefined,
          role: form.role,
          agencyId: form.role === 'OPERATEUR' && form.agencyId ? form.agencyId : null,
        },
        token,
      );
      setCreated({
        name: `${result.firstName} ${result.lastName}`,
        password: result.temporaryPassword,
      });
      setForm(EMPTY);
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Création impossible.');
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(member: StaffMember, role: Role) {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await staff.changeRole(member.id, role, token);
      setNotice(`${member.firstName} est désormais ${ROLE_LABEL[role].toLowerCase()}.`);
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Changement impossible.');
    } finally {
      setBusy(false);
    }
  }

  async function setAccess(member: StaffMember, suspended: boolean) {
    if (!token) return;
    if (suspended && reason.trim().length < 5) {
      setError('Indiquez pourquoi l’accès est suspendu.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await staff.setAccess(member.id, suspended, suspended ? reason.trim() : undefined, token);
      setNotice(
        suspended
          ? `Accès de ${member.firstName} suspendu — il ne peut plus ouvrir le dashboard.`
          : `Accès de ${member.firstName} rétabli.`,
      );
      setSuspendTarget(null);
      setReason('');
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
        <h1 className="font-display text-h1">Équipe</h1>
        <p className="text-light-muted dark:text-dark-muted">
          Comptes internes, rôles et accès. Chaque changement est tracé au journal d’audit.
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

      {/* Mot de passe provisoire : affiché une seule fois, et l'écran l'assume. */}
      {created ? (
        <div className="surface animate-fade-up border-secondary/50 p-5">
          <p className="text-body font-medium">Compte de {created.name} créé.</p>
          <p className="mt-1 text-body text-light-muted dark:text-dark-muted">
            Mot de passe provisoire — <strong>notez-le maintenant</strong>, il ne sera plus jamais
            affiché :
          </p>
          <p className="tabular mt-2 select-all rounded-sm bg-light-surface-alt px-4 py-3 font-mono text-h3 dark:bg-dark-surface-alt">
            {created.password}
          </p>
          <button
            onClick={() => setCreated(null)}
            className="lift mt-3 rounded-sm border border-light-border px-4 py-2 text-body dark:border-dark-border"
          >
            J’ai noté
          </button>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_minmax(0,360px)]">
        <section className="surface lift overflow-x-auto">
          <table className="w-full min-w-[620px] text-body">
            <thead className="border-b border-light-border text-caption uppercase tracking-wide text-light-muted dark:border-dark-border dark:text-dark-muted">
              <tr>
                <th className="p-4 text-left font-medium">Agent</th>
                <th className="p-4 text-left font-medium">Rôle</th>
                <th className="p-4 text-left font-medium">Agence</th>
                <th className="p-4 text-right font-medium">Accès</th>
              </tr>
            </thead>
            <tbody>
              {members.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-6 text-center text-light-muted dark:text-dark-muted">
                    Aucun compte interne.
                  </td>
                </tr>
              ) : null}
              {members.map((member) => {
                const self = member.id === user?.id;
                return (
                  <tr
                    key={member.id}
                    className="border-b border-light-border last:border-0 dark:border-dark-border"
                  >
                    <td className="p-4">
                      <p className="font-medium">
                        {member.firstName} {member.lastName}
                        {self ? ' (vous)' : ''}
                      </p>
                      <p className="text-caption text-light-muted dark:text-dark-muted">
                        {member.phone}
                      </p>
                    </td>
                    <td className="p-4">
                      {self ? (
                        <span className={`rounded-full px-3 py-1 text-caption ${ROLE_CLASS[member.role]}`}>
                          {ROLE_LABEL[member.role]}
                        </span>
                      ) : (
                        <select
                          value={member.role}
                          onChange={(event) => void changeRole(member, event.target.value as Role)}
                          disabled={busy}
                          className="rounded-sm border border-light-border bg-light-bg px-3 py-1.5 text-caption dark:border-dark-border dark:bg-dark-bg"
                        >
                          {ROLES.map((role) => (
                            <option key={role} value={role}>
                              {ROLE_LABEL[role]}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td className="p-4 text-caption">
                      {member.role === 'OPERATEUR'
                        ? (agencies.find((agency) => agency.id === member.agencyId)?.name ??
                          'non affecté')
                        : '—'}
                    </td>
                    <td className="p-4 text-right">
                      {self ? (
                        <span className="text-caption text-light-muted dark:text-dark-muted">—</span>
                      ) : member.blocked ? (
                        <button
                          onClick={() => void setAccess(member, false)}
                          disabled={busy}
                          className="lift rounded-sm bg-success px-3 py-1.5 text-caption font-medium text-white disabled:opacity-40"
                        >
                          Rétablir
                        </button>
                      ) : suspendTarget === member.id ? (
                        <div className="flex flex-col items-end gap-2">
                          <input
                            value={reason}
                            onChange={(event) => setReason(event.target.value)}
                            placeholder="Motif"
                            className="w-40 rounded-sm border border-light-border bg-light-bg px-3 py-1.5 text-caption dark:border-dark-border dark:bg-dark-bg"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => void setAccess(member, true)}
                              disabled={busy}
                              className="rounded-sm bg-danger px-3 py-1.5 text-caption font-medium text-white disabled:opacity-40"
                            >
                              Confirmer
                            </button>
                            <button
                              onClick={() => {
                                setSuspendTarget(null);
                                setReason('');
                              }}
                              className="rounded-sm border border-light-border px-3 py-1.5 text-caption dark:border-dark-border"
                            >
                              Annuler
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => setSuspendTarget(member.id)}
                          className="lift rounded-sm border border-danger px-3 py-1.5 text-caption font-medium text-danger hover:bg-danger/10"
                        >
                          Suspendre
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <section className="surface lift space-y-4 p-6">
          <h2 className="font-display text-h2">Nouveau compte</h2>

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
          </div>

          <label className="block space-y-1">
            <span className="text-caption font-medium">Téléphone</span>
            <input
              value={form.phone}
              onChange={(event) => setForm({ ...form, phone: event.target.value })}
              placeholder="0700000000"
              className="w-full rounded-sm border border-light-border bg-light-bg px-4 py-2.5 outline-none focus:border-tertiary dark:border-dark-border dark:bg-dark-bg"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-caption font-medium">Email (facultatif)</span>
            <input
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
              className="w-full rounded-sm border border-light-border bg-light-bg px-4 py-2.5 outline-none focus:border-tertiary dark:border-dark-border dark:bg-dark-bg"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-caption font-medium">Rôle</span>
            <select
              value={form.role}
              onChange={(event) => setForm({ ...form, role: event.target.value as Role })}
              className="w-full rounded-sm border border-light-border bg-light-bg px-4 py-2.5 dark:border-dark-border dark:bg-dark-bg"
            >
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABEL[role]}
                </option>
              ))}
            </select>
          </label>

          {/* Seul un opérateur se rattache : un admin travaille sur tout le
              réseau, lui coller une agence restreindrait ses écrans. */}
          {form.role === 'OPERATEUR' ? (
            <label className="block space-y-1">
              <span className="text-caption font-medium">Agence</span>
              <select
                value={form.agencyId}
                onChange={(event) => setForm({ ...form, agencyId: event.target.value })}
                className="w-full rounded-sm border border-light-border bg-light-bg px-4 py-2.5 dark:border-dark-border dark:bg-dark-bg"
              >
                <option value="">Sans affectation</option>
                {agencies.map((agency) => (
                  <option key={agency.id} value={agency.id}>
                    {agency.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <button
            onClick={() => void submit()}
            disabled={
              busy ||
              form.firstName.trim().length < 2 ||
              form.lastName.trim().length < 2 ||
              form.phone.trim().length < 8
            }
            className="lift w-full rounded-sm bg-primary px-5 py-2.5 font-medium text-white transition hover:bg-primary-hover disabled:opacity-40"
          >
            Créer le compte
          </button>
          <p className="text-caption text-light-muted dark:text-dark-muted">
            Un mot de passe provisoire sera généré et affiché une seule fois.
          </p>
        </section>
      </div>
    </div>
  );
}
