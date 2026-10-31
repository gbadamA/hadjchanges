/**
 * Contrôle de la vérification des webhooks Wave.
 *
 *   cd api && npx tsx ../scripts-verif/wave-signature-check.ts
 *
 * Le premier cas est le seul qui compte vraiment : il rejoue l'exemple SIGNÉ
 * PAR WAVE, publié dans sa documentation (corps exact dans
 * `wave-exemple-signe.json`, capté octet par octet depuis la page). S'il passe,
 * notre calcul est conforme au leur — pas seulement conforme à notre lecture de
 * leur prose.
 *
 * Les suivants sont les cas d'attaque : rejeu, corps modifié, mauvais secret,
 * corps re-sérialisé. Un webhook de paiement non vérifié laisse n'importe qui
 * déclarer une opération payée.
 */
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  SignatureInvalideError,
  verifierSignatureWave,
} from '../api/src/payments/wave.signature';

/** Exemple publié par Wave : secret, horodatage et signature vont ensemble. */
const SECRET = 'wave_sn_WHS_xz4m6g8rjs9bshxy05xj4khcvjv7j3hcp4fbpvv6met0zdrjvezg';
const T_PUBLIE = '1667920421';
const V1_PUBLIE = '53c971695230e9c51b1030d673eee76e70bbcdf8a7c5b8c1d44e0b8b1329647b';

// Résolu depuis ce fichier, pas depuis le dossier courant : le script se lance
// depuis `api/` (où vit tsx), donc un chemin relatif viserait à côté.
const CORPS = readFileSync(new URL('wave-exemple-signe.json', import.meta.url));
/** Au moment où Wave a émis l'exemple : sinon la fenêtre de rejeu le refuse. */
const ALORS = new Date(Number(T_PUBLIE) * 1000 + 2_000);

function signer(corps: Buffer, t: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(t, 'utf8').update(corps).digest('hex');
}

let reussis = 0;
let echoues = 0;

function accepte(nom: string, fn: () => void): void {
  try {
    fn();
    console.log(`  OK      ${nom}`);
    reussis++;
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    console.log(`  ECHEC   ${nom}\n            attendu : accepté, obtenu : ${detail}`);
    echoues++;
  }
}

function refuse(nom: string, codeAttendu: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ECHEC   ${nom}\n            attendu : refusé (${codeAttendu}), obtenu : ACCEPTÉ`);
    echoues++;
  } catch (cause) {
    const code = cause instanceof SignatureInvalideError ? cause.code : '(autre erreur)';
    if (code === codeAttendu) {
      console.log(`  OK      ${nom}  → ${code}`);
      reussis++;
    } else {
      console.log(`  ECHEC   ${nom}\n            attendu : ${codeAttendu}, obtenu : ${code}`);
      echoues++;
    }
  }
}

console.log(`\nCorps de l'exemple : ${CORPS.byteLength} octets\n`);

console.log('=== Conformité à l’exemple signé par Wave ===');
accepte("signature publiée par Wave sur son propre corps d'exemple", () =>
  verifierSignatureWave(CORPS, `t=${T_PUBLIE},v1=${V1_PUBLIE}`, SECRET, ALORS),
);
accepte('en-tête avec espaces superflus autour des valeurs', () =>
  verifierSignatureWave(CORPS, ` t=${T_PUBLIE} , v1=${V1_PUBLIE} `, SECRET, ALORS),
);

console.log('\n=== Le corps BRUT est indispensable ===');
refuse(
  'même JSON re-sérialisé en compact (ce que ferait un corps parsé)',
  'signature-refusee',
  () => {
    const compact = Buffer.from(JSON.stringify(JSON.parse(CORPS.toString('utf8'))), 'utf8');
    verifierSignatureWave(compact, `t=${T_PUBLIE},v1=${V1_PUBLIE}`, SECRET, ALORS);
  },
);
refuse('un seul octet du corps modifié', 'signature-refusee', () => {
  const altere = Buffer.from(CORPS);
  altere[altere.length - 3] ^= 0x01;
  verifierSignatureWave(altere, `t=${T_PUBLIE},v1=${V1_PUBLIE}`, SECRET, ALORS);
});
refuse('montant gonflé dans le corps, signature d’origine', 'signature-refusee', () => {
  const gonfle = Buffer.from(CORPS.toString('utf8').replace('"amount": "100"', '"amount": "999"'));
  verifierSignatureWave(gonfle, `t=${T_PUBLIE},v1=${V1_PUBLIE}`, SECRET, ALORS);
});

console.log('\n=== Fenêtre de rejeu (signature pourtant VALIDE) ===');
{
  const vieux = String(Math.floor(Date.now() / 1000) - 6 * 60);
  refuse('événement authentique de 6 minutes, rejoué', 'horodatage-expire', () =>
    verifierSignatureWave(CORPS, `t=${vieux},v1=${signer(CORPS, vieux)}`, SECRET),
  );
  const frais = String(Math.floor(Date.now() / 1000) - 30);
  accepte('événement authentique de 30 secondes', () =>
    verifierSignatureWave(CORPS, `t=${frais},v1=${signer(CORPS, frais)}`, SECRET),
  );
  const futur = String(Math.floor(Date.now() / 1000) + 5 * 60);
  refuse('horodatage 5 minutes dans le futur', 'horodatage-expire', () =>
    verifierSignatureWave(CORPS, `t=${futur},v1=${signer(CORPS, futur)}`, SECRET),
  );
  const derive = String(Math.floor(Date.now() / 1000) + 10);
  accepte('dérive d’horloge de 10 secondes vers le futur', () =>
    verifierSignatureWave(CORPS, `t=${derive},v1=${signer(CORPS, derive)}`, SECRET),
  );
}

console.log('\n=== Secret et rotation ===');
refuse('signé avec un autre secret', 'signature-refusee', () =>
  verifierSignatureWave(
    CORPS,
    `t=${T_PUBLIE},v1=${signer(CORPS, T_PUBLIE, 'wave_sn_WHS_autre')}`,
    SECRET,
    ALORS,
  ),
);
accepte('rotation : deux v1, seul le second est le nôtre', () =>
  verifierSignatureWave(
    CORPS,
    `t=${T_PUBLIE},v1=${signer(CORPS, T_PUBLIE, 'ancien_secret')},v1=${V1_PUBLIE}`,
    SECRET,
    ALORS,
  ),
);
refuse('rotation : aucun des deux v1 ne correspond', 'signature-refusee', () =>
  verifierSignatureWave(
    CORPS,
    `t=${T_PUBLIE},v1=${signer(CORPS, T_PUBLIE, 'a')},v1=${signer(CORPS, T_PUBLIE, 'b')}`,
    SECRET,
    ALORS,
  ),
);

console.log('\n=== En-têtes malformés ===');
refuse('en-tête absent', 'signature-absente', () =>
  verifierSignatureWave(CORPS, undefined, SECRET, ALORS),
);
refuse('en-tête vide', 'signature-absente', () => verifierSignatureWave(CORPS, '   ', SECRET, ALORS));
refuse('horodatage manquant', 'format-invalide', () =>
  verifierSignatureWave(CORPS, `v1=${V1_PUBLIE}`, SECRET, ALORS),
);
refuse('signature manquante', 'format-invalide', () =>
  verifierSignatureWave(CORPS, `t=${T_PUBLIE}`, SECRET, ALORS),
);
refuse('horodatage non numérique', 'format-invalide', () =>
  verifierSignatureWave(CORPS, `t=hier,v1=${V1_PUBLIE}`, SECRET, ALORS),
);
refuse('signature de bonne longueur mais fausse', 'signature-refusee', () =>
  verifierSignatureWave(CORPS, `t=${T_PUBLIE},v1=${'0'.repeat(64)}`, SECRET, ALORS),
);
refuse('signature tronquée (longueurs différentes)', 'signature-refusee', () =>
  verifierSignatureWave(CORPS, `t=${T_PUBLIE},v1=${V1_PUBLIE.slice(0, 32)}`, SECRET, ALORS),
);

console.log(
  `\n${echoues === 0 ? 'TOUT PASSE' : 'DES CAS ÉCHOUENT'} — ${reussis} réussi(s), ${echoues} échoué(s)\n`,
);
process.exit(echoues === 0 ? 0 : 1);
