import AsyncStorage from '@react-native-async-storage/async-storage';
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
import { api, ApiError, type AuthResponse } from './api';
import type { Profile } from './models';
import { registerForPush, unregisterPush } from './push';

const REFRESH_KEY = 'hc.refreshToken';

interface AuthContextValue {
  profile: Profile | null;
  accessToken: string | null;
  /** Vrai tant qu'on n'a pas tranché entre « session restaurée » et « anonyme ». */
  booting: boolean;
  signIn: (identifier: string, password: string) => Promise<void>;
  signUp: (input: {
    firstName: string;
    lastName: string;
    phone: string;
    email?: string;
    password: string;
  }) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): ReactNode {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);
  const [deviceToken, setDeviceToken] = useState<string | null>(null);

  /**
   * ⚠️ Promesse de rafraîchissement PARTAGÉE.
   * La rotation côté API est stricte : un refresh token vu deux fois est traité
   * comme un vol et coupe toutes les sessions. Le double montage d'effet de
   * React en développement suffirait à détruire la session à chaque ouverture.
   * Ce verrou n'est pas une optimisation — ne pas le retirer.
   */
  const inFlight = useRef<Promise<AuthResponse | null> | null>(null);

  const persist = useCallback(async (response: AuthResponse) => {
    await AsyncStorage.setItem(REFRESH_KEY, response.refreshToken);
    setAccessToken(response.accessToken);
    setProfile(response.user);
  }, []);

  const clear = useCallback(async () => {
    await AsyncStorage.removeItem(REFRESH_KEY);
    setAccessToken(null);
    setProfile(null);
  }, []);

  const restore = useCallback(async (): Promise<AuthResponse | null> => {
    if (inFlight.current) return inFlight.current;
    inFlight.current = (async () => {
      const stored = await AsyncStorage.getItem(REFRESH_KEY);
      if (!stored) return null;
      try {
        const response = await api.refresh(stored);
        await persist(response);
        return response;
      } catch (error) {
        // 401 = session morte : on nettoie. Panne réseau : on garde le jeton,
        // la session pourra repartir au prochain lancement.
        if (error instanceof ApiError && error.status === 401) await clear();
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
    // `finally` obligatoire : sans lui, un échec laisse l'app figée sur
    // l'écran de chargement.
    restore().finally(() => setBooting(false));
  }, [restore]);

  /**
   * Enregistrement de l'appareil pour les notifications poussées.
   * Silencieux par construction : sur émulateur, ou si la permission est
   * refusée, l'application marche sans push — ce n'est pas une panne.
   */
  useEffect(() => {
    if (!accessToken) return;
    registerForPush(accessToken)
      .then((token) => setDeviceToken(token))
      .catch(() => undefined);
  }, [accessToken]);

  const value = useMemo<AuthContextValue>(
    () => ({
      profile,
      accessToken,
      booting,
      signIn: async (identifier, password) => {
        await persist(await api.login(identifier, password));
      },
      signUp: async (input) => {
        await persist(await api.register(input));
      },
      signOut: async () => {
        // On oublie l'appareil AVANT de couper la session : après, le jeton
        // d'accès ne vaut plus rien et le téléphone continuerait de recevoir
        // les notifications d'un compte déconnecté.
        if (deviceToken && accessToken) await unregisterPush(deviceToken, accessToken);
        const stored = await AsyncStorage.getItem(REFRESH_KEY);
        // On ferme la session côté serveur au mieux : si le réseau est coupé,
        // l'utilisateur doit quand même sortir de son compte sur l'appareil.
        if (stored) await api.logout(stored).catch(() => undefined);
        await clear();
      },
      refreshProfile: async () => {
        if (!accessToken) return;
        setProfile(await api.me(accessToken));
      },
    }),
    [profile, accessToken, booting, deviceToken, persist, clear],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth doit être utilisé dans <AuthProvider>.');
  return context;
}
