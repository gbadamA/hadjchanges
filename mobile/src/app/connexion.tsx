import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ApiError } from '../api';
import { useAuth } from '../auth';
import { S, T } from '../theme';
import { Button, ErrorBanner, Field, FormScreen } from '../ui';
import { C } from '../theme';

export default function Connexion(): ReactNode {
  const { signIn } = useAuth();
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await signIn(identifier.trim(), password);
      router.back();
    } catch (cause) {
      // Toujours un message affiché : un bouton qui ne fait « rien » en
      // silence est le pire des échecs de formulaire.
      setError(cause instanceof ApiError ? cause.message : 'Connexion impossible.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormScreen>
      <View style={styles.head}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color={C.ink} />
        </Pressable>
        <Text style={T.h1}>Se connecter</Text>
      </View>
      <Text style={T.bodyMute}>Par votre numéro de téléphone ou votre email.</Text>

      <ErrorBanner message={error} />

      <Field
        label="Téléphone ou email"
        value={identifier}
        onChangeText={setIdentifier}
        placeholder="0700000000"
        keyboardType="default"
        autoCapitalize="none"
      />
      <Field
        label="Mot de passe"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
      />

      <Button
        label={busy ? 'Connexion…' : 'Se connecter'}
        onPress={() => void submit()}
        disabled={busy || identifier.length < 4 || password.length < 1}
      />
      <Button
        label="Créer un compte"
        onPress={() => router.replace('/inscription')}
        variant="ghost"
      />
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: S.md, paddingTop: S.xxl },
});
