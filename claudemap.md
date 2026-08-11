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
| API | `api/` | 3061 | ⚪ scaffold | Cœur métier : taux, KYC, transactions, caisses, audit |
| Dashboard | `admin/` | 3060 | ⚪ scaffold | Admin / opérateur : validation, pilotage, reporting |
| Mobile | `mobile/` | Expo Go | ⚪ scaffold | Client final : taux, simulateur, transaction, suivi |

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
│       ├── prisma/        accès DB (PrismaService @Global)
│       ├── common/        guards JWT/Roles, @CurrentUser, filtres d'erreur
│       ├── auth/          inscription, connexion, refresh, 2FA interne
│       ├── users/         clients, plafonds, blocage
│       ├── kyc/           dépôt de pièce + file de validation
│       ├── currencies/    devises (CRUD)
│       ├── rates/         taux versionnés + historique + alerte de fraîcheur
│       ├── quotes/        simulation + verrouillage du taux
│       ├── transactions/  state machine + exécution du change
│       ├── receipts/      import + validation des preuves de paiement
│       ├── agencies/      agences, affectation des opérateurs
│       ├── cash/          soldes par devise, mouvements, clôture
│       ├── compliance/    seuils LCB-FT, alertes
│       ├── reporting/     volumes, commissions, exports
│       ├── notifications/ Expo Push · WhatsApp/SMS · email
│       ├── storage/       port fichiers (disque en dev, S3 en prod)
│       ├── realtime/      passerelle WebSocket (taux + statuts)
│       └── audit/         AuditService (traçabilité)
│
├── admin/                 Next.js 15 (App Router)
│   └── src/
│       ├── lib/tokens.ts  🎨 SOURCE DE VÉRITÉ visuelle (miroir du preset Tailwind)
│       ├── lib/api.ts     🔌 client API
│       └── app/
│           ├── login
│           └── (dash)/    taux · transactions · reçus · kyc · clients ·
│                          agences · caisses · rapports · equipe · audit
│
└── mobile/                📱 React Expo 54
    ├── app.json           ⚙️ Config Expo (safe-area, back gesture off)
    └── src/
        ├── theme.ts       🎨 Tokens (C couleurs, G dégradés, R, S, F, T, shadow)
        ├── ui.tsx         🧱 Primitives SANS navigation (Button, Card, Field, OTP…)
        ├── components.tsx 🧩 Composés métier (RateCard, TxTimeline, CurrencyPicker…)
        ├── models.ts      📐 Types + helpers (fcfa, statuts, libellés)
        ├── api.ts         🔌 Client HTTP — 1 SEUL point d'accès réseau
        ├── useApi.ts      ⏳ Hook useAsync (loading / error / reload)
        ├── auth.tsx       🔐 Auth JWT persistée (AsyncStorage)
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
      ├─ RateAlert              └─ ExchangeRate ─────────────────┘ ├─ CashMovement
      ├─ PushToken                 (versionné,                     └─ ComplianceAlert
      ├─ Notification               par agence)
      └─ ComplianceAlert                              RÉSEAU
                                                      ──────
ADMIN                                                 Agency ─┬─ CashBalance  (cache)
─────                                                         ├─ CashMovement (vérité)
AuditLog · Setting                                            └─ User (opérateurs)
```

Quatre groupes : **identité/conformité** (KYC, plafonds, alertes LCB-FT), **devises/taux** (table
de taux versionnée, jamais écrasée), **transaction** (change + reçu + mouvements de caisse générés),
**réseau** (agences et caisses par devise).

Les trois invariants du schéma sont commentés en tête du fichier — les lire avant de le modifier.

---

## 5. Flux d'une transaction (le cœur du produit)

```
  simulation ──verrou du taux (30 min)──► CREEE ──reçu importé──► RECU_SOUMIS
   (libre, sans compte)                     │                          │
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
index (Accueil public) 🌃  ── taux du jour + simulateur, SANS compte
   ├─► (auth)/inscription ─► (auth)/otp ─┐
   └─► (auth)/connexion ─────────────────┤
                                         ▼
                                   kyc (dépôt CNI + selfie)  ⛔ bloquant
                                         ▼
                                   (tabs) 🏠  [barre flottante]
                                   ├─ index        Taux + simulateur
                                   ├─ changer      Nouvelle opération
                                   ├─ operations   Mes transactions
                                   └─ profil       Compte, KYC, plafonds
                                         │
                                         ▼
                                 transaction/[id]  Timeline + import du reçu + PDF
```

| Écran | Fichier | Point clé design |
|---|---|---|
| Accueil public | `app/index.tsx` | Bleu nuit immersif, halos, taux en direct, CTA « Simuler » |
| Inscription/Connexion | `app/(auth)/…` | `FormScreen` : le clavier ne masque jamais le champ |
| OTP | `app/(auth)/otp.tsx` | 5 cases, renvoi minuté |
| KYC | `app/kyc.tsx` | Dépôt CNI + selfie, états en attente / rejeté (motif) / validé |
| Onglets | `app/(tabs)/_layout.tsx` | Barre **flottante** au-dessus des gestes système |
| Taux | `app/(tabs)/index.tsx` | Cartes devise, variation ↑/↓, simulateur inline |
| Changer | `app/(tabs)/changer.tsx` | Montant → équivalent + commission **avant** engagement, compte à rebours du verrou |
| Opérations | `app/(tabs)/operations.tsx` | Historique filtrable (date, devise, statut) |
| Détail | `app/transaction/[id].tsx` | Timeline des 8 statuts, import du reçu, PDF final |
| Profil | `app/(tabs)/profil.tsx` | Statut KYC, plafonds consommés, alertes de taux |

### Dashboard (admin / opérateur)

| Page | Route | Rôle |
|---|---|---|
| Connexion | `/login` | équipe (2FA) |
| Vue d'ensemble | `/(dash)` | volumes, commissions, top devises, alertes |
| Taux | `/(dash)/taux` | publier un taux, historique, marge par paire, alerte de fraîcheur |
| Reçus | `/(dash)/recus` | **file de validation** des preuves de paiement |
| KYC | `/(dash)/kyc` | **file de validation** des identités |
| Transactions | `/(dash)/transactions` | liste temps réel, filtres, détail, export |
| Clients | `/(dash)/clients` | fiche, plafonds, blocage, historique |
| Agences | `/(dash)/agences` | agences + affectation des opérateurs |
| Caisses | `/(dash)/caisses` | soldes par devise, mouvements, clôture journalière |
| Rapports | `/(dash)/rapports` | graphiques SVG maison, exports Excel/PDF |
| Équipe | `/(dash)/equipe` | comptes internes et rôles [super_admin] |
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
[⚪] 1. Socle         Docker + migrations + auth JWT/RBAC + seed CI + devises & taux versionnés
[⚪] 2. Simulateur    taux publics + simulateur mobile + WebSocket
[⚪] 3. KYC           inscription + dépôt de pièce + file de validation + notification
[⚪] 4. Transaction   verrou de taux + import de reçu + validation + exécution du change
[⚪] 5. Suivi         timeline + historique + PDF de justificatif + export
[⚪] 6. Caisses       agences + soldes par devise + mouvements + clôture
[⚪] 7. Reporting     volumes, commissions, graphiques SVG, exports
[⚪] 8. Conformité    seuils LCB-FT + plafonds + journal d'audit
[⚪] 9. Notifications Expo Push + WhatsApp/SMS + alertes de taux favorable
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
`mobile/src/api.ts` — `localhost` ne veut rien dire depuis un téléphone.
