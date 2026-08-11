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
- **Dashboard** : identités, reçus, transactions, caisses, rapports, clients, conformité, audit.
  Les modules à venir
  apparaissent grisés dans le menu tant qu’ils n’existent pas.

Vérifié : `api-check.mjs` **247/247**, `tsc --noEmit` 0 erreur sur les trois briques, et la boucle
complète constatée dans le navigateur — simulation → verrou → opération → reçu → validation au
dashboard → change exécuté → fonds disponibles → suivi horodaté côté client.

Reste à faire avant mise en ligne : renseigner les clés WhatsApp Business et Twilio, remplacer les
taux du seed par les taux réels de l’exploitant, basculer le stockage de fichiers sur S3, et
déployer. Roadmap complète au §9 de [CLAUDE.md](CLAUDE.md).
