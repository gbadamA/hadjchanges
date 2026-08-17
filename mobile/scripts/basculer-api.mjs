#!/usr/bin/env node
/**
 * Bascule l'application mobile vers une API en ligne.
 *
 *   node scripts/basculer-api.mjs https://hadjchanges-api.onrender.com
 *
 * Deux gestes qui DOIVENT aller ensemble, d'où ce script plutôt qu'une note :
 *
 *  1. Figer `EXPO_PUBLIC_API_URL`. Un APK autonome n'a pas de Metro, donc
 *     l'auto-détection de `src/api-url.ts` ne s'applique pas : sans cette
 *     variable, l'application retombe sur `10.0.2.2`, l'alias d'un émulateur.
 *
 *  2. RETIRER `usesCleartextTraffic`. Cette autorisation n'existait que pour
 *     joindre une API en `http://` sur le réseau local. Une fois l'API en
 *     `https`, la laisser affaiblit l'application sans aucune contrepartie :
 *     elle autoriserait n'importe quel trafic non chiffré, y compris une
 *     redirection hostile.
 *
 * ⚠️ L'ordre compte. Faire (1) sans (2) produit un APK qui pointe bien vers
 * `https` mais accepte toujours le trafic en clair — et personne ne s'en
 * aperçoit, puisque l'application fonctionne.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = join(dirname(fileURLToPath(import.meta.url)), '..');
const url = process.argv[2];
const forcer = process.argv.includes('--autoriser-http');

if (!url || url.startsWith('--')) {
  console.error('Usage : node scripts/basculer-api.mjs <url-de-l-api> [--autoriser-http]');
  process.exit(1);
}

// On refuse `http://` par défaut : c'est précisément ce dont on sort.
if (!/^https:\/\//.test(url)) {
  if (!forcer) {
    console.error(
      `\nRefus : « ${url} » n'est pas en https.\n` +
        "La bascule sert justement à quitter le trafic en clair. Si vous visez\n" +
        "sciemment une préproduction en http, relancez avec --autoriser-http\n" +
        "(l'autorisation de trafic non chiffré sera alors CONSERVÉE).\n",
    );
    process.exit(1);
  }
  console.warn(`\n⚠️  ${url} est en http : l'autorisation de trafic en clair est conservée.\n`);
}

const propre = url.replace(/\/+$/, '');

// ── 1. L'adresse de l'API ──────────────────────────────────────────────────
const env = `# Adresse de l'API, figée dans le bundle au moment du build.
#
# ⚠️ Un APK autonome n'a PAS de Metro : l'auto-détection de \`src/api-url.ts\`
# ne peut pas s'appliquer, cette valeur doit donc exister AVANT la construction.
#
# En développement local, remettre cette ligne en commentaire pour retrouver la
# détection automatique (émulateur comme téléphone réel, sans chercher son IP).
EXPO_PUBLIC_API_URL="${propre}"
`;
writeFileSync(join(racine, '.env'), env, 'utf8');
console.log(`✔ .env              → ${propre}`);

// ── 2. Le trafic en clair ──────────────────────────────────────────────────
const cheminAppJson = join(racine, 'app.json');
if (!existsSync(cheminAppJson)) {
  console.error('app.json introuvable — bascule incomplète.');
  process.exit(1);
}
const app = JSON.parse(readFileSync(cheminAppJson, 'utf8'));
const plugins = app.expo.plugins ?? [];
let retire = false;

if (!forcer) {
  app.expo.plugins = plugins
    .map((plugin) => {
      // Un plugin peut s'écrire en forme NUE (`"nom"`) ou CONFIGURÉE
      // (`["nom", {...}]`). Ne traiter que la seconde laisserait la première en
      // place — c'est ce qui a produit un doublon lors de la mise en place.
      if (plugin === 'expo-build-properties') return null;
      if (!Array.isArray(plugin) || plugin[0] !== 'expo-build-properties') return plugin;
      const options = plugin[1] ?? {};
      if (options.android?.usesCleartextTraffic !== undefined) {
        delete options.android.usesCleartextTraffic;
        retire = true;
      }
      // Un plugin dont il ne reste plus rien à configurer n'a pas à subsister.
      if (Object.keys(options.android ?? {}).length === 0) delete options.android;
      return Object.keys(options).length === 0 ? null : [plugin[0], options];
    })
    .filter((plugin) => plugin !== null);

  writeFileSync(cheminAppJson, `${JSON.stringify(app, null, 2)}\n`, 'utf8');
  console.log(
    retire
      ? '✔ app.json          → autorisation du trafic en clair RETIRÉE'
      : '· app.json          → aucune autorisation de trafic en clair (déjà propre)',
  );
}

console.log(`
Reste à reconstruire — le natif doit être régénéré, sinon l'ancien manifeste
Android (qui autorise encore le trafic en clair) resterait en place :

  npx expo prebuild --platform android --clean
  cd android && ./gradlew assembleRelease --no-daemon --max-workers=1

⚠️ \`prebuild --clean\` efface \`android/local.properties\` : le SDK doit y être
redéclaré (sdk.dir), sinon Gradle échoue faute de le trouver.
`);
