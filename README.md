# HadjChanges

Plateforme de **bureau de change** : dashboard web pour l'exploitant, application mobile pour le
client final. Devise de référence **FCFA (XOF)**.

- 🗺️ **Où est quoi** → [claudemap.md](claudemap.md)
- 📘 **Règles et décisions** → [CLAUDE.md](CLAUDE.md)
- 📄 **Specs client** → [cahier-des-charges.md](cahier-des-charges.md)

---

## Démarrage

### 1. Services

```bash
docker compose up -d
```

Postgres sur **54360**, Mailpit (boîte mail locale) sur **http://localhost:8036**.

### 2. API — http://localhost:3061

```bash
cd api && cp ../.env.example .env && npm install && npx prisma migrate dev && npm run start:dev
```

### 3. Dashboard — http://localhost:3060

```bash
cd admin && npm install && npm run dev
```

### 4. Mobile — Expo Go

```bash
cd mobile && npm install && npx expo start
```

Scanner le QR avec **Expo Go**, téléphone et PC sur le même Wi-Fi.
⚠️ Renseigner l'**IP Wi-Fi du PC** dans `mobile/.env` (`EXPO_PUBLIC_API_URL`) : depuis un téléphone,
`localhost` désigne le téléphone.

---

## Ports

| Service | Port |
|---|---|
| Dashboard (Next.js) | 3060 |
| API (NestJS) | 3061 |
| PostgreSQL | 54360 |
| Mailpit (web / SMTP) | 8036 / 1036 |

---

## Vérifier le socle

```bash
node scripts-verif/api-check.mjs
```

Comptes du seed : admin `0700000002` / `Admin@2026`, client vérifié `0709000001` / `Client@2026`
(liste complète au §10 de [claudemap.md](claudemap.md)).

---

## État

- **Brique 0 — scaffold** 🟢 structure, documentation, modèle de données, design des deux surfaces.
- **Brique 1 — socle** 🟢 migrations, auth JWT + RBAC, devises, taux versionnés, agences, audit,
  seed ivoirien. Vérifié : `api-check.mjs` **39/39**, `tsc --noEmit` 0 erreur sur l'API et le mobile.
- **Mobile** : écran « taux du jour » branché sur l'API réelle (Expo SDK 57).
- **Dashboard** : design system posé, aucune page encore écrite.

Suite : brique 2 (simulateur + verrou de taux + WebSocket). Roadmap complète au §9 de
[CLAUDE.md](CLAUDE.md).
