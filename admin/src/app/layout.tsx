import type { Metadata } from 'next';
import { Inter, Playfair_Display } from 'next/font/google';
import type { ReactNode } from 'react';
import { AuthProvider } from '../lib/auth';
import './globals.css';

const display = Playfair_Display({ subsets: ['latin'], variable: '--font-display' });
const body = Inter({ subsets: ['latin'], variable: '--font-body' });

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
