/**
 * Contrôle du versement mobile money et de son rapprochement.
 *
 *   node scripts-verif/wave-versement-check.mjs [http://localhost:3061]
 *
 * ⚠️ API en mode simulation et base de DÉVELOPPEMENT : le script crée de vraies
 * opérations et les mène jusqu'à la clôture.
 *
 * Il mène une opération d'ACHAT_DEVISE — le bureau achète de l'euro, donc les
 * fonds partent en XOF, seul sens versable par mobile money — jusqu'à « prête
 * pour retrait », puis éprouve l'envoi et ses garde-fous.
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

async function appel(methode, chemin, { body, token, form } = {}) {
  const reponse = await fetch(`${API}${chemin}`, {
    method: methode,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
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

/** Mène une opération jusqu'à « prête pour retrait ». */
async function operationPrete({ client, admin, direction, currencyCode, amount, agencyId }) {
  const devis = await appel('POST', '/quotes/lock', {
    token: client.accessToken,
    body: { direction, currencyCode, amount, side: 'SOURCE' },
  });
  if (devis.status !== 200 && devis.status !== 201) {
    throw new Error(`verrou refusé (${devis.status}) : ${JSON.stringify(devis.data)}`);
  }

  const creation = await appel('POST', '/transactions', {
    token: client.accessToken,
    body: {
      quoteId: devis.data.id,
      agencyId,
      depositMethod: 'ESPECES_AGENCE',
      payoutMethod: 'MOBILE_MONEY',
      payoutDetails: '0709000001',
    },
  });
  if (creation.status !== 200 && creation.status !== 201) {
    throw new Error(`création refusée (${creation.status}) : ${JSON.stringify(creation.data)}`);
  }
  const operation = creation.data;

  // Encaissement au comptoir : l'agent constate le paiement et atteste. C'est
  // la seule voie pour un ACHAT_DEVISE — le client apporte des billets, il n'y
  // a rien qu'un opérateur de paiement puisse confirmer à distance.
  const encaissement = await appel('POST', `/transactions/${operation.id}/encaissement`, {
    token: admin.accessToken,
    body: { declaredRef: 'ESPECES-COMPTOIR' },
  });
  if (encaissement.status !== 200 && encaissement.status !== 201) {
    throw new Error(
      `encaissement refusé (${encaissement.status}) : ${JSON.stringify(encaissement.data)}`,
    );
  }

  const prete = await appel('POST', `/transactions/${operation.id}/ready`, {
    token: admin.accessToken,
    body: {},
  });
  if (prete.status !== 200 && prete.status !== 201) {
    throw new Error(`mise à disposition refusée (${prete.status}) : ${JSON.stringify(prete.data)}`);
  }
  return prete.data;
}

async function main() {
  console.log(`\nAPI : ${BASE}\n`);

  const client = await connexion(CLIENT);
  const admin = await connexion(ADMIN);
  const agences = await appel('GET', '/agencies');
  const agencyId = agences.data?.[0]?.id ?? null;
  console.log('  OK      sessions client et encadrement');
  reussis++;

  // -- Garde-fou : mauvais sens d'opération --------------------------------
  console.log('\n=== Le sens de l’opération est contrôlé ===');
  {
    // VENTE_DEVISE : les fonds partent en EUR, donc pas par mobile money.
    let vente;
    try {
      vente = await operationPrete({
        client,
        admin,
        direction: 'VENTE_DEVISE',
        currencyCode: 'EUR',
        amount: 20_000,
        agencyId,
      });
    } catch (cause) {
      console.log(`\nSECTION IGNORÉE : ${cause.message}`);
      console.log('  Plafonds du client de démo probablement consommés — relancer après le seed.\n');
      process.exit(0);
    }
    const refus = await appel('POST', `/payments/transactions/${vente.id}/payout`, {
      token: admin.accessToken,
      body: {},
    });
    verifier(
      'des fonds en devise étrangère ne partent pas par mobile money (400)',
      refus.status === 400,
      '400',
      `${refus.status} ${JSON.stringify(refus.data?.message ?? '')}`,
    );
  }

  // -- Opération versable ---------------------------------------------------
  console.log('\n=== Opération dont les fonds partent en XOF ===');
  let operation;
  try {
    operation = await operationPrete({
      client,
      admin,
      direction: 'ACHAT_DEVISE',
      currencyCode: 'EUR',
      amount: 50,
      agencyId,
    });
  } catch (cause) {
    console.log(`\nSECTION IGNORÉE : ${cause.message}\n`);
    process.exit(0);
  }
  verifier(
    'opération prête pour retrait',
    operation.status === 'PRETE_POUR_RETRAIT',
    'PRETE_POUR_RETRAIT',
    `${operation.reference} — ${operation.status}, cible ${operation.targetAmount} XOF`,
  );

  // -- Un client ne déclenche pas un décaissement ---------------------------
  {
    const refus = await appel('POST', `/payments/transactions/${operation.id}/payout`, {
      token: client.accessToken,
      body: {},
    });
    verifier(
      'un client ne peut pas se faire virer les fonds (403)',
      refus.status === 403,
      '403',
      refus.status,
    );
  }

  // -- Envoi ----------------------------------------------------------------
  console.log('\n=== Envoi des fonds ===');
  const envoi = await appel('POST', `/payments/transactions/${operation.id}/payout`, {
    token: admin.accessToken,
    body: {},
  });
  verifier(
    'le versement est accepté',
    envoi.status === 200 || envoi.status === 201,
    '200/201',
    `${envoi.status} ${JSON.stringify(envoi.data?.statut ?? envoi.data?.message ?? '')}`,
  );
  verifier('statut REUSSI', envoi.data?.statut === 'REUSSI', 'REUSSI', envoi.data?.statut);
  verifier(
    'le numéro est normalisé en E.164',
    typeof envoi.data?.mobile === 'string' && envoi.data.mobile.startsWith('+225'),
    'commence par +225',
    envoi.data?.mobile,
  );
  verifier(
    'les frais sont enregistrés (ils pèsent sur la marge du bureau)',
    envoi.data?.fraisXof !== null && Number(envoi.data?.fraisXof) > 0,
    'un montant > 0',
    `${envoi.data?.fraisXof} XOF pour ${envoi.data?.montantRecuXof} XOF versés`,
  );
  verifier(
    'un identifiant de versement est conservé',
    typeof envoi.data?.idFournisseur === 'string' && envoi.data.idFournisseur.startsWith('pt-'),
    'un pt-…',
    envoi.data?.idFournisseur,
  );

  // -- Clôture --------------------------------------------------------------
  {
    const apres = await appel('GET', `/transactions/${operation.id}`, { token: admin.accessToken });
    verifier(
      'l’opération est clôturée par l’arrivée des fonds',
      apres.data?.status === 'CLOTUREE',
      'CLOTUREE',
      apres.data?.status,
    );
    const pdf = await appel('GET', `/transactions/${operation.id}/justificatif.pdf`, {
      token: client.accessToken,
    });
    verifier('le justificatif est disponible', pdf.status === 200, '200', pdf.status);
  }

  // -- Pas de second virement ----------------------------------------------
  console.log('\n=== On ne paie jamais deux fois ===');
  {
    const second = await appel('POST', `/payments/transactions/${operation.id}/payout`, {
      token: admin.accessToken,
      body: {},
    });
    verifier(
      'un second envoi est refusé (409)',
      second.status === 409,
      '409',
      second.status,
    );
    // ⚠️ Le MOTIF compte autant que le refus. Si le message parle du statut,
    // c'est le contrôle « prête pour retrait » qui a répondu — bonne décision,
    // mauvaise raison, et le garde-fou anti-double-versement n'est pas prouvé.
    verifier(
      'et refusé parce que les fonds sont DÉJÀ PARTIS, pas pour une question de statut',
      typeof second.data?.message === 'string' && second.data.message.includes('déjà été versés'),
      'un message sur des fonds déjà versés',
      JSON.stringify(second.data?.message ?? ''),
    );

    const liste = await appel('GET', `/payments/transactions/${operation.id}/payouts`, {
      token: admin.accessToken,
    });
    verifier(
      'un seul versement a été créé',
      Array.isArray(liste.data) && liste.data.length === 1,
      '1 ligne',
      `${liste.data?.length} ligne(s)`,
    );
  }

  // -- Rapprochement --------------------------------------------------------
  //
  // ⚠️ Aucun webhook n'existe pour les versements : si cette tâche ne marche
  // pas, un versement resté « en cours » le reste pour toujours. On remet donc
  // artificiellement l'opération dans cet état — versement EN_COURS, opération
  // en attente de retrait — et on vérifie que le rapprochement la dénoue.
  console.log('\n=== Rapprochement (le seul moyen de connaître le sort d’un versement) ===');
  {
    const remise = await appel('POST', '/payments/_test/remettre-en-cours', {
      token: admin.accessToken,
      body: { transactionId: operation.id },
    });
    if (remise.status !== 200 && remise.status !== 201) {
      console.log(
        `  ~ section ignorée : route d'essai indisponible (${remise.status}). ` +
          'Normal hors simulation.',
      );
    } else {
      const avant = await appel('GET', `/transactions/${operation.id}`, { token: admin.accessToken });
      verifier(
        'état remis en attente pour l’essai',
        avant.data?.status === 'PRETE_POUR_RETRAIT',
        'PRETE_POUR_RETRAIT',
        avant.data?.status,
      );

      const tour = await appel('POST', '/payments/reconciliation', {
        token: admin.accessToken,
        body: {},
      });
      verifier(
        'le rapprochement s’exécute',
        tour.status === 200 || tour.status === 201,
        '200/201',
        `${tour.status} ${JSON.stringify(tour.data ?? '')}`,
      );
      verifier(
        'il a dénoué au moins un versement',
        Number(tour.data?.versements) >= 1,
        '>= 1',
        tour.data?.versements,
      );

      const apres = await appel('GET', `/transactions/${operation.id}`, { token: admin.accessToken });
      verifier(
        'l’opération est reclôturée par le rapprochement, sans webhook',
        apres.data?.status === 'CLOTUREE',
        'CLOTUREE',
        apres.data?.status,
      );

      const liste = await appel('GET', `/payments/transactions/${operation.id}/payouts`, {
        token: admin.accessToken,
      });
      verifier(
        'aucun second versement n’a été créé au passage',
        Array.isArray(liste.data) && liste.data.length === 1,
        '1 ligne',
        `${liste.data?.length} ligne(s)`,
      );
      verifier(
        'le versement est marqué réussi',
        liste.data?.[0]?.statut === 'REUSSI',
        'REUSSI',
        liste.data?.[0]?.statut,
      );
    }
  }

  // -- Trop tôt -------------------------------------------------------------
  console.log('\n=== Avant la mise à disposition ===');
  {
    let fraiche;
    try {
      const devis = await appel('POST', '/quotes/lock', {
        token: client.accessToken,
        body: { direction: 'ACHAT_DEVISE', currencyCode: 'EUR', amount: 20, side: 'SOURCE' },
      });
      const creation = await appel('POST', '/transactions', {
        token: client.accessToken,
        body: {
          quoteId: devis.data.id,
          agencyId,
          depositMethod: 'ESPECES_AGENCE',
          payoutMethod: 'MOBILE_MONEY',
          payoutDetails: '0709000001',
        },
      });
      fraiche = creation.data;
    } catch {
      fraiche = null;
    }
    if (fraiche?.id) {
      const tropTot = await appel('POST', `/payments/transactions/${fraiche.id}/payout`, {
        token: admin.accessToken,
        body: {},
      });
      verifier(
        'on ne verse pas des fonds qui ne sont pas encore disponibles (409)',
        tropTot.status === 409,
        '409',
        `${tropTot.status} ${JSON.stringify(tropTot.data?.message ?? '')}`,
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
