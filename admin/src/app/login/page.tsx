'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';

export default function LoginPage() {
  const { signIn, user, booting } = useAuth();
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!booting && user) router.replace('/kyc');
  }, [booting, user, router]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(identifier.trim(), password);
      router.replace('/kyc');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Connexion impossible.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen grid lg:grid-cols-2">
      {/* Le dégradé signature porte l'identité : bleu nuit, azur, et l'or
          seulement en fin de course. */}
      <section className="hidden lg:flex flex-col justify-between bg-diplomatic p-12 text-white">
        <span className="font-display text-2xl tracking-tight">HadjChanges</span>
        <div className="space-y-4">
          <h1 className="font-display text-display leading-tight">
            Le pilotage de votre bureau de change.
          </h1>
          <p className="text-white/70 max-w-md">
            Taux, identités, reçus, caisses. Chaque décision tracée, chaque montant justifié.
          </p>
        </div>
        <span className="text-caption text-white/50">Accès réservé au personnel autorisé.</span>
      </section>

      <section className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm space-y-6">
          <div className="space-y-1">
            <h2 className="font-display text-h1">Connexion</h2>
            <p className="text-light-muted dark:text-dark-muted text-body">
              Identifiez-vous pour accéder au pilotage.
            </p>
          </div>

          {error ? (
            <p className="rounded-sm border-l-4 border-danger bg-danger/10 p-3 text-body text-danger">
              {error}
            </p>
          ) : null}

          <label className="block space-y-1">
            <span className="text-caption font-medium">Téléphone ou email</span>
            <input
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              autoComplete="username"
              className="w-full rounded-sm border border-light-border bg-light-surface px-4 py-3 outline-none focus:border-tertiary dark:border-dark-border dark:bg-dark-surface"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-caption font-medium">Mot de passe</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              className="w-full rounded-sm border border-light-border bg-light-surface px-4 py-3 outline-none focus:border-tertiary dark:border-dark-border dark:bg-dark-surface"
            />
          </label>

          <button
            type="submit"
            disabled={busy || identifier.length < 4 || password.length < 1}
            className="w-full rounded-sm bg-primary py-3 font-medium text-white transition hover:bg-primary-hover disabled:opacity-40"
          >
            {busy ? 'Connexion…' : 'Se connecter'}
          </button>
        </form>
      </section>
    </main>
  );
}
