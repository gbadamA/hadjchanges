import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../auth';
import { KYC_LABEL, type KycStatus } from '../models';
import { C, S, T } from '../theme';
import { Badge, Button, Card, EmptyState, Screen } from '../ui';

/** Ce que le statut veut dire pour le client, en une phrase actionnable. */
const KYC_HINT: Record<KycStatus, string> = {
  NON_SOUMIS: 'Déposez votre pièce d’identité pour pouvoir effectuer une opération de change.',
  EN_ATTENTE: 'Votre pièce est en cours de vérification. Vous serez prévenu dès qu’elle est validée.',
  VALIDE: 'Votre identité est vérifiée : vous pouvez changer vos devises.',
  REJETE: 'Votre pièce a été refusée. Corrigez le point signalé et déposez-en une nouvelle.',
};

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

        <Card style={styles.card}>
          <Text style={T.title}>Vérification d’identité</Text>
          <Text style={T.bodyMute}>{KYC_HINT[profile.kycStatus]}</Text>
          {profile.kycStatus !== 'VALIDE' ? (
            <Button
              label={profile.kycStatus === 'REJETE' ? 'Déposer une nouvelle pièce' : 'Vérifier mon identité'}
              onPress={() => router.push('/kyc')}
              variant={profile.kycStatus === 'EN_ATTENTE' ? 'ghost' : 'primary'}
            />
          ) : null}
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
