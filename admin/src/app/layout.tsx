import type { Metadata } from 'next';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';
import { AuthProvider } from '../lib/auth';
import './globals.css';

/**
 * Polices EMBARQUÉES, pas téléchargées.
 *
 * ⚠️ `next/font/google` va chercher les fichiers chez Google PENDANT LA
 * CONSTRUCTION : un incident réseau chez eux, ou une simple lenteur, fait
 * échouer le déploiement sur une cause étrangère au code — c'est arrivé ici
 * (`NextFontError: Failed to fetch Inter`, ETIMEDOUT). Les fichiers sont donc
 * versionnés dans `fonts/`, et le build n'appelle plus personne.
 *
 * Ce sont les variantes VARIABLES : un seul fichier couvre toutes les graisses,
 * d'où `weight` en intervalle plutôt qu'un fichier par graisse.
 */
const display = localFont({
  src: './fonts/playfair.woff2',
  weight: '400 900',
  style: 'normal',
  display: 'swap',
  variable: '--font-display',
});

const body = localFont({
  src: './fonts/inter.woff2',
  weight: '100 900',
  style: 'normal',
  display: 'swap',
  variable: '--font-body',
});

export const metadata: Metadata = {
  title: 'HadjChanges — pilotage',
  description: 'Dashboard du bureau de change : taux, identités, transactions, caisses.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr" className={`${display.variable} ${body.variable}`}>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
