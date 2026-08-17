# Déploiement HadjChanges — plan gratuit

Ordre à respecter : les services externes **avant** Render, car Render demande
leurs valeurs à la création. Chaque étape dit ce qui casse si on la saute.

---

## 1. La base de données — Neon

Créer un compte sur [neon.tech](https://neon.tech), puis un projet en région
**Europe (Frankfurt)** — la même que l'API sur Render, pour éviter un
aller-retour réseau sur chaque requête.

> **Pourquoi pas le PostgreSQL de Render ?** Son offre gratuite **expire à
> 90 jours et détruit la base**. C'est ce qui a mis PREVENTIX 360 hors service.
> Neon suspend après inactivité mais **ne supprime pas**. Même coût : zéro.
>
> **Pourquoi pas Supabase ?** Le compte existe, mais son offre gratuite plafonne
> à **2 projets actifs** et les deux places sont prises (`systemcollaboratif`,
> `preventix-360`). Neon a son propre quota, indépendant.

### ⚠️ DEUX chaînes de connexion, pas une

Neon en fournit deux, et les confondre empêche l'API de démarrer :

| Variable | Chaîne à copier | Usage |
|---|---|---|
| `DATABASE_URL` | hôte **avec** `-pooler` | requêtes de l'application |
| `DIRECT_URL` | hôte **sans** `-pooler` | migrations uniquement |

Ajouter `?sslmode=require` aux deux — Neon refuse les connexions en clair.

`prisma migrate deploy` crée des verrous consultatifs que pgBouncer, le pooleur
de Neon, ne sait pas relayer. Comme les migrations tournent **au démarrage du
conteneur**, une `DIRECT_URL` poolée ou absente ne donne pas une erreur de
migration : **l'API ne démarre pas du tout**.

Les migrations s'appliquent ensuite seules au premier démarrage
(`api/Dockerfile`), il n'y a rien à lancer à la main.

## 2. Le stockage des fichiers — Cloudflare R2 (10 Go gratuits)

Créer un bucket et une clé d'accès. Noter : endpoint, région, nom du bucket,
clé, secret.

> **Ce n'est pas optionnel.** Le disque d'un conteneur Render est **éphémère** :
> il est remis à zéro à chaque redéploiement *et* à chaque réveil après veille.
> Sans stockage externe, les **pièces d'identité et les reçus de paiement
> déposés par les clients disparaissent**. Ce sont des pièces de conformité
> KYC/LCB-FT : leur perte n'est pas un désagrément, c'est un manquement.

## 3. Le courriel — Mailtrap

Récupérer hôte, port, identifiant et mot de passe dans l'interface Mailtrap.

> ### ⚠️ Sandbox ou Live : ce n'est pas le même serveur
>
> | Serveur | Comportement |
> |---|---|
> | `sandbox.smtp.mailtrap.io` (port 2525) | **Capture** les messages dans une boîte de test. **Rien n'est livré.** |
> | `live.smtp.mailtrap.io` (port 587) | Envoie réellement aux destinataires. |
>
> Le sandbox est parfait pour vérifier le rendu des courriels avant ouverture au
> public. Mais le laisser en production donne l'illusion que tout fonctionne —
> l'API signale l'envoi comme réussi — alors qu'**aucun client ne reçoit rien**.
> Le domaine d'envoi doit être vérifié chez Mailtrap pour utiliser le Live.

Sans relais, les notifications par courriel échouent silencieusement ; l'API
démarre quand même.

## 4. Render

1. **New → Blueprint**, pointer le dépôt `gbadamA/hadjchanges`, branche à
   déployer. Render lit `render.yaml` et crée les deux services.
2. Renseigner les variables marquées `sync: false` (elles sont volontairement
   absentes du dépôt) :

   | Variable | Source |
   |---|---|
   | `DATABASE_URL`, `DIRECT_URL` | étape 1 — **deux chaînes différentes** |
   | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | étape 2 |
   | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | étape 3 |
   | `WHATSAPP_*`, `TWILIO_*` | facultatif — l'API démarre sans |

   `JWT_ACCESS_SECRET` et `JWT_REFRESH_SECRET` sont générés par Render.
   `CORS_ORIGINS` et `NEXT_PUBLIC_API_URL` se remplissent tout seuls, les deux
   services se référençant mutuellement.

3. Créer le premier compte administrateur (le seed n'est pas rejoué en
   production).

## 5. Le mobile, une fois l'API en ligne

Trois gestes, dans cet ordre :

1. `mobile/.env` → `EXPO_PUBLIC_API_URL="https://<api>.onrender.com"`.
2. **Retirer** `usesCleartextTraffic` de `app.json` (plugin
   `expo-build-properties`) : il n'existait que pour joindre une API en `http://`
   sur le réseau local. Le laisser affaiblirait l'application sans raison.
3. `npx expo prebuild --platform android --clean`, puis reconstruire l'APK.

L'APK ne dépendra alors plus de l'IP Wi-Fi du poste.

---

## Ce que le plan gratuit impose de savoir

| Fait | Conséquence visible |
|---|---|
| Le service **s'endort** après ~15 min sans trafic | La première requête suivante prend ~50 s. Ce n'est pas une panne. |
| La veille **coupe les WebSockets** | Le mobile se reconnecte seul et **recharge ses données** (`useTransactionUpdates`), sans quoi un statut changé pendant la veille resterait affiché périmé — en ayant l'air à jour. |
| Le disque est **éphémère** | Voir étape 2. |
| 750 h/mois d'exécution | Suffisant pour deux services qui dorment la nuit. |

## Vérifié avant livraison

- Image API : construite, et **démarre** — elle échoue proprement sur `P1001`
  quand la base est injoignable, ce qui prouve que les migrations tournent bien
  *avant* le serveur.
- Image tableau de bord : construite (340 Mo), sortie `standalone` fonctionnelle.
- Polices **embarquées** (`next/font/local`) : plus aucun appel à Google Fonts
  pendant la construction. Un incident chez eux faisait échouer le déploiement —
  c'est arrivé pendant la préparation (`NextFontError`, `ETIMEDOUT`).
- Normalisation du schéma d'URL : Render expose les hôtes **sans** `https://`.
  Sans complétion, le tableau de bord aurait appelé sa propre origine et
  **aucune** origine CORS n'aurait correspondu. Testé sur 9 cas.
