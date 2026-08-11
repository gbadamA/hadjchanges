import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, G, R, S, T, shadow } from './theme';

/**
 * Primitives d'interface. Règle de séparation : ces composants ne naviguent
 * JAMAIS et n'appellent JAMAIS l'API — ils reçoivent, ils affichent. Les
 * composés qui savent naviguer vivent dans `components.tsx`.
 */

export function Screen({
  children,
  scroll = true,
}: {
  children: ReactNode;
  scroll?: boolean;
}): ReactNode {
  const insets = useSafeAreaInsets();
  // La marge basse suit la zone de gestes système : aucun élément tactile ne
  // se retrouve sous la barre de navigation du téléphone.
  const padding = { paddingBottom: insets.bottom + S.xl };
  if (!scroll) return <View style={[styles.screen, padding]}>{children}</View>;
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={padding}
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );
}

/** En-tête immersif bleu nuit avec halos — la signature visuelle du produit. */
export function ImmersiveHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}): ReactNode {
  const insets = useSafeAreaInsets();
  return (
    <LinearGradient
      colors={G.deep}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.header, { paddingTop: insets.top + S.xl }]}
    >
      <View style={styles.haloOne} />
      <View style={styles.haloTwo} />
      <Text style={styles.headerTitle}>{title}</Text>
      {subtitle ? <Text style={styles.headerSubtitle}>{subtitle}</Text> : null}
      {children}
    </LinearGradient>
  );
}

export function Card({
  children,
  style,
  elevated = false,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  elevated?: boolean;
}): ReactNode {
  return (
    <View style={[styles.card, elevated ? shadow.float : shadow.card, style]}>{children}</View>
  );
}

export function Badge({
  label,
  color,
  soft,
}: {
  label: string;
  color: string;
  soft: string;
}): ReactNode {
  return (
    <View style={[styles.badge, { backgroundColor: soft }]}>
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'gold' | 'ghost';
  disabled?: boolean;
}): ReactNode {
  const gradient = variant === 'gold' ? G.gold : G.navy;
  if (variant === 'ghost') {
    return (
      <Pressable
        onPress={onPress}
        disabled={disabled}
        style={({ pressed }) => [
          styles.ghost,
          pressed && styles.pressed,
          disabled && styles.disabled,
        ]}
      >
        <Text style={styles.ghostLabel}>{label}</Text>
      </Pressable>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      // Micro-interaction : l'élément recule légèrement sous le doigt.
      style={({ pressed }) => [pressed && styles.pressed, disabled && styles.disabled]}
    >
      <LinearGradient
        colors={gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.button, variant === 'gold' ? shadow.gold : shadow.navy]}
      >
        <Text style={[styles.buttonLabel, variant === 'gold' && { color: C.onGold }]}>{label}</Text>
      </LinearGradient>
    </Pressable>
  );
}

export function Loader({ label }: { label?: string }): ReactNode {
  return (
    <View style={styles.centered}>
      <ActivityIndicator color={C.navy} size="large" />
      {label ? <Text style={[T.bodyMute, styles.centeredText]}>{label}</Text> : null}
    </View>
  );
}

export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: ReactNode;
}): ReactNode {
  return (
    <View style={styles.centered}>
      <Text style={T.h2}>{title}</Text>
      <Text style={[T.bodyMute, styles.centeredText]}>{message}</Text>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  header: {
    paddingHorizontal: S.xl,
    paddingBottom: S.xxl,
    borderBottomLeftRadius: R.xxl,
    borderBottomRightRadius: R.xxl,
    overflow: 'hidden',
  },
  haloOne: {
    position: 'absolute',
    top: -70,
    right: -50,
    width: 210,
    height: 210,
    borderRadius: 105,
    backgroundColor: 'rgba(46, 124, 184, 0.28)',
  },
  haloTwo: {
    position: 'absolute',
    bottom: -90,
    left: -60,
    width: 190,
    height: 190,
    borderRadius: 95,
    backgroundColor: 'rgba(201, 162, 39, 0.16)',
  },
  headerTitle: { ...T.display, color: C.onDark },
  headerSubtitle: { ...T.bodyMute, color: C.onDarkDim, marginTop: S.xs },
  card: {
    backgroundColor: C.surface,
    borderRadius: R.lg,
    padding: S.lg,
    borderWidth: 1,
    borderColor: C.lineSoft,
  },
  badge: {
    paddingHorizontal: S.sm,
    paddingVertical: 3,
    borderRadius: R.pill,
    alignSelf: 'flex-start',
  },
  badgeText: { ...T.caption },
  button: {
    paddingVertical: S.lg,
    paddingHorizontal: S.xxl,
    borderRadius: R.pill,
    alignItems: 'center',
  },
  buttonLabel: { ...T.title, color: C.onDark },
  ghost: {
    paddingVertical: S.lg,
    paddingHorizontal: S.xxl,
    borderRadius: R.pill,
    borderWidth: 1.5,
    borderColor: C.navy,
    alignItems: 'center',
  },
  ghostLabel: { ...T.title, color: C.navy },
  pressed: { transform: [{ scale: 0.97 }], opacity: 0.92 },
  disabled: { opacity: 0.45 },
  centered: { alignItems: 'center', justifyContent: 'center', padding: S.xxl, gap: S.sm },
  centeredText: { textAlign: 'center' },
});
