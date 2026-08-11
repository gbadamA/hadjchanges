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

## État

Brique 0 (**scaffold**) posée : structure, documentation de fondation, modèle de données complet,
design system des deux surfaces, configuration Docker et environnement.
**Aucune dépendance n'est encore installée et rien ne tourne** — voir la roadmap au §9 de
[CLAUDE.md](CLAUDE.md) pour la suite.
