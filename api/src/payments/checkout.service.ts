import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ComplianceSeverity, Prisma, PaymentStatus, TransactionStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/auth-user';
import { loadEnv } from '../config/env';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionsGateway } from '../realtime/transactions.gateway';
import { TransactionStateMachine } from '../transactions/transaction-state-machine';
import { transactionInclude } from '../transactions/transactions.view';
import { type EvenementPaiement, type IssuePaiement, PaymentService } from './payment.service';

/**
 * Encaissement par un opérateur mobile money : ouverture de la session, puis
 * traitement de l'événement signé qui la conclut.
 *
 * Remplace, pour les moyens de paiement qui exposent une API, le couple
 * « photo du reçu + contrôle humain » (cf. `ReceiptsService`). La machine à
 * états ne bouge pas : c'est la même transition vers `RECU_VALIDE`, atteinte
 * par une preuve signée au lieu du jugement d'un agent.
 */

/** Issue du traitement d'un événement, pour la trace et les tests. */
export type IssueTraitement =
  | 'VALIDE' // paiement confirmé, opération passée à « paiement prouvé »
  | 'DEJA_TRAITE' // événement déjà vu : rejeu ou double livraison
  | 'DEJA_PAYEE' // l'opération était déjà au-delà, rien à faire
  | 'ECHEC_PAIEMENT' // le client n'a pas réussi à payer
  | 'MONTANT_DIVERGENT' // payé ≠ attendu : mise en revue humaine
  | 'INCONNU' // aucune opération ne correspond
  | 'IGNORE'; // événement d'un type qui ne nous concerne pas

export interface ResultatTraitement {
  issue: IssueTraitement;
  reference: string | null;
}

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);
  private readonly env = loadEnv();

  constructor(
    private readonly prisma: PrismaService,
    private readonly paiements: PaymentService,
    private readonly machine: TransactionStateMachine,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly realtime: TransactionsGateway,
  ) {}

  // -------------------------------------------------------------------------
  // Ouverture
  // -------------------------------------------------------------------------

  /**
   * Ouvre une session de paiement pour une opération en attente de règlement.
   *
   * Rend l'adresse à ouvrir dans le NAVIGATEUR du client (pas dans une webview
   * embarquée : l'opérateur n'assure pas le retour vers l'application).
   */
  async ouvrir(
    transactionId: string,
    client: AuthUser,
  ): Promise<{ urlPaiement: string; idSession: string; expireLe: string | null; reel: boolean }> {
    const transaction = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      select: {
        id: true,
        reference: true,
        clientId: true,
        status: true,
        sourceAmount: true,
        rateLockedUntil: true,
        sourceCurrency: { select: { code: true } },
        client: { select: { phone: true } },
      },
    });
    if (!transaction || transaction.clientId !== client.id) {
      throw new NotFoundException('Transaction introuvable.');
    }
    if (transaction.status !== TransactionStatus.CREEE) {
      throw new ConflictException('Cette opération n’est plus en attente de paiement.');
    }

    // ⚠️ L'opérateur n'encaisse qu'en XOF, et la devise SOURCE est celle que le
    // client remet (c'est elle qui entre en caisse, cf. `ExchangeExecutor`).
    // Un ACHAT_DEVISE — le bureau achète des devises, le client apporte donc
    // des billets étrangers — ne peut pas se régler par mobile money : il faut
    // passer au guichet. Le refuser ici évite d'ouvrir une session qui
    // encaisserait le bon nombre dans la mauvaise monnaie : 50 000 EUR
    // deviendraient 50 000 XOF, soit 1/650 du dû.
    if (transaction.sourceCurrency.code !== this.env.BASE_CURRENCY) {
      throw new BadRequestException(
        `Le paiement mobile n’encaisse qu’en ${this.env.BASE_CURRENCY}. ` +
          'Cette opération doit être réglée en agence.',
      );
    }

    // Le verrou de taux et la session expirent ensemble (30 min de part et
    // d'autre) : ouvrir une session sur un taux déjà périmé enverrait le client
    // payer un prix qui ne sera pas honoré.
    if (transaction.rateLockedUntil && transaction.rateLockedUntil.getTime() < Date.now()) {
      throw new ConflictException(
        'Le taux garanti a expiré. Reprenez la simulation pour obtenir un nouveau prix.',
      );
    }

    const montantXof = this.enEntier(transaction.sourceAmount);
    const session = await this.paiements.ouvrirEncaissement({
      reference: transaction.reference,
      montantXof,
      urlSucces: `${this.env.API_PUBLIC_URL}/api/payments/retour/succes?ref=${encodeURIComponent(transaction.reference)}`,
      urlEchec: `${this.env.API_PUBLIC_URL}/api/payments/retour/echec?ref=${encodeURIComponent(transaction.reference)}`,
      // Garde-fou LCB-FT : le paiement doit venir du numéro du client. Sans
      // cela, un tiers pourrait financer l'opération d'une personne dont on a
      // vérifié l'identité — le montage le plus banal du blanchiment.
      mobilePayeur: this.enE164(transaction.client.phone),
    });

    await this.prisma.paymentCheckout.create({
      data: {
        transactionId: transaction.id,
        provider: this.paiements.nom.toLowerCase(),
        providerSessionId: session.idSession,
        amountXof: new Prisma.Decimal(montantXof),
        status: PaymentStatus.EN_COURS,
        launchUrl: session.urlPaiement,
        expiresAt: session.expireLe,
      },
    });

    await this.audit.record({
      userId: client.id,
      action: 'checkout.open',
      entity: 'Transaction',
      entityId: transaction.id,
      after: {
        reference: transaction.reference,
        fournisseur: this.paiements.nom,
        montantXof,
        reel: this.paiements.reel,
      },
    });

    return {
      urlPaiement: session.urlPaiement,
      idSession: session.idSession,
      expireLe: session.expireLe?.toISOString() ?? null,
      // Le client doit savoir qu'un paiement est simulé : lui laisser croire
      // qu'il a payé pour de vrai serait trompeur.
      reel: this.paiements.reel,
    };
  }

  // -------------------------------------------------------------------------
  // Traitement de l'événement
  // -------------------------------------------------------------------------

  /**
   * Traite un événement entrant. **Lève** si la signature est invalide — c'est
   * le seul cas où l'appelant doit refuser l'événement.
   *
   * ⚠️ Politique de réponse, qui n'est pas qu'un détail : tout événement
   * durablement enregistré ou délibérément ignoré doit être ACQUITTÉ (2xx).
   * L'opérateur réessaie pendant 3 jours sur une réponse non-2xx : répondre en
   * erreur parce qu'une opération nous est inconnue le ferait marteler
   * l'API pendant trois jours pour un problème qui n'est pas le sien.
   */
  async traiterEvenement(
    rawBody: Buffer,
    enTeteSignature: string | undefined,
    ip?: string,
  ): Promise<ResultatTraitement> {
    return this.appliquerEvenement(this.paiements.verifierEvenement(rawBody, enTeteSignature), ip);
  }

  /**
   * Applique un événement **déjà authentifié**.
   *
   * Séparé de la vérification pour que le rattrapage par rapprochement — qui
   * interroge l'opérateur au lieu de recevoir un événement — emprunte
   * exactement le même chemin : contrôle du montant, dédoublonnage et machine
   * à états compris. Deux chemins de validation aux règles différentes
   * finiraient immanquablement par diverger, et c'est de l'argent.
   *
   * ⚠️ N'appeler qu'avec un événement dont la provenance est établie : soit
   * une signature vérifiée, soit une lecture directe chez l'opérateur.
   */
  async appliquerEvenement(
    evenement: EvenementPaiement,
    ip?: string,
  ): Promise<ResultatTraitement> {
    const provider = this.paiements.nom.toLowerCase();

    // ⚠️ Dédoublonnage AVANT tout traitement. L'opérateur annonce que ses
    // événements « peuvent être livrés plusieurs fois » : sans ce verrou, un
    // même paiement validerait deux fois la même opération. L'unicité est
    // portée par la base, seule capable de départager deux requêtes
    // simultanées — un `findFirst` suivi d'un `create` laisserait les deux
    // passer.
    try {
      await this.prisma.paymentEvent.create({
        data: { provider, providerEventId: evenement.idEvenement, type: evenement.type },
      });
    } catch (cause) {
      if (
        cause instanceof Prisma.PrismaClientKnownRequestError &&
        cause.code === 'P2002' // contrainte d'unicité
      ) {
        this.logger.log(`Événement ${evenement.idEvenement} déjà traité : ignoré.`);
        return { issue: 'DEJA_TRAITE', reference: null };
      }
      throw cause;
    }

    const encaissement = evenement.encaissement;
    if (!encaissement) {
      this.logger.log(`Événement ${evenement.type} sans encaissement : rien à faire.`);
      return { issue: 'IGNORE', reference: null };
    }

    // Retrouvé par l'identifiant de session, et à défaut par notre référence :
    // deux chemins, parce qu'un événement rejoué après une restauration de base
    // peut porter une session qu'on ne connaît plus.
    const checkout = await this.prisma.paymentCheckout.findUnique({
      where: { providerSessionId: encaissement.idSession },
      include: { transaction: { select: { id: true, status: true, reference: true, clientId: true, sourceAmount: true } } },
    });
    const transaction =
      checkout?.transaction ??
      (encaissement.reference
        ? await this.prisma.transaction.findUnique({
            where: { reference: encaissement.reference },
            select: { id: true, status: true, reference: true, clientId: true, sourceAmount: true },
          })
        : null);

    if (!transaction) {
      // Acquitté quand même : réessayer ne fera jamais apparaître l'opération.
      this.logger.error(
        `Encaissement ${encaissement.idSession} sans opération correspondante ` +
          `(référence « ${encaissement.reference ?? 'absente'} »). Événement conservé.`,
      );
      return { issue: 'INCONNU', reference: encaissement.reference };
    }

    await this.prisma.paymentEvent.update({
      where: { provider_providerEventId: { provider, providerEventId: evenement.idEvenement } },
      data: { transactionId: transaction.id },
    });

    if (encaissement.issue !== 'REUSSI') {
      return this.echec(checkout?.id ?? null, transaction, encaissement.issue, encaissement.codeEchec);
    }

    // ⚠️ Contrôle du MONTANT. C'est ce que l'agent faisait à l'œil sur le reçu,
    // avec le montant attendu affiché en évidence. Un encaissement de 100 XOF
    // ne doit pas solder une opération de 500 000 : sans ce test, l'automatisme
    // serait plus permissif que l'humain qu'il remplace.
    const attendu = this.enEntier(transaction.sourceAmount);
    if (encaissement.montantXof !== null && encaissement.montantXof !== attendu) {
      return this.montantDivergent(checkout?.id ?? null, transaction, encaissement.montantXof, attendu, ip);
    }

    // Déjà payée : un rejeu tardif ne doit pas rejouer la transition.
    if (transaction.status !== TransactionStatus.CREEE) {
      this.logger.log(
        `Opération ${transaction.reference} déjà au statut ${transaction.status} : confirmation sans effet.`,
      );
      return { issue: 'DEJA_PAYEE', reference: transaction.reference };
    }

    this.machine.assertPaiementProuve(transaction.status, TransactionStatus.PAIEMENT_CONFIRME);

    const [, mise] = await this.prisma.$transaction([
      this.prisma.paymentCheckout.updateMany({
        where: { providerSessionId: encaissement.idSession },
        data: {
          status: PaymentStatus.REUSSI,
          providerTransactionId: encaissement.idTransaction,
          failureCode: null,
        },
      }),
      this.prisma.transaction.update({
        where: { id: transaction.id },
        data: { status: TransactionStatus.PAIEMENT_CONFIRME, paidAt: new Date() },
        include: transactionInclude,
      }),
    ]);

    // ⚠️ Pas d'exécution du change ici, et c'est délibéré.
    //
    // 1. Tout mouvement de caisse exige un auteur (`CashMovement.createdById`
    //    n'est pas nullable). Attribuer à un agent un décaissement qu'il n'a
    //    pas fait falsifierait la piste d'audit d'un registre de caisse.
    // 2. `ExchangeExecutor` refuse si l'encaisse de l'agence ne suffit pas.
    //    L'exception ferait répondre en erreur, et l'opérateur réessaierait
    //    pendant 3 jours à cause d'un tiroir-caisse vide — alors que le
    //    paiement, lui, est parfaitement confirmé.
    // 3. Le webhook dispose de 5 secondes : l'arithmétique de caisse et les
    //    contrôles de solde n'y ont pas leur place.
    //
    // L'opération apparaît donc dans la file du dashboard, **déjà marquée
    // payée**, sans reçu à examiner. Ce qui disparaît est le jugement « cette
    // capture d'écran est-elle authentique ? » ; ce qui reste est le geste
    // d'exécuter le change, qu'un humain faisait de toute façon.
    await this.audit.record({
      // Nul volontairement : personne n'a agi, c'est une preuve signée qui a
      // déclenché la transition. `AuditLog.userId` est nullable pour ce cas.
      userId: null,
      action: 'checkout.confirme',
      entity: 'Transaction',
      entityId: transaction.id,
      before: { status: transaction.status },
      after: {
        status: TransactionStatus.PAIEMENT_CONFIRME,
        fournisseur: this.paiements.nom,
        idSession: encaissement.idSession,
        idTransactionFournisseur: encaissement.idTransaction,
        montantXof: encaissement.montantXof,
      },
      ip,
    });

    await this.notifications.notify({
      userId: transaction.clientId,
      title: 'Paiement confirmé',
      body: `Votre paiement a été confirmé automatiquement (${transaction.reference}). Votre change va être exécuté.`,
      deepLink: `/transaction/${transaction.id}`,
    });

    await this.realtime.publishAndView(mise, { withClient: true });
    this.logger.log(`Opération ${transaction.reference} confirmée par ${this.paiements.nom}.`);
    return { issue: 'VALIDE', reference: transaction.reference };
  }

  // -------------------------------------------------------------------------

  private async echec(
    checkoutId: string | null,
    transaction: { id: string; reference: string; clientId: string },
    issue: IssuePaiement,
    codeEchec: string | null,
  ): Promise<ResultatTraitement> {
    if (checkoutId) {
      await this.prisma.paymentCheckout.update({
        where: { id: checkoutId },
        data: {
          status: issue === 'EXPIRE' ? PaymentStatus.EXPIRE : PaymentStatus.ECHOUE,
          failureCode: codeEchec,
        },
      });
    }

    // ⚠️ L'opération RESTE en attente de paiement : un échec de paiement n'est
    // pas un rejet de reçu. Le client peut réessayer, et l'opérateur annonce
    // qu'« on peut recevoir plusieurs échecs avant une réussite ».
    await this.notifications.notify({
      userId: transaction.clientId,
      title: 'Paiement non abouti',
      body:
        codeEchec === 'insufficient-funds'
          ? 'Solde insuffisant sur votre compte. Rechargez-le puis réessayez.'
          : 'Votre paiement n’a pas abouti. Vous pouvez réessayer depuis votre opération.',
      deepLink: `/transaction/${transaction.id}`,
    });
    this.logger.warn(
      `Paiement non abouti sur ${transaction.reference} (${codeEchec ?? issue}). Opération laissée en attente.`,
    );
    return { issue: 'ECHEC_PAIEMENT', reference: transaction.reference };
  }

  /**
   * Montant payé différent du montant attendu : **rien n'est validé**.
   *
   * L'opération part en revue humaine par une alerte de conformité. Un écart
   * de montant sur un bureau de change n'est pas une broutille administrative :
   * c'est soit une erreur de saisie, soit une tentative de solder une grosse
   * opération avec un petit versement.
   */
  private async montantDivergent(
    checkoutId: string | null,
    transaction: { id: string; reference: string; clientId: string },
    paye: number,
    attendu: number,
    ip?: string,
  ): Promise<ResultatTraitement> {
    if (checkoutId) {
      await this.prisma.paymentCheckout.update({
        where: { id: checkoutId },
        data: { failureCode: 'montant-divergent' },
      });
    }

    await this.prisma.complianceAlert.create({
      data: {
        userId: transaction.clientId,
        transactionId: transaction.id,
        rule: 'MONTANT_PAIEMENT_DIVERGENT',
        severity: ComplianceSeverity.CRITIQUE,
        message:
          `Paiement de ${paye} XOF reçu pour une opération de ${attendu} XOF ` +
          `(${transaction.reference}). Opération NON validée : à vérifier avant tout change.`,
      },
    });

    await this.audit.record({
      userId: null,
      action: 'checkout.montant-divergent',
      entity: 'Transaction',
      entityId: transaction.id,
      after: { paye, attendu, reference: transaction.reference },
      ip,
    });

    this.logger.error(
      `Montant divergent sur ${transaction.reference} : ${paye} XOF payés pour ${attendu} XOF attendus. Non validée.`,
    );
    return { issue: 'MONTANT_DIVERGENT', reference: transaction.reference };
  }

  /** XOF n'a pas de décimales : un montant non entier est une anomalie. */
  private enEntier(montant: Prisma.Decimal): number {
    return Number(montant.toFixed(0));
  }

  /**
   * Numéro au format E.164 attendu par l'opérateur.
   *
   * Les comptes sont créés avec des numéros ivoiriens à 10 chiffres
   * (`0709000001`). Rend `null` plutôt qu'un numéro douteux : mieux vaut ne pas
   * restreindre le payeur que de restreindre sur un numéro faux, qui ferait
   * échouer tous les paiements du client.
   */
  private enE164(telephone: string): string | null {
    const chiffres = telephone.replace(/[^\d+]/g, '');
    if (chiffres.startsWith('+')) return chiffres;
    if (chiffres.length === 10 && chiffres.startsWith('0')) return `+225${chiffres}`;
    return null;
  }
}
