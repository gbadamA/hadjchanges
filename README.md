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
  seed ivoirien.
- **Brique 2 — simulateur** 🟢 simulation publique, verrou de taux (`Quote`), diffusion des taux
  en direct par WebSocket, comptes clients sur mobile.
- **Brique 3 — KYC** 🟢 dépôt de pièce et selfie sur mobile, file de validation au dashboard,
  décision motivée notifiée au client, journal d'audit consultable.
- **Brique 4 — transaction** 🟢 création depuis un devis verrouillé, import du reçu, file de
  contrôle au dashboard, exécution du change et mouvements de caisse, suivi horodaté côté client.
- **Brique 5 — suivi** 🟢 justificatif PDF émis à la clôture, historique filtrable côté client,
  exports Excel et CSV côté dashboard.
- **Brique 6 — caisses** 🟢 soldes par devise, alimentation et retrait, clôture journalière par
  comptage avec constat d'écart, affectation des opérateurs aux agences.
- **Brique 7 — reporting** 🟢 volumes réalisés, commissions, séries journalières et répartitions,
  graphiques SVG maison, export comptable CSV.
- **Brique 8 — conformité** 🟢 vigilance LCB-FT (seuil, fractionnement, compte récent, rythme),
  plafonds et blocage par client, journal d’audit consultable.
- **Brique 9 — notifications** 🟢 Expo Push et courriel branchés, WhatsApp/SMS prêts (clés à
  renseigner), alertes de taux favorable côté client.

**La roadmap est terminée** : les phases 1 à 3 du cahier des charges sont couvertes.
- **Mobile** (Expo SDK 57) : taux poussés en direct, simulateur, verrou, comptes, vérification
  d’identité, opération de change complète et suivi.
- **Dashboard** : les 10 modules sont en place — identités, reçus, transactions, taux, clients,
  caisses, agences, rapports, équipe, conformité, audit.

Vérifié : `api-check.mjs` **261/261**, `tsc --noEmit` 0 erreur sur les trois briques, et la boucle
complète constatée dans le navigateur — simulation → verrou → opération → reçu → validation au
dashboard → change exécuté → fonds disponibles → suivi horodaté côté client.

---

## Mise en service

### Canaux WhatsApp et SMS

Renseigner `WHATSAPP_TOKEN` / `WHATSAPP_PHONE_ID` (Meta Cloud API) et
`TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM` dans `api/.env`, puis vérifier :

```bash
curl -s -X POST http://localhost:3061/api/notifications/test -H "content-type: application/json" -H "authorization: Bearer <jeton-admin>" -d '{"channel":"WHATSAPP"}'
```

Le message part **vers le compte appelant**, jamais vers un numéro choisi. Tant que les clés
manquent, `GET /notifications/channels` répond `configured: false` — le service passe simplement au
canal suivant.

### Stockage des fichiers sur S3

Poser `STORAGE_DRIVER=s3` + `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` (et `S3_ENDPOINT` hors
AWS). ⚠️ **Le compartiment doit être privé** : on y dépose des pièces d’identité, la lecture passe
toujours par l’API. Un `STORAGE_DRIVER=s3` incomplet **arrête le démarrage** au lieu de retomber en
silence sur le disque.

Pour l’éprouver en local, un MinIO est fourni :

```bash
docker compose up -d minio && docker exec hadjchanges-minio mc alias set local http://localhost:9000 hadjchanges hadjchanges-secret && docker exec hadjchanges-minio mc mb local/hadjchanges-files
```

### Données à saisir par l’exploitant

Les **taux du seed sont plausibles mais pas officiels** (seule la parité EUR/XOF est fixe), et les
**numéros de dépôt mobile money sont fictifs**. Les uns se saisissent dans `/taux`, les autres dans
`/reglages`.

Roadmap complète au §9 de [CLAUDE.md](CLAUDE.md).
