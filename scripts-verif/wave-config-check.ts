/**
 * Contrôle des garde-fous de configuration des paiements.
 *
 *   cd api && npx tsx ../scripts-verif/wave-config-check.ts
 *
 * Deux erreurs de configuration coûtent de l'argent, et aucune des deux ne se
 * signale d'elle-même à l'exécution :
 *
 *  - `wave` sans clé : l'API démarre et chaque paiement échoue ;
 *  - `simulation` en production : les opérations passent en « payé » sans
 *    qu'un centime soit encaissé, et personne ne s'en aperçoit avant la caisse.
 *
 * D'où un refus de démarrer dans les deux cas. Ce script vérifie que ces refus
 * existent bel et bien — une protection non éprouvée n'en est pas une.
 */
import { loadEnv } from '../api/src/config/env';
import { construireAdaptateurPaiement } from '../api/src/payments/payments.module';

/** Environnement minimal valide, que chaque cas vient perturber. */
const BASE: Record<string, string> = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  DIRECT_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
};

let reussis = 0;
let echoues = 0;

function cas(
  nom: string,
  surcharge: Record<string, string>,
  attendu: { adaptateur: string } | { refus: string },
): void {
  let obtenu: string;
  try {
    const adaptateur = construireAdaptateurPaiement(loadEnv({ ...BASE, ...surcharge }));
    obtenu = `adaptateur ${adaptateur.nom} (réel=${adaptateur.reel})`;
    if ('adaptateur' in attendu && adaptateur.nom === attendu.adaptateur) {
      console.log(`  OK      ${nom}  → ${obtenu}`);
      reussis++;
      return;
    }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    obtenu = `refus : ${message.split('\n')[0]}`;
    if ('refus' in attendu && message.includes(attendu.refus)) {
      console.log(`  OK      ${nom}  → refus de démarrer`);
      reussis++;
      return;
    }
  }
  const texteAttendu =
    'adaptateur' in attendu ? `adaptateur ${attendu.adaptateur}` : `refus contenant « ${attendu.refus} »`;
  console.log(`  ECHEC   ${nom}\n            attendu : ${texteAttendu}\n            obtenu  : ${obtenu}`);
  echoues++;
}

console.log('\n=== Défaut : jamais de paiement réel par accident ===');
cas('aucune variable de paiement renseignée', {}, { adaptateur: 'Simulation' });
cas(
  'clés Wave présentes mais driver non basculé',
  { WAVE_API_KEY: 'wave_sn_prod_x', WAVE_WEBHOOK_SECRET: 'wave_sn_WHS_x' },
  { adaptateur: 'Simulation' },
);

console.log('\n=== Wave incomplet : refus de démarrer ===');
cas('driver=wave sans aucune clé', { PAYMENT_DRIVER: 'wave' }, { refus: 'WAVE_API_KEY' });
cas(
  'driver=wave avec la clé mais sans secret de webhook',
  { PAYMENT_DRIVER: 'wave', WAVE_API_KEY: 'wave_sn_prod_x' },
  { refus: 'WAVE_WEBHOOK_SECRET' },
);
cas(
  'driver=wave avec le secret mais sans clé',
  { PAYMENT_DRIVER: 'wave', WAVE_WEBHOOK_SECRET: 'wave_sn_WHS_x' },
  { refus: 'WAVE_API_KEY' },
);

console.log('\n=== Simulation en production : refus de démarrer ===');
cas(
  'driver=simulation avec NODE_ENV=production',
  { NODE_ENV: 'production' },
  { refus: 'déclarées payées sans aucun paiement réel' },
);
cas(
  'PAYMENT_DEMO=false explicite en production',
  { NODE_ENV: 'production', PAYMENT_DEMO: 'false' },
  { refus: 'déclarées payées sans aucun paiement réel' },
);
cas(
  'PAYMENT_DEMO=1 (valeur non reconnue) en production',
  { NODE_ENV: 'production', PAYMENT_DEMO: '1' },
  { refus: 'PAYMENT_DEMO' },
);

console.log('\n=== Démonstration déclarée en production ===');
cas(
  'driver=simulation, NODE_ENV=production, PAYMENT_DEMO=true',
  { NODE_ENV: 'production', PAYMENT_DEMO: 'true' },
  { adaptateur: 'Simulation' },
);

console.log('\n=== Configuration complète ===');
cas(
  'driver=wave avec clé et secret',
  { PAYMENT_DRIVER: 'wave', WAVE_API_KEY: 'wave_sn_prod_x', WAVE_WEBHOOK_SECRET: 'wave_sn_WHS_x' },
  { adaptateur: 'Wave' },
);
cas(
  'driver=wave en production, complet',
  {
    NODE_ENV: 'production',
    PAYMENT_DRIVER: 'wave',
    WAVE_API_KEY: 'wave_sn_prod_x',
    WAVE_WEBHOOK_SECRET: 'wave_sn_WHS_x',
  },
  { adaptateur: 'Wave' },
);

console.log(
  `\n${echoues === 0 ? 'TOUT PASSE' : 'DES CAS ÉCHOUENT'} — ${reussis} réussi(s), ${echoues} échoué(s)\n`,
);
process.exit(echoues === 0 ? 0 : 1);
