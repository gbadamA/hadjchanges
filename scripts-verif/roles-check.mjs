/**
 * Contrôle des décorateurs de rôle sur les routes.
 *
 *   node scripts-verif/roles-check.mjs
 *
 * Ne demande ni API ni base : c'est une lecture du source.
 *
 * ⚠️ Pourquoi ce contrôle existe. Deux fois dans la même journée, une insertion
 * ou une suppression de bloc s'est glissée ENTRE un `@Roles(...)` et la méthode
 * à laquelle il appartenait. Les décorateurs s'appliquant de bas en haut, le
 * résultat fut à chaque fois une inversion silencieuse des droits :
 *
 *  - un `@Roles(Role.CLIENT)` orphelin a écrasé un `@Roles(...STAFF)` : le
 *    CLIENT pouvait encaisser, l'ADMIN non, et la route voisine se retrouvait
 *    sans aucune restriction ;
 *  - un `@Roles(...STAFF)` rescapé d'une route supprimée s'est collé à la
 *    lecture d'une opération : plus aucun client ne pouvait ouvrir la sienne.
 *
 * Aucun des deux n'a été vu à la relecture.
 *
 * ⚠️ **Ce que ce contrôle attrape, et ce qu'il n'attrape pas.** Il voit le
 * premier cas — deux `@Roles` sur une même route — et un `@Roles` qui ne
 * précède aucune route. Vérifié en réinjectant le défaut : il le signale.
 *
 * Il ne voit PAS le second : un `@Roles` orphelin qui atterrit sur une route
 * qui n'en portait aucune est indiscernable d'un `@Roles` légitime. Vérifié
 * aussi, en réinjectant ce cas-là : le contrôle passe. Seul un essai de
 * comportement le démasque, et c'est `api-check.mjs` qui l'a fait, en
 * constatant qu'un client ne pouvait plus lire sa propre opération.
 *
 * Autrement dit : ce script réduit le risque, il ne le supprime pas. Toute
 * route dont les droits comptent doit AUSSI avoir son cas dans api-check.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const RACINE = 'api/src';

function fichiers(dossier) {
  return readdirSync(dossier).flatMap((entree) => {
    const chemin = join(dossier, entree);
    if (statSync(chemin).isDirectory()) return fichiers(chemin);
    return chemin.endsWith('.controller.ts') ? [chemin] : [];
  });
}

const ROUTE = /^\s*@(Get|Post|Patch|Put|Delete)\(/;
const ROLES = /^\s*@Roles\(/;
/** Fin du membre précédent : accolade fermante en début de ligne indentée. */
const FIN_MEMBRE = /^\s{0,4}\}\s*$/;

let routes = 0;
let anomalies = 0;

for (const chemin of fichiers(RACINE)) {
  const lignes = readFileSync(chemin, 'utf8').split('\n');

  // Tout @Roles doit précéder une route, sans qu'un corps de méthode s'intercale.
  lignes.forEach((ligne, i) => {
    if (!ROLES.test(ligne)) return;
    let j = i + 1;
    while (j < lignes.length && !ROUTE.test(lignes[j]) && !FIN_MEMBRE.test(lignes[j])) j += 1;
    if (j >= lignes.length || !ROUTE.test(lignes[j])) {
      console.log(`  ANOMALIE  ${chemin}:${i + 1} — @Roles ne précède aucune route`);
      anomalies += 1;
    }
  });

  // Une route ne doit porter qu'un seul @Roles.
  lignes.forEach((ligne, i) => {
    if (!ROUTE.test(ligne)) return;
    routes += 1;
    const attaches = [];
    for (let j = i - 1; j >= 0 && !FIN_MEMBRE.test(lignes[j]); j -= 1) {
      if (ROLES.test(lignes[j])) attaches.push(j + 1);
    }
    if (attaches.length > 1) {
      console.log(
        `  ANOMALIE  ${chemin}:${i + 1} — ${attaches.length} @Roles sur la même route ` +
          `(lignes ${attaches.reverse().join(', ')}). Le DERNIER écrit l'emporte : ` +
          'un décorateur orphelin a probablement glissé ici.',
      );
      anomalies += 1;
    }
  });
}

console.log(
  `\n${anomalies === 0 ? 'TOUT PASSE' : 'DES ANOMALIES'} — ${routes} route(s) examinée(s), ` +
    `${anomalies} anomalie(s)\n`,
);
process.exit(anomalies === 0 ? 0 : 1);
