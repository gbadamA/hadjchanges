import type { TextStyle, ViewStyle } from 'react-native';

// ============================================================================
// HadjChanges — design system mobile.
//
// La STRUCTURE de ce fichier (échelles C / G / R / S / F / T / shadow) est
// reprise d'AutoPièce CI : elle a fait ses preuves, on ne la réinvente pas.
// La PALETTE, elle, est celle du dashboard — bleu diplomatique & or — pour que
// les deux surfaces du produit se reconnaissent au premier coup d'œil.
//
// Identité « confiance & valeur » : bleu nuit profond comme marque (une
// signature, un guichet, un coffre), or comme accent RARE (montants clés, CTA,
// badges de valeur). L'or ne porte jamais de texte clair et ne couvre jamais
// une grande surface.
//
// ⚠️ Aucune couleur en dur ailleurs dans le code mobile. Tout part d'ici.
// ============================================================================

export const C = {
  // Fonds
  bg: '#F5F8FC', // gris bleuté perle
  bgDeep: '#0B2A4A', // bleu nuit (headers immersifs, accueil)
  surface: '#FFFFFF',
  surface2: '#EAF1F8',
  surface3: '#DFE9F4',
  line: '#D8E3EF',
  lineSoft: '#E8F0F8',

  // Texte
  ink: '#0B1A2A',
  inkDim: '#3E5162',
  textMute: '#5A6B7D',
  onDark: '#FFFFFF',
  onDarkDim: '#A9C2DC',

  // Marque : bleu diplomatique
  navy: '#0F3D6B',
  navyDeep: '#0B2A4A',
  navySoft: '#E4EDF7',
  navyBright: '#14507F',

  // Azur : liens, focus, illustrations
  azure: '#2E7CB8',
  azureSoft: '#E3F0FA',

  // Accent : or (rare — montants, CTA de valeur, badges)
  gold: '#C9A227',
  goldDeep: '#A9871C',
  goldSoft: '#FBF3DC',
  onGold: '#0B1A2A', // ⚠️ l'or ne porte QUE du texte sombre

  // Sémantique
  ok: '#12B76A',
  okSoft: '#E3F7EE',
  warn: '#F59E0B',
  warnSoft: '#FEF3DC',
  info: '#2E7CB8',
  infoSoft: '#E3F0FA',
  stop: '#DC2626',
  stopSoft: '#FCE9E9',
};

/**
 * Variation d'un taux — convention métier, pas esthétique.
 * Vert = monte, rouge = baisse, gris = stable. Ne jamais inverser, et ne jamais
 * y mettre l'or (l'or dit « valeur », pas « direction »).
 */
export const TREND = {
  up: C.ok,
  down: C.stop,
  flat: C.textMute,
} as const;

/**
 * Une couleur par statut de transaction. Identique au dashboard
 * (`admin/src/lib/tokens.ts` → statusColors) : un statut a UNE couleur, partout.
 */
export const STATUS = {
  CREEE: '#5A6B7D',
  RECU_SOUMIS: '#F59E0B',
  RECU_VALIDE: '#2E7CB8',
  RECU_REJETE: '#DC2626',
  CHANGE_EXECUTE: '#0F3D6B',
  PRETE_POUR_RETRAIT: '#C9A227',
  CLOTUREE: '#12B76A',
  ANNULEE: '#8A97A6',
} as const;

/** Ce que chaque statut veut dire pour le client, en une phrase. */
export const STATUS_HINT: Record<keyof typeof STATUS, string> = {
  CREEE: 'Effectuez votre dépôt, puis importez le reçu.',
  RECU_SOUMIS: 'Votre reçu est en cours de contrôle par un agent.',
  RECU_VALIDE: 'Paiement confirmé, le change va être exécuté.',
  RECU_REJETE: 'Votre reçu a été refusé. Déposez-en un nouveau.',
  CHANGE_EXECUTE: 'Le change est fait. Vos fonds sont en préparation.',
  PRETE_POUR_RETRAIT: 'Vos fonds sont disponibles.',
  CLOTUREE: 'Opération terminée.',
  ANNULEE: 'Opération annulée.',
};

// Dégradés (headers, CTA, médaillons, cartes de devise).
export const G = {
  /** Dégradé signature 135° — bannières et boutons primaires. */
  diplomatic: ['#0B2A4A', '#14507F', '#C9A227'] as const,
  /** Variante sobre, sans or — grandes surfaces et fonds de section. */
  deep: ['#08203A', '#14507F'] as const,
  navy: ['#14507F', '#0F3D6B', '#0B2A4A'] as const,
  gold: ['#E7C766', '#C9A227', '#A9871C'] as const,
  azure: ['#4A9BD4', '#2E7CB8'] as const,
  night: ['#0B2A4A', '#123A63'] as const,
};

// Rayons.
export const R = { xs: 8, sm: 10, md: 16, lg: 20, xl: 24, xxl: 30, pill: 999 } as const;

// Espacements (base 4).
export const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28, huge: 40 } as const;

// Police Plus Jakarta Sans (chargée dans app/_layout.tsx).
export const F = {
  regular: 'PlusJakartaSans_400Regular',
  medium: 'PlusJakartaSans_500Medium',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
  extra: 'PlusJakartaSans_800ExtraBold',
} as const;

// Échelle typographique.
export const T: Record<string, TextStyle> = {
  display: { fontFamily: F.extra, fontSize: 32, lineHeight: 38, letterSpacing: -0.7, color: C.ink },
  h1: { fontFamily: F.extra, fontSize: 25, lineHeight: 31, letterSpacing: -0.5, color: C.ink },
  h2: { fontFamily: F.bold, fontSize: 20, lineHeight: 26, letterSpacing: -0.3, color: C.ink },
  title: { fontFamily: F.bold, fontSize: 16, lineHeight: 22, letterSpacing: -0.2, color: C.ink },
  body: { fontFamily: F.regular, fontSize: 15, lineHeight: 22, color: C.ink },
  bodyMute: { fontFamily: F.regular, fontSize: 14, lineHeight: 20, color: C.inkDim },
  label: { fontFamily: F.semibold, fontSize: 13, lineHeight: 18, color: C.ink },
  caption: { fontFamily: F.medium, fontSize: 12, lineHeight: 16, color: C.textMute },
  overline: { fontFamily: F.bold, fontSize: 11, lineHeight: 14, letterSpacing: 1.2, color: C.textMute },
  /**
   * Montants et taux. `fontVariant: tabular-nums` aligne les chiffres en
   * colonne — indispensable dès qu'on empile des montants dans une liste.
   */
  amount: {
    fontFamily: F.extra,
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: -0.6,
    color: C.ink,
    fontVariant: ['tabular-nums'],
  },
  rate: {
    fontFamily: F.semibold,
    fontSize: 15,
    lineHeight: 20,
    color: C.ink,
    fontVariant: ['tabular-nums'],
  },
};

// Ombres / élévations (le « soulèvement » demandé).
export const shadow = {
  // Carte posée, discrète.
  card: {
    shadowColor: '#0B2A4A',
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  } as ViewStyle,
  // Élément soulevé (cartes clés, feuilles, modales).
  float: {
    shadowColor: '#0B2A4A',
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 14,
  } as ViewStyle,
  // Halo bleu nuit (barre d'onglets flottante, header immersif).
  navy: {
    shadowColor: '#08203A',
    shadowOpacity: 0.24,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  } as ViewStyle,
  // CTA or avec glow — réservé aux actions qui engagent de la valeur.
  gold: {
    shadowColor: '#A9871C',
    shadowOpacity: 0.34,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  } as ViewStyle,
};
