import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatRate, timeAgo, type RateRow } from './models';
import { C, R, S, T, TREND } from './theme';
import { Badge, Card } from './ui';

/**
 * Composés métier. Ils connaissent le domaine (un taux, une transaction) et
 * peuvent naviguer — contrairement aux primitives de `ui.tsx`.
 */

const TREND_ICON = {
  up: 'trending-up' as const,
  down: 'trending-down' as const,
  flat: 'remove' as const,
};

/**
 * Carte d'une devise dans le tableau des taux du jour.
 * `highlight` s'allume brièvement quand la mise à jour vient d'arriver par
 * WebSocket : sans ce signal, un chiffre qui change tout seul passe inaperçu.
 */
export function RateCard({ row, highlight = false }: { row: RateRow; highlight?: boolean }): ReactNode {
  const color = TREND[row.trend];
  return (
    <Card style={[styles.card, highlight && styles.highlight]}>
      <View style={styles.head}>
        <View style={styles.identity}>
          <View style={styles.symbolBubble}>
            <Text style={styles.symbol}>{row.currency.symbol}</Text>
          </View>
          <View style={styles.names}>
            <Text style={T.title}>{row.currency.code}</Text>
            <Text style={T.caption} numberOfLines={1}>
              {row.currency.name}
            </Text>
          </View>
        </View>

        <View style={styles.trend}>
          <Ionicons name={TREND_ICON[row.trend]} size={16} color={color} />
          <Text style={[T.caption, { color }]}>
            {row.trend === 'flat' ? 'stable' : `${row.trendPct} %`}
          </Text>
        </View>
      </View>

      <View style={styles.quotes}>
        <Quote label="Nous achetons" value={row.buyRate} />
        <View style={styles.separator} />
        <Quote label="Nous vendons" value={row.sellRate} emphasis />
      </View>

      <View style={styles.foot}>
        <Text style={T.caption}>
          Commission {row.commissionPct} % · mis à jour {timeAgo(row.effectiveFrom)}
        </Text>
        {/* L'alerte de fraîcheur du cahier §3.1, vue côté client : mieux vaut
            afficher un doute qu'un taux périmé présenté comme certain. */}
        {row.stale ? <Badge label="à confirmer" color={C.warn} soft={C.warnSoft} /> : null}
      </View>
    </Card>
  );
}

function Quote({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}): ReactNode {
  return (
    <View style={styles.quote}>
      <Text style={T.overline}>{label.toUpperCase()}</Text>
      <Text style={[T.rate, styles.quoteValue, emphasis && styles.quoteEmphasis]}>
        {formatRate(value)}
      </Text>
      <Text style={T.caption}>FCFA</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: S.md },
  highlight: { borderColor: C.gold, backgroundColor: C.goldSoft },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  identity: { flexDirection: 'row', alignItems: 'center', gap: S.md, flexShrink: 1 },
  symbolBubble: {
    width: 44,
    height: 44,
    borderRadius: R.md,
    backgroundColor: C.navySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  symbol: { ...T.title, color: C.navy },
  names: { flexShrink: 1 },
  trend: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  quotes: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface2,
    borderRadius: R.md,
    paddingVertical: S.md,
  },
  quote: { flex: 1, alignItems: 'center', gap: 2 },
  quoteValue: { fontSize: 19, lineHeight: 24 },
  quoteEmphasis: { color: C.navy },
  separator: { width: 1, alignSelf: 'stretch', backgroundColor: C.line },
  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: S.sm },
});
