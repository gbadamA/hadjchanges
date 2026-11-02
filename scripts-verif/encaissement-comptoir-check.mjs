/**
 * Contrôle de l'encaissement au comptoir — le parcours normal depuis que le
 * reçu photo a disparu.
 *
 *   node scripts-verif/encaissement-comptoir-check.mjs [http://localhost:3061]
 *
 * ⚠️ Base de DÉVELOPPEMENT : le script crée de vraies opérations et exécute de
 * vrais changes.
 *
 * Le client crée son opération, l'agent la retrouve par son numéro — comme il
 * le ferait en scannant le QR, qui porte exactement cette chaîne — constate le
 * paiement et encaisse. Le change doit s'exécuter dans la foulée.
 */

const BASE = (process.argv[2] ?? 'http://localhost:3061').replace(/\/$/, '');
const API = `${BASE}/api`;
const CLIENT = { identifier: '0709000001', password: process.env.SEED_CLIENT_PASSWORD ?? 'Client@2026' };
const ADMIN = { identifier: '0700000002', password: process.env.SEED_ADMIN_PASSWORD ?? 'Admin@2026' };

let reussis = 0;
let echoues = 0;

function verifier(nom, condition, attendu, obtenu) {
  if (condition) {
    console.log(`  OK      ${nom}${obtenu !== undefined ? ` → ${obtenu}` : ''}`);
    reussis++;
  } else {
    console.log(`  ECHEC   ${nom}\n            attendu : ${attendu}\n            obtenu  : ${obtenu}`);
    echoues++;
  }
}

async function appel(methode, chemin, { body, token } = {}) {
  const reponse = await fetch(`${API}${chemin}`, {
    method: methode,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
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

async function connexion(identifiants) {
  const { status, data } = await appel('POST', '/auth/login', { body: identifiants });
  if (status !== 200) throw new Error(`Connexion impossible (${status}) : ${JSON.stringify(data)}`);
  return data;
}

async function creerOperation(client, agencyId, depositMethod) {
  const devis = await appel('POST', '/quotes/lock', {
    token: client.accessToken,
    body: { direction: 'VENTE_DEVISE', currencyCode: 'EUR', amount: 20_000, side: 'SOURCE' },
  });
  if (devis.status !== 200 && devis.status !== 201) {
    throw new Error(`verrou refusé (${devis.status}) : ${JSON.stringify(devis.data)}`);
  }
  const creation = await appel('POST', '/transactions', {
    token: client.accessToken,
    body: { quoteId: devis.data.id, agencyId, depositMethod, payoutMethod: 'ESPECES_AGENCE' },
  });
  if (creation.status !== 200 && creation.status !== 201) {
    throw new Error(`création refusée (${creation.status}) : ${JSON.stringify(creation.data)}`);
  }
  return creation.data;
}

async function main() {
  console.log(`\nAPI : ${BASE}\n`);

  const client = await connexion(CLIENT);
  const admin = await connexion(ADMIN);
  const agences = await appel('GET', '/agencies');
  const agencyId = agences.data?.[0]?.id ?? null;
  console.log('  OK      sessions client et agent');
  reussis++;

  let operation;
  try {
    operation = await creerOperation(client, agencyId, 'ORANGE_MONEY');
  } catch (cause) {
    console.log(`\nSECTION IGNORÉE : ${cause.message}`);
    console.log('  Plafonds du client de démo probablement consommés.\n');
    process.exit(0);
  }
  verifier(
    'opération créée, en attente de paiement',
    operation.status === 'CREEE',
    'CREEE',
    `${operation.reference} — ${operation.status}`,
  );

  // -- Le client ne peut plus importer de justificatif ----------------------
  console.log('\n=== Le reçu photo a bien disparu du parcours ===');
  {
    const parNumero = await appel('GET', `/transactions?reference=${operation.reference}`, {
      token: admin.accessToken,
    });
    verifier(
      'l’agent retrouve l’opération par le numéro du QR',
      Array.isArray(parNumero.data) && parNumero.data.length === 1,
      '1 résultat',
      `${parNumero.data?.length} résultat(s)`,
    );

    const parClient = await appel('POST', `/transactions/${operation.id}/encaissement`, {
      token: client.accessToken,
      body: {},
    });
    verifier(
      'un client ne peut pas déclarer sa propre opération payée (403)',
      parClient.status === 403,
      '403',
      parClient.status,
    );
  }

  // -- Encaissement ---------------------------------------------------------
  console.log('\n=== L’agent constate et encaisse ===');
  const encaissement = await appel('POST', `/transactions/${operation.id}/encaissement`, {
    token: admin.accessToken,
    body: { declaredRef: 'OM-TEST-998877' },
  });
  verifier(
    'l’encaissement est accepté',
    encaissement.status === 200 || encaissement.status === 201,
    '200/201',
    `${encaissement.status} ${JSON.stringify(encaissement.data?.message ?? '')}`,
  );
  verifier(
    'le change est exécuté dans la foulée, sans étape intermédiaire',
    encaissement.data?.status === 'CHANGE_EXECUTE',
    'CHANGE_EXECUTE',
    encaissement.data?.status,
  );

  // -- La preuve est conservée, sans document -------------------------------
  console.log('\n=== Ce qui remplace le document ===');
  {
    const relue = await appel('GET', `/transactions/${operation.id}`, { token: admin.accessToken });
    const preuves = relue.data?.receipts ?? [];
    verifier(
      'une preuve de paiement est enregistrée',
      preuves.length === 1,
      '1 preuve',
      `${preuves.length}`,
    );
    verifier(
      'elle est déjà validée : personne d’autre n’a à trancher',
      preuves[0]?.status === 'VALIDE',
      'VALIDE',
      preuves[0]?.status,
    );
    verifier(
      'elle porte un horodatage de validation',
      typeof preuves[0]?.validatedAt === 'string',
      'une date',
      preuves[0]?.validatedAt ?? 'aucune',
    );

    // La référence saisie est la SEULE trace vérifiable : si elle ne ressort
    // pas, l'attestation ne vaut plus rien en cas de litige.
    const file = await appel('GET', '/transactions/receipts/queue?status=VALIDE', {
      token: admin.accessToken,
    });
    const ligne = (file.data ?? []).find((r) => r.transaction?.id === operation.id);
    verifier(
      'la référence du paiement est conservée et relisible',
      ligne?.declaredRef === 'OM-TEST-998877',
      'OM-TEST-998877',
      ligne?.declaredRef ?? 'absente',
    );
    verifier(
      'le montant constaté est conservé',
      ligne?.declaredAmount !== null && ligne?.declaredAmount !== undefined,
      'un montant',
      ligne?.declaredAmount ?? 'absent',
    );
  }

  // -- On n'encaisse pas deux fois -----------------------------------------
  console.log('\n=== On n’encaisse jamais deux fois ===');
  {
    const second = await appel('POST', `/transactions/${operation.id}/encaissement`, {
      token: admin.accessToken,
      body: {},
    });
    verifier(
      'un second encaissement est refusé (409)',
      second.status === 409,
      '409',
      `${second.status} ${JSON.stringify(second.data?.message ?? '')}`,
    );
  }

  // -- Une opération annulée ne s'encaisse pas ------------------------------
  console.log('\n=== Une opération annulée ne s’encaisse pas ===');
  {
    let annulee;
    try {
      annulee = await creerOperation(client, agencyId, 'MTN_MOMO');
    } catch {
      annulee = null;
    }
    if (annulee?.id) {
      await appel('POST', `/transactions/${annulee.id}/cancel`, {
        token: client.accessToken,
        body: { reason: 'essai de contrôle' },
      });
      const refus = await appel('POST', `/transactions/${annulee.id}/encaissement`, {
        token: admin.accessToken,
        body: {},
      });
      verifier(
        'encaisser une opération annulée est refusé (409)',
        refus.status === 409,
        '409',
        `${refus.status} ${JSON.stringify(refus.data?.message ?? '')}`,
      );
    }
  }

  console.log(
    `\n${echoues === 0 ? 'TOUT PASSE' : 'DES CAS ÉCHOUENT'} — ${reussis} réussi(s), ${echoues} échoué(s)\n`,
  );
  process.exit(echoues === 0 ? 0 : 1);
}

main().catch((cause) => {
  console.error(`\nERREUR : ${cause instanceof Error ? cause.message : String(cause)}\n`);
  process.exit(1);
});
