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

  // ------------------------------------------------------------------ bilan --
  console.log(`\n${'='.repeat(60)}`);
  console.log(`${passed} vérifications passées · ${failed} échouées · ${skipped} ignorées`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error('\nLa vérification a échoué :', error.message);
  process.exitCode = 1;
});
