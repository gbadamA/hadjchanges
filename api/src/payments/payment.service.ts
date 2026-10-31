/**
 * **Port** des encaissements et versements mobile money.
 *
 * Classe abstraite plutôt qu'interface, pour la même raison que
 * `StorageService` : TypeScript efface les interfaces à la compilation, or Nest
 * a besoin d'un jeton d'injection qui existe à l'exécution.
 *
 * Le métier du change n'appelle QUE ce port. Ajouter Orange Money demain, ou
 * remplacer Wave, se fait par un nouvel adaptateur — sans rouvrir la machine à
 * états ni le calcul des taux (OCP, cf. CLAUDE.md §SOLID).
 *
 * ⚠️ **Wave n'offre aucun environnement de test.** Pas de clé sandbox, pas de
 * bac à sable : la documentation n'en mentionne nulle part, et toutes ses clés
 * d'exemple sont des clés de production. Le moindre essai contre le vrai
 * service déplace de l'argent réel. C'est précisément pourquoi ce port existe
 * et pourquoi `PaiementSimuleAdapter` est l'adaptateur PAR DÉFAUT : sur un
 * bureau de change, développer directement contre Wave reviendrait à virer de
 * l'argent à chaque exécution de test.
 */

/**
 * Montants en **XOF entier**. Wave : « les décimales ne sont pas autorisées
 * pour les montants en XOF ». Les adaptateurs sérialisent en chaîne, comme
 * l'API l'exige — jamais en nombre flottant, qui finirait par produire des
 * « 1000.0000000001 » sur des sommes d'argent.
 */
export type MontantXof = number;

/** Issue d'un encaissement, vocabulaire du projet plutôt que celui de Wave. */
export type IssuePaiement = 'EN_COURS' | 'REUSSI' | 'ECHOUE' | 'EXPIRE';

export interface DemandeEncaissement {
  /**
   * Référence de l'opération (`HC-2026-000123`). Transmise à Wave dans
   * `client_reference` et **rendue telle quelle dans le webhook** : c'est le
   * seul lien entre un paiement et l'opération qu'il règle.
   */
  reference: string;
  montantXof: MontantXof;
  /** Pages de retour. Wave exige des adresses absolues en https. */
  urlSucces: string;
  urlEchec: string;
  /**
   * Numéro du client, au format E.164 avec `+`.
   *
   * Renseigné, Wave REFUSE que le paiement vienne d'un autre compte. Sur un
   * bureau de change c'est un garde-fou LCB-FT : il empêche un tiers de
   * financer l'opération d'une personne dont on a vérifié l'identité.
   */
  mobilePayeur?: string | null;
}

export interface SessionEncaissement {
  /** Identifiant Wave de la session (`cos-…`). */
  idSession: string;
  /**
   * Adresse à ouvrir pour payer.
   *
   * ⚠️ Doit être ouverte par le NAVIGATEUR du client. Wave est explicite :
   * dans une webview embarquée, le retour vers l'application ne fonctionne pas.
   */
  urlPaiement: string;
  /** Wave expire les sessions au bout de 30 minutes par défaut. */
  expireLe: Date | null;
}

export interface EtatEncaissement {
  idSession: string;
  /** `client_reference` tel que rendu : notre référence d'opération. */
  reference: string | null;
  issue: IssuePaiement;
  montantXof: MontantXof | null;
  /** Identifiant de la transaction Wave, pour le rapprochement de caisse. */
  idTransaction: string | null;
  /** Code d'échec Wave (`insufficient-funds`, `blocked-account`…). */
  codeEchec: string | null;
}

export type IssueVersement = 'EN_COURS' | 'REUSSI' | 'ECHOUE' | 'ANNULE';

export interface DemandeVersement {
  reference: string;
  /**
   * Ce que le bénéficiaire **touche**.
   *
   * ⚠️ Wave nomme ce champ `receive_amount` et il est NET de frais : les frais
   * se prélèvent EN PLUS sur le portefeuille du bureau. Promettre 100 000 au
   * bénéficiaire coûte donc 100 000 + frais, et cet écart doit être imputé à la
   * commission, sinon la caisse ne tombe jamais juste.
   */
  montantRecuXof: MontantXof;
  /** Numéro du bénéficiaire, E.164 avec `+`. */
  mobile: string;
  /** Nom du bénéficiaire : Wave peut s'en servir pour vérifier le compte. */
  nom?: string | null;
  /** Motif imprimé sur le reçu du bénéficiaire. 40 caractères au plus. */
  motif?: string | null;
  /**
   * Clé d'idempotence, **fournie par l'appelant et conservée en base**.
   *
   * ⚠️ Le point le plus dangereux de toute l'intégration. Wave est formel :
   * un même corps envoyé avec une clé DIFFÉRENTE « aboutira inévitablement à
   * une transaction dupliquée ». Donc une reprise doit rejouer la MÊME clé.
   * La dériver de l'opération et la stocker, jamais la régénérer.
   */
  cleIdempotence: string;
}

export interface EtatVersement {
  /** Identifiant Wave du versement (`pt-…`). */
  idVersement: string;
  issue: IssueVersement;
  /** Frais prélevés en plus du montant reçu. */
  fraisXof: MontantXof | null;
  codeEchec: string | null;
}

/** Événement entrant, une fois la signature vérifiée. */
export interface EvenementPaiement {
  /**
   * Identifiant de l'événement.
   *
   * ⚠️ Wave avertit que les événements « peuvent être livrés plusieurs fois »
   * et « arriver dans le désordre ». Cet identifiant est la clé de
   * dédoublonnage : sans lui, un même paiement pourrait valider deux fois la
   * même opération.
   */
  idEvenement: string;
  type: string;
  /** Renseigné pour les événements d'encaissement, nul pour les autres. */
  encaissement: EtatEncaissement | null;
}

export abstract class PaymentService {
  /** Nom affichable de l'adaptateur en service, pour les journaux. */
  abstract readonly nom: string;

  /**
   * `true` quand les paiements sont réellement exécutés chez l'opérateur.
   *
   * Permet aux écrans et aux justificatifs d'annoncer clairement un paiement
   * simulé. Un client ne doit jamais croire avoir payé pour de vrai.
   */
  abstract readonly reel: boolean;

  abstract ouvrirEncaissement(demande: DemandeEncaissement): Promise<SessionEncaissement>;

  abstract lireEncaissement(idSession: string): Promise<EtatEncaissement>;

  /**
   * Retrouve une session par notre référence d'opération.
   *
   * Indispensable au rattrapage : si un webhook est perdu — Wave reconnaît que
   * « des événements peuvent occasionnellement être manqués » — c'est le seul
   * moyen de savoir si le client a payé.
   */
  abstract chercherEncaissementParReference(reference: string): Promise<EtatEncaissement | null>;

  abstract verser(demande: DemandeVersement): Promise<EtatVersement>;

  /**
   * État d'un versement.
   *
   * ⚠️ Wave n'émet **aucun** webhook pour les versements : seuls les
   * encaissements en produisent. Un versement doit donc être interrogé — d'où
   * cette méthode et la tâche de rapprochement qui s'appuie dessus.
   */
  abstract lireVersement(idVersement: string): Promise<EtatVersement>;

  /** Solde du portefeuille, pour la caisse et avant tout versement. */
  abstract lireSoldeXof(): Promise<MontantXof>;

  /**
   * Vérifie l'authenticité d'un événement et le traduit.
   *
   * @param rawBody corps **brut**, non parsé. Démontré indispensable : signer
   *   le même JSON re-sérialisé produit une signature différente.
   */
  abstract verifierEvenement(rawBody: Buffer, enTeteSignature: string | undefined): EvenementPaiement;
}
