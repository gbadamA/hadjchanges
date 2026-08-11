import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../auth';
import { KYC_LABEL, type KycStatus } from '../models';
import { C, S, T } from '../theme';
import { Badge, Button, Card, EmptyState, Screen } from '../ui';

/** Couleur du statut KYC — même code couleur que le dashboard. */
const KYC_TONE: Record<KycStatus, { color: string; soft: string }> = {
  NON_SOUMIS: { color: C.textMute, soft: C.surface2 },
  EN_ATTENTE: { color: C.warn, soft: C.warnSoft },
  VALIDE: { color: C.ok, soft: C.okSoft },
  REJETE: { color: C.stop, soft: C.stopSoft },
};

export default function Compte(): ReactNode {
  const { profile, signOut } = useAuth();
  const router = useRouter();

  if (!profile) {
    return (
      <Screen>
        <EmptyState
          title="Aucune session"
          message="Connectez-vous pour retrouver votre compte."
          action={<Button label="Se connecter" onPress={() => router.replace('/connexion')} />}
        />
      </Screen>
    );
  }

  const tone = KYC_TONE[profile.kycStatus];

  return (
    <Screen>
      <View style={styles.body}>
        <View style={styles.head}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="arrow-back" size={24} color={C.ink} />
          </Pressable>
          <Text style={T.h1}>Mon compte</Text>
        </View>

        <Card style={styles.card}>
          <Text style={T.h2}>
            {profile.firstName} {profile.lastName}
          </Text>
          <Text style={T.bodyMute}>{profile.phone}</Text>
          {profile.email ? <Text style={T.bodyMute}>{profile.email}</Text> : null}
          <Badge label={KYC_LABEL[profile.kycStatus]} color={tone.color} soft={tone.soft} />
          {profile.kycRejectReason ? (
            <Text style={[T.caption, { color: C.stop }]}>{profile.kycRejectReason}</Text>
          ) : null}
        </Card>

        {/* La vérification d'identité arrive à la brique suivante ; annoncer
            l'étape vaut mieux qu'un écran muet. */}
        <Card style={styles.card}>
          <Text style={T.title}>Vérification d’identité</Text>
          <Text style={T.bodyMute}>
            Le dépôt de votre pièce d’identité sera disponible très prochainement. Il est requis
            avant toute opération de change.
          </Text>
        </Card>

        <Button label="Se déconnecter" onPress={() => void signOut()} variant="ghost" />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: S.lg, gap: S.md, paddingTop: S.huge },
  head: { flexDirection: 'row', alignItems: 'center', gap: S.md },
  card: { gap: S.sm },
});
