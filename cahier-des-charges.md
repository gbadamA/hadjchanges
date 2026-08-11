# Cahier des charges — Plateforme de Bureau de Change

## 1. Contexte et objectif

Développer une plateforme numérique de bureau de change permettant :
- à un **administrateur/opérateur** de piloter l'activité via un **Dashboard** (taux, transactions, clients, caisses, reporting) ;
- à un **client final** de consulter les taux, effectuer des opérations de change réelles (achat/vente de devises) et suivre l'historique de ses transactions.

Devises cibles : FCFA (XOF) comme devise de référence, avec EUR, USD, GBP, et autres devises configurables.

L'**application client est une application mobile**, orientée exclusivement utilisateur final (le Dashboard reste une interface web séparée pour l'admin/opérateur).

---

## 2. Acteurs du système

| Acteur | Description |
|---|---|
| **Client** | Utilisateur final qui simule et effectue des opérations de change |
| **Opérateur / Caissier** | Traite et valide les transactions au niveau agence |
| **Administrateur** | Gère les taux, les utilisateurs, les agences, les rapports globaux |
| **Super-admin** | Accès total, paramétrage système, audit |

---

## 3. Périmètre fonctionnel

### 3.1 Dashboard (Admin / Opérateur)

**Gestion des taux de change**
- Définir et mettre à jour les taux d'achat/vente par paire de devises
- Historique des variations de taux (avec horodatage et auteur de la modification)
- Marge/commission configurable par paire de devises
- Taux différenciés possibles par agence (si multi-agences)
- Alerte si taux non mis à jour depuis X heures

**Validation KYC (étape préalable obligatoire)**
- File d'attente des comptes clients en attente de vérification d'identité
- Visualisation de la pièce d'identité (et selfie si fourni) soumise par le client
- Action Valider / Rejeter (avec motif de rejet transmis au client)
- Le client ne peut initier aucune transaction tant que son compte n'est pas validé

**Gestion des transactions**
- Liste des transactions en temps réel (créée / reçu soumis / reçu validé / reçu rejeté / change exécuté / prête pour retrait / clôturée / annulée)
- **File dédiée de validation des reçus de paiement** : visualisation du justificatif de dépôt (mobile money/CB) importé par le client, Valider/Rejeter avant exécution du change
- Détail transaction : client, devises, montant, taux appliqué, commission, agence, opérateur, statut, reçu de paiement, justificatifs
- Recherche et filtres (date, devise, statut, montant, client, agence)
- Export des transactions (Excel/PDF)

**Gestion des clients**
- Fiche client (identité, contact, historique complet)
- Statut KYC (vérifié / en attente / rejeté) et pièce d'identité associée
- Plafonds de transaction par client (limites journalières/mensuelles)
- Blocage/déblocage de compte client

**Gestion des caisses / agences (si multi-agences)**
- Solde de caisse par devise et par agence
- Mouvements de caisse (entrées/sorties, alimentation, clôture journalière)
- Affectation des opérateurs aux agences

**Reporting et statistiques**
- Volume de transactions par période, par devise, par agence
- Chiffre d'affaires / commissions générées
- Tableau de bord avec graphiques (évolution des taux, volumes, top devises échangées)
- Rapport de conformité (transactions suspectes, seuils dépassés)

**Gestion des utilisateurs internes**
- Rôles et permissions (admin, opérateur, super-admin)
- Journal d'activité (logs d'audit)

**Notifications**
- Alertes transactions en attente de validation
- Alertes seuils réglementaires (LCB-FT) dépassés
- Notifications de variation de taux importante

---

### 3.2 Application Mobile Client

**Consultation et simulation** (accessible sans compte validé)
- Affichage des taux du jour (achat/vente) par devise
- Simulateur de conversion en temps réel (montant → équivalent avec taux + commission affichés clairement)

**Inscription et vérification d'identité (KYC) — bloquant pour toute transaction**
- Inscription (téléphone, email, mot de passe)
- Upload obligatoire d'une pièce d'identité valide (CNI, passeport...) + selfie de vérification (optionnel mais recommandé)
- Le compte est créé avec un statut `en attente de validation`
- **Aucune transaction ne peut être initiée tant que la pièce n'est pas validée par un opérateur/admin côté Dashboard**
- Notification au client dès que son identité est validée ou rejetée (avec motif si rejet)
- Statuts possibles : `en attente` / `validé` / `rejeté` (avec possibilité de re-soumission)

**Flux de transaction réelle** (uniquement pour compte KYC validé)
1. Le client simule sa conversion (devise source → devise cible, montant)
2. Le client choisit son mode de dépôt : **Mobile Money** (Orange Money, MTN, Moov) ou **Carte bancaire (CB)**
3. Le client effectue le dépôt de son côté (hors app ou via lien de paiement) puis **importe le reçu/preuve de paiement** (photo ou PDF) dans l'application
4. La transaction passe au statut `en attente de validation du reçu`
5. Un opérateur/admin vérifie le reçu côté Dashboard et **valide ou rejette** la preuve de paiement
6. Une fois le reçu validé, le système **exécute l'opération de change** au taux verrouillé lors de la simulation (ou taux du moment si non verrouillé — à trancher)
7. Le client est notifié et peut suivre le statut jusqu'au retrait/versement final (espèces en agence, mobile money, virement)

Statuts de transaction à prévoir : `créée` → `reçu soumis` → `reçu validé` / `reçu rejeté` → `change exécuté` → `prête pour retrait` → `clôturée` / `annulée`

**Suivi**
- Suivi en temps réel du statut de chaque transaction (avec les étapes ci-dessus)
- Historique complet des transactions (filtrable par date, devise, statut)
- Détail de chaque transaction (reçu importé, taux appliqué, commission, statut, dates)
- Génération d'un reçu/justificatif final téléchargeable (PDF) une fois la transaction clôturée
- Export de l'historique

**Historique et suivi**
- Historique complet des transactions (filtrable par date, devise, statut)
- Détail de chaque transaction passée
- Export de l'historique

**Notifications**
- Notification de changement de statut de transaction (WhatsApp / SMS / email)
- Alerte de taux favorable (optionnel, sur devises suivies)

---

## 4. Exigences non-fonctionnelles

- **Sécurité** : authentification forte (2FA recommandé pour l'admin), chiffrement des données sensibles, conformité KYC/LCB-FT (lutte contre le blanchiment)
- **Traçabilité** : chaque action (changement de taux, validation de transaction) doit être journalisée avec auteur + horodatage
- **Performance** : mise à jour des taux et affichage en temps réel (WebSocket ou polling)
- **Disponibilité** : accès mobile-first (le client agit souvent depuis son smartphone)
- **Multi-langue** : français par défaut, anglais en option
- **Devise de référence** : FCFA (XOF)
- **Intégrations locales** : Mobile Money (Orange Money, MTN, Moov) pour règlement, WhatsApp Business pour notifications

---

## 5. Modèle de données (entités principales)

- `User` (client / opérateur / admin — rôle, statut KYC)
- `Agency` (agence physique, solde de caisse)
- `Currency` (devise, code ISO)
- `ExchangeRate` (paire de devises, taux achat, taux vente, agence, date, auteur)
- `Transaction` (client, devises source/cible, montant, taux appliqué, commission, statut, agence, opérateur, mode de dépôt [Mobile Money/CB], reçu de paiement, statut du reçu, dates de chaque étape)
- `KYCDocument` (client, type de pièce, fichier, selfie éventuel, statut de vérification, motif de rejet)
- `PaymentReceipt` (transaction, fichier importé, statut [en attente/validé/rejeté], validé par, date)
- `CashMovement` (agence, devise, type mouvement, montant, date)
- `AuditLog` (utilisateur, action, entité concernée, date)

---

## 6. Stack technique recommandée

- **Frontend Dashboard** : Next.js (React) + Tailwind CSS
- **Application Client** : App mobile native ou cross-platform (React Native / Flutter) — orientée exclusivement utilisateur final
- **Backend** : Node.js (API REST ou GraphQL), commun aux deux applications
- **Base de données** : PostgreSQL
- **Temps réel** : WebSocket (mise à jour des taux et statuts de transaction en direct)
- **Authentification** : JWT + 2FA pour les comptes admin
- **Stockage fichiers** : S3-compatible (justificatifs KYC, reçus PDF)
- **Notifications** : WhatsApp Business API / Twilio (SMS) / email

---

## 7. Phasage suggéré

| Phase | Contenu |
|---|---|
| **Phase 1 — MVP** | Gestion des taux, simulateur client, inscription + KYC bloquant, flux dépôt → import reçu → validation → change, dashboard basique |
| **Phase 2** | Selfie de vérification, multi-agences, gestion des caisses, notifications automatiques (WhatsApp/SMS) |
| **Phase 3** | Reporting avancé, intégrations mobile money, alertes de conformité, export comptable |

---

## 8. Livrables attendus

- Dashboard web (admin/opérateur)
- Application mobile client (utilisateur final)
- Documentation technique (API, schéma de base de données)
- Guide d'utilisation pour les opérateurs et les clients
