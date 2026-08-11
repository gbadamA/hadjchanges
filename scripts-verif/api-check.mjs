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

/**
 * Sessions mises en cache par identifiant.
 *
 * `/auth/login` est limité à 10 requêtes par minute et par IP — une protection
 * voulue. Sans ce cache, le script finissait par déclencher sa propre limite et
 * échouait en 429 sur des vérifications parfaitement saines : un script qui se
 * sabote lui-même ne prouve plus rien.
 */
const sessions = new Map();

const login = async (credentials, { fresh = false } = {}) => {
  if (!fresh && sessions.has(credentials.identifier)) return sessions.get(credentials.identifier);

  const { status, data } = await call('POST', '/auth/login', { body: credentials });
  if (status === 429) {
    throw new Error(
      'Quota de connexion atteint (10/min, compteur EN MÉMOIRE). ' +
        'Attendez une minute, ou redémarrez l’API pour le remettre à zéro.',
    );
  }
  if (status !== 200) throw new Error(`Connexion impossible (${status}) : ${JSON.stringify(data)}`);
  sessions.set(credentials.identifier, data);
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
    const previousTop = (before.data ?? [])[0];
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

    // ⚠️ On ne COMPTE PAS les lignes : l'historique est plafonné côté API, si
    // bien qu'après quelques dizaines de publications le compteur n'augmente
    // plus et le test criait au loup. On vérifie la FORME : la nouvelle version
    // arrive en tête, et l'ancienne est toujours là, juste derrière.
    const after = await call('GET', '/rates/EUR/history', { token: admin.accessToken });
    const [newest, second] = after.data ?? [];
    check(
      'la nouvelle version arrive en tête de l’historique',
      Number(newest?.sellRate) === newSell,
      `tête à ${newest?.sellRate}, attendu ${newSell}`,
    );
    check(
      'la version précédente n’est pas écrasée, elle recule d’un rang',
      previousTop === undefined || second?.id === previousTop.id,
      `${previousTop?.id} vs ${second?.id}`,
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
  // Bloc étiqueté : un `return` ici couperait TOUT le script, pas la section.
  kycSection: {
    // Le parcours KYC part forcément d'un compte NEUF : « aucun dossier » n'a de
    // sens qu'une fois. ⚠️ `/auth/register` est plafonné à 5 par heure et par IP
    // — au-delà, on IGNORE la section en le disant, plutôt que d'enchaîner des
    // échecs en cascade qui feraient croire à une régression.
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

    if (!token) {
      skip(
        'parcours de vérification d’identité',
        registered.status === 429
          ? 'quota d’inscription épuisé — redémarrer l’API remet le compteur à zéro'
          : `inscription impossible (${registered.status})`,
      );
      break kycSection;
    }

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
  transactionSection: {
    // Un client SANS identité vérifiée ne doit pas pouvoir transiger.
    // ⚠️ Compte STABLE, réutilisé d'un passage à l'autre : créer un compte neuf
    // à chaque exécution finissait par épuiser le quota d'inscription, et le
    // script échouait en 401 faute de jeton — un faux négatif spectaculaire.
    const NOVICE = { identifier: '0600000099', password: 'Tx@2026Test' };
    const novice = await (async () => {
      const existing = await call('POST', '/auth/login', { body: NOVICE });
      if (existing.status === 200) return existing;
      return call('POST', '/auth/register', {
        body: {
          firstName: 'Sekou',
          lastName: 'Bamba',
          phone: NOVICE.identifier,
          password: NOVICE.password,
        },
      });
    })();

    if (!novice.data?.accessToken) {
      skip(
        'refus de transaction sans KYC',
        'quota d’inscription épuisé — redémarrer l’API remet le compteur à zéro',
      );
    }
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
    if (novice.data?.accessToken) {
      check('sans KYC validé, la transaction est refusée (403)', blocked.status === 403, `reçu ${blocked.status}`);
      check(
        'le refus explique qu’il faut vérifier son identité',
        /identité/i.test(String(blocked.data?.message)),
        String(blocked.data?.message),
      );
    }

    // Le client vérifié du seed, lui, peut aller au bout.
    const verifie = await login(CLIENT);
    const locked = await call('POST', '/quotes/lock', {
      token: verifie.accessToken,
      body: { direction: 'VENTE_DEVISE', currencyCode: 'EUR', amount: 20_000, side: 'SOURCE' },
    });

    const created = await call('POST', '/transactions', {
      token: verifie.accessToken,
      body: {
        quoteId: locked.data?.id,
        depositMethod: 'ORANGE_MONEY',
        payoutMethod: 'ESPECES_AGENCE',
      },
    });
    // ⚠️ Chaque passage consomme le plafond JOURNALIER du client de démo : c'est
    // le produit qui fonctionne, pas le script qui casse. On le dit clairement.
    if (created.status === 403 && /plafond/i.test(String(created.data?.message))) {
      skip('opération de change de bout en bout', 'plafond journalier du client de démo atteint');
      break transactionSection;
    }
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
    const before = await call('GET', `/cash/${agencyId}/balances`, { token: admin.accessToken });
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

    const after = await call('GET', `/cash/${agencyId}/balances`, { token: admin.accessToken });
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

  // ------------------------------------------- justificatif PDF et exports --
  section('Justificatif et exports');
  {
    const closed = await call('GET', '/transactions?status=CLOTUREE', { token: admin.accessToken });
    const done = (closed.data ?? [])[0];
    const open = (await call('GET', '/transactions?status=CREEE', { token: admin.accessToken }))
      .data?.[0];

    if (!done) {
      skip('justificatif PDF', 'aucune transaction clôturée dans le jeu de données');
    } else {
      const pdf = await fetch(`${API}/transactions/${done.id}/justificatif.pdf`, {
        headers: { authorization: `Bearer ${admin.accessToken}` },
      });
      const bytes = Buffer.from(await pdf.arrayBuffer());
      check('le justificatif est servi (200)', pdf.status === 200, `reçu ${pdf.status}`);
      // On teste la SIGNATURE sur les octets : un PDF vide ou une page d'erreur
      // renverrait aussi un 200.
      check('le fichier est bien un PDF', bytes.subarray(0, 5).toString() === '%PDF-');
      check('le justificatif n’est pas vide', bytes.length > 1500, `${bytes.length} octets`);
      check(
        'il est proposé en téléchargement, sous la référence de l’opération',
        (pdf.headers.get('content-disposition') ?? '').includes(done.reference),
        String(pdf.headers.get('content-disposition')),
      );
      check(
        'il n’est ni mis en cache ni indexé',
        /no-store/.test(pdf.headers.get('cache-control') ?? '') &&
          /noindex/.test(pdf.headers.get('x-robots-tag') ?? ''),
      );

      // Le document est figé : deux téléchargements donnent le même fichier.
      const again = await fetch(`${API}/transactions/${done.id}/justificatif.pdf`, {
        headers: { authorization: `Bearer ${admin.accessToken}` },
      });
      const bytes2 = Buffer.from(await again.arrayBuffer());
      check('un justificatif retéléchargé est identique', bytes.equals(bytes2));

      const stranger = await login({ identifier: '0709000002', password: CLIENT.password });
      const stolen = await fetch(`${API}/transactions/${done.id}/justificatif.pdf`, {
        headers: { authorization: `Bearer ${stranger.accessToken}` },
      });
      check('le justificatif d’autrui est introuvable (404)', stolen.status === 404, `reçu ${stolen.status}`);
    }

    if (open) {
      const early = await call('GET', `/transactions/${open.id}/justificatif.pdf`, {
        token: admin.accessToken,
      });
      check(
        'pas de justificatif avant la clôture (409)',
        early.status === 409,
        `reçu ${early.status}`,
      );
    } else {
      skip('justificatif prématuré', 'aucune transaction en attente de paiement');
    }

    // Export Excel.
    const xlsx = await fetch(`${API}/transactions/export?format=xlsx`, {
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });
    const xlsxBytes = Buffer.from(await xlsx.arrayBuffer());
    check('l’export Excel est servi (200)', xlsx.status === 200, `reçu ${xlsx.status}`);
    // « PK » : un .xlsx est une archive zip. Un CSV renommé passerait sinon.
    check('le fichier est un vrai classeur xlsx', xlsxBytes.subarray(0, 2).toString() === 'PK');
    check(
      'le classeur porte un nom daté',
      /hadjchanges-transactions-\d{4}-\d{2}-\d{2}\.xlsx/.test(
        xlsx.headers.get('content-disposition') ?? '',
      ),
    );

    // Export CSV : c'est le BOM qui décide si Excel affiche « Opération » ou
    // « OpÃ©ration ». À tester sur les OCTETS — `text()` retire le BOM en silence.
    const csv = await fetch(`${API}/transactions/export?format=csv`, {
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });
    const csvBytes = Buffer.from(await csv.arrayBuffer());
    check('l’export CSV est servi (200)', csv.status === 200, `reçu ${csv.status}`);
    check(
      'le CSV commence par un BOM UTF-8',
      csvBytes.subarray(0, 3).toString('hex') === 'efbbbf',
      csvBytes.subarray(0, 3).toString('hex'),
    );
    const header = csvBytes.subarray(3).toString('utf8').split('\r\n')[0];
    check('les colonnes sont séparées par des points-virgules', header.split(';').length > 10);
    check('les accents sont préservés', header.includes('Référence'), header.slice(0, 40));

    // Un client exporte SON historique, pas celui du bureau.
    const client = await login(CLIENT);
    const mineCsv = await fetch(`${API}/transactions/export?format=csv`, {
      headers: { authorization: `Bearer ${client.accessToken}` },
    });
    const mineLines = Buffer.from(await mineCsv.arrayBuffer())
      .subarray(3)
      .toString('utf8')
      .split('\r\n')
      .slice(1)
      .filter(Boolean);
    const allLines = csvBytes.subarray(3).toString('utf8').split('\r\n').slice(1).filter(Boolean);
    check('un client peut exporter son historique (200)', mineCsv.status === 200, `reçu ${mineCsv.status}`);
    check(
      'son export ne contient que ses opérations',
      mineLines.length > 0 && mineLines.length < allLines.length,
      `${mineLines.length} lignes sur ${allLines.length}`,
    );
  }

  // ---------------------------------------------------------------- caisses --
  section('Tenue de caisse et clôture');
  {
    const plateau = agencies.find((agency) => agency.code === 'PLT');
    const aeroport = agencies.find((agency) => agency.code === 'AER');
    const operateur = await login(OPERATEUR); // rattaché au Plateau dans le seed

    const balances = await call('GET', `/cash/${plateau.id}/balances`, { token: admin.accessToken });
    check('les soldes de caisse sont lisibles (200)', balances.status === 200, `reçu ${balances.status}`);
    check('chaque solde porte sa devise', (balances.data ?? []).every((row) => row.currency?.code));
    check(
      'les montants sortent en chaînes, jamais en flottants',
      (balances.data ?? []).every((row) => typeof row.amount === 'string'),
    );

    const client = await login(CLIENT);
    const peek = await call('GET', `/cash/${plateau.id}/balances`, { token: client.accessToken });
    check('un client ne voit pas l’encaisse du bureau (403)', peek.status === 403, `reçu ${peek.status}`);

    // Cloisonnement : l'opérateur du Plateau n'a rien à faire à l'aéroport.
    const own = await call('GET', `/cash/${plateau.id}/balances`, { token: operateur.accessToken });
    check('un opérateur consulte sa propre caisse (200)', own.status === 200, `reçu ${own.status}`);
    const other = await call('GET', `/cash/${aeroport.id}/balances`, { token: operateur.accessToken });
    check('il ne consulte pas celle d’une autre agence (403)', other.status === 403, `reçu ${other.status}`);

    // Alimentation : réservée à l'encadrement.
    const byOperator = await call('POST', `/cash/${plateau.id}/movements`, {
      token: operateur.accessToken,
      body: { currencyCode: 'EUR', type: 'ALIMENTATION', amount: 1000 },
    });
    check('un opérateur n’alimente pas sa caisse (403)', byOperator.status === 403, `reçu ${byOperator.status}`);

    const eurBefore = Number(
      (balances.data ?? []).find((row) => row.currency.code === 'EUR')?.amount ?? 0,
    );
    const funded = await call('POST', `/cash/${plateau.id}/movements`, {
      token: admin.accessToken,
      body: { currencyCode: 'EUR', type: 'ALIMENTATION', amount: 5000, note: 'Réassort hebdomadaire' },
    });
    check('l’encadrement alimente la caisse (201)', funded.status === 201, `reçu ${funded.status}`);
    check(
      'le solde augmente du montant versé',
      Number(funded.data?.balance) === eurBefore + 5000,
      `${eurBefore} → ${funded.data?.balance}`,
    );

    // Le signe vient du TYPE : un retrait saisi en positif doit sortir de la caisse.
    const withdrawn = await call('POST', `/cash/${plateau.id}/movements`, {
      token: admin.accessToken,
      body: { currencyCode: 'EUR', type: 'RETRAIT', amount: 2000 },
    });
    check(
      'un retrait saisi en positif diminue quand même la caisse',
      Number(withdrawn.data?.balance) === eurBefore + 3000,
      `solde ${withdrawn.data?.balance}`,
    );

    const overdraft = await call('POST', `/cash/${plateau.id}/movements`, {
      token: admin.accessToken,
      body: { currencyCode: 'EUR', type: 'RETRAIT', amount: 99_000_000 },
    });
    check('on ne retire pas plus que l’encaisse (409)', overdraft.status === 409, `reçu ${overdraft.status}`);

    const zero = await call('POST', `/cash/${plateau.id}/movements`, {
      token: admin.accessToken,
      body: { currencyCode: 'EUR', type: 'ALIMENTATION', amount: 0 },
    });
    check('un mouvement de zéro est refusé (400)', zero.status === 400, `reçu ${zero.status}`);

    const movements = await call('GET', `/cash/${plateau.id}/movements?currencyCode=EUR`, {
      token: admin.accessToken,
    });
    check('les mouvements sont consultables (200)', movements.status === 200, `reçu ${movements.status}`);
    check(
      'chaque mouvement porte son auteur et le solde qui en résulte',
      (movements.data ?? []).every((row) => row.author && row.balanceAfter !== undefined),
    );
    check(
      'les mouvements nés d’une transaction citent sa référence',
      (movements.data ?? []).some((row) => row.type === 'SORTIE_TRANSACTION' && row.reference),
    );

    // Clôture journalière : c'est l'écart qui compte.
    const current = await call('GET', `/cash/${plateau.id}/balances`, { token: admin.accessToken });
    const eurNow = Number((current.data ?? []).find((row) => row.currency.code === 'EUR')?.amount);
    const xofNow = Number((current.data ?? []).find((row) => row.currency.code === 'XOF')?.amount);

    // ⚠️ Le script ne PRÉSUME PAS que la journée est encore ouverte : une
    // clôture faite à la main dans le navigateur suffirait à le faire échouer
    // alors que rien n'est cassé. Il prend donc le premier jour non clôturé en
    // remontant le temps.
    const existing = await call('GET', `/cash/${plateau.id}/closures`, { token: admin.accessToken });
    const taken = new Set((existing.data ?? []).map((row) => row.businessDay));
    const businessDay = (() => {
      const day = new Date();
      while (taken.has(day.toISOString().slice(0, 10))) day.setDate(day.getDate() - 1);
      return day.toISOString().slice(0, 10);
    })();

    const closed = await call('POST', `/cash/${plateau.id}/close-day`, {
      token: operateur.accessToken,
      body: {
        businessDay,
        counts: [
          { currencyCode: 'EUR', countedAmount: eurNow - 50 }, // manquant volontaire
          { currencyCode: 'XOF', countedAmount: xofNow }, // conforme
        ],
        note: 'Clôture du soir',
      },
    });
    check('l’opérateur clôture sa caisse (201)', closed.status === 201, `reçu ${closed.status}`);

    const eurLine = (closed.data?.lines ?? []).find((line) => Number(line.difference) !== 0);
    check(
      'l’écart constaté est enregistré, pas masqué',
      Number(eurLine?.difference) === -50,
      `écart ${eurLine?.difference}`,
    );

    const after = await call('GET', `/cash/${plateau.id}/balances`, { token: admin.accessToken });
    const eurAfter = Number((after.data ?? []).find((row) => row.currency.code === 'EUR')?.amount);
    check(
      'le solde repart du montant réellement compté',
      eurAfter === eurNow - 50,
      `${eurNow} → ${eurAfter}`,
    );

    const twice = await call('POST', `/cash/${plateau.id}/close-day`, {
      token: operateur.accessToken,
      body: { businessDay, counts: [{ currencyCode: 'XOF', countedAmount: xofNow }] },
    });
    check('une journée déjà clôturée ne se reclôture pas (409)', twice.status === 409, `reçu ${twice.status}`);

    const closures = await call('GET', `/cash/${plateau.id}/closures`, { token: admin.accessToken });
    check('l’historique des clôtures est consultable', (closures.data ?? []).length > 0);
    check(
      'chaque clôture nomme son auteur et son jour comptable',
      /^\d{4}-\d{2}-\d{2}$/.test(closures.data?.[0]?.businessDay ?? '') && Boolean(closures.data?.[0]?.closedBy),
      JSON.stringify(closures.data?.[0]?.businessDay),
    );

    const trace = await call('GET', '/audit?entity=CashClosure&take=5', { token: admin.accessToken });
    check('la clôture est tracée à l’audit', (trace.data ?? []).some((row) => row.action === 'cash.close_day'));
  }

  // ------------------------------------------------- affectation des agents --
  section('Affectation des opérateurs');
  {
    const staff = await call('GET', '/staff', { token: admin.accessToken });
    check('la liste de l’équipe est lisible (200)', staff.status === 200, `reçu ${staff.status}`);
    check(
      'aucun client dans la liste de l’équipe',
      (staff.data ?? []).every((row) => row.role !== 'CLIENT'),
    );

    const client = await login(CLIENT);
    const forbidden = await call('GET', '/staff', { token: client.accessToken });
    check('un client ne lit pas la liste de l’équipe (403)', forbidden.status === 403, `reçu ${forbidden.status}`);

    const operateur = (staff.data ?? []).find((row) => row.role === 'OPERATEUR');
    const aeroport = agencies.find((agency) => agency.code === 'AER');
    const plateau = agencies.find((agency) => agency.code === 'PLT');

    const moved = await call('PATCH', `/staff/${operateur.id}/agency`, {
      token: admin.accessToken,
      body: { agencyId: aeroport.id },
    });
    check('un opérateur peut changer d’agence (200)', moved.status === 200, `reçu ${moved.status}`);
    check('son rattachement suit', moved.data?.agencyId === aeroport.id);

    const back = await call('PATCH', `/staff/${operateur.id}/agency`, {
      token: admin.accessToken,
      body: { agencyId: plateau.id },
    });
    check('le rattachement d’origine se rétablit', back.data?.agencyId === plateau.id);

    const admins = (staff.data ?? []).find((row) => row.role === 'ADMIN');
    const refused = await call('PATCH', `/staff/${admins.id}/agency`, {
      token: admin.accessToken,
      body: { agencyId: plateau.id },
    });
    check(
      'un administrateur ne se rattache pas à une agence (404)',
      refused.status === 404,
      `reçu ${refused.status}`,
    );
  }

  // -------------------------------------------------------------- rapports --
  section('Rapports et export comptable');
  {
    const { status, data } = await call('GET', '/reporting/overview', { token: admin.accessToken });
    check('le rapport est servi (200)', status === 200, `reçu ${status}`);
    check(
      'la fenêtre par défaut couvre 30 jours',
      (data?.series ?? []).length === 30,
      `${data?.series?.length} points`,
    );
    // Les jours creux DOIVENT être présents : sans eux, une courbe relierait
    // deux pics en ligne droite et inventerait une activité continue.
    check(
      'les jours sans activité sont présents dans la série',
      (data?.series ?? []).some((point) => point.operations === 0),
    );
    check(
      'la série est ordonnée du plus ancien au plus récent',
      (data?.series ?? []).every((point, index, all) => index === 0 || point.day > all[index - 1].day),
    );
    check(
      'les montants sortent en chaînes, jamais en flottants',
      typeof data?.totals?.volumeXof === 'string' && typeof data?.totals?.commissionXof === 'string',
    );

    // Cohérence : le total doit être la somme de la série, au centime près.
    const sommeSerie = (data?.series ?? []).reduce((total, point) => total + Number(point.volumeXof), 0);
    check(
      'le total annoncé est bien la somme des jours',
      Math.abs(sommeSerie - Number(data?.totals?.volumeXof)) < 1,
      `série ${sommeSerie} vs total ${data?.totals?.volumeXof}`,
    );

    const sommeDevises = (data?.byCurrency ?? []).reduce((total, row) => total + Number(row.volumeXof), 0);
    check(
      'la répartition par devise couvre tout le volume',
      Math.abs(sommeDevises - Number(data?.totals?.volumeXof)) < 1,
      `devises ${sommeDevises} vs total ${data?.totals?.volumeXof}`,
    );
    check(
      'le FCFA n’apparaît pas comme devise échangée',
      (data?.byCurrency ?? []).every((row) => row.code !== 'XOF'),
    );

    // Le chiffre « réalisé » ne doit pas inclure les opérations en attente.
    const pending = await call('GET', '/transactions?status=CREEE', { token: admin.accessToken });
    const attendu = (pending.data ?? []).reduce((total, row) => total + Number(row.amountXof), 0);
    check(
      'les opérations non exécutées sont comptées à part, pas dans le volume',
      Math.abs(Number(data?.totals?.pendingXof) - attendu) < 1,
      `${data?.totals?.pendingXof} vs ${attendu}`,
    );

    // Fenêtre restreinte : le total doit diminuer ou rester égal, jamais grandir.
    const jour = new Date().toISOString().slice(0, 10);
    const restreint = await call('GET', `/reporting/overview?from=${jour}`, { token: admin.accessToken });
    check(
      'une fenêtre plus courte ne peut pas produire plus de volume',
      Number(restreint.data?.totals?.volumeXof) <= Number(data?.totals?.volumeXof),
      `${restreint.data?.totals?.volumeXof} vs ${data?.totals?.volumeXof}`,
    );
    check('la fenêtre demandée est reprise dans la réponse', restreint.data?.period?.from === jour);

    const client = await login(CLIENT);
    const interdit = await call('GET', '/reporting/overview', { token: client.accessToken });
    check('un client ne consulte pas les rapports (403)', interdit.status === 403, `reçu ${interdit.status}`);

    // Un opérateur voit ses chiffres, cantonnés à son agence.
    const operateur = await login(OPERATEUR);
    const vueAgence = await call('GET', '/reporting/overview', { token: operateur.accessToken });
    check('un opérateur consulte son propre rapport (200)', vueAgence.status === 200, `reçu ${vueAgence.status}`);
    check(
      'son rapport ne porte que sur son agence',
      (vueAgence.data?.byAgency ?? []).length <= 1,
      `${vueAgence.data?.byAgency?.length} agences`,
    );

    // Export comptable.
    const csv = await fetch(`${API}/reporting/export?format=csv`, {
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });
    const octets = Buffer.from(await csv.arrayBuffer());
    check('l’export comptable est servi (200)', csv.status === 200, `reçu ${csv.status}`);
    check('il commence par un BOM UTF-8', octets.subarray(0, 3).toString('hex') === 'efbbbf');
    const lignes = octets.subarray(3).toString('utf8').split('\r\n');
    check('l’en-tête nomme les colonnes attendues', lignes[0] === 'Jour;Opérations;Volume (XOF);Commissions (XOF)', lignes[0]);
    check(
      'le fichier porte une ligne de TOTAL',
      lignes[lignes.length - 1].startsWith('TOTAL'),
      lignes[lignes.length - 1],
    );
    check(
      'le total du fichier correspond au rapport',
      lignes[lignes.length - 1].split(';')[1] === String(data?.totals?.operations),
      lignes[lignes.length - 1],
    );

    const exportOperateur = await call('GET', '/reporting/export', { token: operateur.accessToken });
    check(
      'l’export comptable reste réservé à l’encadrement (403)',
      exportOperateur.status === 403,
      `reçu ${exportOperateur.status}`,
    );
  }

  // ------------------------------------------------------------ conformité --
  section('Vigilance LCB-FT et plafonds');
  conformiteSection: {
    const client = await login(CLIENT);
    const seuil = 5_000_000; // réglage `lcbFtThresholdXof` du seed

    const clients = await call('GET', '/clients', { token: admin.accessToken });
    check('la liste des clients est lisible (200)', clients.status === 200, `reçu ${clients.status}`);
    check(
      'elle ne contient que des clients',
      (clients.data ?? []).length > 0 && (clients.data ?? []).every((row) => row.blocked !== undefined),
    );

    const operateur = await login(OPERATEUR);
    const refuse = await call('GET', '/clients', { token: operateur.accessToken });
    check('un opérateur ne gère pas les clients (403)', refuse.status === 403, `reçu ${refuse.status}`);

    const moussa = (clients.data ?? []).find((row) => row.phone === CLIENT.identifier);

    // Plafonds : consommation lisible par l'encadrement ET par le client.
    const limites = await call('GET', `/compliance/limits/${moussa.id}`, { token: admin.accessToken });
    check('les plafonds et leur consommation sont lisibles (200)', limites.status === 200, `reçu ${limites.status}`);
    check(
      'le reste à consommer est cohérent',
      Number(limites.data?.daily?.remainingXof) ===
        Math.max(Number(limites.data.daily.limitXof) - Number(limites.data.daily.usedXof), 0),
      JSON.stringify(limites.data?.daily),
    );
    const miennes = await call('GET', '/compliance/limits/me', { token: client.accessToken });
    check('un client voit ses propres plafonds (200)', miennes.status === 200, `reçu ${miennes.status}`);
    const autrui = await call('GET', `/compliance/limits/${moussa.id}`, { token: client.accessToken });
    check('il ne voit pas ceux d’autrui (403)', autrui.status === 403, `reçu ${autrui.status}`);

    // Déclenchement du seuil de déclaration : une opération au-dessus du seuil.
    const avant = await call('GET', '/compliance/alerts?resolved=false', { token: admin.accessToken });
    const grosse = await call('POST', '/transactions', {
      token: client.accessToken,
      body: {
        direction: 'VENTE_DEVISE',
        currencyCode: 'EUR',
        amount: seuil + 100_000,
        depositMethod: 'CARTE_BANCAIRE',
        payoutMethod: 'ESPECES_AGENCE',
      },
    });
    if (grosse.status !== 201) {
      skip(
        'déclenchement du seuil de déclaration',
        `création refusée (${grosse.status}) — plafond du client de démo probablement atteint`,
      );
      break conformiteSection;
    }

    const apres = await call('GET', '/compliance/alerts?resolved=false', { token: admin.accessToken });
    check(
      'une opération au-dessus du seuil lève une alerte',
      (apres.data ?? []).length > (avant.data ?? []).length,
      `${avant.data?.length} → ${apres.data?.length}`,
    );
    const alerte = (apres.data ?? []).find((row) => row.transaction?.id === grosse.data?.id);
    check('l’alerte cite la transaction concernée', alerte !== undefined);
    check('elle est classée CRITIQUE', alerte?.severity === 'CRITIQUE', String(alerte?.severity));
    check(
      'son message dit quoi faire, pas seulement qu’il y a un problème',
      /déclaration|dossier/i.test(String(alerte?.message)),
      String(alerte?.message),
    );
    check('elle nomme le client', alerte?.client?.phone === CLIENT.identifier);

    // Le signalement ne bloque PAS : la transaction existe bel et bien.
    check(
      'le signalement n’empêche pas l’opération',
      grosse.data?.status === 'CREEE',
      String(grosse.data?.status),
    );

    // Les alertes les plus graves remontent en tête de file.
    const severites = (apres.data ?? []).map((row) => row.severity);
    const rang = { CRITIQUE: 0, ALERTE: 1, INFO: 2 };
    check(
      'la file est ordonnée du plus grave au moins grave',
      severites.every((severity, index) => index === 0 || rang[severity] >= rang[severites[index - 1]]),
      severites.join(', '),
    );

    const traitee = await call('POST', `/compliance/alerts/${alerte.id}/resolve`, {
      token: admin.accessToken,
    });
    check('une alerte se marque traitée (201)', traitee.status === 201, `reçu ${traitee.status}`);
    const restantes = await call('GET', '/compliance/alerts?resolved=false', { token: admin.accessToken });
    check(
      'elle sort de la file sans disparaître de la base',
      (restantes.data ?? []).every((row) => row.id !== alerte.id),
    );
    const archivees = await call('GET', '/compliance/alerts?resolved=true', { token: admin.accessToken });
    check('elle reste consultable une fois traitée', (archivees.data ?? []).some((row) => row.id === alerte.id));

    const parClient = await call('GET', '/compliance/alerts', { token: client.accessToken });
    check('un client ne lit pas les alertes (403)', parClient.status === 403, `reçu ${parClient.status}`);

    // Blocage de compte : motif obligatoire, effet immédiat sur les opérations.
    const sansMotif = await call('POST', `/clients/${moussa.id}/block`, {
      token: admin.accessToken,
      body: { reason: 'court' },
    });
    check('bloquer sans motif explicite est refusé (400)', sansMotif.status === 400, `reçu ${sansMotif.status}`);

    const bloque = await call('POST', `/clients/${moussa.id}/block`, {
      token: admin.accessToken,
      body: { reason: 'Vérification complémentaire en cours sur l’origine des fonds.' },
    });
    check('le blocage motivé est accepté (201)', bloque.status === 201, `reçu ${bloque.status}`);

    const tentative = await call('POST', '/transactions', {
      token: client.accessToken,
      body: {
        direction: 'VENTE_DEVISE',
        currencyCode: 'EUR',
        amount: 20_000,
        depositMethod: 'WAVE',
        payoutMethod: 'ESPECES_AGENCE',
      },
    });
    check('un compte bloqué ne peut plus transiger (403)', tentative.status === 403, `reçu ${tentative.status}`);

    const debloque = await call('POST', `/clients/${moussa.id}/unblock`, { token: admin.accessToken });
    check('le déblocage rétablit le compte (201)', debloque.status === 201 && debloque.data?.blocked === false);

    // Plafonds : `null` rend la main au réglage global, ce n'est pas « zéro ».
    const posé = await call('PATCH', `/clients/${moussa.id}/limits`, {
      token: admin.accessToken,
      body: { dailyLimitXof: 123_456 },
    });
    check('un plafond se fixe par client (200)', posé.status === 200, `reçu ${posé.status}`);
    check('la valeur posée est bien reprise', Number(posé.data?.dailyLimitXof) === 123_456);

    const rendu = await call('PATCH', `/clients/${moussa.id}/limits`, {
      token: admin.accessToken,
      body: { dailyLimitXof: null },
    });
    check('remettre à null rend la main au réglage global', rendu.data?.dailyLimitXof === null);
    const herite = await call('GET', `/compliance/limits/${moussa.id}`, { token: admin.accessToken });
    check('le plafond est alors marqué comme hérité', herite.data?.daily?.inherited === true);

    // Remise en état : le compte de démo garde ses plafonds larges.
    await call('PATCH', `/clients/${moussa.id}/limits`, {
      token: admin.accessToken,
      body: { dailyLimitXof: 50_000_000, monthlyLimitXof: 500_000_000 },
    });

    const trace = await call('GET', '/audit?entity=User&take=20', { token: admin.accessToken });
    const actions = (trace.data ?? []).map((row) => row.action);
    check(
      'blocage, déblocage et plafonds sont tracés',
      actions.includes('client.block') && actions.includes('client.unblock') && actions.includes('client.limits'),
      actions.slice(0, 5).join(', '),
    );
  }

  // --------------------------------------------------------- notifications --
  section('Notifications et alertes de taux');
  {
    const client = await login(CLIENT);

    const canaux = await call('GET', '/notifications/channels', { token: admin.accessToken });
    check('les canaux disponibles sont listés (200)', canaux.status === 200, `reçu ${canaux.status}`);
    const parCanal = Object.fromEntries((canaux.data ?? []).map((row) => [row.channel, row.configured]));
    check('le push et l’email sont branchés', parCanal.PUSH === true && parCanal.EMAIL === true);
    // Sans identifiants, un transport payant doit se déclarer NON configuré —
    // faire croire à un envoi serait pire que ne rien envoyer.
    check(
      'WhatsApp et SMS s’annoncent non configurés faute d’identifiants',
      parCanal.WHATSAPP === false && parCanal.SMS === false,
      JSON.stringify(parCanal),
    );
    const parClient = await call('GET', '/notifications/channels', { token: client.accessToken });
    check('un client ne voit pas cette configuration (403)', parClient.status === 403, `reçu ${parClient.status}`);

    // Enregistrement d'appareil : idempotent, une réinstallation ne double pas.
    const jeton = 'ExponentPushToken[verification-hadjchanges]';
    const premier = await call('POST', '/notifications/devices', {
      token: client.accessToken,
      body: { token: jeton, platform: 'android' },
    });
    const second = await call('POST', '/notifications/devices', {
      token: client.accessToken,
      body: { token: jeton, platform: 'android' },
    });
    check('un appareil s’enregistre (200)', premier.status === 200, `reçu ${premier.status}`);
    check('le réenregistrer ne crée pas de doublon (200)', second.status === 200, `reçu ${second.status}`);
    const mauvais = await call('POST', '/notifications/devices', {
      token: client.accessToken,
      body: { token: 'court', platform: 'android' },
    });
    check('un jeton manifestement invalide est refusé (400)', mauvais.status === 400, `reçu ${mauvais.status}`);

    // Alerte de taux : on surveille l'euro sous un seuil très au-dessus du
    // cours, pour que la prochaine publication le déclenche à coup sûr.
    const board = (await call('GET', '/rates')).data ?? [];
    const eur = board.find((row) => row.currency.code === 'EUR');
    const seuil = Number(eur.sellRate) + 50;

    const posee = await call('POST', '/notifications/rate-alerts', {
      token: client.accessToken,
      body: { currencyCode: 'EUR', thresholdRate: seuil },
    });
    check('une alerte de taux se pose (201)', posee.status === 201, `reçu ${posee.status}`);
    check('elle est active et jamais déclenchée', posee.data?.active === true && posee.data?.triggeredAt === null);

    const doublon = await call('POST', '/notifications/rate-alerts', {
      token: client.accessToken,
      body: { currencyCode: 'EUR', thresholdRate: seuil + 1 },
    });
    const mesAlertes = await call('GET', '/notifications/rate-alerts', { token: client.accessToken });
    check('reposer la même devise met à jour au lieu d’empiler', doublon.status === 201);
    check(
      'une seule alerte par devise',
      (mesAlertes.data ?? []).filter((row) => row.currency.code === 'EUR').length === 1,
      `${mesAlertes.data?.length} alertes`,
    );

    const refusXof = await call('POST', '/notifications/rate-alerts', {
      token: client.accessToken,
      body: { currencyCode: 'XOF', thresholdRate: 1 },
    });
    check('surveiller la devise de référence est refusé (404)', refusXof.status === 404, `reçu ${refusXof.status}`);

    // Publication sous le seuil → l'alerte doit partir.
    const avant = await call('GET', '/notifications', { token: client.accessToken });
    await call('POST', '/rates', {
      token: admin.accessToken,
      body: {
        currencyCode: 'EUR',
        buyRate: Number(eur.buyRate),
        sellRate: Number(eur.sellRate),
        commissionPct: Number(eur.commissionPct),
      },
    });

    const apres = await call('GET', '/notifications', { token: client.accessToken });
    check(
      'publier un taux sous le seuil notifie le client',
      (apres.data ?? []).length > (avant.data ?? []).length,
      `${avant.data?.length} → ${apres.data?.length}`,
    );
    const message = (apres.data ?? [])[0];
    check('la notification nomme la devise et le seuil', /EUR/.test(String(message?.title)));
    check('elle renvoie vers le simulateur', message?.deepLink === '/simulateur');

    // Désarmement : une alerte déclenchée ne se répète pas à chaque publication.
    const apresDeclenchement = await call('GET', '/notifications/rate-alerts', { token: client.accessToken });
    const desarmee = (apresDeclenchement.data ?? []).find((row) => row.currency.code === 'EUR');
    check(
      'l’alerte déclenchée est désarmée, pas répétée',
      desarmee?.active === false && desarmee?.triggeredAt !== null,
      JSON.stringify(desarmee),
    );

    const compteur = await call('GET', '/notifications/unread-count', { token: client.accessToken });
    check('les non-lues sont comptées', Number(compteur.data?.unread) > 0, JSON.stringify(compteur.data));
    const lues = await call('POST', '/notifications/read', { token: client.accessToken });
    check('tout marquer lu fonctionne (200)', lues.status === 200 && Number(lues.data?.marked) > 0);
    const apresLecture = await call('GET', '/notifications/unread-count', { token: client.accessToken });
    check('le compteur retombe à zéro', Number(apresLecture.data?.unread) === 0);

    const suppression = await call('DELETE', `/notifications/rate-alerts/${desarmee.id}`, {
      token: client.accessToken,
    });
    check('une alerte se retire (200)', suppression.status === 200, `reçu ${suppression.status}`);

    // Le courriel part-il VRAIMENT ? Mailpit reçoit tout en développement.
    try {
      const boite = await fetch('http://localhost:8036/api/v1/messages?limit=20');
      if (!boite.ok) throw new Error(String(boite.status));
      const { messages = [] } = await boite.json();
      const recu = messages.find((mail) => /EUR/.test(mail.Subject ?? ''));
      check(
        'le courriel d’alerte est réellement remis (Mailpit)',
        recu !== undefined,
        `${messages.length} message(s) en boîte`,
      );
      check(
        'il part de l’adresse du bureau',
        /hadjchanges/i.test(recu?.From?.Address ?? ''),
        String(recu?.From?.Address),
      );
    } catch (error) {
      skip('remise du courriel', `Mailpit injoignable sur 8036 (${String(error)})`);
    }
  }

  // ------------------------------------------------------- gestion d'équipe --
  section('Création et droits des comptes internes');
  {
    const superAdmin = await login({ identifier: '0700000001', password: ADMIN.password });
    const suffix = Date.now().toString().slice(-6);
    const phone = `0788${suffix}`;

    // Créer un compte interne est réservé au SUPER-administrateur.
    const parAdmin = await call('POST', '/staff', {
      token: admin.accessToken,
      body: { firstName: 'Test', lastName: 'Refuse', phone, role: 'OPERATEUR' },
    });
    check('un administrateur ne crée pas de compte interne (403)', parAdmin.status === 403, `reçu ${parAdmin.status}`);

    const cree = await call('POST', '/staff', {
      token: superAdmin.accessToken,
      body: { firstName: 'Konan', lastName: 'Verif', phone, role: 'OPERATEUR' },
    });
    check('le super-administrateur crée un compte (201)', cree.status === 201, `reçu ${cree.status}`);
    check('le rôle demandé est appliqué', cree.data?.role === 'OPERATEUR');

    // Le mot de passe provisoire doit RÉELLEMENT ouvrir la session : le rendre
    // sans qu'il fonctionne serait le pire des deux mondes.
    const motDePasse = cree.data?.temporaryPassword ?? '';
    check('un mot de passe provisoire est rendu', motDePasse.length >= 12, `${motDePasse.length} caractères`);
    const ouverture = await call('POST', '/auth/login', { body: { identifier: phone, password: motDePasse } });
    check('ce mot de passe ouvre bien la session (200)', ouverture.status === 200, `reçu ${ouverture.status}`);

    const doublon = await call('POST', '/staff', {
      token: superAdmin.accessToken,
      body: { firstName: 'Autre', lastName: 'Personne', phone, role: 'ADMIN' },
    });
    check('un téléphone déjà pris est refusé (409)', doublon.status === 409, `reçu ${doublon.status}`);

    // Garde-fous : on ne se retire pas ses propres droits.
    const autoRole = await call('PATCH', `/staff/${superAdmin.user.id}/role`, {
      token: superAdmin.accessToken,
      body: { role: 'OPERATEUR' },
    });
    check('changer son propre rôle est refusé (409)', autoRole.status === 409, `reçu ${autoRole.status}`);
    const autoSuspension = await call('POST', `/staff/${superAdmin.user.id}/access`, {
      token: superAdmin.accessToken,
      body: { suspended: true, reason: 'test' },
    });
    check('se suspendre soi-même est refusé (409)', autoSuspension.status === 409, `reçu ${autoSuspension.status}`);

    // Suspension d'un agent : l'accès tombe immédiatement.
    const suspendu = await call('POST', `/staff/${cree.data.id}/access`, {
      token: superAdmin.accessToken,
      body: { suspended: true, reason: 'Fin de mission.' },
    });
    check('un agent se suspend (201)', suspendu.status === 201, `reçu ${suspendu.status}`);
    const bloque = await call('GET', '/users/me', { token: ouverture.data.accessToken });
    check(
      'sa session en cours ne passe plus (403)',
      bloque.status === 403,
      `reçu ${bloque.status}`,
    );

    await call('POST', `/staff/${cree.data.id}/access`, {
      token: superAdmin.accessToken,
      body: { suspended: false },
    });
    const retabli = await call('GET', '/users/me', { token: ouverture.data.accessToken });
    check('le rétablissement rouvre l’accès (200)', retabli.status === 200, `reçu ${retabli.status}`);

    const promu = await call('PATCH', `/staff/${cree.data.id}/role`, {
      token: superAdmin.accessToken,
      body: { role: 'ADMIN' },
    });
    check('un opérateur peut être promu administrateur', promu.data?.role === 'ADMIN');
    check(
      'promu administrateur, il perd son rattachement d’agence',
      promu.data?.agencyId === null,
      String(promu.data?.agencyId),
    );

    const trace = await call('GET', '/audit?entity=User&take=30', { token: admin.accessToken });
    const actions = (trace.data ?? []).map((row) => row.action);
    check(
      'création, suspension et changement de rôle sont tracés',
      actions.includes('staff.create') &&
        actions.includes('staff.suspend') &&
        actions.includes('staff.change_role'),
      actions.slice(0, 5).join(', '),
    );
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
