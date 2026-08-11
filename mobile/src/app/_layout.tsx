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
import { Loader } from '../ui';

export default function RootLayout(): ReactNode {
  const [fontsLoaded] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });

  return (
    <SafeAreaProvider>
      {/* En-tête immersif bleu nuit : le texte de la barre système doit être clair. */}
      <StatusBar style="light" />
      {fontsLoaded ? (
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#F5F8FC' } }} />
      ) : (
        <Loader label="Chargement…" />
      )}
    </SafeAreaProvider>
  );
}
