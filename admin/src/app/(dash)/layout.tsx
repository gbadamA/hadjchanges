'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useAuth } from '../../lib/auth';
import { NAVIGATION, navigationFor, ROLE_LABEL } from '../../lib/navigation';

export default function DashLayout({ children }: { children: ReactNode }) {
  const { user, booting, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (booting) return;
    // Un client n'a rien à faire dans le pilotage : même traitement qu'un
    // visiteur sans session.
    if (!user || user.role === 'CLIENT') router.replace('/login');
  }, [booting, user, router]);

  if (booting || !user || user.role === 'CLIENT') {
    return (
      <div className="grid min-h-screen place-items-center text-light-muted dark:text-dark-muted">
        Ouverture de la session…
      </div>
    );
  }

  const items = navigationFor(user.role);

  /**
   * Garde de ROUTE, en plus du filtrage du menu.
   *
   * Cacher une entrée ne suffit pas : l'URL reste tapable, et la page
   * s'ouvrirait avec des boutons qui échoueront tous en 403 après le clic.
   * L'API reste la vraie sécurité — ceci évite juste de laisser quelqu'un
   * s'escrimer sur une page qui ne lui répondra jamais.
   */
  const target = NAVIGATION.find((item) => pathname.startsWith(item.href));
  const forbidden = target !== undefined && !target.roles.includes(user.role);

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-64 shrink-0 flex-col justify-between bg-diplomatic-deep p-6 text-white lg:flex">
        <div className="space-y-8">
          <span className="font-display text-xl">HadjChanges</span>
          <nav className="space-y-1">
            {items.map((item) =>
              item.ready ? (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`block rounded-sm px-3 py-2 text-body transition ${
                    pathname.startsWith(item.href)
                      ? 'bg-white/15 font-medium'
                      : 'text-white/70 hover:bg-white/10'
                  }`}
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  key={item.href}
                  className="flex items-center justify-between rounded-sm px-3 py-2 text-body text-white/35"
                  title="Module à venir"
                >
                  {item.label}
                  <span className="text-[10px] uppercase tracking-wider text-secondary/70">
                    à venir
                  </span>
                </span>
              ),
            )}
          </nav>
        </div>

        <div className="space-y-2 border-t border-white/10 pt-4">
          <p className="text-body font-medium">
            {user.firstName} {user.lastName}
          </p>
          <p className="text-caption text-white/60">{ROLE_LABEL[user.role]}</p>
          <button
            onClick={() => void signOut()}
            className="text-caption text-white/70 underline underline-offset-2 hover:text-white"
          >
            Se déconnecter
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-x-hidden bg-light-bg p-6 dark:bg-dark-bg lg:p-10">
        {forbidden ? (
          <div className="surface mx-auto max-w-lg p-8 text-center">
            <h1 className="font-display text-h2">Accès réservé</h1>
            <p className="mt-2 text-body text-light-muted dark:text-dark-muted">
              Le module « {target?.label} » n’est pas ouvert au rôle{' '}
              {ROLE_LABEL[user.role].toLowerCase()}. Demandez-le au super-administrateur.
            </p>
            <Link
              href={items.find((item) => item.ready)?.href ?? '/kyc'}
              className="lift mt-5 inline-block rounded-sm bg-primary px-5 py-2.5 font-medium text-white"
            >
              Revenir à mon pilotage
            </Link>
          </div>
        ) : (
          children
        )}
      </main>
    </div>
  );
}
