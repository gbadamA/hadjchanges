import type { TextStyle, ViewStyle } from 'react-native';

// ============================================================================
// HadjChanges — design system mobile.
//
// La STRUCTURE de ce fichier (échelles C / G / R / S / F / T / shadow) est
// reprise d'AutoPièce CI : elle a fait ses preuves, on ne la réinvente pas.
// La PALETTE, elle, est celle du dashboard — bleu diplomatique & or — pour que
// les deux surfaces du produit se reconnaissent au premier coup d'œil.
//
// Palette reprise du LOGO de la structure (FITYA TRANSPORT LOGISTICS) : bleu
// royal comme marque, rouge comme accent RARE (montants clés, CTA, badges de
// valeur). Le rouge porte du texte BLANC — contrairement à l'or qu'il remplace,
// qui exigeait du texte sombre — et ne couvre jamais une grande surface : sur
// un produit financier, le rouge en aplat se lit comme une alerte.
//
// ⚠️ Aucune couleur en dur ailleurs dans le code mobile. Tout part d'ici.
// ============================================================================

export const C = {
  // Fonds
  bg: '#F5F8FC', // gris bleuté perle
  bgDeep: '#111A63', // bleu royal profond (headers immersifs, accueil)
  surface: '#FFFFFF',
  surface2: '#EDEFF9',
  surface3: '#E0E4F4',
  line: '#DADEF0',
  lineSoft: '#EBEEF9',

  // Texte
  ink: '#0E1330',
  inkDim: '#454C74',
  textMute: '#666C8C',
  onDark: '#FFFFFF',
  onDarkDim: '#B6BCE6',

  // Marque : bleu royal du logo
  navy: '#1B2A8F',
  navyDeep: '#111A63',
  navySoft: '#E8EAF8',
  navyBright: '#2C3CB5',

  // Azur : liens, focus, illustrations
  azure: '#4757C9',
  azureSoft: '#E9ECFA',

  // Accent : rouge du logo (rare — montants, CTA de valeur, badges)
  accent: '#D81E27',
  accentDeep: '#A3141C',
  accentSoft: '#FDEAEB',
  onAccent: '#FFFFFF', // ⚠️ le rouge porte du texte CLAIR

  // Sémantique
  ok: '#12B76A',
  okSoft: '#E3F7EE',
  warn: '#F59E0B',
  warnSoft: '#FEF3DC',
  info: '#4757C9',
  infoSoft: '#E9ECFA',
  stop: '#B3261E',
  stopSoft: '#FBE6E4',
};

/**
 * Variation d'un taux — convention métier, pas esthétique.
 * Vert = monte, rouge = baisse, gris = stable. Ne jamais inverser, et ne jamais
 * y mettre le rouge de marque (il dit « valeur », pas « direction »).
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
  CREEE: '#5A6B7D', // gris — en attente d'action du client
  RECU_SOUMIS: '#F59E0B', // ambre — à traiter par l'opérateur
  RECU_VALIDE: '#4757C9', // bleu-indigo — contrôlé, change à exécuter
  RECU_REJETE: '#B3261E', // rouge sombre — à redéposer
  CHANGE_EXECUTE: '#1B2A8F', // bleu du logo — opération faite
  PRETE_POUR_RETRAIT: '#D81E27', // rouge du logo — la valeur est disponible
  CLOTUREE: '#12B76A', // vert — terminé
  ANNULEE: '#8A97A6', // gris clair — sans suite
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
  diplomatic: ['#111A63', '#1B2A8F', '#D81E27'] as const,
  /** Variante sobre, sans rouge — grandes surfaces et fonds de section. */
  deep: ['#0B1250', '#1B2A8F'] as const,
  navy: ['#2C3CB5', '#1B2A8F', '#111A63'] as const,
  accent: ['#EE5A61', '#D81E27', '#A3141C'] as const,
  azure: ['#5C6BD8', '#4757C9'] as const,
  night: ['#111A63', '#182270'] as const,
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
    shadowColor: '#111A63',
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  } as ViewStyle,
  // Élément soulevé (cartes clés, feuilles, modales).
  float: {
    shadowColor: '#111A63',
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
  accent: {
    shadowColor: '#A3141C',
    shadowOpacity: 0.34,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  } as ViewStyle,
};
