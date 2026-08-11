import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { api, ApiError, type AppNotification, type RateAlert } from '../api';
import { useAuth } from '../auth';
import { C, R, S, T } from '../theme';
import { Badge, Button, Card, EmptyState, ErrorBanner, Loader, PressableCard, Screen } from '../ui';

/**
 * Notifications et devises surveillées.
 *
 * L'écran marque tout comme lu **à l'ouverture** : arriver ici, c'est avoir vu.
 * Demander un geste supplémentaire pour faire disparaître une pastille est une
 * corvée que personne ne fait, et le compteur reste rouge indéfiniment.
 */
export default function NotificationsScreen(): ReactNode {
  const { accessToken } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<AppNotification[]>([]);
  const [alerts, setAlerts] = useState<RateAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    if (!accessToken) {
      setLoading(false);
      return;
    }
    try {
      const [list, watched] = await Promise.all([
        api.notifications(accessToken),
        api.rateAlerts(accessToken),
      ]);
      setRows(list);
      setAlerts(watched);
      setError(null);
      // Lecture implicite : on ne fait pas payer un geste de plus.
      if (list.some((row) => row.readAt === null)) {
        await api.markNotificationsRead(accessToken);
      }
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Notifications indisponibles.');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const stopWatching = async (alert: RateAlert): Promise<void> => {
    if (!accessToken) return;
    try {
      await api.removeRateAlert(alert.id, accessToken);
      setAlerts((current) => current.filter((row) => row.id !== alert.id));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Suppression impossible.');
    }
  };

  if (loading) return <Loader label="Chargement…" />;

  return (
    <Screen>
      <View style={styles.body}>
        <View style={styles.head}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="arrow-back" size={24} color={C.ink} />
          </Pressable>
          <Text style={T.h1}>Notifications</Text>
        </View>

        <ErrorBanner message={error} />

        {!accessToken ? (
          <EmptyState
            title="Aucune session"
            message="Connectez-vous pour recevoir vos notifications."
            action={<Button label="Se connecter" onPress={() => router.push('/connexion')} />}
          />
        ) : null}

        {alerts.length > 0 ? (
          <Card style={styles.watched}>
            <Text style={T.title}>Devises surveillées</Text>
            {alerts.map((alert) => (
              <View key={alert.id} style={styles.alertRow}>
                <View style={styles.alertText}>
                  <Text style={T.label}>
                    {alert.currency.code} sous {alert.thresholdRate} FCFA
                  </Text>
                  <Text style={T.caption}>
                    {alert.triggeredAt
                      ? `Seuil atteint le ${new Date(alert.triggeredAt).toLocaleDateString('fr-FR')}`
                      : 'En surveillance'}
                  </Text>
                </View>
                <Pressable onPress={() => void stopWatching(alert)} hitSlop={10}>
                  <Ionicons name="close-circle-outline" size={22} color={C.textMute} />
                </Pressable>
              </View>
            ))}
          </Card>
        ) : null}

        {accessToken && rows.length === 0 ? (
          <EmptyState
            title="Rien de neuf"
            message="Vous serez prévenu ici du suivi de vos opérations et de vos alertes de taux."
            action={<Button label="Voir les taux" onPress={() => router.push('/')} variant="ghost" />}
          />
        ) : null}

        {rows.map((row) => {
          const unread = row.readAt === null;
          const card = (
            <>
              <View style={styles.row}>
                <Text style={T.title}>{row.title}</Text>
                {unread ? <Badge label="nouveau" color={C.gold} soft={C.goldSoft} /> : null}
              </View>
              <Text style={T.bodyMute}>{row.body}</Text>
              <Text style={T.caption}>
                {new Date(row.createdAt).toLocaleString('fr-FR', {
                  day: '2-digit',
                  month: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </Text>
            </>
          );

          // Une notification qui mène quelque part est cliquable ; les autres
          // ne doivent pas faire croire qu'il y a une suite.
          return row.deepLink ? (
            <PressableCard
              key={row.id}
              style={[styles.card, unread && styles.unread]}
              onPress={() => router.push(row.deepLink as '/simulateur')}
            >
              {card}
            </PressableCard>
          ) : (
            <Card key={row.id} style={[styles.card, unread && styles.unread]}>
              {card}
            </Card>
          );
        })}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: S.lg, gap: S.md, paddingTop: S.huge },
  head: { flexDirection: 'row', alignItems: 'center', gap: S.md },
  card: { gap: S.xs, borderRadius: R.md },
  unread: { borderLeftWidth: 3, borderLeftColor: C.gold },
  watched: { gap: S.sm },
  alertRow: { flexDirection: 'row', alignItems: 'center', gap: S.md },
  alertText: { flex: 1, gap: 2 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: S.sm },
});
