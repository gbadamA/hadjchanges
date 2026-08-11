/**
 * Source de vérité visuelle du dashboard HadjChanges.
 * Aucune couleur ni rayon en dur ailleurs dans le code : tout part d'ici, et
 * `tailwind.config.ts` en est le miroir exact.
 *
 * DA « bleu diplomatique & or », reprise de FI-HADJ à la demande du client.
 * Le bleu nuit porte l'institution (une banque, un guichet, une signature) ;
 * l'azur ouvre et allège ; l'or est un accent RARE — filets, montants clés,
 * badges — jamais une grande surface, jamais un fond de texte clair.
 *
 * Ce que HadjChanges ajoute à FI-HADJ, parce que le métier l'exige :
 * la variation de taux (haussière / baissière) et la couleur de statut de
 * transaction. Ces deux familles ne sont PAS décoratives, elles portent du sens.
 */

/** Dégradé signature (135°) : bannières, en-têtes de page, boutons primaires. */
export const gradient = {
  /** Bleu nuit → azur → or. Le liseré doré ne doit occuper que la fin de course. */
  diplomatic: ["#0B2A4A", "#14507F", "#C9A227"] as const,
  /** Variante sobre (sans or) pour les grandes surfaces et les fonds de section. */
  deep: ["#08203A", "#14507F"] as const,
  angle: 135,
};

/**
 * Couleurs de marque (indépendantes du thème).
 * ⚠️ Contraste : `secondary` (or) ne porte QUE du texte sombre (`palette.light.text`).
 *    Le bleu `primary` ne porte QUE du texte blanc.
 */
export const brand = {
  primary: "#0F3D6B", // bleu diplomatique — actions
  primaryHover: "#0B2E52",
  secondary: "#C9A227", // or — montants clés, filets, badges
  secondaryHover: "#A9871C",
  tertiary: "#2E7CB8", // azur — liens, focus, illustrations
  success: "#12B76A",
  warning: "#F59E0B",
  danger: "#DC2626",
};

/** Neutres par thème — teintés très légèrement bleu pour l'unité chromatique. */
export const palette = {
  light: {
    bg: "#F5F8FC",
    surface: "#FFFFFF",
    surfaceAlt: "#EAF1F8",
    border: "#D8E3EF",
    text: "#0B1A2A",
    textMuted: "#5A6B7D",
  },
  dark: {
    bg: "#060F1A",
    surface: "#0E1B2A",
    surfaceAlt: "#152435",
    border: "#23374C",
    text: "#E8EFF7",
    textMuted: "#90A3B8",
  },
} as const;

/**
 * Variation d'un taux. Convention métier, pas esthétique :
 * vert = le taux monte, rouge = il baisse, gris = stable. Ne jamais inverser,
 * et ne jamais utiliser l'or ici (l'or dit « valeur », pas « direction »).
 */
export const trend = {
  up: "#12B76A",
  down: "#DC2626",
  flat: "#5A6B7D",
} as const;

/**
 * Une couleur par statut de transaction (cahier §3.2). Le même statut porte la
 * même couleur partout : liste, détail, filtre, badge mobile.
 */
export const statusColors = {
  CREEE: "#5A6B7D", // gris — en attente d'action du client
  RECU_SOUMIS: "#F59E0B", // ambre — à traiter par l'opérateur
  RECU_VALIDE: "#2E7CB8", // azur — contrôlé, change à exécuter
  RECU_REJETE: "#DC2626", // rouge — à redéposer
  CHANGE_EXECUTE: "#0F3D6B", // bleu — opération faite
  PRETE_POUR_RETRAIT: "#C9A227", // or — la valeur est disponible
  CLOTUREE: "#12B76A", // vert — terminé
  ANNULEE: "#8A97A6", // gris clair — sans suite
} as const;

/** Une couleur par mode de dépôt — pastilles et graphiques de répartition. */
export const depositColors = {
  ORANGE_MONEY: "#F26522",
  MTN_MOMO: "#FFCB05",
  MOOV_MONEY: "#0A5FBF",
  WAVE: "#1DC8F2",
  CARTE_BANCAIRE: "#0F3D6B",
  ESPECES_AGENCE: "#12B76A",
} as const;

export const radii = {
  sm: 10,
  md: 16,
  lg: 24,
  full: 999,
};

/** Espacement en base 4. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  "2xl": 48,
};

export const typography = {
  fonts: {
    display: "Playfair Display", // titres — sérif institutionnel
    body: "Inter", // texte courant
    /** Chiffres tabulaires : montants et taux alignés en colonne. */
    mono: "JetBrains Mono",
  },
  sizes: {
    display: 34,
    h1: 28,
    h2: 22,
    h3: 18,
    body: 15,
    caption: 13,
  },
  weights: {
    regular: "400",
    medium: "500",
    semibold: "600",
    bold: "700",
  },
} as const;

/** Ombres douces teintées bleu plutôt que noires pures. */
export const shadows = {
  card: "0 8px 24px rgba(15, 61, 107, 0.12)",
  glow: "0 0 20px rgba(15, 61, 107, 0.35)",
  gold: "0 0 18px rgba(201, 162, 39, 0.35)",
};

export type ThemeName = keyof typeof palette;
export type TransactionStatusKey = keyof typeof statusColors;
