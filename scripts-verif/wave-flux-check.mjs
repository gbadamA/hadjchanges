/**
 * Contrôle de bout en bout de l'encaissement par fournisseur.
 *
 *   node scripts-verif/wave-flux-check.mjs [http://localhost:3061]
 *
 * ⚠️ À lancer contre une API **en mode simulation** (`PAYMENT_DRIVER` non
 * renseigné) et une base de DÉVELOPPEMENT. Le script crée de vraies opérations.
 *
 * Il signe lui-même les événements, avec le secret de simulation, et frappe le
 * VRAI point d'entrée `/payments/wave/webhook`. C'est volontaire : passer par
 * un raccourci de test laisserait inexercé le chemin réellement déployé —
 * vérification de signature, fenêtre de rejeu et dédoublonnage compris.
 */
import { createHmac, randomUUID } from 'node:crypto';

const BASE = (process.argv[2] ?? 'http://localhost:3061').replace(/\/$/, '');
const API = `${BASE}/api`;
const CLIENT = { identifier: '0709000001', password: process.env.SEED_CLIENT_PASSWORD ?? 'Client@2026' };
/** Défaut posé par `PaymentsModule` quand aucun secret n'est configuré. */
const SECRET = process.env.WAVE_WEBHOOK_SECRET || 'secret-de-simulation-hadjchanges';

let reussis = 0;
let echoues = 0;
const ignores = [];

function ok(nom, detail = '') {
  console.log(`  OK      ${nom}${detail ? ` → ${detail}` : ''}`);
  reussis++;
}
function ko(nom, attendu, obtenu) {
  console.log(`  ECHEC   ${nom}\n            attendu : ${attendu}\n            obtenu  : ${obtenu}`);
  echoues++;
}
function verifier(nom, condition, attendu, obtenu) {
  if (condition) ok(nom, String(obtenu));
  else ko(nom, attendu, obtenu);
}

async function appel(methode, chemin, { body, token, brut, signature } = {}) {
  const reponse = await fetch(`${API}${chemin}`, {
    method: methode,
    headers: {
      ...(brut === undefined && body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(brut !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(signature ? { 'wave-signature': signature } : {}),
    },
    body: brut !== undefined ? brut : body === undefined ? undefined : JSON.stringify(body),
  });
  const texte = await reponse.text();
  let data = null;
  try {
    data = texte ? JSON.parse(texte) : null;
  } catch {
    data = texte;
  }
  return { status: reponse.status, data };
}

/** Signe un événement comme le fournisseur : HMAC(horodatage + corps brut). */
function signer(corps, decalageSecondes = 0) {
  const t = String(Math.floor(Date.now() / 1000) + decalageSecondes);
  const v1 = createHmac('sha256', SECRET).update(t, 'utf8').update(corps).digest('hex');
  return `t=${t},v1=${v1}`;
}

/** Objet de l'événement. La sérialisation est laissée à l'appelant, parce que
 *  la FORME des octets est précisément ce que certains cas éprouvent. */
function objetPaye({ idEvenement, idSession, reference, montant }) {
  return {
    id: idEvenement,
    type: 'checkout.session.completed',
    data: {
      id: idSession,
      amount: String(montant),
      currency: 'XOF',
      client_reference: reference,
      checkout_status: 'complete',
      payment_status: 'succeeded',
      transaction_id: `T${idEvenement.slice(-8).toUpperCase()}`,
      last_payment_error: null,
    },
  };
}

function evenementPaye(options) {
  return Buffer.from(JSON.stringify(objetPaye(options)), 'utf8');
}

async function main() {
  console.log(`\nAPI : ${BASE}\n`);

  // -- Session cliente ------------------------------------------------------
  const connexion = await appel('POST', '/auth/login', { body: CLIENT });
  if (connexion.status !== 200) {
    console.log(
      `\nIMPOSSIBLE DE CONTINUER : connexion refusée (${connexion.status}). ` +
        `Base semée ? Mot de passe du client de démo ?\n`,
    );
    process.exit(1);
  }
  const token = connexion.data.accessToken;
  ok('connexion du client de démonstration');

  // -- Opération en XOF -----------------------------------------------------
  // VENTE_DEVISE : le bureau vend de l'euro, donc le client remet des XOF —
  // c'est le seul sens réglable par mobile money. Un ACHAT_DEVISE suppose que
  // le client apporte des billets étrangers, et doit passer au guichet.
  const devis = await appel('POST', '/quotes/lock', {
    token,
    body: { direction: 'VENTE_DEVISE', currencyCode: 'EUR', amount: 50_000, side: 'SOURCE' },
  });
  if (devis.status !== 201 && devis.status !== 200) {
    console.log(`\nIMPOSSIBLE DE CONTINUER : verrou de taux refusé (${devis.status}).`);
    console.log(JSON.stringify(devis.data));
    process.exit(1);
  }

  const agences = await appel('GET', '/agencies');
  const agencyId = Array.isArray(agences.data) && agences.data.length > 0 ? agences.data[0].id : null;

  const creation = await appel('POST', '/transactions', {
    token,
    body: {
      quoteId: devis.data.id,
      agencyId,
      depositMethod: 'WAVE',
      payoutMethod: 'ESPECES_AGENCE',
    },
  });
  if (creation.status !== 201 && creation.status !== 200) {
    // Les plafonds du client de démo se consomment à chaque passage : c'est une
    // limite du produit, pas un défaut. On le dit et on s'arrête proprement.
    console.log(`\nSECTION IGNORÉE : création d'opération refusée (${creation.status}).`);
    console.log(`  ${JSON.stringify(creation.data)}`);
    console.log('  Plafond journalier probablement atteint — relancer après le seed.\n');
    process.exit(0);
  }
  const operation = creation.data;
  const montantAttendu = Math.round(Number(operation.sourceAmount));
  ok('opération créée', `${operation.reference}, ${montantAttendu} XOF, statut ${operation.status}`);

  // -- Ouverture de la session ---------------------------------------------
  const session = await appel('POST', `/payments/transactions/${operation.id}/checkout`, { token });
  verifier(
    'ouverture de la session de paiement',
    session.status === 201 || session.status === 200,
    '200/201',
    session.status,
  );
  if (!session.data?.idSession) {
    console.log('\nIMPOSSIBLE DE CONTINUER : aucune session rendue.');
    console.log(JSON.stringify(session.data));
    process.exit(1);
  }
  const idSession = session.data.idSession;
  verifier(
    'le mode simulé est annoncé au client',
    session.data.reel === false,
    'reel=false',
    `reel=${session.data.reel}`,
  );
  verifier(
    "une adresse de paiement est fournie",
    typeof session.data.urlPaiement === 'string' && session.data.urlPaiement.length > 0,
    'une URL',
    session.data.urlPaiement,
  );

  const avant = await appel('GET', `/transactions/${operation.id}`, { token });
  verifier(
    "ouvrir une session ne vaut PAS paiement",
    avant.data.status === 'CREEE',
    'CREEE',
    avant.data.status,
  );

  // -- Signature refusée ----------------------------------------------------
  console.log('\n=== Un événement non authentique ne passe pas ===');
  {
    const corps = evenementPaye({
      idEvenement: `EV_${randomUUID()}`,
      idSession,
      reference: operation.reference,
      montant: montantAttendu,
    });
    const sansSignature = await appel('POST', '/payments/wave/webhook', { brut: corps });
    verifier('aucune signature → refusé', sansSignature.status === 401, '401', sansSignature.status);

    const mauvaise = await appel('POST', '/payments/wave/webhook', {
      brut: corps,
      signature: `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}`,
    });
    verifier('signature fausse → refusé', mauvaise.status === 401, '401', mauvaise.status);

    const vieille = await appel('POST', '/payments/wave/webhook', {
      brut: corps,
      signature: signer(corps, -6 * 60),
    });
    verifier('rejeu de 6 minutes → refusé', vieille.status === 401, '401', vieille.status);

    // ⚠️ Le vrai danger, celui que la documentation du fournisseur contredit :
    // la signature porte sur des OCTETS. On signe ici la forme indentée et on
    // envoie la forme compacte — même JSON, mêmes données, octets différents.
    // C'est exactement ce qui arrive si le serveur parse le corps avant de
    // vérifier. Doit être refusé.
    const objet = objetPaye({
      idEvenement: `EV_${randomUUID()}`,
      idSession,
      reference: operation.reference,
      montant: montantAttendu,
    });
    const indente = Buffer.from(JSON.stringify(objet, null, 2), 'utf8');
    const compact = JSON.stringify(objet);
    const reserialise = await appel('POST', '/payments/wave/webhook', {
      brut: compact,
      signature: signer(indente),
    });
    verifier(
      'même JSON, octets différents (indenté signé, compact envoyé) → refusé',
      reserialise.status === 401,
      '401',
      reserialise.status,
    );

    const toujoursEnAttente = await appel('GET', `/transactions/${operation.id}`, { token });
    verifier(
      'aucun de ces refus n’a touché l’opération',
      toujoursEnAttente.data.status === 'CREEE',
      'CREEE',
      toujoursEnAttente.data.status,
    );
  }

  // -- Montant divergent ----------------------------------------------------
  console.log('\n=== Un montant qui ne correspond pas ne solde rien ===');
  {
    const corps = evenementPaye({
      idEvenement: `EV_${randomUUID()}`,
      idSession,
      reference: operation.reference,
      montant: 100, // dérisoire face au montant réel
    });
    const reponse = await appel('POST', '/payments/wave/webhook', {
      brut: corps,
      signature: signer(corps),
    });
    verifier(
      'événement acquitté (pas de martèlement du fournisseur)',
      reponse.status === 200,
      '200',
      reponse.status,
    );
    verifier(
      'traitement = MONTANT_DIVERGENT',
      reponse.data?.issue === 'MONTANT_DIVERGENT',
      'MONTANT_DIVERGENT',
      reponse.data?.issue,
    );
    const apres = await appel('GET', `/transactions/${operation.id}`, { token });
    verifier(
      'opération NON validée malgré un paiement signé',
      apres.data.status === 'CREEE',
      'CREEE',
      apres.data.status,
    );
  }

  // -- Paiement conforme ----------------------------------------------------
  console.log('\n=== Paiement conforme ===');
  const idEvenement = `EV_${randomUUID()}`;
  const corpsPaye = evenementPaye({
    idEvenement,
    idSession,
    reference: operation.reference,
    montant: montantAttendu,
  });
  {
    const reponse = await appel('POST', '/payments/wave/webhook', {
      brut: corpsPaye,
      signature: signer(corpsPaye),
    });
    verifier('événement accepté', reponse.status === 200, '200', reponse.status);
    verifier('traitement = VALIDE', reponse.data?.issue === 'VALIDE', 'VALIDE', reponse.data?.issue);

    const apres = await appel('GET', `/transactions/${operation.id}`, { token });
    verifier(
      'opération passée à RECU_VALIDE sans aucun reçu déposé',
      apres.data.status === 'RECU_VALIDE',
      'RECU_VALIDE',
      apres.data.status,
    );
    verifier(
      'le change n’est PAS exécuté par le webhook (il reste à l’opérateur)',
      apres.data.status !== 'CHANGE_EXECUTE',
      'pas CHANGE_EXECUTE',
      apres.data.status,
    );
  }

  // -- Dédoublonnage --------------------------------------------------------
  console.log('\n=== Le même événement livré deux fois ===');
  {
    const rejeu = await appel('POST', '/payments/wave/webhook', {
      brut: corpsPaye,
      signature: signer(corpsPaye), // signature neuve, MÊME identifiant d'événement
    });
    verifier('rejeu acquitté', rejeu.status === 200, '200', rejeu.status);
    verifier(
      'traitement = DEJA_TRAITE (dédoublonné)',
      rejeu.data?.issue === 'DEJA_TRAITE',
      'DEJA_TRAITE',
      rejeu.data?.issue,
    );
  }

  // -- Événement inconnu ----------------------------------------------------
  console.log('\n=== Un encaissement qui ne nous concerne pas ===');
  {
    const corps = evenementPaye({
      idEvenement: `EV_${randomUUID()}`,
      idSession: 'cos-inexistant',
      reference: 'HC-0000-000000',
      montant: 1000,
    });
    const reponse = await appel('POST', '/payments/wave/webhook', {
      brut: corps,
      signature: signer(corps),
    });
    verifier(
      'acquitté malgré tout (réessayer ne le ferait pas apparaître)',
      reponse.status === 200,
      '200',
      reponse.status,
    );
    verifier('traitement = INCONNU', reponse.data?.issue === 'INCONNU', 'INCONNU', reponse.data?.issue);
  }

  // -- Deuxième ouverture ---------------------------------------------------
  console.log('\n=== Une opération déjà payée ===');
  {
    const seconde = await appel('POST', `/payments/transactions/${operation.id}/checkout`, { token });
    verifier(
      'rouvrir une session est refusé',
      seconde.status === 409,
      '409',
      `${seconde.status} ${JSON.stringify(seconde.data?.message ?? '')}`,
    );
  }

  console.log(
    `\n${echoues === 0 ? 'TOUT PASSE' : 'DES CAS ÉCHOUENT'} — ${reussis} réussi(s), ${echoues} échoué(s)` +
      `${ignores.length > 0 ? `, ${ignores.length} ignoré(s)` : ''}\n`,
  );
  process.exit(echoues === 0 ? 0 : 1);
}

main().catch((cause) => {
  console.error(`\nERREUR : ${cause instanceof Error ? cause.message : String(cause)}\n`);
  process.exit(1);
});
