import { Ionicons } from '@expo/vector-icons';
import { Link, useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../auth';
import { RateCard } from '../components';
import { KYC_LABEL } from '../models';
import { C, R, S, T } from '../theme';
import { Button, Card, EmptyState, ImmersiveHeader, Loader, Screen } from '../ui';
import { useRates } from '../useRates';

/**
 * Écran d'accueil public : les taux du jour, tenus à jour en direct.
 *
 * Accessible SANS compte — c'est la vitrine du bureau de change (cahier §3.2).
 * Le compte n'est requis que pour verrouiller un taux, et le KYC que pour
 * transiger.
 */
export default function Accueil(): ReactNode {
  const { rows, loading, error, justUpdated, reload } = useRates();
  const { profile } = useAuth();
  const router = useRouter();

  return (
    <Screen>
      <ImmersiveHeader
        title="Taux du jour"
        subtitle="Mis à jour en direct. Consultez librement, changez en toute sécurité."
      >
        <Card style={styles.pitch} elevated>
          <View style={styles.pitchHead}>
            <View>
              <Text style={T.label}>Devise de référence</Text>
              <Text style={styles.base}>FCFA · XOF</Text>
            </View>
            <View style={styles.live}>
              <View style={styles.liveDot} />
              <Text style={T.caption}>en direct</Text>
            </View>
          </View>
          <Button label="Simuler une conversion" onPress={() => router.push('/simulateur')} />
        </Card>
      </ImmersiveHeader>

      <View style={styles.body}>
        {profile ? (
          <Link href="/compte" asChild>
            <Pressable style={styles.account}>
              <Ionicons name="person-circle-outline" size={22} color={C.navy} />
              <Text style={[T.label, styles.accountText]} numberOfLines={1}>
                {profile.firstName} · {KYC_LABEL[profile.kycStatus]}
              </Text>
              <Ionicons name="chevron-forward" size={18} color={C.textMute} />
            </Pressable>
          </Link>
        ) : (
          <View style={styles.authRow}>
            <View style={styles.authButton}>
              <Button label="Se connecter" onPress={() => router.push('/connexion')} variant="ghost" />
            </View>
            <View style={styles.authButton}>
              <Button label="Créer un compte" onPress={() => router.push('/inscription')} />
            </View>
          </View>
        )}

        {loading ? <Loader label="Récupération des taux…" /> : null}

        {!loading && error ? (
          <EmptyState
            title="Taux indisponibles"
            message={error}
            action={<Button label="Réessayer" onPress={reload} />}
          />
        ) : null}

        {!loading && !error && rows.length === 0 ? (
          <EmptyState
            title="Aucun taux publié"
            message="Les taux du jour n’ont pas encore été publiés par le bureau."
            action={<Button label="Actualiser" onPress={reload} variant="ghost" />}
          />
        ) : null}

        {rows.map((row) => (
          <RateCard
            key={row.currency.code}
            row={row}
            highlight={justUpdated === row.currency.code}
          />
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pitch: { marginTop: S.xl, gap: S.md },
  pitchHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  base: { ...T.h1, color: C.navy },
  live: { flexDirection: 'row', alignItems: 'center', gap: S.xs },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.ok },
  body: { padding: S.lg, gap: S.md },
  authRow: { flexDirection: 'row', gap: S.md },
  authButton: { flex: 1 },
  account: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.sm,
    backgroundColor: C.navySoft,
    borderRadius: R.md,
    padding: S.md,
  },
  accountText: { flex: 1, color: C.navy },
});
