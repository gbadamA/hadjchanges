import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PaymentStatus, PayoutStatus, TransactionStatus } from '@prisma/client';
import type { AuthUser } from '../common/auth-user';
import { PrismaService } from '../prisma/prisma.service';
import { CheckoutService } from './checkout.service';
import { PaymentService } from './payment.service';
import { PayoutService } from './payout.service';

/**
 * Rapprochement : aller demander à l'opérateur ce qu'on n'a pas appris
 * autrement.
 *
 * ⚠️ Deux manques distincts le rendent indispensable, et aucun n'est
 * contournable :
 *
 * 1. **Aucun webhook n'existe pour les versements.** Seuls les encaissements
 *    en émettent. Un versement resté « en cours » n'apprendra jamais son sort
 *    tout seul : il faut l'interroger.
 * 2. **Les événements d'encaissement peuvent être perdus.** L'opérateur écrit
 *    que « des événements peuvent occasionnellement être manqués ». Sans
 *    filet, un client aurait payé sans que son opération avance — et personne
 *    ne le saurait avant sa réclamation.
 *
 * ⚠️ Sur un hébergement dont l'instance s'endort (forfait gratuit), cette
 * tâche NE TOURNE PAS pendant le sommeil. Elle rattrape au réveil, mais les
 * versements restent « en cours » entre-temps. Une raison de plus pour ne pas
 * laisser cette API s'endormir.
 */

/** Lots volontairement petits : une tâche de fond ne doit pas saturer l'API. */
const LOT = 20;

/** En deçà, on laisse le webhook faire son travail avant de s'en mêler. */
const DELAI_RATTRAPAGE_MS = 5 * 60 * 1000;

@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);
  /** Évite qu'un passage lent soit doublé par le suivant. */
  private enCours = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly paiements: PaymentService,
    private readonly payouts: PayoutService,
    private readonly checkouts: CheckoutService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tourner(): Promise<{ versements: number; encaissements: number }> {
    if (this.enCours) {
      this.logger.debug('Rapprochement déjà en cours : passage ignoré.');
      return { versements: 0, encaissements: 0 };
    }
    this.enCours = true;
    try {
      const versements = await this.rapprocherVersements();
      const encaissements = await this.rattraperEncaissements();
      if (versements > 0 || encaissements > 0) {
        this.logger.log(
          `Rapprochement : ${versements} versement(s) et ${encaissements} encaissement(s) mis à jour.`,
        );
      }
      return { versements, encaissements };
    } catch (cause) {
      // Une tâche de fond ne doit jamais mourir sur une erreur : elle repasse
      // dans une minute. On journalise et on laisse vivre.
      this.logger.error(
        `Rapprochement interrompu : ${cause instanceof Error ? cause.message : String(cause)}`,
      );
      return { versements: 0, encaissements: 0 };
    } finally {
      this.enCours = false;
    }
  }

  /**
   * Interroge les versements dont l'issue est inconnue.
   *
   * Un versement sans identifiant fournisseur n'a peut-être jamais été créé
   * chez l'opérateur — mais peut-être que si, l'appel ayant échoué après coup.
   * On le retrouve alors par notre référence, seule façon de trancher sans
   * risquer un second virement.
   */
  private async rapprocherVersements(): Promise<number> {
    const enAttente = await this.prisma.paymentPayout.findMany({
      where: { status: PayoutStatus.EN_COURS },
      // Les jamais vérifiés d'abord (`lastCheckedAt` nul), puis les plus anciens.
      orderBy: [{ lastCheckedAt: { sort: 'asc', nulls: 'first' } }],
      take: LOT,
      include: {
        transaction: { select: { id: true, reference: true, clientId: true } },
        initiatedBy: { select: { id: true, role: true, agencyId: true } },
      },
    });

    let traites = 0;
    for (const ligne of enAttente) {
      if (!ligne.providerPayoutId) {
        // Sans identifiant, on ne peut pas interroger. On marque la vérification
        // pour ne pas boucler dessus à chaque minute, et on alerte : ce cas
        // demande un œil humain, parce que l'argent est peut-être parti.
        await this.prisma.paymentPayout.update({
          where: { id: ligne.id },
          data: { lastCheckedAt: new Date() },
        });
        this.logger.error(
          `Versement ${ligne.transaction.reference} sans identifiant fournisseur : ` +
            'issue indéterminable automatiquement. À VÉRIFIER À LA MAIN dans le portail ' +
            `de l’opérateur (clé d’idempotence ${ligne.idempotencyKey}).`,
        );
        continue;
      }

      try {
        const etat = await this.paiements.lireVersement(ligne.providerPayoutId);
        if (etat.issue === 'EN_COURS') {
          await this.prisma.paymentPayout.update({
            where: { id: ligne.id },
            data: { lastCheckedAt: new Date() },
          });
          continue;
        }
        const acteur: AuthUser = {
          id: ligne.initiatedBy.id,
          role: ligne.initiatedBy.role,
          agencyId: ligne.initiatedBy.agencyId,
        };
        await this.payouts.appliquer(
          ligne.id,
          etat,
          ligne.transaction.reference,
          ligne.transaction.clientId,
          acteur,
        );
        traites++;
      } catch (cause) {
        // Un versement injoignable est réessayé au tour suivant : ne jamais
        // conclure « échoué » sur une erreur de lecture, ce serait autoriser
        // une relance alors que l'argent est peut-être parti.
        this.logger.warn(
          `Versement ${ligne.transaction.reference} illisible : ` +
            `${cause instanceof Error ? cause.message : String(cause)}`,
        );
        await this.prisma.paymentPayout.update({
          where: { id: ligne.id },
          data: { lastCheckedAt: new Date() },
        });
      }
    }
    return traites;
  }

  /**
   * Filet pour les événements d'encaissement perdus.
   *
   * On ne regarde que les sessions ouvertes depuis plus de quelques minutes :
   * en deçà, le webhook est probablement en route, et doubler son travail ne
   * ferait qu'ajouter des appels inutiles.
   */
  private async rattraperEncaissements(): Promise<number> {
    const sessions = await this.prisma.paymentCheckout.findMany({
      where: {
        status: PaymentStatus.EN_COURS,
        createdAt: { lt: new Date(Date.now() - DELAI_RATTRAPAGE_MS) },
        transaction: {
          // Inutile d'insister sur une opération déjà avancée ou abandonnée.
          status: {
            in: [
              TransactionStatus.CREEE,
            ],
          },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: LOT,
      include: { transaction: { select: { reference: true } } },
    });

    let traites = 0;
    for (const session of sessions) {
      try {
        const etat = await this.paiements.lireEncaissement(session.providerSessionId);

        if (etat.issue === 'REUSSI') {
          // ⚠️ On ne valide PAS à part : on emprunte le même traitement que le
          // webhook, pour que le contrôle du montant, le dédoublonnage et la
          // machine à états s'appliquent aussi au rattrapage.
          //
          // L'identifiant d'événement est DÉTERMINISTE : un rattrapage rejoué
          // tombe sur « déjà traité » au lieu de valider deux fois. Et un
          // événement réel arrivant plus tard porte le sien, donc il sera vu
          // comme une opération déjà payée — les deux chemins se croisent sans
          // se marcher dessus.
          await this.checkouts.appliquerEvenement({
            idEvenement: `rattrapage:${session.providerSessionId}`,
            type: 'checkout.session.completed',
            encaissement: etat,
          });
          traites++;
          this.logger.warn(
            `Encaissement de ${session.transaction.reference} rattrapé par rapprochement : ` +
              'l’événement du fournisseur a été perdu.',
          );
        } else if (etat.issue === 'EXPIRE' || etat.issue === 'ECHOUE') {
          await this.prisma.paymentCheckout.update({
            where: { id: session.id },
            data: {
              status: etat.issue === 'EXPIRE' ? PaymentStatus.EXPIRE : PaymentStatus.ECHOUE,
              failureCode: etat.codeEchec,
            },
          });
          traites++;
        }
      } catch (cause) {
        this.logger.warn(
          `Session ${session.providerSessionId} illisible : ` +
            `${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }
    }
    return traites;
  }
}
