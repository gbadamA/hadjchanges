/**
 * Vérification exécutable de l'API HadjChanges — brique 1 (socle).
 *
 * Ce script vérifie la FORME et la COHÉRENCE, jamais des valeurs de contenu qui
 * bougeront (le nombre de devises, le taux de l'euro du jour…). Un script qui
 * crie au loup à chaque changement de données ne sert plus à rien.
 *
 * Usage : node scripts-verif/api-check.mjs [http://localhost:3061]
 */

const BASE = (process.argv[2] ?? 'http://localhost:3061').replace(/\/$/, '');
const API = `${BASE}/api`;

const ADMIN = { identifier: '0700000002', password: process.env.SEED_ADMIN_PASSWORD ?? 'Admin@2026' };
const OPERATEUR = { identifier: '0700000003', password: process.env.SEED_ADMIN_PASSWORD ?? 'Admin@2026' };
const CLIENT = { identifier: '0709000001', password: process.env.SEED_CLIENT_PASSWORD ?? 'Client@2026' };

let passed = 0;
let failed = 0;
let skipped = 0;

const check = (label, condition, detail = '') => {
  if (condition) {
    passed += 1;
    console.log(`  ✔ ${label}`);
  } else {
    failed += 1;
    console.log(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

const skip = (label, why) => {
  skipped += 1;
  console.log(`  ~ ${label} — ignoré (${why})`);
};

const section = (title) => console.log(`\n${title}`);

async function call(method, path, { token, body } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data };
}

/** Dépôt multipart — le KYC et les reçus passent par des fichiers, pas du JSON. */
async function upload(path, { token, fields = {}, files = {} }) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, String(value));
  for (const [key, file] of Object.entries(files)) {
    form.append(key, new Blob([file.content], { type: file.type }), file.name);
  }
  const response = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: form,
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data };
}

/** PNG 1×1 valide — assez pour prouver la chaîne de dépôt sans embarquer d'image. */
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const login = async (credentials) => {
  const { status, data } = await call('POST', '/auth/login', { body: credentials });
  if (status !== 200) throw new Error(`Connexion impossible (${status}) : ${JSON.stringify(data)}`);
  return data;
};

async function main() {
  console.log(`Vérification de ${API}\n${'='.repeat(60)}`);

  // ---------------------------------------------------------------- santé --
  section('Santé et accès public');
  {
    const { status, data } = await call('GET', '/health');
    check('GET /health répond 200', status === 200, `reçu ${status}`);
    check('la base est joignable', data?.database === 'ok', String(data?.database));
  }

  // -------------------------------------------------------------- devises --
  {
    const { status, data } = await call('GET', '/currencies');
    check('GET /currencies est public', status === 200, `reçu ${status}`);
    check('au moins une devise active', Array.isArray(data) && data.length > 0);
    const bases = (data ?? []).filter((currency) => currency.isBase);
    check('exactement une devise de référence', bases.length === 1, `trouvé ${bases.length}`);
    check(
      'la devise de référence a 0 décimale (XOF)',
      bases[0]?.decimals === 0,
      `décimales = ${bases[0]?.decimals}`,
    );
  }

  // ------------------------------------------------------------- agences ---
  let agencies = [];
  {
    const { status, data } = await call('GET', '/agencies');
    agencies = Array.isArray(data) ? data : [];
    check('GET /agencies est public', status === 200, `reçu ${status}`);
    check('toutes les agences listées sont actives', agencies.every((agency) => agency.active));
  }

  // ----------------------------------------------------------- taux (lu) ---
  section('Taux du jour');
  let board = [];
  {
    const { status, data } = await call('GET', '/rates');
    board = Array.isArray(data) ? data : [];
    check('GET /rates est public', status === 200, `reçu ${status}`);
    check('le tableau des taux est non vide', board.length > 0);
    check(
      'aucun taux de vente inférieur au taux d’achat',
      board.every((row) => Number(row.sellRate) >= Number(row.buyRate)),
    );
    check(
      'chaque ligne porte une variation exploitable',
      board.every((row) => ['up', 'down', 'flat'].includes(row.trend)),
    );
    check(
      'la devise de référence n’apparaît pas dans le tableau',
      board.every((row) => row.currency.code !== 'XOF'),
    );
    // Cohérence de l'alerte de fraîcheur : `stale` doit correspondre à la date.
    const staleHours = 12;
    const limit = Date.now() - staleHours * 3_600_000;
    const incoherent = board.filter(
      (row) => row.stale !== new Date(row.effectiveFrom).getTime() < limit,
    );
    check(
      'l’indicateur « taux périmé » est cohérent avec l’horodatage',
      incoherent.length === 0,
      incoherent.map((row) => row.currency.code).join(', '),
    );
  }

  // Taux différencié par agence : le taux propre à l'agence doit l'emporter.
  {
    const airport = agencies.find((agency) => agency.code === 'AER');
    if (!airport) {
      skip('taux différencié par agence', 'agence AER absente du jeu de données');
    } else {
      const { data } = await call('GET', `/rates?agencyId=${airport.id}`);
      const rows = Array.isArray(data) ? data : [];
      const overridden = rows.filter((row) => row.agencyId === airport.id);
      check('au moins un taux propre à l’agence s’applique', overridden.length > 0);
      // Le taux d'agence doit résister à une republication du taux global :
      // sinon une simple mise à jour effacerait la politique de l'agence.
      const before = overridden[0];
      if (before) {
        // Cette section s'exécute avant la connexion de l'administrateur du
        // scénario principal : on ouvre donc une session locale.
        const publisher = await login(ADMIN);
        const global = (await call('GET', '/rates')).data.find(
          (row) => row.currency.code === before.currency.code,
        );
        await call('POST', '/rates', {
          token: publisher.accessToken,
          body: {
            currencyCode: before.currency.code,
            buyRate: Number(global.buyRate) + 1,
            sellRate: Number(global.sellRate) + 1,
            commissionPct: Number(global.commissionPct),
          },
        });
        const after = (await call('GET', `/rates?agencyId=${airport.id}`)).data.find(
          (row) => row.currency.code === before.currency.code,
        );
        check(
          'republier le taux global n’efface pas le taux de l’agence',
          after?.agencyId === airport.id && after?.sellRate === before.sellRate,
          `agencyId ${after?.agencyId}, vente ${after?.sellRate} (attendu ${before.sellRate})`,
        );
      }
      for (const row of overridden) {
        const global = board.find((item) => item.currency.code === row.currency.code);
        check(
          `le taux ${row.currency.code} de l’agence remplace le taux global`,
          !global || global.sellRate !== row.sellRate || global.buyRate !== row.buyRate,
        );
      }
    }
  }

  // ------------------------------------------------------------- sécurité --
  section('Authentification et RBAC');
  {
    const { status } = await call('GET', '/users/me');
    check('GET /users/me sans jeton renvoie 401', status === 401, `reçu ${status}`);
  }
  {
    const { status } = await call('POST', '/rates', {
      body: { currencyCode: 'EUR', buyRate: 1, sellRate: 2 },
    });
    check('publier un taux sans jeton renvoie 401', status === 401, `reçu ${status}`);
  }

  const client = await login(CLIENT);
  check('un client se connecte par son numéro', Boolean(client.accessToken));
  {
    const { status, data } = await call('GET', '/users/me', { token: client.accessToken });
    check('GET /users/me renvoie le profil', status === 200 && data?.id === client.user.id);
    check('le profil ne contient jamais le hash du mot de passe', !('passwordHash' in (data ?? {})));
    check('le profil porte un statut KYC', typeof data?.kycStatus === 'string');
  }
  {
    const { status } = await call('POST', '/rates', {
      token: client.accessToken,
      body: { currencyCode: 'EUR', buyRate: 600, sellRate: 700 },
    });
    check('un client ne peut pas publier un taux (403)', status === 403, `reçu ${status}`);
  }

  const operateur = await login(OPERATEUR);
  {
    const { status } = await call('POST', '/rates', {
      token: operateur.accessToken,
      body: { currencyCode: 'EUR', buyRate: 600, sellRate: 700 },
    });
    check('un opérateur ne fixe pas les prix (403)', status === 403, `reçu ${status}`);
  }
  {
    const { status } = await call('GET', '/rates/EUR/history', { token: operateur.accessToken });
    check('un opérateur peut consulter l’historique (200)', status === 200, `reçu ${status}`);
  }

  // ------------------------------------------------------- taux (écriture) --
  section('Publication de taux (append-only)');
  const admin = await login(ADMIN);
  {
    const before = await call('GET', '/rates/EUR/history', { token: admin.accessToken });
    const countBefore = Array.isArray(before.data) ? before.data.length : 0;
    const currentEur = board.find((row) => row.currency.code === 'EUR');
    const newSell = Number(currentEur?.sellRate ?? 666) + 1.5;

    const { status, data } = await call('POST', '/rates', {
      token: admin.accessToken,
      body: {
        currencyCode: 'EUR',
        buyRate: Number(currentEur?.buyRate ?? 647),
        sellRate: newSell,
        commissionPct: 1,
      },
    });
    check('un admin publie un taux (201)', status === 201, `reçu ${status} ${JSON.stringify(data)}`);

    const after = await call('GET', '/rates/EUR/history', { token: admin.accessToken });
    const countAfter = Array.isArray(after.data) ? after.data.length : 0;
    check(
      'la version précédente n’est pas écrasée (historique +1)',
      countAfter === countBefore + 1,
      `${countBefore} → ${countAfter}`,
    );

    const { data: refreshed } = await call('GET', '/rates');
    const eur = (refreshed ?? []).find((row) => row.currency.code === 'EUR');
    check('le tableau sert bien la nouvelle version', Number(eur?.sellRate) === newSell);
    check('la variation est calculée par rapport à la version précédente', eur?.trend === 'up');
    check('le taux fraîchement publié n’est pas signalé périmé', eur?.stale === false);
  }
  {
    const { status } = await call('POST', '/rates', {
      token: admin.accessToken,
      body: { currencyCode: 'EUR', buyRate: 700, sellRate: 600 },
    });
    check('un taux de vente inférieur à l’achat est refusé (400)', status === 400, `reçu ${status}`);
  }
  {
    const { status } = await call('POST', '/rates', {
      token: admin.accessToken,
      body: { currencyCode: 'XOF', buyRate: 1, sellRate: 1 },
    });
    check('la devise de référence n’accepte pas de taux (400)', status === 400, `reçu ${status}`);
  }

  // ------------------------------------------------------------ inscription --
  section('Inscription et rotation des jetons');
  const phone = `07${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  const registration = await call('POST', '/auth/register', {
    body: { firstName: 'Test', lastName: 'Vérification', phone, password: 'Test1234' },
  });
  if (registration.status === 429) {
    skip('inscription client', 'quota horaire d’inscriptions atteint');
    skip('rotation du refresh token', 'dépend de l’inscription');
  } else {
    check('inscription acceptée (201)', registration.status === 201, `reçu ${registration.status}`);
    check(
      'un nouveau compte naît sans KYC',
      registration.data?.user?.kycStatus === 'NON_SOUMIS',
      String(registration.data?.user?.kycStatus),
    );
    check('le rôle attribué est CLIENT', registration.data?.user?.role === 'CLIENT');

    const first = registration.data?.refreshToken;
    const rotated = await call('POST', '/auth/refresh', { body: { refreshToken: first } });
    check('un refresh token valide est échangé (200)', rotated.status === 200, `reçu ${rotated.status}`);
    check(
      'la rotation renvoie un jeton différent',
      rotated.data?.refreshToken && rotated.data.refreshToken !== first,
    );

    const replayed = await call('POST', '/auth/refresh', { body: { refreshToken: first } });
    check('rejouer un jeton consommé est refusé (401)', replayed.status === 401, `reçu ${replayed.status}`);

    // La détection de rejeu doit couper TOUTES les sessions de ce compte.
    const afterTheft = await call('POST', '/auth/refresh', {
      body: { refreshToken: rotated.data?.refreshToken },
    });
    check(
      'le rejeu coupe aussi les sessions saines du compte (401)',
      afterTheft.status === 401,
      `reçu ${afterTheft.status}`,
    );
  }

  // -------------------------------------------------------------- simulation --
  section('Simulation et verrou de taux');
  const eurRate = board.find((row) => row.currency.code === 'EUR');
  {
    // Le simulateur doit être utilisable SANS compte : c'est la vitrine.
    const { status, data } = await call('POST', '/quotes/simulate', {
      body: { direction: 'VENTE_DEVISE', currencyCode: 'EUR', amount: 500_000, side: 'SOURCE' },
    });
    check('POST /quotes/simulate est public (200)', status === 200, `reçu ${status}`);
    check('la simulation part du FCFA vers la devise', data?.sourceCurrency === 'XOF' && data?.targetCurrency === 'EUR');
    check('aucun verrou sur une simple simulation', data?.lockedUntil === null && data?.id === null);

    // Cohérence arithmétique : on refait le calcul depuis le tableau des taux.
    const { data: freshBoard } = await call('GET', '/rates');
    const eur = (freshBoard ?? []).find((row) => row.currency.code === 'EUR');
    const pct = Number(eur.commissionPct);
    const commission = Math.round(500_000 * (pct / 100));
    const expected = (500_000 - commission) / Number(eur.sellRate);
    check(
      'la commission est prélevée sur la jambe FCFA',
      Number(data?.commissionAmount) === commission,
      `attendu ${commission}, reçu ${data?.commissionAmount}`,
    );
    check(
      'le montant reçu correspond au taux de VENTE',
      Math.abs(Number(data?.targetAmount) - expected) < 0.02,
      `attendu ~${expected.toFixed(2)}, reçu ${data?.targetAmount}`,
    );
    check('le taux appliqué est celui du tableau', data?.appliedRate === eur.sellRate);
  }
  {
    // Saisie inverse : « je veux recevoir exactement 300 € ».
    const { status, data } = await call('POST', '/quotes/simulate', {
      body: { direction: 'VENTE_DEVISE', currencyCode: 'EUR', amount: 300, side: 'TARGET' },
    });
    check('la saisie inverse est acceptée (200)', status === 200, `reçu ${status}`);
    check('le montant demandé est servi exactement', Number(data?.targetAmount) === 300);

    // Aller-retour : payer ce montant doit bien redonner ~300 €.
    const back = await call('POST', '/quotes/simulate', {
      body: {
        direction: 'VENTE_DEVISE',
        currencyCode: 'EUR',
        amount: Number(data?.sourceAmount),
        side: 'SOURCE',
      },
    });
    check(
      'l’aller-retour saisie inverse → saisie directe est cohérent',
      Math.abs(Number(back.data?.targetAmount) - 300) < 1,
      `retour ${back.data?.targetAmount} €`,
    );
  }
  {
    const { status, data } = await call('POST', '/quotes/simulate', {
      body: { direction: 'ACHAT_DEVISE', currencyCode: 'EUR', amount: 200, side: 'SOURCE' },
    });
    check('le sens achat de devise inverse les jambes', data?.sourceCurrency === 'EUR' && data?.targetCurrency === 'XOF', `reçu ${status}`);
    const gross = Math.round(200 * Number(eurRate.buyRate));
    check(
      'le sens achat applique le taux d’ACHAT',
      Number(data?.amountXof) === gross,
      `attendu ${gross}, reçu ${data?.amountXof}`,
    );
    check(
      'le client reçoit le brut moins la commission',
      Number(data?.targetAmount) === gross - Number(data?.commissionAmount),
    );
  }
  {
    const { status } = await call('POST', '/quotes/simulate', {
      body: { direction: 'VENTE_DEVISE', currencyCode: 'XOF', amount: 1000 },
    });
    check('changer du FCFA contre du FCFA est refusé (400)', status === 400, `reçu ${status}`);
  }
  {
    const { status } = await call('POST', '/quotes/simulate', {
      body: { direction: 'VENTE_DEVISE', currencyCode: 'EUR', amount: -5 },
    });
    check('un montant négatif est refusé (400)', status === 400, `reçu ${status}`);
  }

  // Verrouillage : engage le bureau, donc compte obligatoire.
  {
    const anonymous = await call('POST', '/quotes/lock', {
      body: { direction: 'VENTE_DEVISE', currencyCode: 'EUR', amount: 100_000 },
    });
    check('verrouiller sans compte est refusé (401)', anonymous.status === 401, `reçu ${anonymous.status}`);

    const byAdmin = await call('POST', '/quotes/lock', {
      token: admin.accessToken,
      body: { direction: 'VENTE_DEVISE', currencyCode: 'EUR', amount: 100_000 },
    });
    check('un compte interne ne verrouille pas un taux (403)', byAdmin.status === 403, `reçu ${byAdmin.status}`);

    const locked = await call('POST', '/quotes/lock', {
      token: client.accessToken,
      body: { direction: 'VENTE_DEVISE', currencyCode: 'EUR', amount: 100_000 },
    });
    check('un client verrouille son taux (201)', locked.status === 201, `reçu ${locked.status}`);
    check('le devis porte une référence lisible', /^DEV-\d{4}-\d{6}$/.test(locked.data?.reference ?? ''), String(locked.data?.reference));

    const remaining = (new Date(locked.data?.lockedUntil).getTime() - Date.now()) / 60_000;
    check(
      'le verrou a une échéance de 30 min (± 1)',
      remaining > 29 && remaining <= 30,
      `${remaining.toFixed(1)} min`,
    );

    const owned = await call('GET', `/quotes/${locked.data?.id}`, { token: client.accessToken });
    check('le client relit son devis (200)', owned.status === 200, `reçu ${owned.status}`);
    check('le devis relu porte le même prix', owned.data?.targetAmount === locked.data?.targetAmount);

    // Un devis appartient à une personne : les autres ne doivent pas le voir.
    const other = await login({ identifier: '0709000002', password: CLIENT.password });
    const stolen = await call('GET', `/quotes/${locked.data?.id}`, { token: other.accessToken });
    check('le devis d’autrui est introuvable (404)', stolen.status === 404, `reçu ${stolen.status}`);

    // Le verrou tient bon même si le taux bouge juste après.
    const bumped = Number(eurRate.sellRate) + 5;
    await call('POST', '/rates', {
      token: admin.accessToken,
      body: { currencyCode: 'EUR', buyRate: Number(eurRate.buyRate), sellRate: bumped, commissionPct: 1 },
    });
    const afterMove = await call('GET', `/quotes/${locked.data?.id}`, { token: client.accessToken });
    check(
      'un taux publié après coup ne réécrit pas le devis verrouillé',
      afterMove.data?.appliedRate === locked.data?.appliedRate,
      `${locked.data?.appliedRate} → ${afterMove.data?.appliedRate}`,
    );
  }

  // ------------------------------------------------------------- temps réel --
  section('Diffusion des taux en direct');
  {
    let io = null;
    try {
      ({ io } = await import('socket.io-client'));
    } catch {
      io = null;
    }
    if (!io) {
      skip('diffusion WebSocket', 'socket.io-client absent — npm install dans scripts-verif/');
    } else {
      const socket = io(`${BASE}/rates`, { transports: ['websocket'], timeout: 5000 });
      const received = new Promise((resolve) => {
        socket.on('rates:updated', resolve);
        setTimeout(() => resolve(null), 8000);
      });
      await new Promise((resolve) => {
        socket.on('connect', resolve);
        setTimeout(resolve, 5000);
      });
      check('connexion à la passerelle /rates', socket.connected);

      const target = Number(eurRate.sellRate) + 7;
      await call('POST', '/rates', {
        token: admin.accessToken,
        body: { currencyCode: 'EUR', buyRate: Number(eurRate.buyRate), sellRate: target, commissionPct: 1 },
      });
      const event = await received;
      check('une publication de taux est diffusée sans requête HTTP', event !== null);
      check(
        'l’événement porte la ligne complète, pas un simple identifiant',
        event?.currency?.code === 'EUR' && Number(event?.sellRate) === target,
        JSON.stringify(event?.currency ?? null),
      );
      socket.close();
    }
  }

  // ------------------------------------------------------- vérification KYC --
  section('Vérification d’identité (KYC)');
  {
    const suffix = Date.now().toString().slice(-7);
    const candidate = { phone: `05${suffix}1`, password: 'Kyc@2026Test' };
    const registered = await call('POST', '/auth/register', {
      body: {
        firstName: 'Awa',
        lastName: 'Traoré',
        phone: candidate.phone,
        password: candidate.password,
      },
    });
    const token = registered.data?.accessToken;

    const initial = await call('GET', '/kyc/me', { token });
    check('un compte neuf n’a aucun dossier d’identité', initial.data?.status === 'NON_SOUMIS' && initial.data?.document === null);

    const noFile = await upload('/kyc/documents', { token, fields: { type: 'CNI' } });
    check('déposer sans fichier est refusé (400)', noFile.status === 400, `reçu ${noFile.status}`);

    const badFormat = await upload('/kyc/documents', {
      token,
      fields: { type: 'CNI' },
      files: { document: { content: 'MZ exécutable', type: 'application/x-msdownload', name: 'piece.exe' } },
    });
    check('un format non image/PDF est refusé (400)', badFormat.status === 400, `reçu ${badFormat.status}`);

    const submitted = await upload('/kyc/documents', {
      token,
      fields: { type: 'CNI', documentNumber: 'CI0042198' },
      files: { document: { content: PNG_1PX, type: 'image/png', name: 'cni.png' } },
    });
    check('le dépôt d’une pièce valide est accepté (201)', submitted.status === 201, `reçu ${submitted.status}`);
    check('le dossier part en attente de vérification', submitted.data?.status === 'EN_ATTENTE');
    check('aucune clé de stockage ne sort de l’API', !JSON.stringify(submitted.data).includes('kyc/'), JSON.stringify(submitted.data));

    const profile = await call('GET', '/users/me', { token });
    check('le compte bascule en attente de vérification', profile.data?.kycStatus === 'EN_ATTENTE');

    const again = await upload('/kyc/documents', {
      token,
      fields: { type: 'PASSEPORT' },
      files: { document: { content: PNG_1PX, type: 'image/png', name: 'passeport.png' } },
    });
    check('re-déposer pendant l’examen est refusé (409)', again.status === 409, `reçu ${again.status}`);

    // La file de traitement : réservée aux agents, jamais aux clients.
    const clientQueue = await call('GET', '/kyc/queue', { token });
    check('un client ne voit pas la file KYC (403)', clientQueue.status === 403, `reçu ${clientQueue.status}`);

    const queue = await call('GET', '/kyc/queue', { token: admin.accessToken });
    const mine = (queue.data ?? []).find((row) => row.id === submitted.data?.id);
    check('le dossier apparaît dans la file de l’agent', mine !== undefined);
    check('la file porte l’identité du client', mine?.client?.phone === candidate.phone, JSON.stringify(mine?.client ?? null));

    // Accès au fichier : c'est ici que se joue la fuite de données.
    const fileUrl = `/kyc/documents/${submitted.data?.id}/file`;
    const anonymous = await fetch(`${API}${fileUrl}`);
    check('la pièce n’est pas lisible sans jeton (401)', anonymous.status === 401, `reçu ${anonymous.status}`);

    const stranger = await login({ identifier: '0709000002', password: CLIENT.password });
    const stolen = await fetch(`${API}${fileUrl}`, {
      headers: { authorization: `Bearer ${stranger.accessToken}` },
    });
    check('la pièce d’autrui est introuvable (404)', stolen.status === 404, `reçu ${stolen.status}`);

    const owner = await fetch(`${API}${fileUrl}`, { headers: { authorization: `Bearer ${token}` } });
    check('le propriétaire relit sa pièce (200)', owner.status === 200, `reçu ${owner.status}`);
    check('la pièce n’est ni mise en cache ni indexée', /no-store/.test(owner.headers.get('cache-control') ?? '') && /noindex/.test(owner.headers.get('x-robots-tag') ?? ''));

    const byAgent = await fetch(`${API}${fileUrl}`, {
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });
    check('l’agent habilité voit la pièce (200)', byAgent.status === 200, `reçu ${byAgent.status}`);
    check('la pièce servie fait bien le poids du fichier déposé', Number(byAgent.headers.get('content-length')) === PNG_1PX.byteLength);

    const noSelfie = await fetch(`${API}${fileUrl}?kind=selfie`, {
      headers: { authorization: `Bearer ${token}` },
    });
    check('un selfie absent répond 404', noSelfie.status === 404, `reçu ${noSelfie.status}`);

    // Rejet : le motif est obligatoire et doit revenir au client.
    const vagueReject = await call('POST', `/kyc/documents/${submitted.data?.id}/reject`, {
      token: admin.accessToken,
      body: { reason: 'flou' },
    });
    check('un rejet sans motif explicite est refusé (400)', vagueReject.status === 400, `reçu ${vagueReject.status}`);

    const reason = 'Photo illisible : les quatre coins de la pièce doivent être visibles.';
    const rejected = await call('POST', `/kyc/documents/${submitted.data?.id}/reject`, {
      token: admin.accessToken,
      body: { reason },
    });
    check('le rejet motivé est accepté (201)', rejected.status === 201, `reçu ${rejected.status}`);

    const afterReject = await call('GET', '/kyc/me', { token });
    check('le client voit son dossier rejeté', afterReject.data?.status === 'REJETE');
    check('le motif du rejet lui est transmis', afterReject.data?.document?.rejectReason === reason, String(afterReject.data?.document?.rejectReason));

    const notifications = await call('GET', '/notifications', { token });
    check('le rejet a produit une notification', (notifications.data ?? []).some((row) => row.body.includes(reason)));

    const twice = await call('POST', `/kyc/documents/${submitted.data?.id}/reject`, {
      token: admin.accessToken,
      body: { reason },
    });
    check('un dossier déjà tranché ne se retranche pas (409)', twice.status === 409, `reçu ${twice.status}`);

    // Re-soumission après rejet : explicitement prévue par le cahier §3.2.
    const resubmitted = await upload('/kyc/documents', {
      token,
      fields: { type: 'CNI' },
      files: {
        document: { content: PNG_1PX, type: 'image/png', name: 'cni-2.png' },
        selfie: { content: PNG_1PX, type: 'image/jpeg', name: 'selfie.jpg' },
      },
    });
    check('la re-soumission après rejet est acceptée (201)', resubmitted.status === 201, `reçu ${resubmitted.status}`);
    check('le selfie est pris en compte', resubmitted.data?.hasSelfie === true);
    const cleared = await call('GET', '/kyc/me', { token });
    check('le motif de l’ancien rejet disparaît du compte', cleared.data?.document?.rejectReason === null);

    const operateur = await login(OPERATEUR);
    const approved = await call('POST', `/kyc/documents/${resubmitted.data?.id}/approve`, {
      token: operateur.accessToken,
    });
    check('l’opérateur peut valider une identité (201)', approved.status === 201, `reçu ${approved.status}`);

    const verified = await call('GET', '/users/me', { token });
    check('le compte devient vérifié', verified.data?.kycStatus === 'VALIDE');

    const blockedResubmit = await upload('/kyc/documents', {
      token,
      fields: { type: 'CNI' },
      files: { document: { content: PNG_1PX, type: 'image/png', name: 'cni-3.png' } },
    });
    check('un compte déjà vérifié ne redépose pas (409)', blockedResubmit.status === 409, `reçu ${blockedResubmit.status}`);

    const trace = await call('GET', '/audit?entity=KycDocument&take=20', { token: admin.accessToken });
    const actions = (trace.data ?? []).map((row) => row.action);
    check(
      'les décisions d’identité sont tracées à l’audit',
      actions.includes('kyc.approve') && actions.includes('kyc.reject'),
      actions.slice(0, 5).join(', '),
    );
  }

  // ---------------------------------------------------------- transactions --
  section('Opération de change, de bout en bout');
  {
    // Un client SANS identité vérifiée ne doit pas pouvoir transiger.
    const suffix = Date.now().toString().slice(-7);
    const novice = await call('POST', '/auth/register', {
      body: { firstName: 'Sekou', lastName: 'Bamba', phone: `06${suffix}2`, password: 'Tx@2026Test' },
    });
    const blocked = await call('POST', '/transactions', {
      token: novice.data?.accessToken,
      body: {
        direction: 'VENTE_DEVISE',
        currencyCode: 'EUR',
        amount: 100_000,
        depositMethod: 'ORANGE_MONEY',
        payoutMethod: 'ESPECES_AGENCE',
      },
    });
    check('sans KYC validé, la transaction est refusée (403)', blocked.status === 403, `reçu ${blocked.status}`);
    check(
      'le refus explique qu’il faut vérifier son identité',
      /identité/i.test(String(blocked.data?.message)),
      String(blocked.data?.message),
    );

    // Le client vérifié du seed, lui, peut aller au bout.
    const verifie = await login(CLIENT);
    const locked = await call('POST', '/quotes/lock', {
      token: verifie.accessToken,
      body: { direction: 'VENTE_DEVISE', currencyCode: 'EUR', amount: 200_000, side: 'SOURCE' },
    });

    const created = await call('POST', '/transactions', {
      token: verifie.accessToken,
      body: {
        quoteId: locked.data?.id,
        depositMethod: 'ORANGE_MONEY',
        payoutMethod: 'ESPECES_AGENCE',
      },
    });
    check('la transaction est créée à partir du devis (201)', created.status === 201, `reçu ${created.status}`);
    check('elle porte une référence lisible', /^HC-\d{4}-\d{6}$/.test(created.data?.reference ?? ''), String(created.data?.reference));
    check('elle démarre en attente de paiement', created.data?.status === 'CREEE');
    check(
      'le prix vient du devis, pas d’un recalcul',
      created.data?.targetAmount === locked.data?.targetAmount &&
        created.data?.appliedRate === locked.data?.appliedRate,
      `${locked.data?.targetAmount} vs ${created.data?.targetAmount}`,
    );
    check('une agence lui est rattachée', created.data?.agency?.id !== undefined);
    check('la timeline compte les 6 étapes du parcours', created.data?.timeline?.length === 6);

    // Un verrou ne sert qu'une fois.
    const reused = await call('POST', '/transactions', {
      token: verifie.accessToken,
      body: { quoteId: locked.data?.id, depositMethod: 'WAVE', payoutMethod: 'ESPECES_AGENCE' },
    });
    check('un devis déjà consommé est refusé (409)', reused.status === 409, `reçu ${reused.status}`);

    const txId = created.data?.id;
    // Aucune étape ne se saute : on ne valide pas un reçu qui n'existe pas.
    const early = await call('POST', `/transactions/${txId}/ready`, { token: admin.accessToken });
    check('impossible de sauter au retrait sans exécuter le change (409)', early.status === 409, `reçu ${early.status}`);

    const noProof = await upload(`/transactions/${txId}/receipt`, { token: verifie.accessToken });
    check('déposer un reçu vide est refusé (400)', noProof.status === 400, `reçu ${noProof.status}`);

    const submitted = await upload(`/transactions/${txId}/receipt`, {
      token: verifie.accessToken,
      files: { receipt: { content: PNG_1PX, type: 'image/png', name: 'recu.png' } },
    });
    check('le dépôt du reçu est accepté (201)', submitted.status === 201, `reçu ${submitted.status}`);
    check('la transaction passe en contrôle de reçu', submitted.data?.status === 'RECU_SOUMIS');

    const queue = await call('GET', '/transactions/receipts/queue', { token: admin.accessToken });
    const waiting = (queue.data ?? []).find((row) => row.transaction.id === txId);
    check('le reçu apparaît dans la file de contrôle', waiting !== undefined);
    check('la file porte le montant attendu et le client', waiting?.transaction?.client?.id !== undefined);

    const clientQueue = await call('GET', '/transactions/receipts/queue', { token: verifie.accessToken });
    check('un client ne voit pas la file des reçus (403)', clientQueue.status === 403, `reçu ${clientQueue.status}`);

    // Rejet, puis redépôt : c'est une boucle, pas une impasse.
    const motif = 'Le montant du reçu ne correspond pas au montant attendu.';
    const rejected = await call('POST', `/transactions/receipts/${waiting?.id}/reject`, {
      token: admin.accessToken,
      body: { reason: motif },
    });
    check('le rejet motivé du reçu est accepté (201)', rejected.status === 201, `reçu ${rejected.status}`);
    check('la transaction revient au client', rejected.data?.status === 'RECU_REJETE');

    const redeposit = await upload(`/transactions/${txId}/receipt`, {
      token: verifie.accessToken,
      files: { receipt: { content: PNG_1PX, type: 'image/png', name: 'recu-2.png' } },
    });
    check('après rejet, le client peut redéposer (201)', redeposit.status === 201, `reçu ${redeposit.status}`);
    check('la transaction conserve ses deux reçus', (redeposit.data?.receipts ?? []).length === 2);

    // Soldes de caisse AVANT exécution, pour vérifier le mouvement réel.
    const agencyId = created.data?.agency?.id;
    const before = await call('GET', `/agencies/${agencyId}/cash`, { token: admin.accessToken });
    const xofBefore = Number((before.data ?? []).find((row) => row.currency.code === 'XOF')?.amount);
    const eurBefore = Number((before.data ?? []).find((row) => row.currency.code === 'EUR')?.amount);

    const queue2 = await call('GET', '/transactions/receipts/queue', { token: admin.accessToken });
    const pending = (queue2.data ?? []).find((row) => row.transaction.id === txId);
    const approved = await call('POST', `/transactions/receipts/${pending?.id}/approve`, {
      token: admin.accessToken,
      body: { declaredAmount: Number(created.data?.sourceAmount) },
    });
    check('la validation du reçu est acceptée (201)', approved.status === 201, `reçu ${approved.status}`);
    check(
      'valider le reçu exécute le change dans la foulée',
      approved.data?.status === 'CHANGE_EXECUTE',
      String(approved.data?.status),
    );

    const after = await call('GET', `/agencies/${agencyId}/cash`, { token: admin.accessToken });
    const xofAfter = Number((after.data ?? []).find((row) => row.currency.code === 'XOF')?.amount);
    const eurAfter = Number((after.data ?? []).find((row) => row.currency.code === 'EUR')?.amount);
    check(
      'les FCFA reçus entrent en caisse',
      xofAfter - xofBefore === Number(created.data?.sourceAmount),
      `${xofBefore} → ${xofAfter}`,
    );
    check(
      'les devises remises sortent de la caisse',
      Math.abs(eurBefore - eurAfter - Number(created.data?.targetAmount)) < 0.01,
      `${eurBefore} → ${eurAfter}`,
    );

    const twice = await call('POST', `/transactions/receipts/${pending?.id}/approve`, {
      token: admin.accessToken,
      body: {},
    });
    check('un reçu déjà traité ne se revalide pas (409)', twice.status === 409, `reçu ${twice.status}`);

    const ready = await call('POST', `/transactions/${txId}/ready`, { token: admin.accessToken });
    check('les fonds passent à disposition (201)', ready.status === 201 && ready.data?.status === 'PRETE_POUR_RETRAIT', `reçu ${ready.status}`);

    const closed = await call('POST', `/transactions/${txId}/close`, { token: admin.accessToken });
    check('la transaction se clôture (201)', closed.status === 201 && closed.data?.status === 'CLOTUREE', `reçu ${closed.status}`);
    check('toutes les étapes sont horodatées', (closed.data?.timeline ?? []).every((step) => step.at !== null));

    const reopen = await call('POST', `/transactions/${txId}/cancel`, {
      token: admin.accessToken,
      body: { reason: 'test' },
    });
    check('une transaction close ne se rouvre jamais (409)', reopen.status === 409, `reçu ${reopen.status}`);

    // Cloisonnement : la transaction d'autrui reste invisible.
    const stranger = await login({ identifier: '0709000002', password: CLIENT.password });
    const peek = await call('GET', `/transactions/${txId}`, { token: stranger.accessToken });
    check('la transaction d’autrui est introuvable (404)', peek.status === 404, `reçu ${peek.status}`);

    const mine = await call('GET', '/transactions/mine', { token: verifie.accessToken });
    check('le client retrouve son opération dans son historique', (mine.data ?? []).some((row) => row.id === txId));

    const trace = await call('GET', '/audit?entity=Transaction&take=30', { token: admin.accessToken });
    const actions = (trace.data ?? []).map((row) => row.action);
    check(
      'la création et l’exécution sont tracées',
      actions.includes('transaction.create') && actions.includes('transaction.execute'),
      actions.slice(0, 4).join(', '),
    );
  }

  // Plafond : la protection doit tenir même si l'app ne l'affiche pas.
  {
    const rich = await login(CLIENT);
    const huge = await call('POST', '/transactions', {
      token: rich.accessToken,
      body: {
        direction: 'VENTE_DEVISE',
        currencyCode: 'EUR',
        amount: 900_000_000,
        depositMethod: 'ORANGE_MONEY',
        payoutMethod: 'ESPECES_AGENCE',
      },
    });
    check('un montant au-delà du plafond est refusé (403)', huge.status === 403, `reçu ${huge.status}`);
    check('le refus nomme le plafond dépassé', /plafond/i.test(String(huge.data?.message)), String(huge.data?.message));
  }

  // ------------------------------------------------------------------ bilan --
  console.log(`\n${'='.repeat(60)}`);
  console.log(`${passed} vérifications passées · ${failed} échouées · ${skipped} ignorées`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error('\nLa vérification a échoué :', error.message);
  process.exitCode = 1;
});
