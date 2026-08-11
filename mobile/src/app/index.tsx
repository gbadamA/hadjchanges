import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { api } from '../api';
import { RateCard } from '../components';
import { C, S, T } from '../theme';
import { Button, Card, EmptyState, ImmersiveHeader, Loader, Screen } from '../ui';
import { useAsync } from '../useApi';

/**
 * Écran d'accueil public : les taux du jour.
 *
 * Accessible SANS compte — c'est la vitrine du bureau de change (cahier §3.2).
 * Le parcours d'inscription et le simulateur viennent par-dessus, ils ne
 * conditionnent pas la consultation.
 */
export default function Accueil(): ReactNode {
  const { data, loading, error, reload } = useAsync(() => api.rates(), []);

  return (
    <Screen>
      <ImmersiveHeader
        title="Taux du jour"
        subtitle="Consultez librement. Un compte vérifié n’est requis que pour changer."
      >
        <Card style={styles.pitch} elevated>
          <Text style={T.label}>Devise de référence</Text>
          <Text style={styles.base}>FCFA · XOF</Text>
          <Text style={T.caption}>
            Achat et vente affichés commission comprise, avant toute opération.
          </Text>
        </Card>
      </ImmersiveHeader>

      <View style={styles.body}>
        {loading ? <Loader label="Récupération des taux…" /> : null}

        {!loading && error ? (
          <EmptyState
            title="Taux indisponibles"
            message={error}
            action={<Button label="Réessayer" onPress={reload} />}
          />
        ) : null}

        {!loading && !error && (data?.length ?? 0) === 0 ? (
          <EmptyState
            title="Aucun taux publié"
            message="Les taux du jour n’ont pas encore été publiés par le bureau."
            action={<Button label="Actualiser" onPress={reload} variant="ghost" />}
          />
        ) : null}

        {(data ?? []).map((row) => (
          <RateCard key={row.currency.code} row={row} />
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pitch: { marginTop: S.xl, gap: 2 },
  base: { ...T.h1, color: C.navy },
  body: { padding: S.lg, gap: S.md },
});
