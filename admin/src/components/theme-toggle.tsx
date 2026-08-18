'use client';

import { Moon, Sun } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { definirTheme, themeActuel, type Theme } from '../lib/theme';

/**
 * Bascule clair/sombre. `null` tant qu'on n'a pas lu l'état réel posé par le
 * script anti-flash (`app/layout.tsx`) : rendre une icône par défaut avant ça
 * l'afficherait parfois à l'envers pendant une fraction de seconde.
 */
export function ThemeToggle(): ReactNode {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => setTheme(themeActuel()), []);

  if (theme === null) {
    return <span className="h-9 w-9 shrink-0" aria-hidden />;
  }

  const sombre = theme === 'sombre';
  const toggle = (): void => {
    const suivant: Theme = sombre ? 'clair' : 'sombre';
    definirTheme(suivant);
    setTheme(suivant);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      title={sombre ? 'Passer en clair' : 'Passer en sombre'}
      aria-label={sombre ? 'Passer en clair' : 'Passer en sombre'}
      className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-white/15 text-white/70 transition hover:border-white/30 hover:text-white"
    >
      {sombre ? <Sun size={17} aria-hidden /> : <Moon size={17} aria-hidden />}
    </button>
  );
}
