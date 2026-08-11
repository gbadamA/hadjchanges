'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '../lib/auth';

/**
 * Racine : une redirection, pas une page. Le point d'entrée du travail
 * quotidien est la file d'identités tant que les autres modules n'existent pas.
 */
export default function Home() {
  const { user, booting } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (booting) return;
    router.replace(user && user.role !== 'CLIENT' ? '/kyc' : '/login');
  }, [booting, user, router]);

  return (
    <div className="grid min-h-screen place-items-center text-light-muted dark:text-dark-muted">
      Chargement…
    </div>
  );
}
