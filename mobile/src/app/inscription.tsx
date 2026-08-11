import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ApiError } from '../api';
import { useAuth } from '../auth';
import { C, S, T } from '../theme';
import { Button, Card, ErrorBanner, Field, FormScreen } from '../ui';

export default function Inscription(): ReactNode {
  const { signUp } = useAuth();
  const router = useRouter();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const complete =
    firstName.trim().length >= 2 &&
    lastName.trim().length >= 2 &&
    phone.replace(/\D/g, '').length >= 10 &&
    password.length >= 8;

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await signUp({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim(),
        email: email.trim() ? email.trim() : undefined,
        password,
      });
      router.replace('/');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Inscription impossible.');
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
        <Text style={T.h1}>Créer un compte</Text>
      </View>

      {/* Dire dès l'inscription que la vérification d'identité viendra : le
          client ne doit pas découvrir le blocage au moment de payer. */}
      <Card style={styles.notice}>
        <Ionicons name="shield-checkmark-outline" size={20} color={C.navy} />
        <Text style={[T.bodyMute, styles.noticeText]}>
          La consultation et la simulation sont libres. Une pièce d’identité vous sera demandée
          avant votre première opération de change.
        </Text>
      </Card>

      <ErrorBanner message={error} />

      <Field label="Prénom" value={firstName} onChangeText={setFirstName} autoCapitalize="words" />
      <Field label="Nom" value={lastName} onChangeText={setLastName} autoCapitalize="words" />
      <Field
        label="Téléphone"
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        placeholder="0700000000"
      />
      <Field
        label="Email (facultatif)"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
      />
      <Field
        label="Mot de passe"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        error={password.length > 0 && password.length < 8 ? '8 caractères minimum.' : null}
      />

      <Button
        label={busy ? 'Création…' : 'Créer mon compte'}
        onPress={() => void submit()}
        disabled={busy || !complete}
      />
      <Button label="J’ai déjà un compte" onPress={() => router.replace('/connexion')} variant="ghost" />
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: S.md, paddingTop: S.xxl },
  notice: { flexDirection: 'row', gap: S.md, alignItems: 'flex-start', backgroundColor: C.navySoft },
  noticeText: { flex: 1 },
});
