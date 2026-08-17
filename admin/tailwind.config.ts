import type { Config } from "tailwindcss";

/**
 * Miroir Tailwind de `src/lib/tokens.ts`. Les deux fichiers évoluent ENSEMBLE :
 * une couleur ajoutée ici sans être dans les tokens (ou l'inverse) est un bug.
 *
 * Les couleurs de marque passent par des variables CSS en **canaux RVB**
 * (`rgb(var(--c-primary) / <alpha-value>)`) et non en hex : c'est ce qui permet
 * à `bg-primary/10` de fonctionner tout en restant surchargeable à l'exécution.
 * Les variables sont déclarées dans `src/app/globals.css`.
 */
const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "rgb(var(--c-primary) / <alpha-value>)",
          hover: "rgb(var(--c-primary-hover) / <alpha-value>)",
        },
        secondary: {
          DEFAULT: "rgb(var(--c-secondary) / <alpha-value>)",
          hover: "rgb(var(--c-secondary-hover) / <alpha-value>)",
        },
        tertiary: "rgb(var(--c-tertiary) / <alpha-value>)",
        success: "#12B76A",
        warning: "#F59E0B",
        danger: "#B3261E",
        // Dégradé signature
        azure: { start: "#111A63", mid: "#1B2A8F", end: "#D81E27" },
        // Variation de taux — sens métier, voir tokens.ts
        trend: { up: "#12B76A", down: "#B3261E", flat: "#5A6B7D" },
        // Statuts de transaction
        status: {
          creee: "#5A6B7D",
          "recu-soumis": "#F59E0B",
          "recu-valide": "#4757C9",
          "recu-rejete": "#B3261E",
          execute: "#1B2A8F",
          prete: "#D81E27",
          cloturee: "#12B76A",
          annulee: "#8A97A6",
        },
        // Neutres — clair
        light: {
          bg: "#F5F8FC",
          surface: "#FFFFFF",
          "surface-alt": "#EAF1F8",
          border: "#D8E3EF",
          text: "#0B1A2A",
          muted: "#5A6B7D",
        },
        // Neutres — sombre
        dark: {
          bg: "#060F1A",
          surface: "#0E1B2A",
          "surface-alt": "#152435",
          border: "#23374C",
          text: "#E8EFF7",
          muted: "#90A3B8",
        },
      },
      borderRadius: {
        sm: "10px",
        md: "16px",
        lg: "24px",
      },
      fontFamily: {
        display: ["var(--font-display)", "Playfair Display", "Georgia", "serif"],
        body: ["var(--font-body)", "Inter", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "JetBrains Mono", "ui-monospace", "monospace"],
      },
      fontSize: {
        display: ["34px", { lineHeight: "42px", fontWeight: "700" }],
        h1: ["28px", { lineHeight: "36px", fontWeight: "700" }],
        h2: ["22px", { lineHeight: "30px", fontWeight: "600" }],
        h3: ["18px", { lineHeight: "26px", fontWeight: "600" }],
        body: ["15px", { lineHeight: "24px" }],
        caption: ["13px", { lineHeight: "18px" }],
      },
      backgroundImage: {
        diplomatic: "linear-gradient(135deg, #111A63 0%, #2C3CB5 58%, #D81E27 100%)",
        "diplomatic-deep": "linear-gradient(135deg, #08203A 0%, #2C3CB5 100%)",
        accent: "linear-gradient(135deg, #D81E27 0%, #EE5A61 50%, #A3141C 100%)",
      },
      boxShadow: {
        card: "0 8px 24px rgba(27, 42, 143, 0.12)",
        glow: "0 0 20px rgba(27, 42, 143, 0.35)",
        accent: "0 0 18px rgba(216, 30, 39, 0.35)",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(12px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        /** Clignotement discret d'un taux qui vient de changer (WebSocket). */
        "rate-flash": {
          "0%": { backgroundColor: "rgb(var(--c-secondary) / 0.18)" },
          "100%": { backgroundColor: "transparent" },
        },
        /** Tracé progressif d'une courbe SVG : la ligne se dessine. */
        draw: {
          from: { strokeDashoffset: "var(--dash)" },
          to: { strokeDashoffset: "0" },
        },
        /** Remplissage d'aire qui monte sous la courbe une fois tracée. */
        "fill-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        /** Barre qui pousse depuis sa base — jamais depuis le centre. */
        rise: {
          from: { transform: "scaleY(0)" },
          to: { transform: "scaleY(1)" },
        },
        /** Halo qui respire, réservé au chiffre clé d'un tableau de bord. */
        breathe: {
          "0%, 100%": { boxShadow: "0 0 0 rgba(201, 162, 39, 0)" },
          "50%": { boxShadow: "0 0 24px rgba(201, 162, 39, 0.28)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.5s ease-out both",
        "rate-flash": "rate-flash 1.2s ease-out both",
        draw: "draw 1.1s cubic-bezier(0.22, 1, 0.36, 1) both",
        "fill-in": "fill-in 0.6s ease-out 0.5s both",
        rise: "rise 0.7s cubic-bezier(0.22, 1, 0.36, 1) both",
        breathe: "breathe 4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
