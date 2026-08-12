'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, settings, type SettingRow } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';

const CHANNELS = [
  { value: 'PUSH', label: 'Notification push' },
  { value: 'EMAIL', label: 'Courriel' },
  { value: 'WHATSAPP', label: 'WhatsApp' },
  { value: 'SMS', label: 'SMS' },
];

/** Les numéros de dépôt en tête : c'est là que part l'argent des clients. */
const GROUPS = [
  { title: 'Numéros de dépôt', keys: ['depositNumberOrange', 'depositNumberMtn', 'depositNumberMoov'] },
  { title: 'Règles de change', keys: ['rateLockMinutes', 'rateStaleHours'] },
  { title: 'Conformité et plafonds', keys: ['lcbFtThresholdXof', 'defaultDailyLimitXof', 'defaultMonthlyLimitXof'] },
];

/**
 * Réglages système (cahier §3.1, « paramétrage »).
 *
 * Deux choses qu'un exploitant doit pouvoir changer sans développeur : **le
 * numéro sur lequel ses clients envoient leur argent**, et les seuils
 * réglementaires. Le reste — jetons WhatsApp, clés S3 — reste dans `.env` : une
 * clé d'API en base est une clé qui fuit par un export ou un écran partagé.
 */
export default function ReglagesPage() {
  const { token } = useAuth();
  const [rows, setRows] = useState<SettingRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [channels, setChannels] = useState<Array<{ channel: string; configured: boolean }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [list, available] = await Promise.all([settings.list(token), settings.channels(token)]);
      setRows(list);
      setChannels(available);
      setDrafts(Object.fromEntries(list.map((row) => [row.key, row.value])));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Réglages illisibles.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(row: SettingRow) {
    if (!token) return;
    setBusy(row.key);
    setError(null);
    setNotice(null);
    try {
      await settings.update(row.key, drafts[row.key] ?? '', token);
      setNotice(`${row.label} enregistré.`);
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Enregistrement impossible.');
    } finally {
      setBusy(null);
    }
  }

  async function testChannel(channel: string) {
    if (!token) return;
    setBusy(channel);
    setError(null);
    setNotice(null);
    try {
      const result = await settings.testChannel(channel, token);
      if (result.delivered) {
        setNotice(`Essai ${channel} remis${result.detail ? ` — ${result.detail}` : ''}. Vérifiez sa réception.`);
      } else {
        setError(`Essai ${channel} non remis — ${result.detail}`);
      }
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Essai impossible.');
    } finally {
      setBusy(null);
    }
  }

  const byKey = new Map(rows.map((row) => [row.key, row]));

  return (
    <div className="space-y-6">
      <header className="animate-fade-up space-y-1">
        <h1 className="font-display text-h1">Réglages</h1>
        <p className="text-light-muted dark:text-dark-muted">
          Les valeurs que l’exploitation change sans développeur. Chaque modification est tracée au
          journal d’audit.
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

      {loading ? <p className="text-light-muted dark:text-dark-muted">Chargement…</p> : null}

      {GROUPS.map((group, index) => (
        <section
          key={group.title}
          className="surface lift animate-fade-up space-y-4 p-6"
          style={{ animationDelay: `${index * 70}ms` }}
        >
          <h2 className="font-display text-h2">{group.title}</h2>

          {group.keys.map((key) => {
            const row = byKey.get(key);
            if (!row) return null;
            const dirty = (drafts[key] ?? '') !== row.value;
            return (
              <div key={key} className="flex flex-wrap items-end gap-3">
                <label className="min-w-[220px] flex-1 space-y-1">
                  <span className="text-caption font-medium">{row.label}</span>
                  <input
                    value={drafts[key] ?? ''}
                    onChange={(event) => setDrafts({ ...drafts, [key]: event.target.value })}
                    inputMode={row.kind === 'number' ? 'numeric' : 'tel'}
                    className="tabular w-full rounded-sm border border-light-border bg-light-bg px-4 py-2.5 outline-none focus:border-tertiary dark:border-dark-border dark:bg-dark-bg"
                  />
                </label>
                <button
                  onClick={() => void save(row)}
                  disabled={busy === key || !dirty}
                  className="lift rounded-sm bg-primary px-4 py-2.5 font-medium text-white transition hover:bg-primary-hover disabled:opacity-40"
                >
                  Enregistrer
                </button>
              </div>
            );
          })}

          {group.title === 'Numéros de dépôt' ? (
            <p className="text-caption text-light-muted dark:text-dark-muted">
              Ces numéros sont affichés au client au moment de payer. Une erreur ici envoie son
              argent chez quelqu’un d’autre : relisez avant d’enregistrer.
            </p>
          ) : null}
        </section>
      ))}

      <section className="surface lift animate-fade-up space-y-4 p-6" style={{ animationDelay: '210ms' }}>
        <div>
          <h2 className="font-display text-h2">Canaux de notification</h2>
          <p className="text-light-muted dark:text-dark-muted">
            Les identifiants se posent dans <code className="font-mono text-caption">api/.env</code>{' '}
            — jamais en base. L’essai s’envoie <strong>à vous</strong>, pas à un client.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {CHANNELS.map((channel) => {
            const configured =
              channels.find((row) => row.channel === channel.value)?.configured ?? false;
            return (
              <div
                key={channel.value}
                className="flex items-center justify-between gap-3 rounded-sm bg-light-surface-alt p-4 dark:bg-dark-surface-alt"
              >
                <div>
                  <p className="font-medium">{channel.label}</p>
                  <p
                    className={`text-caption ${configured ? 'text-success' : 'text-light-muted dark:text-dark-muted'}`}
                  >
                    {configured ? 'configuré' : 'identifiants manquants'}
                  </p>
                </div>
                <button
                  onClick={() => void testChannel(channel.value)}
                  disabled={busy === channel.value || !configured}
                  className="lift rounded-sm border border-light-border px-3 py-1.5 text-caption font-medium disabled:opacity-40 dark:border-dark-border"
                >
                  Tester
                </button>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
