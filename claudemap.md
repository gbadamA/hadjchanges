# 🗺️ ClaudeMap — HadjChanges

Carte de navigation du projet. Le « tu es ici » pour s'orienter en 30 secondes.
Pour les règles et les décisions, voir [CLAUDE.md](CLAUDE.md). Ce fichier, c'est le plan.

---

## 1. Identité du projet

| | |
|---|---|
| **Nom** | HadjChanges |
| **Produit** | Plateforme de bureau de change — dashboard exploitant + app mobile client |
| **Devise de référence** | FCFA (**XOF**) · échangée contre EUR, USD, GBP, SAR… configurables |
| **Emplacement** | `C:\dev\hadjchanges` — **hors OneDrive** (Metro/Expo, voir CLAUDE.md §2) |
| **Specs client** | [cahier-des-charges.md](cahier-des-charges.md) — lecture seule |
| **Design dashboard** | DA « bleu diplomatique & or », reprise de [`C:\dev\fi-hadj`](file:///C:/dev/fi-hadj) |
| **Design mobile** | patterns d'**AutoPièce CI** (`projets/pieces-auto-marketplace/mobile`) |
| **Dépôt** | git local, branche `main`. Pas de remote pour l'instant. |

**Promesse produit :** un client change ses devises depuis son téléphone sans mettre les pieds au
guichet, et l'exploitant garde le contrôle — identité vérifiée, reçu contrôlé, taux verrouillé,
caisse tenue, tout tracé.

---

## 2. Vue d'ensemble

```
                        ┌──────────────────────────────┐
                        │        HadjChanges            │
                        │   bureau de change XOF ⇄ ⧉    │
                        │  KYC bloquant + reçu validé   │
                        └──────────────┬───────────────┘
             ┌─────────────────────────┼─────────────────────────┐
             ▼                         ▼                         ▼
     ┌───────────────┐        ┌───────────────┐         ┌───────────────┐
     │    mobile/    │        │     api/      │         │    admin/     │
     │  React Expo   │◄──────►│ NestJS+Prisma │◄───────►│   Next.js     │
     │ client final  │ REST+WS│  PostgreSQL   │ REST+WS │  dashboard    │
     └───────────────┘        └───────┬───────┘         └───────────────┘
                                      ▼
                            ┌───────────────────┐
                            │ PostgreSQL :54360 │
                            └───────────────────┘
```

| Brique | Dossier | Port | Statut | Rôle |
|--------|---------|------|--------|------|
| API | `api/` | 3061 | 🟢 auth, taux, simulation, KYC, **transactions + reçus + caisse**, audit | Cœur métier : taux, KYC, transactions, caisses, audit |
| Dashboard | `admin/` | 3060 | 🟢 12 modules, dont le **guichet** (client au comptoir) | Admin / opérateur : guichet, validation, pilotage, reporting |
| Mobile | `mobile/` | Expo Go | 🟢 taux, simulateur, KYC, **opération complète + suivi** | Client final : taux, simulateur, transaction, suivi |

---

## 3. Carte des fichiers

```
hadjchanges/
├── CLAUDE.md              📘 Fondation : règles, rôles, décisions actées
├── claudemap.md           🗺️ CE FICHIER : la carte de navigation
├── README.md              ▶️ Démarrage rapide
├── cahier-des-charges.md  📄 Specs client d'origine (lecture seule)
├── .env.example           🔑 Modèle des variables (jamais de vraie valeur)
├── docker-compose.yml     🐳 Postgres 16 (54360) + Mailpit (8036)
│
├── api/                   NestJS 11 + Prisma 6
│   ├── prisma/
│   │   ├── schema.prisma  🗄️ LE modèle de données (backbone) — voir §4
│   │   └── seed.ts        🌱 devises, taux, agences d'Abidjan, comptes de démo
│   └── src/
│       ├── config/env.ts  🟢 validation Zod des variables AU DÉMARRAGE
│       ├── prisma/        🟢 accès DB (PrismaService @Global)
│       ├── common/        🟢 guards JWT/Roles, @CurrentUser, pont Zod, helpers Decimal
│       ├── auth/          🟢 inscription, connexion, rotation stricte du refresh
│       ├── users/         🟢 /users/me · (à venir : plafonds, blocage)
│       ├── audit/         🟢 AuditService (traçabilité)
│       ├── settings/      🟢 réglages base > env > défaut
│       ├── currencies/    🟢 devises (CRUD)
│       ├── rates/         🟢 taux versionnés + historique + variation + fraîcheur
│       ├── agencies/      🟢 agences (CRUD)
│       ├── quotes/        🟢 simulation + verrouillage — `quote-calculator.ts` = LE calcul du change
│       ├── realtime/      🟢 passerelle WebSocket `/rates` (diffusion des taux)
│       ├── kyc/           🟢 dépôt de pièce + file de validation + décisions tracées
│       ├── storage/       🟢 port + adaptateurs local/S3 — clés opaques, JAMAIS servi en statique
│       ├── notifications/ 🟢 transports (Expo Push, email, WhatsApp, SMS) + alertes de taux
│       ├── transactions/  🟢 machine à états + reçus + `exchange-executor.ts` (l'argent bouge ici)
│       │                    + `counter.service.ts` 🏦 le parcours GUICHET
│       ├── cash/          🟢 mouvements, soldes (cache recalculable), clôture journalière
│       ├── compliance/    🟢 règles de vigilance (fonctions pures) + alertes + plafonds
│       ├── documents/     🟢 justificatif PDF (PDFKit) + exports xlsx/CSV
│       └── reporting/     🟢 volumes, commissions, séries et répartitions + export comptable
│
├── scripts-verif/
│   └── api-check.mjs      ✅ vérification exécutable de bout en bout (293 contrôles)
│
├── admin/                 Next.js 15 (App Router)
│   └── src/
│       ├── lib/tokens.ts     🎨 SOURCE DE VÉRITÉ visuelle (miroir du tailwind.config)
│       ├── lib/api.ts        🔌 client API — 1 SEUL point d'accès réseau
│       ├── lib/auth.tsx      🔐 session équipe (access token EN MÉMOIRE)
│       ├── lib/navigation.ts 🧭 matrice du menu — MÊME matrice que les @Roles de l'API
│       ├── components/charts.tsx 📈 AreaChart · BarList · Donut — SVG maison, animés une fois
│       └── app/
│           ├── login         🟢 connexion équipe
│           └── (dash)/       🟢 les 12 modules : guichet, kyc, recus, transactions, taux,
│                             clients, caisses, agences, rapports, equipe, conformite,
│                             audit, reglages
│
└── mobile/                📱 React Expo 57
    ├── app.json           ⚙️ Config Expo (safe-area, back gesture off)
    └── src/
        ├── theme.ts       🎨 Tokens (C couleurs, G dégradés, R, S, F, T, shadow)
        ├── ui.tsx         🧱 Primitives SANS navigation (Screen, Card, Button, Badge,
        │                     FormScreen clavier-safe, Field, Segmented, ErrorBanner)
        ├── components.tsx 🧩 Composés métier (RateCard · à venir : TxTimeline…)
        ├── models.ts      📐 Types miroirs du contrat API + helpers (fcfa, formatRate)
        ├── api.ts         🔌 Client HTTP — 1 SEUL point d'accès réseau
        ├── useApi.ts      ⏳ Hook useAsync (loading / error / reload)
        ├── auth.tsx       🟢 Auth JWT persistée + promesse de refresh PARTAGÉE
        ├── useRates.ts    🟢 taux du jour, tenus à jour par WebSocket
        ├── push.ts        🟢 enregistrement de l'appareil (silencieux sur émulateur)
        └── app/           🖥️ Écrans (Expo Router) — voir §6
```

**Règle de séparation (SRP)** : `theme` = tokens, `ui` = primitives pures, `components` = composés
qui peuvent naviguer, `app` = écrans, `api`+`models` = données. Jamais deux rôles dans un fichier.

---

## 4. Carte du modèle de données (`api/prisma/schema.prisma`)

```
IDENTITÉ & CONFORMITÉ        DEVISES & TAUX          TRANSACTION
─────────────────────        ──────────────          ───────────
User ─┬─ KycDocument          Currency               Transaction ─┬─ PaymentReceipt
      ├─ RefreshToken           └─ ExchangeRate ────┐            │ ├─ CashMovement
      ├─ RateAlert                 (versionné,      │            │ └─ ComplianceAlert
      ├─ PushToken                  par agence)     ▼            │
      ├─ Notification                          Quote ────────────┘
      ├─ Quote                              (taux verrouillé,
      └─ ComplianceAlert                     consommable 1 fois)  RÉSEAU
                                                      ──────
ADMIN                                                 Agency ─┬─ CashBalance  (cache)
─────                                                         ├─ CashMovement (vérité)
AuditLog · Setting                                            ├─ CashClosure ─ Line
                                                              └─ User (opérateurs)
```

Quatre groupes : **identité/conformité** (KYC, plafonds, alertes LCB-FT), **devises/taux** (table
de taux versionnée, jamais écrasée), **transaction** (le devis fige le prix, la transaction
l'exécute, la caisse enregistre), **réseau** (agences et caisses par devise).

Les trois invariants du schéma sont commentés en tête du fichier — les lire avant de le modifier.

---

## 5. Flux d'une transaction (le cœur du produit)

```
  simulation ──verrou du taux (30 min)──► CREEE ──reçu importé──► RECU_SOUMIS
   (libre, sans compte)   🟢 Quote          │                          │
                                            └─► ANNULEE      opérateur │
                                                                       ▼
                              RECU_REJETE ◄──rejet (motif)──┬──validation──► RECU_VALIDE
                                    │                                             │
                              (redépôt)                              exécution du change
                                    │                            (taux figé + mouvements caisse)
                                    └────────────────────────────────────► CHANGE_EXECUTE
                                                                                  ▼
                                                                       PRETE_POUR_RETRAIT
                                                          (espèces agence / mobile money / virement)
                                                                                  ▼
                                                                     CLOTUREE  + justificatif PDF
```

⚠️ **Rien ne démarre sans KYC `VALIDE`** — vérifié côté API, pas seulement dans l'UI.
Détail et invariants : [CLAUDE.md §5](CLAUDE.md).

---

## 6. Carte des écrans

### Mobile (client)

```
index (Accueil public) 🟢  ── taux du jour EN DIRECT, sans compte
   ├─► simulateur 🟢 ──► verrou du taux ──┬─ connecté ─► devis garanti 30 min
   │                                      └─ anonyme ──► connexion
   ├─► connexion 🟢 ─────┐
   ├─► inscription 🟢 ───┤
   └─► compte 🟢 ────────┘  profil + statut KYC + déconnexion
                            │
                            ▼  (à venir)
                      kyc (dépôt CNI + selfie)  ⛔ bloquant pour transiger
                            ▼
                      (tabs) 🏠  operations · transaction/[id]
```

⚠️ **Pas encore de barre d'onglets** : elle arrivera avec « mes opérations » (brique 5). Tant qu'il
n'y a qu'un parcours, une pile suffit — une barre à un seul onglet ne sert personne.

| Écran | Fichier | Point clé design |
|---|---|---|
| Accueil public 🟢 | `app/index.tsx` | Bleu nuit immersif, halos, taux **poussés par WebSocket**, carte qui s'allume en or à la mise à jour |
| Simulateur 🟢 | `app/simulateur.tsx` | Taux **et** commission affichés avant tout engagement, verrou en or avec compte à rebours |
| Connexion 🟢 | `app/connexion.tsx` | `FormScreen` : le clavier ne masque jamais le champ, erreur toujours affichée |
| Inscription 🟢 | `app/inscription.tsx` | Annonce le KYC **dès l'inscription** : pas de blocage découvert au moment de payer |
| Compte 🟢 | `app/compte.tsx` | Statut KYC coloré comme au dashboard, motif de rejet visible |
| KYC 🟢 | `app/kyc.tsx` | Dépôt CNI + selfie, états en attente / rejeté (motif) / validé |
| Onglets | `app/(tabs)/_layout.tsx` | Barre **flottante** au-dessus des gestes système |
| Opérations 🟢 | `app/operations.tsx` | Historique filtrable par statut + export CSV partageable |
| Détail | `app/transaction/[id].tsx` | Timeline des 8 statuts, import du reçu, PDF final |
| Profil | `app/(tabs)/profil.tsx` | Statut KYC, plafonds consommés, alertes de taux |

### Dashboard (admin / opérateur)

| Page | Route | Rôle |
|---|---|---|
| Connexion 🟢 | `/login` | équipe (2FA à venir) |
| Vue d'ensemble | `/(dash)` | volumes, commissions, top devises, alertes |
| Taux 🟢 | `/(dash)/taux` | publier (pré-rempli sur le taux en vigueur), marge calculée en direct, garde-fou d’inversion, historique |
| Reçus | `/(dash)/recus` | **file de validation** des preuves de paiement |
| KYC 🟢 | `/(dash)/kyc` | **file de validation** des identités, pièce affichée après contrôle des droits |
| Reçus 🟢 | `/(dash)/recus` | **file de contrôle** : montant attendu en évidence, valider exécute le change |
| Transactions 🟢 | `/(dash)/transactions` | liste filtrable, exports Excel/CSV, justificatif PDF |
| Transactions | `/(dash)/transactions` | liste temps réel, filtres, détail, export |
| Clients 🟢 | `/(dash)/clients` | recherche, jauges de plafond, blocage motivé |
| Agences 🟢 | `/(dash)/agences` | agence + **son encaisse** + **ses opérateurs**, réunis sur un écran |
| Caisses 🟢 | `/(dash)/caisses` | soldes par devise, mouvementer, **clôture par comptage** avec écart en direct |
| Rapports 🟢 | `/(dash)/rapports` | bandeau dégradé, KPI soulevés, courbe tracée, anneau, export |
| Équipe 🟢 | `/(dash)/equipe` | création avec mot de passe provisoire affiché une fois, rôles, suspension |
| Audit | `/(dash)/audit` | journal d'activité |

---

## 7. Carte des rôles (RBAC)

```
APP MOBILE                    DASHBOARD
──────────                    ─────────
CLIENT ── simule, dépose      OPERATEUR   ── reçus + caisse de SON agence
          un reçu, suit       ADMIN       ── taux, clients, KYC, agences, rapports
                              SUPER_ADMIN ── tout + équipe + réglages + audit
```

Un opérateur ne modifie **jamais** un taux ni un plafond, et ne voit que son agence.

---

## 8. Roadmap (statut)

```
[🟢] 0. Scaffold      structure + CLAUDE.md + claudemap + schéma Prisma + design des 2 surfaces
[🟢] 1. Socle         Docker + migrations + auth JWT/RBAC + seed CI + devises & taux versionnés
                      → vérifié : scripts-verif/api-check.mjs, 39/39
[🟢] 2. Simulateur    simulateur mobile + verrou de taux (Quote) + WebSocket + comptes mobiles
                      → vérifié : scripts-verif/api-check.mjs, 65/65
[🟢] 3. KYC           dépôt mobile + file de validation dashboard + notification + audit lisible
                      → vérifié : api-check.mjs 96/96 + boucle complète dans le navigateur
[🟢] 4. Transaction   création + reçu + validation + exécution du change + mouvements de caisse
                      → vérifié : api-check.mjs 131/131 + boucle complète dans le navigateur
[🟢] 5. Suivi         historique filtrable + justificatif PDF + exports Excel/CSV
                      → vérifié : api-check.mjs 148/148 + téléchargements constatés dans les 2 fronts
[🟢] 6. Caisses       soldes + mouvements + clôture journalière + affectation des agents
                      → vérifié : api-check.mjs 178/178 + clôture avec écart dans le navigateur
[🟢] 7. Reporting     volumes, commissions, graphiques SVG maison, export comptable
                      → vérifié : api-check.mjs 198/198 + rendu et export dans le navigateur
[🟢] 8. Conformité    vigilance LCB-FT + plafonds/blocage client + journal d'audit
                      → vérifié : api-check.mjs 225/225 + alertes réelles dans le navigateur
[🟢] 9. Notifications Expo Push + email + WhatsApp/SMS + alertes de taux favorable
                      → vérifié : api-check.mjs 247/247, courriel réellement remis (Mailpit)
```

Correspondance cahier §7 : **phase 1** = briques 1-5 · **phase 2** = 6 + 9 · **phase 3** = 7 + 8.

---

## 9. Où trouver quoi (index rapide)

| Je cherche… | C'est dans… |
|---|---|
| Les règles, décisions, conventions | `CLAUDE.md` |
| Le modèle de données | `api/prisma/schema.prisma` |
| Les couleurs du dashboard | `admin/src/lib/tokens.ts` (+ `admin/tailwind.config.ts`, son miroir) |
| Les couleurs / ombres / typo du mobile | `mobile/src/theme.ts` |
| Un bouton, une carte, un champ (mobile) | `mobile/src/ui.tsx` |
| Le branchement API mobile (et l'IP Wi-Fi) | `mobile/src/api.ts` |
| Un écran précis | §6 ci-dessus |
| Les ports et les variables | `.env.example` · `docker-compose.yml` |
| Comment démarrer | `README.md` |

---

## 10. Démarrer

```bash
docker compose up -d
```

```bash
cd C:/dev/hadjchanges/api && npm install && npx prisma migrate dev && npm run start:dev
```

```bash
cd C:/dev/hadjchanges/admin && npm install && npm run dev
```

```bash
cd C:/dev/hadjchanges/mobile && npm install && npx expo start
```

Scanner le QR avec **Expo Go** (téléphone et PC sur le même Wi-Fi). L'IP de l'API se règle dans
`mobile/.env` (`EXPO_PUBLIC_API_URL`) — `localhost` ne veut rien dire depuis un téléphone.

### Vérifier que le socle tient toujours

```bash
node C:/dev/hadjchanges/scripts-verif/api-check.mjs
```

39 contrôles de forme et de cohérence sur l'API (accès public, RBAC, append-only des taux, rotation
des jetons). Il ne teste **aucune valeur de contenu** : le jeu de données peut changer sans le casser.

### Comptes du seed

| Rôle | Identifiant | Mot de passe |
|---|---|---|
| Super-admin | `0700000001` | `Admin@2026` |
| Admin | `0700000002` | `Admin@2026` |
| Opérateur (Plateau) | `0700000003` | `Admin@2026` |
| Client KYC validé | `0709000001` | `Client@2026` |
| Client KYC en attente | `0709000002` | `Client@2026` |
| Client KYC rejeté | `0709000003` | `Client@2026` |
