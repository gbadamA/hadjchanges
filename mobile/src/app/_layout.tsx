import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/plus-jakarta-sans';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../auth';
import { configureForeground } from '../push';
import { Loader } from '../ui';

function Navigation(): ReactNode {
  const { booting } = useAuth();
  if (booting) return <Loader label="Ouverture de la session…" />;
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#F5F8FC' } }} />
  );
}

// Hors composant : le comportement d'affichage se déclare une fois, au
// chargement du module, pas à chaque rendu.
configureForeground();

export default function RootLayout(): ReactNode {
  const [fontsLoaded, fontError] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });

  // ⚠️ `fontError` DOIT ouvrir la porte lui aussi. Sans lui, une police qui ne
  // se charge pas — réseau lent, fichier absent — fige l'application entière
  // sur l'écran de chargement, définitivement. Une typographie de repli est un
  // désagrément ; une application qui ne démarre pas est une panne.
  const pretAAfficher = fontsLoaded || fontError !== null;

  return (
    <SafeAreaProvider>
      {/* En-tête immersif bleu nuit : le texte de la barre système doit être clair. */}
      <StatusBar style="light" />
      {pretAAfficher ? (
        <AuthProvider>
          <Navigation />
        </AuthProvider>
      ) : (
        <Loader label="Chargement…" />
      )}
    </SafeAreaProvider>
  );
}
