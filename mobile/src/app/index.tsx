import { Ionicons } from '@expo/vector-icons';
import { Link, useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useEffect, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api';
import { useAuth } from '../auth';
import { RateCard } from '../components';
import { C, R, S, T } from '../theme';
import { Button, Card, EmptyState, ImmersiveHeader, Loader } from '../ui';
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
  const insets = useSafeAreaInsets();

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

  /**
   * Barre de navigation, en haut de l'en-tête bleu.
   *
   * Elle est POSÉE SUR le dégradé sombre : ses pastilles sont donc translucides
   * blanches, pas bleu clair sur blanc comme dans le corps de l'écran. Reprendre
   * les couleurs du corps ici rendrait le texte illisible.
   */
  const barreHaute = profile ? (
    <View style={styles.authRow}>
      <Link href="/compte" asChild>
        <Pressable style={styles.accountDark}>
          <Ionicons name="person-circle-outline" size={20} color={C.onDark} />
          <Text style={[T.label, styles.accountDarkText]} numberOfLines={1}>
            {profile.firstName}
          </Text>
          {/* Le statut KYC ne tient plus en toutes lettres dans un tiers de
              largeur, mais il ne doit pas disparaître : une pastille colorée
              signale que le compte n'est pas encore en règle, et le détail
              reste sur l'écran « Mon compte ». */}
          {profile.kycStatus !== 'VALIDE' ? (
            <View
              style={[
                styles.kycDot,
                { backgroundColor: profile.kycStatus === 'REJETE' ? C.stop : C.warn },
              ]}
            />
          ) : null}
        </Pressable>
      </Link>
      <Link href="/notifications" asChild>
        <Pressable style={styles.accountDark}>
          <Ionicons name="notifications-outline" size={20} color={C.onDark} />
          <Text style={[T.label, styles.accountDarkText]} numberOfLines={1}>
            Alertes
          </Text>
          {unread > 0 ? (
            <View style={styles.dot}>
              <Text style={styles.dotText}>{unread > 9 ? '9+' : unread}</Text>
            </View>
          ) : null}
        </Pressable>
      </Link>
      <Link href="/operations" asChild>
        <Pressable style={styles.accountDark}>
          <Ionicons name="swap-horizontal-outline" size={20} color={C.onDark} />
          <Text style={[T.label, styles.accountDarkText]} numberOfLines={1}>
            Opérations
          </Text>
        </Pressable>
      </Link>
    </View>
  ) : (
    <View style={styles.authRow}>
      <Pressable style={styles.accountDark} onPress={() => router.push('/connexion')}>
        <Ionicons name="log-in-outline" size={20} color={C.onDark} />
        <Text style={[T.label, styles.accountDarkText]} numberOfLines={1}>
          Se connecter
        </Text>
      </Pressable>
      <Pressable style={styles.accountDark} onPress={() => router.push('/inscription')}>
        <Ionicons name="person-add-outline" size={20} color={C.onDark} />
        <Text style={[T.label, styles.accountDarkText]} numberOfLines={1}>
          Créer un compte
        </Text>
      </Pressable>
    </View>
  );

  return (
    // ⚠️ PAS de <Screen> ici : il enveloppe tout dans un défilement, ce qui
    // emporterait l'en-tête bleu avec la liste. Ici l'en-tête reste FIXE et
    // seule la liste des taux défile — d'où ce conteneur en colonne.
    <View style={styles.page}>
      <ImmersiveHeader
        title="Taux du jour"
        subtitle="Mis à jour en direct. Consultez librement, changez en toute sécurité."
        top={barreHaute}
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

      {/* Seule cette zone défile : l'en-tête bleu reste en place au-dessus. */}
      <ScrollView
        style={styles.liste}
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + S.xl }]}
        showsVerticalScrollIndicator={false}
      >
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
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  // Colonne : en-tête fixe en haut, liste défilante qui prend le reste.
  page: { flex: 1, backgroundColor: C.bg },
  liste: { flex: 1 },
  pitch: { marginTop: S.xl, gap: S.md },
  pitchHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  base: { ...T.h1, color: C.navy },
  live: { flexDirection: 'row', alignItems: 'center', gap: S.xs },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.ok },
  body: { padding: S.lg, gap: S.md },
  authRow: { flexDirection: 'row', gap: S.md },
  // Pastilles posées SUR le dégradé sombre de l'en-tête : fond translucide
  // blanc et texte clair. Les tons bleu-sur-blanc du corps de l'écran y
  // seraient illisibles.
  accountDark: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.xs,
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    borderRadius: R.md,
    paddingHorizontal: S.sm,
    paddingVertical: S.sm,
  },
  accountDarkText: { flex: 1, color: C.onDark },
  kycDot: { width: 8, height: 8, borderRadius: 4 },
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
