import { Ionicons } from '@expo/vector-icons';
import { Link, useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useEffect, useState } from 'react';
import { api } from '../api';
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
  const { profile, accessToken } = useAuth();
  const [unread, setUnread] = useState(0);
  const router = useRouter();

  // Pastille de notifications : muette en cas d'échec, ce n'est qu'un indicateur.
  useEffect(() => {
    if (!accessToken) {
      setUnread(0);
      return;
    }
    api
      .unreadCount(accessToken)
      .then((result) => setUnread(result.unread))
      .catch(() => setUnread(0));
  }, [accessToken]);

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
          <Button
            label="Changer de l’argent"
            onPress={() => router.push('/operation/nouvelle')}
            variant="accent"
          />
          {/* Le simulateur reste offert, mais en second : c'est l'outil de
              celui qui regarde, pas de celui qui vient changer. */}
          <Button
            label="Simuler une conversion"
            onPress={() => router.push('/simulateur')}
            variant="ghost"
          />
        </Card>
      </ImmersiveHeader>

      <View style={styles.body}>
        {profile ? (
          <View style={styles.authRow}>
            <Link href="/compte" asChild>
              <Pressable style={styles.account}>
                <Ionicons name="person-circle-outline" size={22} color={C.navy} />
                <Text style={[T.label, styles.accountText]} numberOfLines={1}>
                  {profile.firstName} · {KYC_LABEL[profile.kycStatus]}
                </Text>
              </Pressable>
            </Link>
            <Link href="/notifications" asChild>
              <Pressable style={styles.account}>
                <Ionicons name="notifications-outline" size={22} color={C.navy} />
                <Text style={[T.label, styles.accountText]} numberOfLines={1}>
                  Notifications
                </Text>
                {unread > 0 ? (
                  <View style={styles.dot}>
                    <Text style={styles.dotText}>{unread > 9 ? '9+' : unread}</Text>
                  </View>
                ) : null}
              </Pressable>
            </Link>
            <Link href="/operations" asChild>
              <Pressable style={styles.account}>
                <Ionicons name="swap-horizontal-outline" size={22} color={C.navy} />
                <Text style={[T.label, styles.accountText]} numberOfLines={1}>
                  Mes opérations
                </Text>
              </Pressable>
            </Link>
          </View>
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
  // ⚠️ Style UNIQUE, pas un tableau : ces boutons sont enfants directs d'un
  // <Link asChild>, qui les clone via <Slot> et refuse une liste de styles.
  account: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.sm,
    backgroundColor: C.navySoft,
    borderRadius: R.md,
    padding: S.md,
  },
  accountText: { flex: 1, color: C.navy },
  dot: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  dotText: { ...T.caption, color: C.onAccent, fontVariant: ['tabular-nums'] },
});
