/**
 * Préférence clair/sombre — indépendante des couleurs de marque.
 *
 * La palette sombre existe déjà entièrement (`tailwind.config.ts` → `dark`,
 * et `dark:` dans `globals.css`) : il ne manquait que le mécanisme qui pose la
 * classe `dark` sur `<html>` et la retient d'une visite à l'autre.
 *
 * Trois états, comme la préférence système elle-même : « clair » et « sombre »
 * sont un choix explicite de l'agent ; l'absence de choix suit la préférence du
 * système d'exploitation, pour que le dashboard s'accorde à l'écran sans qu'on
 * ait à y penser.
 */
export type Theme = 'clair' | 'sombre';

const CLE = 'hc.admin.theme';

export function themeSysteme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'sombre' : 'clair';
}

/** Ce que `<html>` porte EN CE MOMENT — pas la préférence enregistrée. */
export function themeActuel(): Theme {
  return document.documentElement.classList.contains('dark') ? 'sombre' : 'clair';
}

export function appliquerTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'sombre');
}

export function definirTheme(theme: Theme): void {
  appliquerTheme(theme);
  try {
    localStorage.setItem(CLE, theme);
  } catch {
    // Stockage indisponible (navigation privée) : le choix vaut pour l'onglet
    // en cours, sans persister — mieux que de faire échouer le basculement.
  }
}

/**
 * Script exécuté AVANT l'hydratation React (voir `app/layout.tsx`).
 *
 * Sans lui, la page s'affiche d'abord en clair — le temps que React monte et
 * lise la préférence — puis bascule en sombre sous les yeux de l'agent : un
 * flash disgracieux à chaque chargement, pire la nuit. Une fonction plutôt
 * qu'une chaîne éparse : le script INLINE en est la sérialisation exacte, en
 * une seule source de vérité.
 */
export function scriptAntiFlash(): string {
  return `(function(){try{var t=localStorage.getItem('${CLE}');var sombre=t==='sombre'||(t!=='clair'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',sombre);}catch(e){}})();`;
}
