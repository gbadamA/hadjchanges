import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  PayoutStatus,
  Prisma,
  TransactionDirection,
  TransactionStatus,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/auth-user';
import { loadEnv } from '../config/env';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionsService } from '../transactions/transactions.service';
import { type EtatVersement, PaymentService } from './payment.service';

/**
 * Versement des fonds au bénéficiaire par mobile money.
 *
 * Remplace, pour les opérations dont les fonds partent en XOF, le transfert
 * fait à la main par un opérateur. Il reste **déclenché par un humain** : c'est
 * l'opérateur qui décide d'envoyer l'argent, la machine ne fait que l'exécuter
 * et en suivre l'issue.
 */

/** Au-delà, on arrête d'insister : chaque tentative coûte des frais. */
const TENTATIVES_MAX = 3;

export interface VueVersement {
  id: string;
  statut: PayoutStatus;
  montantRecuXof: string;
  fraisXof: string | null;
  mobile: string;
  tentatives: number;
  codeEchec: string | null;
  idFournisseur: string | null;
  creeLe: string;
}

@Injectable()
export class PayoutService {
  private readonly logger = new Logger(PayoutService.name);
  private readonly env = loadEnv();

  constructor(
    private readonly prisma: PrismaService,
    private readonly paiements: PaymentService,
    private readonly transactions: TransactionsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Envoie les fonds au bénéficiaire, puis clôture si l'argent est arrivé.
   *
   * ⚠️ Toute la prudence de cette méthode tient à une phrase de la
   * documentation de l'opérateur : un même versement envoyé avec une clé
   * d'idempotence DIFFÉRENTE « aboutira inévitablement à une transaction
   * dupliquée ». Sur un bureau de change, cela veut dire payer deux fois le
   * même bénéficiaire, sans trace de l'erreur.
   */
  async verser(transactionId: string, operateur: AuthUser, ip?: string): Promise<VueVersement> {
    const transaction = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      select: {
        id: true,
        reference: true,
        status: true,
        clientId: true,
        direction: true,
        targetAmount: true,
        payoutMethod: true,
        payoutDetails: true,
        beneficiaryName: true,
        beneficiaryPhone: true,
        targetCurrency: { select: { code: true } },
        client: { select: { phone: true, firstName: true, lastName: true } },
      },
    });
    if (!transaction) throw new NotFoundException('Transaction introuvable.');

    // ⚠️ Les versements déjà tentés se regardent AVANT le statut, et l'ordre
    // compte. Un versement réussi clôture l'opération : interroger le statut
    // d'abord répondrait « pas prête pour retrait » à une seconde demande,
    // c'est-à-dire la bonne décision avec la mauvaise raison. Un agent lirait
    // qu'il faut attendre, là où il faut comprendre que l'argent est parti.
    const existants = await this.prisma.paymentPayout.findMany({
      where: { transactionId },
      orderBy: { createdAt: 'desc' },
    });

    if (existants.some((p) => p.status === PayoutStatus.REUSSI)) {
      throw new ConflictException('Les fonds ont déjà été versés pour cette opération.');
    }
    // LA règle qui évite de payer deux fois. Tant qu'un versement est en cours,
    // on ne relance RIEN : son sort est inconnu, et une seconde demande
    // porterait une nouvelle clé d'idempotence, donc enverrait réellement
    // l'argent une seconde fois. On attend que le rapprochement ait tranché.
    if (existants.some((p) => p.status === PayoutStatus.EN_COURS)) {
      throw new ConflictException(
        'Un versement est déjà en cours pour cette opération. ' +
          'Son issue sera connue au prochain rapprochement : ne pas relancer.',
      );
    }
    if (existants.length >= TENTATIVES_MAX) {
      throw new ConflictException(
        `${existants.length} versements ont déjà échoué sur cette opération. ` +
          'Chaque tentative coûte des frais : traitez le cas à la main.',
      );
    }

    if (transaction.status !== TransactionStatus.PRETE_POUR_RETRAIT) {
      throw new ConflictException(
        'Les fonds ne peuvent partir que lorsque l’opération est prête pour retrait.',
      );
    }
    if (transaction.payoutMethod !== 'MOBILE_MONEY') {
      throw new BadRequestException(
        'Cette opération ne prévoit pas un versement mobile money.',
      );
    }
    // ⚠️ Miroir exact du contrôle à l'encaissement : l'opérateur ne manie que
    // du XOF, et la devise CIBLE est celle qui part au bénéficiaire. Un
    // VENTE_DEVISE livre des billets étrangers — remise en agence obligatoire.
    if (transaction.targetCurrency.code !== this.env.BASE_CURRENCY) {
      throw new BadRequestException(
        `Le versement mobile n’envoie que du ${this.env.BASE_CURRENCY}. ` +
          'Cette opération doit être remise en agence.',
      );
    }

    const mobile = this.enE164(
      transaction.beneficiaryPhone ?? transaction.payoutDetails ?? transaction.client.phone,
    );
    if (!mobile) {
      throw new BadRequestException(
        'Numéro du bénéficiaire inexploitable : corrigez-le avant d’envoyer les fonds.',
      );
    }

    const montant = Number(transaction.targetAmount.toFixed(0));
    const beneficiaire =
      transaction.beneficiaryName ??
      `${transaction.client.firstName} ${transaction.client.lastName}`.trim();

    // ⚠️ La ligne est écrite AVANT l'appel, avec sa clé définitive. Si le
    // processus meurt pendant l'appel, la clé survit : le rapprochement saura
    // de quoi il parle, et une reprise rejouera la même clé au lieu d'envoyer
    // un second virement.
    const ligne = await this.prisma.paymentPayout.create({
      data: {
        transactionId,
        provider: this.paiements.nom.toLowerCase(),
        idempotencyKey: randomUUID(),
        receiveAmountXof: new Prisma.Decimal(montant),
        mobile,
        beneficiary: beneficiaire || null,
        initiatedById: operateur.id,
        status: PayoutStatus.EN_COURS,
        attempts: 1,
      },
    });

    await this.audit.record({
      userId: operateur.id,
      action: 'payout.envoi',
      entity: 'Transaction',
      entityId: transactionId,
      after: {
        reference: transaction.reference,
        montantXof: montant,
        mobile,
        fournisseur: this.paiements.nom,
        reel: this.paiements.reel,
      },
      ip,
    });

    let etat: EtatVersement;
    try {
      etat = await this.paiements.verser({
        reference: transaction.reference,
        montantRecuXof: montant,
        mobile,
        nom: beneficiaire || null,
        motif: `Change ${transaction.reference}`,
        cleIdempotence: ligne.idempotencyKey,
      });
    } catch (cause) {
      // ⚠️ L'échec de l'APPEL ne veut pas dire l'échec du VERSEMENT : un délai
      // réseau peut survenir après que l'opérateur a débité le portefeuille.
      // La ligne reste donc EN_COURS, et le rapprochement ira demander la
      // vérité. La marquer « échouée » ici autoriserait une relance, c'est-à-dire
      // un second virement.
      const code = this.codeDe(cause);
      await this.prisma.paymentPayout.update({
        where: { id: ligne.id },
        data: { failureCode: code, lastCheckedAt: new Date() },
      });
      this.logger.error(
        `Versement ${transaction.reference} : appel en échec (${code}). ` +
          'Laissé EN COURS — son sort est inconnu, le rapprochement tranchera.',
      );
      return this.vue({ ...ligne, failureCode: code });
    }

    return this.appliquer(ligne.id, etat, transaction.reference, transaction.clientId, operateur);
  }

  /**
   * Applique l'issue rendue par l'opérateur, et clôture si l'argent est arrivé.
   *
   * Partagé entre l'envoi et le rapprochement : les deux chemins doivent
   * conclure exactement de la même façon.
   */
  async appliquer(
    payoutId: string,
    etat: EtatVersement,
    reference: string,
    clientId: string,
    acteur: AuthUser,
  ): Promise<VueVersement> {
    const statuts: Record<EtatVersement['issue'], PayoutStatus> = {
      EN_COURS: PayoutStatus.EN_COURS,
      REUSSI: PayoutStatus.REUSSI,
      ECHOUE: PayoutStatus.ECHOUE,
      ANNULE: PayoutStatus.ANNULE,
    };

    const ligne = await this.prisma.paymentPayout.update({
      where: { id: payoutId },
      data: {
        providerPayoutId: etat.idVersement,
        status: statuts[etat.issue],
        feeXof: etat.fraisXof === null ? null : new Prisma.Decimal(etat.fraisXof),
        failureCode: etat.codeEchec,
        lastCheckedAt: new Date(),
      },
      include: { transaction: { select: { id: true, status: true } } },
    });

    if (etat.issue === 'REUSSI') {
      // Clôture idempotente : la machine à états refuse une seconde clôture,
      // et le rapprochement peut repasser sur la même ligne sans dommage.
      if (ligne.transaction.status === TransactionStatus.PRETE_POUR_RETRAIT) {
        await this.transactions.close(ligne.transaction.id, acteur);
      }
      await this.notifications.notify({
        userId: clientId,
        title: 'Fonds envoyés',
        body: `Les fonds de l’opération ${reference} ont été envoyés au ${ligne.mobile}.`,
        deepLink: `/transaction/${ligne.transaction.id}`,
      });
      this.logger.log(`Versement ${reference} réussi (${etat.idVersement}).`);
    } else if (etat.issue === 'ECHOUE') {
      await this.notifications.notify({
        userId: clientId,
        title: 'Versement non abouti',
        body:
          `Le versement de l’opération ${reference} n’a pas abouti` +
          `${etat.codeEchec ? ` (${this.enClair(etat.codeEchec)})` : ''}. Nos équipes vous recontactent.`,
        deepLink: `/transaction/${ligne.transaction.id}`,
      });
      this.logger.warn(`Versement ${reference} échoué : ${etat.codeEchec ?? 'sans code'}.`);
    }

    return this.vue(ligne);
  }

  /** Versements d'une opération, le plus récent d'abord. */
  async lister(transactionId: string): Promise<VueVersement[]> {
    const lignes = await this.prisma.paymentPayout.findMany({
      where: { transactionId },
      orderBy: { createdAt: 'desc' },
    });
    return lignes.map((ligne) => this.vue(ligne));
  }

  // -------------------------------------------------------------------------

  private vue(ligne: {
    id: string;
    status: PayoutStatus;
    receiveAmountXof: Prisma.Decimal;
    feeXof: Prisma.Decimal | null;
    mobile: string;
    attempts: number;
    failureCode: string | null;
    providerPayoutId: string | null;
    createdAt: Date;
  }): VueVersement {
    return {
      id: ligne.id,
      statut: ligne.status,
      // Les montants sortent en CHAÎNES, comme partout dans ce projet.
      montantRecuXof: ligne.receiveAmountXof.toString(),
      fraisXof: ligne.feeXof?.toString() ?? null,
      mobile: ligne.mobile,
      tentatives: ligne.attempts,
      codeEchec: ligne.failureCode,
      idFournisseur: ligne.providerPayoutId,
      creeLe: ligne.createdAt.toISOString(),
    };
  }

  private codeDe(cause: unknown): string {
    if (cause && typeof cause === 'object' && 'code' in cause) {
      const code = (cause as { code?: unknown }).code;
      if (typeof code === 'string') return code;
    }
    return 'appel-echoue';
  }

  /** Codes de l'opérateur traduits pour un client. */
  private enClair(code: string): string {
    const messages: Record<string, string> = {
      'insufficient-funds': 'fonds insuffisants chez nous',
      'recipient-account-blocked': 'compte du bénéficiaire bloqué',
      'recipient-account-inactive': 'compte du bénéficiaire inactif',
      'recipient-limit-exceeded': 'plafond mensuel du bénéficiaire atteint',
      'recipient-minor': 'bénéficiaire mineur',
      'country-mismatch': 'numéro hors du pays desservi',
      'request-validation-error': 'numéro invalide',
    };
    return messages[code] ?? code;
  }

  private enE164(valeur: string): string | null {
    const chiffres = valeur.replace(/[^\d+]/g, '');
    if (chiffres.startsWith('+') && chiffres.length >= 11) return chiffres;
    if (chiffres.length === 10 && chiffres.startsWith('0')) return `+225${chiffres}`;
    if (chiffres.length === 13 && chiffres.startsWith('225')) return `+${chiffres}`;
    return null;
  }
}
