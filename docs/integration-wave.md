# Intégration Wave — notes de cadrage

Source : <https://docs.wave.com/business#api-reference> (checkout, payout, balance, webhook,
transactions), lue le 2026-10-31.

Ce document retient ce que la documentation **dit**, ce qu'elle **ne dit pas**, et ce qui doit être
tranché avec Wave avant la mise en service. Il ne reformule pas l'API : pour les champs, voir
`api/src/payments/payment.wave.ts`, écrit sur les noms documentés.

---

## 1. Ce que l'API change pour HadjChanges

### Encaissement : le reçu manuel disparaît

Parcours actuel (cf. `CLAUDE.md` §5) :

> le client paie de son côté → **importe une photo du reçu** → un opérateur contrôle et valide

Avec l'API Checkout, pour les paiements Wave, les deux dernières étapes tombent. Le client est
renvoyé vers `wave_launch_url`, paie dans Wave, et l'événement `checkout.session.completed`
confirme le paiement. L'opération peut passer à « paiement prouvé » sans intervention humaine.

Au-delà du temps d'opérateur, cela ferme une faille : **une capture d'écran se falsifie, une
confirmation signée par Wave non.**

Deux alignements heureux :

- Wave expire les sessions au bout de **30 minutes**, exactement le `RATE_LOCK_MINUTES` du projet.
  Le verrou de taux et la session de paiement meurent donc ensemble, sans code supplémentaire.
- `restrict_payer_mobile` permet d'exiger que le paiement vienne **du numéro du client lui-même**.
  Pour un bureau de change soumis à la LCB-FT, c'est un garde-fou réel : il empêche un tiers de
  financer l'opération d'une personne dont on a vérifié l'identité. **À activer systématiquement.**

### Versement : automatisable, mais sans notification

`PayoutMethod.MOBILE_MONEY` est aujourd'hui une opération manuelle. `POST /v1/payout`
l'automatise, avec deux réserves structurantes :

- **Aucun webhook n'existe pour les versements.** Seuls les encaissements en émettent. Un versement
  doit donc être **interrogé** (`GET /v1/payout/:id`) : il faut une tâche de rapprochement, pas une
  attente passive.
- `receive_amount` est **net de frais** : on indique ce que le bénéficiaire touche, et les frais se
  prélèvent **en plus** sur le portefeuille du bureau.

### Caisse

`GET /v1/balance` donne le flottant Wave. `GET /v1/transactions?date=` donne l'extrait journalier
avec `fee`, le solde courant ligne à ligne, et un `transaction_type` qui distingue encaissements,
versements et annulations (`api_checkout`, `api_payout`, `api_payout_reversal`…). De quoi alimenter
les `CashMovement` et la clôture journalière sans ressaisie.

---

## 2. Contraintes qui ont façonné le code

### Il n'existe aucun environnement de test

C'est le fait le plus important de toute la documentation, et il n'y est écrit nulle part
explicitement : **aucune clé sandbox, aucun bac à sable**. Toutes les clés d'exemple sont des clés
de production (`wave_sn_prod_…`).

Conséquence : sur un bureau de change, développer directement contre Wave signifierait virer de
l'argent réel à chaque exécution de test. D'où `PaymentService` (port) et
`PaiementSimuleAdapter` **par défaut**. `PaymentsModule` refuse de démarrer :

- en `PAYMENT_DRIVER=wave` sans clé ni secret ;
- en `PAYMENT_DRIVER=simulation` **en production** — des clients verraient leurs opérations passer
  en « payé » sans avoir payé, et rien ne le signalerait.

### La signature se calcule sur le corps brut — démontré, pas supposé

`Wave-Signature: t=<secondes unix>,v1=<hex>` ; charge signée = `horodatage + corps`, HMAC-SHA256,
sortie hexadécimale.

Ce n'est pas une lecture de la prose : `scripts-verif/wave-signature-check.ts` **rejoue l'exemple
signé publié par Wave** (corps exact capté dans `wave-exemple-signe.json`) et reproduit sa
signature au caractère près.

Le même contrôle établit le point opérationnel décisif : **le même JSON re-sérialisé en compact
produit une signature différente.** Donc tout code qui parse le corps avant de vérifier rejette
*tous* les événements authentiques. D'où `Buffer` partout et `rawBody: true` au démarrage de Nest.

> La documentation se contredit ici : elle présente deux corps d'exemple différents (compact et
> indenté) sous un seul en-tête, et plusieurs de ses exemples de code portent un corps JSON aux
> accolades déséquilibrées. Seul le calcul permettait de trancher.

### La clé d'idempotence est le point le plus dangereux

Wave est formel : un même corps envoyé avec une clé **différente** « aboutira inévitablement à une
transaction dupliquée ». Donc :

- la clé est **fournie par l'appelant**, dérivée de l'opération, et **conservée en base** ;
- une reprise rejoue la **même** clé, jamais une nouvelle ;
- seuls les versements sont rejouables. **La création de session de paiement ne l'est pas** —
  l'API Checkout n'accepte aucune clé d'idempotence, donc rejouer l'appel après un délai réseau
  créerait une seconde session, et le client pourrait payer deux fois.

### Les événements arrivent en double, dans le désordre, ou pas du tout

Wave l'écrit : les événements « peuvent être manqués », « livrés plusieurs fois » et « arriver dans
le désordre ». Deux conséquences :

- dédoublonnage obligatoire sur l'`id` de l'événement, sinon un paiement valide deux fois la même
  opération ;
- un rattrapage par `GET /v1/checkout/sessions/search?client_reference=` est indispensable : c'est
  le seul moyen de savoir si un client a payé quand l'événement est perdu.

### Le webhook doit répondre en moins de 5 secondes

Wave exige une réponse en 5 s et réessaie pendant 3 jours. Sur le forfait gratuit Render, une
instance endormie met **~50 s** à se réveiller : les confirmations arriveraient avec des minutes ou
des heures de retard, et les clients attendraient devant un paiement « en cours ».

**Le point d'entrée webhook ne peut pas vivre sur une instance qui dort.** C'est le même incident
que celui du 2026-10-31 (502 `no-deploy`), avec de l'argent client en jeu cette fois.

### Le filtrage d'IP suppose une IP sortante fixe

Wave permet de restreindre une clé d'API à des IP. Bonne pratique pour une API d'argent, mais une
fois la première IP ajoutée **le filtrage ne se désactive plus depuis le portail**. Le forfait
gratuit Render n'offre pas d'IP sortante fixe : ne pas l'activer avant d'avoir un hébergement qui
en fournit une.

Dans l'autre sens, les webhooks arrivent depuis **16 plages d'IP** Wave, dont une nouvelle annoncée
en octobre 2026 (`87.192.0.0/19`). À autoriser toutes si l'on filtre l'entrée.

---

## 3. À trancher avec Wave avant la mise en service

Ces questions ne se résolvent pas dans le code. Les réponses conditionnent la suite.

1. **La Côte d'Ivoire est-elle couverte par l'API ?**
   `XOF` est documenté, mais **tous** les exemples sont sénégalais (`+221`), certains champs sont
   marqués « Senegal only » (taxes gouvernementales), et il n'existe aucune liste de pays. Or un
   versement exige que le portefeuille du bureau et le bénéficiaire soient **dans le même pays**.
   Sans réponse, le volet versement n'est pas constructible avec certitude.

2. **Quel est le barème de frais, encaissement et versement ?**
   La commission du bureau est de **1 % à 1,5 %**. Si les frais Wave s'en approchent, l'opération
   se fait à perte. À obtenir chiffré, par tranche de montant.

3. **Existe-t-il un moyen d'essayer sans déplacer d'argent réel ?**
   Même un portefeuille de test plafonné à quelques milliers de francs changerait la nature du
   travail. Si la réponse est non, le simulateur reste le seul filet.

4. **Quels sont les montants minimum et maximum**, par opération et par jour, pour un encaissement
   et pour un versement ? Non documentés. Ils doivent être connus pour être validés **avant**
   l'appel, et croisés avec `DEFAULT_DAILY_LIMIT_XOF` / `LCB_FT_THRESHOLD_XOF`.

5. **Quelle est la limite de débit (rate limit) réelle ?**
   Seul le `429` est documenté, sans chiffre.

6. **Un remboursement partiel est-il possible ?**
   Seul le remboursement total est documenté. Sur un change annulé après encaissement, savoir si
   l'on peut ne rendre qu'une partie change le traitement comptable.

7. **`verify_recipient` peut-il être ouvert ?**
   Il permettrait de vérifier qu'un numéro de bénéficiaire correspond bien au nom déclaré — utile
   en LCB-FT. Wave le réserve à des justifications réglementaires documentées et précise qu'il
   **n'est pas** accordé pour réduire les échecs de versement. À demander sur le fondement
   LCB-FT, sans compter dessus.

8. **Combien de temps un versement reste-t-il annulable ?**
   La documentation annonce « exactement 3 jours » depuis la création. À confirmer, car c'est la
   fenêtre pendant laquelle une erreur de versement est rattrapable.

---

## 4. Ouverture du compte

- Il faut un **Wave Business Account**.
- Les clés se créent dans le portail : <https://business.wave.com/dev-portal>, section Developer,
  **visible seulement par un utilisateur Admin**. Si elle n'apparaît pas, il faut la faire activer
  par le support API de Wave.
- Une clé est **liée à un seul portefeuille**, et n'est affichée **qu'une fois**.
- Le secret de webhook (`wave_sn_WHS_…`) est **distinct** de la clé d'API, et affiché une seule
  fois lui aussi.
- Ni la clé ni le secret ne doivent transiter par une conversation, un ticket ou le dépôt : ils se
  posent en variables d'environnement (`WAVE_API_KEY`, `WAVE_WEBHOOK_SECRET`).

---

## 5. État de l'intégration

| Brique | État |
| --- | --- |
| Port `PaymentService` | fait |
| Adaptateur simulé (défaut) | fait |
| Adaptateur Wave réel | fait |
| Vérification de signature + contrôle de conformité | fait, 19/19 |
| Choix d'adaptateur au démarrage, avec refus de démarrer | fait |
| Modèles en base (session, versement, événements vus) | fait, migration appliquée |
| Point d'entrée webhook (corps brut, dédoublonnage) | fait, 23/23 de bout en bout |
| Branchement sur la machine à états | fait |
| Versement + tâche de rapprochement | à faire |
| Écrans mobile et dashboard | à faire |

### Contrôles

```bash
cd api && npx tsx ../scripts-verif/wave-signature-check.ts   # 19 cas, conformité à l'exemple de Wave
cd api && npx tsx ../scripts-verif/wave-config-check.ts      # 8 cas, refus de démarrer
node scripts-verif/wave-flux-check.mjs                       # 23 cas, API en marche requise
```

### Ce que le webhook fait, et ne fait pas

Il confirme le paiement (`→ RECU_VALIDE`) et **n'exécute pas le change**. Trois raisons :

1. `CashMovement.createdById` n'est pas nullable : tout mouvement de caisse a un auteur. Attribuer
   à un agent un décaissement qu'il n'a pas fait falsifierait la piste d'audit du registre.
2. `ExchangeExecutor` refuse si l'encaisse de l'agence ne suffit pas. L'exception ferait répondre en
   erreur, et l'opérateur réessaierait **pendant 3 jours** à cause d'un tiroir-caisse vide — alors
   que le paiement, lui, est confirmé.
3. Le webhook dispose de 5 secondes : l'arithmétique de caisse n'y a pas sa place.

L'opération arrive donc dans la file du dashboard **déjà marquée payée, sans reçu à examiner**. Ce
qui disparaît est le jugement « cette capture d'écran est-elle authentique ? » ; ce qui reste est le
geste d'exécuter le change, qu'un humain faisait de toute façon.

### Garde-fous ajoutés au passage

- **Contrôle du montant** : un encaissement dont le montant diffère de l'attendu ne valide **rien**.
  Il lève une alerte de conformité `MONTANT_PAIEMENT_DIVERGENT` en sévérité critique et laisse
  l'opération en attente. Sans ce test, l'automatisme serait plus permissif que l'humain qu'il
  remplace — l'agent avait le montant attendu affiché en évidence.
- **Sens de l'opération** : seul un `VENTE_DEVISE` est réglable par mobile money, car la devise
  **source** est celle que le client remet. Un `ACHAT_DEVISE` suppose des billets étrangers et doit
  passer au guichet. Sans ce refus, 50 000 EUR seraient encaissés comme 50 000 XOF, soit 1/650 du dû.
- **Pages de retour sans valeur probante** : elles n'écrivent rien. Seul l'événement signé fait foi,
  sinon un client bidouillant l'adresse de retour pourrait se déclarer payé.
- **Routes de simulation inatteignables en production** : 404 dès que l'adaptateur réel est en
  service, et le module refuse de démarrer en simulation hors développement.
