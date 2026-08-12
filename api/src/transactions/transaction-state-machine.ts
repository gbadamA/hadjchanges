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
  [TransactionStatus.CREEE]: [TransactionStatus.RECU_SOUMIS, TransactionStatus.ANNULEE],
  // Le reçu part en contrôle : l'agent valide ou rejette, personne d'autre.
  [TransactionStatus.RECU_SOUMIS]: [
    TransactionStatus.RECU_VALIDE,
    TransactionStatus.RECU_REJETE,
    TransactionStatus.ANNULEE,
  ],
  // Un rejet renvoie le client au dépôt : c'est une boucle, pas une impasse.
  [TransactionStatus.RECU_REJETE]: [TransactionStatus.RECU_SOUMIS, TransactionStatus.ANNULEE],
  [TransactionStatus.RECU_VALIDE]: [TransactionStatus.CHANGE_EXECUTE],
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
  TransactionStatus.RECU_SOUMIS,
  TransactionStatus.RECU_VALIDE,
  TransactionStatus.CHANGE_EXECUTE,
  TransactionStatus.PRETE_POUR_RETRAIT,
  TransactionStatus.CLOTUREE,
];

/**
 * Transitions **supplémentaires** au guichet.
 *
 * Le client est là, avec ses billets : il n'y a pas de reçu de virement à
 * contrôler, donc l'agent exécute le change directement. Ce raccourci est
 * déclaré ici, séparément, plutôt qu'ajouté à la table commune — l'ouvrir à
 * tout le monde laisserait une opération de l'application sauter le contrôle
 * du paiement, c'est-à-dire exécuter un change sans avoir vu l'argent.
 */
const COUNTER_TRANSITIONS: Partial<Record<TransactionStatus, TransactionStatus[]>> = {
  [TransactionStatus.CREEE]: [TransactionStatus.CHANGE_EXECUTE],
  // Au guichet l'argent est remis dans la foulée : pas d'attente de retrait.
  [TransactionStatus.CHANGE_EXECUTE]: [TransactionStatus.CLOTUREE],
};

@Injectable()
export class TransactionStateMachine {
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
  [TransactionStatus.RECU_SOUMIS]: 'reçu en cours de contrôle',
  [TransactionStatus.RECU_VALIDE]: 'reçu validé',
  [TransactionStatus.RECU_REJETE]: 'reçu rejeté',
  [TransactionStatus.CHANGE_EXECUTE]: 'change exécuté',
  [TransactionStatus.PRETE_POUR_RETRAIT]: 'prête pour retrait',
  [TransactionStatus.CLOTUREE]: 'clôturée',
  [TransactionStatus.ANNULEE]: 'annulée',
};
