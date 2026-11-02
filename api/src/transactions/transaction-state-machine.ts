import { ConflictException, Injectable } from '@nestjs/common';
import { TransactionChannel, TransactionStatus } from '@prisma/client';

/**
 * Machine à états d'une transaction (cahier §3.2).
 *
 * **La base ne connaît pas ces règles, et c'est voulu** : une contrainte SQL ne
 * sait pas dire « un reçu rejeté peut être redéposé mais une transaction close
 * ne rouvre jamais ». Tout passe par ici, et un service qui veut changer un
 * statut doit demander l'autorisation d'abord.
 *
 * Ajouter un état (un futur `EN_LITIGE`, par exemple) se fait en ajoutant une
 * ligne à cette table, sans toucher aux services (OCP).
 */
const TRANSITIONS: Record<TransactionStatus, TransactionStatus[]> = {
  // ⚠️ Depuis « en attente de paiement », la table COMMUNE ne mène qu'à
  // l'annulation. Confirmer un paiement passe forcément par
  // `assertPaiementProuve` — une preuve signée ou l'attestation d'un agent —
  // jamais par un appel ordinaire.
  [TransactionStatus.CREEE]: [TransactionStatus.ANNULEE],
  [TransactionStatus.PAIEMENT_CONFIRME]: [TransactionStatus.CHANGE_EXECUTE],
  [TransactionStatus.CHANGE_EXECUTE]: [TransactionStatus.PRETE_POUR_RETRAIT],
  [TransactionStatus.PRETE_POUR_RETRAIT]: [TransactionStatus.CLOTUREE],
  // États terminaux. Une transaction close ou annulée ne repart jamais : la
  // corriger, c'est en créer une nouvelle, pas réécrire l'histoire.
  [TransactionStatus.CLOTUREE]: [],
  [TransactionStatus.ANNULEE]: [],
};

/** Ce que le client peut voir comme « étapes franchies » dans son suivi. */
export const TIMELINE_ORDER: TransactionStatus[] = [
  TransactionStatus.CREEE,
  TransactionStatus.PAIEMENT_CONFIRME,
  TransactionStatus.CHANGE_EXECUTE,
  TransactionStatus.PRETE_POUR_RETRAIT,
  TransactionStatus.CLOTUREE,
];

/**
 * Transitions **supplémentaires** au guichet.
 *
 * Le client est là, avec ses billets, et l'opération naît sous les mains de
 * l'agent : il n'y a rien à confirmer séparément, le change s'exécute
 * directement. Ce raccourci est déclaré ici plutôt qu'ajouté à la table
 * commune — l'ouvrir à tout le monde laisserait une opération née dans
 * l'application exécuter un change sans que personne n'ait vu l'argent.
 */
const COUNTER_TRANSITIONS: Partial<Record<TransactionStatus, TransactionStatus[]>> = {
  [TransactionStatus.CREEE]: [TransactionStatus.CHANGE_EXECUTE],
  // Au guichet l'argent est remis dans la foulée : pas d'attente de retrait.
  [TransactionStatus.CHANGE_EXECUTE]: [TransactionStatus.CLOTUREE],
};

/**
 * Transitions **supplémentaires** quand le paiement est prouvé autrement que
 * par un justificatif importé.
 *
 * Deux preuves, une seule règle, parce que la machine à états se moque de
 * l'origine de la preuve — seul le service appelant en répond :
 *  - **l'événement signé d'un opérateur de paiement** : la signature tient
 *    lieu de preuve, il n'y a aucun document à contrôler ;
 *  - **l'attestation d'un agent au comptoir** : il a le client devant lui,
 *    retrouve l'opération par son code et constate le paiement.
 *
 * Dans les deux cas on passe directement de « en attente de paiement » à
 * « paiement confirmé » : il n'existe plus d'étape intermédiaire de dépôt ni
 * de contrôle de justificatif.
 *
 * ⚠️ Déclaré à part, et **atteignable uniquement par `assertPaiementProuve`**,
 * exactement pour la raison qui vaut déjà pour le guichet : ajouter
 * `CREEE → RECU_VALIDE` à la table commune permettrait à n'importe quel appel
 * de déclarer une opération payée sans qu'aucun argent n'ait été vu. Une
 * méthode au nom distinct ne peut pas être atteinte par erreur, contrairement
 * à un drapeau booléen qu'on oublie de passer.
 *
 */
const PREUVE_TRANSITIONS: Partial<Record<TransactionStatus, TransactionStatus[]>> = {
  [TransactionStatus.CREEE]: [TransactionStatus.PAIEMENT_CONFIRME],
};

@Injectable()
export class TransactionStateMachine {
  /**
   * Autorise une transition **sur preuve de paiement**.
   *
   * ⚠️ Deux appelants légitimes, et deux seulement :
   *  - le traitement d'un événement dont la **signature a été vérifiée** ;
   *  - l'**attestation d'un agent** qui a le client devant lui.
   *
   * Partout ailleurs, l'appeler reviendrait à déclarer une opération payée sans
   * que personne n'ait vu l'argent.
   */
  assertPaiementProuve(from: TransactionStatus, to: TransactionStatus): void {
    if (PREUVE_TRANSITIONS[from]?.includes(to)) return;
    // La table commune reste valable : une opération déjà au bon état y passe.
    if (TRANSITIONS[from].includes(to)) return;
    throw new ConflictException(
      `Transition refusée : une transaction ${LABELS[from]} ne peut pas passer à ${LABELS[to]}, même sur preuve de paiement.`,
    );
  }

  can(
    from: TransactionStatus,
    to: TransactionStatus,
    channel: TransactionChannel = TransactionChannel.APPLICATION,
  ): boolean {
    if (TRANSITIONS[from].includes(to)) return true;
    return (
      channel === TransactionChannel.GUICHET && (COUNTER_TRANSITIONS[from]?.includes(to) ?? false)
    );
  }

  /**
   * Refuse une transition invalide avec un message qui dit l'état courant :
   * « transition impossible » sans contexte est inexploitable en production.
   */
  assert(
    from: TransactionStatus,
    to: TransactionStatus,
    channel: TransactionChannel = TransactionChannel.APPLICATION,
  ): void {
    if (!this.can(from, to, channel)) {
      throw new ConflictException(
        `Transition refusée : une transaction ${LABELS[from]} ne peut pas passer à ${LABELS[to]}.`,
      );
    }
  }

  isFinal(status: TransactionStatus): boolean {
    return TRANSITIONS[status].length === 0;
  }
}

/** Libellés français — repris tels quels par le mobile et le dashboard. */
export const LABELS: Record<TransactionStatus, string> = {
  [TransactionStatus.CREEE]: 'en attente de paiement',
  [TransactionStatus.PAIEMENT_CONFIRME]: 'paiement confirmé',
  [TransactionStatus.CHANGE_EXECUTE]: 'change exécuté',
  [TransactionStatus.PRETE_POUR_RETRAIT]: 'prête pour retrait',
  [TransactionStatus.CLOTUREE]: 'clôturée',
  [TransactionStatus.ANNULEE]: 'annulée',
};
