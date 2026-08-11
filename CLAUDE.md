# CLAUDE.md — HadjChanges

Fondation du projet **HadjChanges**. Ce fichier est chargé au début de chaque session sur ce dépôt.
Il dit **ce que fait le produit**, **comment il est construit** et **comment travailler dessus**.
La carte de navigation (« où est quoi ») est dans [claudemap.md](claudemap.md).
Les specs d'origine du client sont dans [cahier-des-charges.md](cahier-des-charges.md) — non modifiable.

---

## 1. Ce que c'est

**HadjChanges** est une plateforme de **bureau de change** : un dashboard web pour l'exploitant
(taux, transactions, clients, caisses, conformité) et une **application mobile** pour le client final
(consulter les taux, simuler, effectuer une opération de change réelle, suivre son historique).

Devise de référence : **FCFA (XOF)**. Devises échangées : EUR, USD, GBP, SAR et autres, configurables.

Le cœur du produit tient en deux verrous :

1. **Le KYC est bloquant.** Un compte non validé peut consulter et simuler, rien d'autre.
2. **Le paiement est validé manuellement.** Le client dépose son argent de son côté (mobile money
   ou CB), importe le reçu, un opérateur le valide, et c'est seulement là que le change s'exécute.
   Pas de passerelle de paiement automatique en phase 1.

---

## 2. Stack (verrouillée)

| Brique | Techno | Port |
|---|---|---|
| **API** | NestJS 11 + Prisma 6 + PostgreSQL 16 | **3061** |
| **Dashboard** | Next.js 15 (App Router) + Tailwind 3 | **3060** |
| **Mobile** | React **Expo 57** (RN 0.86, React 19.2) + Expo Router | Expo Go |
| **Base** | PostgreSQL 16 (Docker) | **54360** |
| **Emails (dev)** | Mailpit | **8036** |
| Auth | JWT access court + refresh en cookie httpOnly ; 2FA sur les comptes internes | |
| Fichiers | disque local en dev derrière un port `StorageService` (S3 en prod) | |
| Temps réel | WebSocket (taux + statuts de transaction) | |
| Notifications | Expo Push · WhatsApp Business / Twilio SMS · email | |

⚠️ **Ports choisis pour ne heurter aucun autre projet du poste** : 3040/3041 (qardan-hassana),
3050/3051 (fi-hadj), 3030 + 5413x (mosquee-fitia), 3013 (abayomi), 3021 (systemcollaboratif).

⚠️ **Le projet vit dans `C:\dev\hadjchanges`, hors OneDrive.** Metro (Expo) meurt sous OneDrive
(« Failed to start watch mode », des milliers de handles de watch). Ne pas déplacer.

⚠️ **Mobile = React Expo, jamais Flutter.** Standard du poste. Le cahier §6 laisse le choix
« React Native / Flutter » : la question est tranchée.

---

## 3. Structure

```
hadjchanges/
├── CLAUDE.md              ce fichier — règles et décisions
├── claudemap.md           🗺️ la carte : où est quoi, dans quel ordre
├── cahier-des-charges.md  specs client d'origine (lecture seule)
├── docker-compose.yml     Postgres + Mailpit
├── api/                   NestJS + Prisma  → prisma/schema.prisma = LE modèle
├── admin/                 Next.js — dashboard admin/opérateur
└── mobile/                Expo — application client
    └── src/theme.ts       design system mobile
```

Structure **plate**, pas de monorepo pnpm : Metro et les workspaces pnpm se marchent dessus.
Chaque brique installe ses dépendances chez elle. Les types partagés sont dupliqués à dessein
côté mobile (`src/models.ts`) — la frontière réseau est un contrat, pas un import.

---

## 4. Rôles (RBAC)

| Rôle | Peut |
|---|---|
| `CLIENT` | simuler, déposer un reçu, suivre ses transactions (mobile uniquement) |
| `OPERATEUR` | valider les reçus, exécuter le change, tenir la caisse de **son agence** |
| `ADMIN` | taux, clients, plafonds, KYC, agences, rapports |
| `SUPER_ADMIN` | tout + utilisateurs internes + réglages système + audit |

Règles dures : un opérateur ne modifie **jamais** un taux ni un plafond ; un opérateur ne voit que
**son agence** ; seul le super-admin touche aux réglages et à l'équipe. Toute action sensible
(taux, validation de reçu, déblocage de compte, mouvement de caisse) est écrite dans `AuditLog`
avec auteur + horodatage — exigence §4 du cahier, non négociable.

---

## 5. Le flux de transaction (cœur du produit)

```
CREEE ──reçu importé──► RECU_SOUMIS ──opérateur──┬─► RECU_VALIDE ─exécution─► CHANGE_EXECUTE
  │                                              │                                  │
  └─► ANNULEE                                    └─► RECU_REJETE ─(redépôt)─► RECU_SOUMIS
                                                                                    ▼
                                                                        PRETE_POUR_RETRAIT
                                                                                    ▼
                                                                              CLOTUREE  (+ PDF)
```

1. Le client simule (devise source → cible, montant) : taux et commission affichés **avant** tout engagement.
2. Il choisit son mode de dépôt (Orange Money / MTN / Moov / Wave / CB).
3. Il paie de son côté, puis **importe le reçu** (photo ou PDF) → `RECU_SOUMIS`.
4. Un opérateur contrôle le reçu au dashboard : **valide** (`RECU_VALIDE`) ou **rejette** (motif transmis).
5. Le change s'exécute au taux **verrouillé lors de la simulation**, mouvements de caisse générés.
6. Retrait/versement (espèces en agence, mobile money, virement) → `CLOTUREE` + justificatif PDF.

Les transitions invalides sont refusées **côté service** par une state machine, jamais par la base.

---

## 6. Décisions actées

- ✅ **Valider un reçu exécute le change dans la foulée.** Les deux gestes ne sont pas séparés :
  valider, c'est décider que l'argent est arrivé. Laisser une file « reçu validé, change à faire »
  créerait une attente que personne ne relève.
- ✅ **Une caisse ne passe jamais en négatif.** `CashService.move` refuse, et toute l'exécution est
  annulée : la transaction reste au statut « reçu validé », prête à repartir une fois la caisse
  alimentée. On ne remet pas au client des billets qu'on n'a pas.
- ✅ **Les plafonds sont vérifiés à la création**, côté serveur, sur la somme des transactions non
  annulées du jour et du mois.
- ✅ **Un seul dossier d'identité vivant à la fois.** Re-déposer pendant l'examen créerait deux
  files pour la même personne ; re-déposer une fois validé n'a pas de sens. La re-soumission
  **après rejet** est en revanche explicitement ouverte (cahier §3.2), et elle efface le motif
  précédent, qui portait sur l'ancien dépôt.
- ✅ **Un rejet exige un motif d'au moins 10 caractères.** C'est ce texte que le client reçoit :
  un rejet sans explication le laisse bloqué sans savoir quoi corriger, et finit en appel au
  service client.
- ✅ **Le journal d'audit est en lecture seule et réservé à l'encadrement** (`GET /audit`,
  ADMIN/SUPER_ADMIN). Ni écriture ni suppression par l'API : un journal modifiable ne prouve rien.
- ✅ **Le verrou est un objet à part entière** (`Quote`), pas un champ sur la transaction. Une
  simulation ne persiste rien ; verrouiller crée un devis daté, nominatif et **consommable une seule
  fois** (`consumedAt`) — deux transactions ne peuvent pas s'adosser au même prix garanti.
- ✅ **Verrouiller exige un compte, pas un KYC validé.** Le verrou engage le bureau sur un prix : il
  faut savoir envers qui. Mais un client dont la pièce est en cours de vérification doit pouvoir
  préparer son opération — le KYC bloque la transaction (brique 4), pas la préparation.
- ✅ **Taux verrouillé à la simulation**, avec une **durée de validité** (`rateLockedUntil`, réglage
  `rateLockMinutes`, défaut 30 min). Le cahier §3.2-6 laissait la question ouverte : elle est tranchée.
  Passé le délai, la transaction est recalculée au taux du moment et le client doit reconfirmer.
  Un bureau de change ne peut pas porter un risque de marché ouvert sur un reçu qui arrive trois jours après.
- ✅ **Les taux sont une table versionnée** (`ExchangeRate` en append-only), pas une ligne mise à jour.
  L'« historique des variations » du cahier §3.1 n'est pas une table à part : c'est cette table lue à l'envers.
- ✅ **Montants en `Decimal`**, jamais en `Float`. Taux à 6 décimales, montants à 2.
- ✅ **Le solde de caisse est un cache recalculable** (`CashBalance`) ; la vérité est la somme des
  `CashMovement`. Un écran ne recalcule pas une somme à chaque affichage, mais un écart doit pouvoir
  être détecté par recalcul.
- ✅ **KYC bloquant** vérifié **côté API** en plus de l'UI. Un client peut masquer un bouton, pas un POST.
- ✅ **Phase 1 → 3 du cahier §7**, dans l'ordre. Multilingue (anglais) reporté après la phase 3.
- ✅ **Paiement manuel par reçu** en phase 1 ; l'intégration mobile money automatique remplacera
  l'étape de validation manuelle plus tard, sans changer la machine à états (juste une transition
  déclenchée par un webhook au lieu d'un opérateur).

---

## 7. Design (non négociable)

### Dashboard — DA « bleu diplomatique & or », reprise de FI-HADJ

Le client a demandé cette filiation visuelle. On reprend la **même grammaire** que
[`C:\dev\fi-hadj`](file:///C:/dev/fi-hadj) : primaire `#0F3D6B`, or `#C9A227` en **accent rare**
(filets, puces, badges — jamais un aplat), azur `#2E7CB8` pour les liens et le focus, dégradé
signature 135° `#0B2A4A → #14507F → #C9A227`, neutres légèrement teintés bleu, thème clair/sombre
en **variables CSS canaux RVB** (pour que `bg-primary/10` garde ses modificateurs d'opacité),
titres sérif (Playfair Display) + texte Inter, graphiques **SVG maison** (pas de Recharts).

Source de vérité unique : `admin/src/lib/tokens.ts` + `admin/tailwind.config.ts` qui en est le miroir.
**Aucune couleur en dur ailleurs dans le code.**

Ajout propre au domaine du change : `rateUp` vert / `rateDown` rouge pour les variations, et une
couleur par statut de transaction (`statusColors`). L'or reste réservé aux marqueurs de valeur.

### Mobile — patterns d'AutoPièce CI, habillés en bleu diplomatique

On reprend **ce qui marche déjà** dans
`projets/pieces-auto-marketplace/mobile` (workspace Jarvis), pas l'inspiration vague :

- **Séparation stricte des fichiers** : `theme.ts` (tokens `C`/`G`/`R`/`S`/`F`/`T`/`shadow`) ·
  `ui.tsx` (primitives **sans navigation**) · `components.tsx` (composés métier qui peuvent naviguer) ·
  `app/` (écrans, Expo Router) · `api.ts` + `models.ts` (données). On ne mélange pas ces rôles.
- **Élévations et effets** : cartes soulevées (ombres douces teintées bleu), boutons dégradés avec
  glow, `scale 0.97` au press, header immersif bleu nuit avec halos.
- **Le clavier ne masque JAMAIS le champ saisi** : tout écran de saisie passe par `FormScreen`
  (`KeyboardAwareScrollView`). À vérifier écran par écran : inscription, connexion, OTP, montant,
  import de reçu, coordonnées de retrait.
- **Les zones tactiles ne chevauchent pas les gestes système** : safe-area partout, **barre
  d'onglets flottante** avec marge = `insets.bottom`, `predictiveBackGestureEnabled: false`.
- **Un seul point d'accès réseau** : `src/api.ts`. Aucun `fetch` dans un écran.

La palette mobile est celle du dashboard (bleu nuit `#0B2A4A` marque, or `#C9A227` accent) :
les deux surfaces doivent se reconnaître au premier coup d'œil. Police Plus Jakarta Sans.

---

## 8. Conventions de travail

- **Communique en français**, direct, sans blabla. Pas de tirets longs.
- **Brique par brique**, un commit par fonctionnalité. Proposer avant d'implémenter les gros morceaux.
- **TypeScript strict** partout. `tsc --noEmit` doit passer sur les trois briques.
- **Aucun secret en dur** : tout dans `.env` (jamais committé), documenté dans `.env.example`.
- **Migrations Prisma versionnées** + seed réaliste (agences d'Abidjan, noms ivoiriens, taux plausibles).
- **Scripts de vérification exécutables** dans `scripts-verif/` — ils vérifient la **forme et la
  cohérence**, jamais des valeurs de contenu qui bougeront (leçon FI-HADJ : un script qui crie au
  loup ne sert plus à rien).

### SOLID & clean code (tout le projet)

- **SRP** : `controller` (HTTP) → `service` (métier) → `repository` (accès données) côté API ;
  `theme` / `ui` / `components` / `app` / `api`+`models` côté mobile.
- **OCP** : la state machine des transactions et les fournisseurs de paiement s'étendent par ajout.
  Ajouter Wave ou un webhook mobile money ne doit pas rouvrir le code du change.
- **DIP** : injection de dépendances, jamais de `PrismaClient` instancié dans le métier ; le stockage
  de fichiers passe par un port (`StorageService`) pour que le disque local devienne S3 sans toucher au métier.
- **Clean code** : noms explicites, fonctions courtes, zéro nombre magique (échelles du thème,
  constantes nommées), zéro code mort, DRY. Les commentaires disent le **pourquoi**.

---

## 9. Roadmap

| # | Brique | Contenu | Statut |
|---|---|---|---|
| 0 | **Scaffold** | structure, CLAUDE.md, claudemap, schéma Prisma, design system des deux surfaces | 🟢 |
| 1 | **Socle** | Docker + migrations + auth JWT/RBAC + seed CI + devises & taux (CRUD versionné) | 🟢 |
| 2 | **Simulateur** | simulateur mobile + verrou de taux (`Quote`) + WebSocket + auth mobile | 🟢 |
| 3 | **KYC** | dépôt CNI/selfie, file de validation dashboard, notification, 1res pages du dashboard | 🟢 |
| 4 | **Transaction** | création + verrou de taux + import de reçu + file de validation + exécution du change | ⚪ |
| 5 | **Suivi** | timeline mobile, historique filtrable, PDF de justificatif, export | ⚪ |
| 6 | **Caisses** | agences, soldes par devise, mouvements, clôture journalière | ⚪ |
| 7 | **Reporting** | volumes, commissions, graphiques SVG, export Excel/PDF | ⚪ |
| 8 | **Conformité** | seuils LCB-FT, alertes, plafonds client, journal d'audit consultable | ⚪ |
| 9 | **Notifications** | Expo Push + WhatsApp/SMS + alertes de taux favorable | ⚪ |

Correspondance cahier §7 : phase 1 = briques 1-5, phase 2 = 6 + 9, phase 3 = 7 + 8.

---

## 10. Pièges déjà payés (ne pas les repayer)

⚠️ **`nest build` sans `tsconfig.build.json` produit `dist/src/main.js`, pas `dist/main.js`.**
Le `tsconfig.json` inclut `prisma/` pour que le seed soit typé ; du coup tsc calcule un `rootDir`
commun à `src/` et `prisma/` et décale toute la sortie. Symptôme : `Cannot find module dist/main.js`
alors que le build vient de réussir. `tsconfig.build.json` fixe `rootDir: ./src` et exclut `prisma`.
Et **ne jamais mettre `incremental: true`** dans le tsconfig de l'API : `nest build` vide `dist/`
mais le `.tsbuildinfo` survit, tsc croit tout à jour et n'émet qu'une partie des fichiers.

⚠️ **Pas de `ValidationPipe` globale.** Elle exige `class-validator` au démarrage (l'API refuse de
booter sans) alors que tout le projet valide en **Zod** via `@ZBody`. Deux piles de validation, c'est
une de trop : celle qui reste est Zod, au plus près du contrat.

⚠️ **Ne jamais laisser partir deux `/auth/refresh` concurrents.** La rotation est stricte : un jeton
vu deux fois est traité comme un vol et **révoque toutes les sessions de l'utilisateur**. Le double
montage d'effet de React en développement suffit à détruire la session à chaque ouverture. Côté
client : une **promesse de rafraîchissement partagée** entre appelants simultanés. Ce n'est pas une
optimisation, ne pas la retirer. (Vérifié par `scripts-verif/api-check.mjs`, qui teste justement que
le rejeu coupe tout.)

⚠️ **Les taux sont sérialisés en CHAÎNES, pas en nombres.** `Decimal` ne passe pas en JSON sans
perte : `decimalToString` partout à la frontière, et côté client on garde la chaîne jusqu'à
l'affichage (`formatRate`). Un `Number()` prématuré, c'est un écart de caisse plus tard.

⚠️ **`socket.io-client` ne se bundle pas sous Metro sans `unstable_enablePackageExports`.**
Erreur trompeuse : `Unable to resolve "./contrib/parseuri.js" from engine.io-client` — un fichier qui
existe pourtant. Correctif dans `mobile/metro.config.js`. Ne pas le supprimer en croyant à un
reliquat : sans lui, l'app ne bundle plus du tout.

⚠️ **Aucun fichier déposé n'est servi en statique.** Pièces d'identité et reçus passent par
`StorageService` (clé opaque en base, nom d'origine jeté) et se lisent par un contrôleur qui
vérifie les droits — `no-store`, `noindex`. Une photo de CNI derrière une URL devinable est une
fuite, même avec un nom aléatoire : les URL fuient par les journaux et l'historique. Côté
dashboard, l'image se charge donc par `fetch` + `URL.createObjectURL`, jamais par un `<img src>`
direct. **Ne jamais « simplifier » en exposant `uploads/`.**

⚠️ **Un `return` anticipé dans un chargement doit toujours retomber sur `setLoading(false)`.**
L'écran KYC restait figé sur « Ouverture de votre dossier… » pour un visiteur sans session : le
garde `if (!accessToken) return;` sautait la fin du chargement. Vérifier ce cas sur chaque écran
qui lit des données protégées.

⚠️ **Un mouvement de caisse et le changement de statut qui le justifie vont dans LA MÊME
transaction base.** L'un sans l'autre laisse un trou impossible à rattraper à la clôture
journalière. La vérité des soldes est la suite des `CashMovement` ; `CashBalance` n'est qu'un cache,
reconstructible par `CashService.recompute()`.

⚠️ **Ne jamais résoudre le taux courant par une requête fenêtrée** (`take: n` sur les deux
périmètres mélangés). Passé la fenêtre, le taux propre à une agence disparaissait des candidats et
le taux global reprenait la main **sans que personne ne l'ait décidé** — bug réel, trouvé par
`api-check.mjs` après une vingtaine de republications globales. Chaque périmètre a sa propre
requête dans `RatesRepository.current`.

⚠️ **Routes dynamiques d'Expo Router : forme objet obligatoire.**
`router.push({ pathname: '/transaction/[id]', params: { id } })` — une chaîne interpolée ne compile
pas avec les routes typées. Et ces types ne sont régénérés que par le serveur Metro : un `tsc` sur
un écran fraîchement ajouté échoue tant que Metro n'a pas tourné.

⚠️ **Le compteur du throttler est EN MÉMOIRE** : quelques passages du script de vérification
épuisent le quota de `/auth/login` (429 en cascade). Redémarrer l'API le remet à zéro.

⚠️ **Le calcul du change n'existe qu'à UN endroit** : `api/src/quotes/quote-calculator.ts`. Le
simulateur, le verrou et (bientôt) l'exécution de la transaction l'appellent tous. Ne jamais
recopier cette arithmétique dans un écran ou un service : deux calculs qui divergent, c'est un écart
de caisse à la fin du mois. **La commission se prélève toujours sur la jambe en XOF.**

⚠️ **`.claude/launch.json` du poste n'accepte qu'un `cwd` RELATIF à la racine du workspace Jarvis.**
Le projet vivant dans `C:\dev`, la configuration `hadjchanges-mobile-web` y est déclarée mais le
serveur se démarre à la main (`npx expo start --web --port 8081`).
