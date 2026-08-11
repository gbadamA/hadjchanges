'use client';

import { useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ApiError, auth, type AuthResponse, type StaffUser } from './api';

/**
 * Le refresh token seul est persisté (localStorage) ; l'access token reste **en
 * mémoire**. Un jeton d'accès dans le stockage du navigateur est lisible par
 * n'importe quel script injecté — celui-ci meurt avec l'onglet.
 */
const REFRESH_KEY = 'hc.admin.refresh';

interface AuthValue {
  user: StaffUser | null;
  token: string | null;
  booting: boolean;
  signIn: (identifier: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<StaffUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);
  const router = useRouter();

  /**
   * ⚠️ Promesse de rafraîchissement PARTAGÉE — la rotation côté API est stricte :
   * un refresh token vu deux fois est traité comme un vol et coupe toutes les
   * sessions. Le double montage d'effet de React en développement suffirait à
   * déconnecter l'agent à chaque ouverture. Ne pas retirer.
   */
  const inFlight = useRef<Promise<AuthResponse | null> | null>(null);

  const persist = useCallback((response: AuthResponse) => {
    localStorage.setItem(REFRESH_KEY, response.refreshToken);
    setToken(response.accessToken);
    setUser(response.user);
  }, []);

  const clear = useCallback(() => {
    localStorage.removeItem(REFRESH_KEY);
    setToken(null);
    setUser(null);
  }, []);

  const restore = useCallback(async (): Promise<AuthResponse | null> => {
    if (inFlight.current) return inFlight.current;
    inFlight.current = (async () => {
      const stored = localStorage.getItem(REFRESH_KEY);
      if (!stored) return null;
      try {
        const response = await auth.refresh(stored);
        persist(response);
        return response;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) clear();
        return null;
      }
    })();
    try {
      return await inFlight.current;
    } finally {
      inFlight.current = null;
    }
  }, [persist, clear]);

  useEffect(() => {
    // `finally` obligatoire : sans lui, un échec fige l'écran de chargement.
    restore().finally(() => setBooting(false));
  }, [restore]);

  const value = useMemo<AuthValue>(
    () => ({
      user,
      token,
      booting,
      signIn: async (identifier, password) => {
        persist(await auth.login(identifier, password));
      },
      signOut: async () => {
        const stored = localStorage.getItem(REFRESH_KEY);
        if (stored) await auth.logout(stored).catch(() => undefined);
        clear();
        router.replace('/login');
      },
    }),
    [user, token, booting, persist, clear, router],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth doit être utilisé dans <AuthProvider>.');
  return context;
}
