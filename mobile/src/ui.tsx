import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
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

/**
 * Carte cliquable. Une carte qui mène quelque part doit **réagir au doigt** :
 * sans l'enfoncement, rien ne distingue une liste consultable d'une liste
 * navigable, et l'utilisateur tape deux fois pour vérifier qu'il a bien touché.
 */
export function PressableCard({
  children,
  onPress,
  style,
  elevated = false,
}: {
  children: ReactNode;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  elevated?: boolean;
}): ReactNode {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [pressed && styles.pressed]}>
      <View style={[styles.card, elevated ? shadow.float : shadow.card, style]}>{children}</View>
    </Pressable>
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
  variant?: 'primary' | 'accent' | 'ghost';
  disabled?: boolean;
}): ReactNode {
  const gradient = variant === 'accent' ? G.accent : G.navy;
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
        style={[styles.button, variant === 'accent' ? shadow.accent : shadow.navy]}
      >
        <Text style={[styles.buttonLabel, variant === 'accent' && { color: C.onAccent }]}>{label}</Text>
      </LinearGradient>
    </Pressable>
  );
}

/**
 * Écran de saisie. Le clavier ne doit JAMAIS masquer le champ actif : c'est une
 * exigence de conception, pas un détail (CLAUDE.md §7). Tout écran avec un
 * champ passe par ici — jamais un `ScrollView` nu.
 */
export function FormScreen({ children }: { children: ReactNode }): ReactNode {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      <ScrollView
        contentContainerStyle={[styles.formContent, { paddingBottom: insets.bottom + S.huge }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType = 'default',
  secureTextEntry = false,
  autoCapitalize = 'sentences',
  suffix,
  error,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'numeric' | 'phone-pad' | 'email-address';
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words';
  suffix?: string;
  error?: string | null;
}): ReactNode {
  return (
    <View style={styles.field}>
      <Text style={T.label}>{label}</Text>
      <View style={[styles.inputRow, error ? styles.inputError : null]}>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={C.textMute}
          keyboardType={keyboardType}
          secureTextEntry={secureTextEntry}
          autoCapitalize={autoCapitalize}
          autoCorrect={false}
        />
        {suffix ? <Text style={styles.suffix}>{suffix}</Text> : null}
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

/** Sélecteur à deux ou trois options — le sens de l'opération, par exemple. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}): ReactNode {
  return (
    <View style={styles.segmented}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            style={[styles.segment, active && styles.segmentActive]}
          >
            <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Bandeau d'erreur d'un formulaire — toujours visible, jamais en console. */
export function ErrorBanner({ message }: { message: string | null }): ReactNode {
  if (!message) return null;
  return (
    <View style={styles.errorBanner}>
      <Text style={styles.errorBannerText}>{message}</Text>
    </View>
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
  // 0.45 effaçait le bouton au point qu'on le croyait absent ; il doit rester
  // reconnaissable comme bouton, seulement visiblement inactif.
  disabled: { opacity: 0.7 },
  formContent: { padding: S.lg, gap: S.lg },
  field: { gap: S.xs },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
    borderRadius: R.md,
    borderWidth: 1.5,
    borderColor: C.line,
    paddingHorizontal: S.lg,
  },
  input: { ...T.body, flex: 1, paddingVertical: S.lg },
  suffix: { ...T.label, color: C.textMute },
  inputError: { borderColor: C.stop },
  errorText: { ...T.caption, color: C.stop },
  errorBanner: {
    backgroundColor: C.stopSoft,
    borderRadius: R.md,
    padding: S.md,
    borderLeftWidth: 3,
    borderLeftColor: C.stop,
  },
  errorBannerText: { ...T.bodyMute, color: C.stop },
  segmented: {
    flexDirection: 'row',
    backgroundColor: C.surface2,
    borderRadius: R.pill,
    padding: 4,
    gap: 4,
  },
  segment: { flex: 1, paddingVertical: S.md, borderRadius: R.pill, alignItems: 'center' },
  segmentActive: { backgroundColor: C.navy },
  segmentLabel: { ...T.label, color: C.inkDim },
  segmentLabelActive: { color: C.onDark },
  centered: { alignItems: 'center', justifyContent: 'center', padding: S.xxl, gap: S.sm },
  centeredText: { textAlign: 'center' },
});
