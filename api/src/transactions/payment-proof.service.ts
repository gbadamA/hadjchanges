import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role, TransactionStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/auth-user';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { ExchangeExecutor } from './exchange-executor';
import { TransactionStateMachine } from './transaction-state-machine';
import { MOBILE_MONEY_METHODS, type CounterCollectionInput } from './transactions.schemas';
import type { TransactionView } from './transactions.view';

/**
 * Preuve de paiement — **l'attestation d'un agent au comptoir**.
 *
 * Il n'y a plus de dépôt de justificatif par le client, ni de file de contrôle
 * : l'agent retrouve l'opération par son code, constate le paiement, atteste,
 * et le change s'exécute dans la foulée. L'autre preuve possible est
 * l'événement signé d'un opérateur de paiement, traité ailleurs
 * (`CheckoutService`) — les deux empruntent la même transition.
 */
@Injectable()
export class PaymentProofService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly machine: TransactionStateMachine,
    private readonly executor: ExchangeExecutor,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * **Encaissement au comptoir** — le parcours normal depuis que le reçu photo
   * a disparu.
   *
   * L'agent retrouve l'opération par son code (QR scanné ou numéro dicté),
   * constate le paiement ou reçoit les espèces, et l'atteste. Le change
   * s'exécute dans la foulée, exactement comme à la validation d'un
   * justificatif : laisser une opération « payée » sans change exécuté créerait
   * une file d'attente fantôme que personne ne relève.
   *
   * ⚠️ Ce qui remplace le document : l'identité de l'agent, l'horodatage, et
   * `declaredRef` — la référence du paiement relevée sur le téléphone du
   * client. C'est moins qu'une pièce conservée en cas de litige ou de contrôle
   * LCB-FT, et c'est un arbitrage assumé par l'exploitant. Raison de plus pour
   * que la référence soit saisie dès qu'elle existe.
   */
  async attester(
    transactionId: string,
    input: CounterCollectionInput,
    agent: AuthUser,
    ip?: string,
  ): Promise<TransactionView> {
    const transaction = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      select: {
        id: true,
        reference: true,
        status: true,
        clientId: true,
        sourceAmount: true,
        agencyId: true,
        depositMethod: true,
        sourceCurrency: { select: { isBase: true } },
      },
    });
    if (!transaction) throw new NotFoundException('Transaction introuvable.');

    // ⚠️ Un opérateur n'atteste que pour son agence. Sans ce contrôle, un
    // agent pourrait encaisser une opération rattachée ailleurs, et le
    // mouvement de caisse partirait de la mauvaise encaisse.
    if (
      agent.role === Role.OPERATEUR &&
      agent.agencyId &&
      transaction.agencyId &&
      transaction.agencyId !== agent.agencyId
    ) {
      throw new ConflictException(
        'Cette opération est rattachée à une autre agence : elle doit y être encaissée.',
      );
    }

    this.machine.assertPaiementProuve(transaction.status, TransactionStatus.PAIEMENT_CONFIRME);

    // Le réseau constaté au comptoir l'emporte sur celui choisi à la création.
    const methode = input.depositMethod ?? transaction.depositMethod;
    if (MOBILE_MONEY_METHODS.includes(methode) && !transaction.sourceCurrency.isBase) {
      throw new BadRequestException(
        'Le mobile money ne règle qu’en FCFA : cette opération se paie en devises, au comptoir.',
      );
    }
    if (MOBILE_MONEY_METHODS.includes(methode) && !input.declaredRef) {
      throw new BadRequestException(
        'Paiement mobile money : saisissez l’identifiant de transaction affiché sur le téléphone du client.',
      );
    }

    await this.prisma.$transaction([
      // La preuve est écrite DÉJÀ VALIDÉE : il n'y a personne d'autre à
      // attendre, l'agent est à la fois celui qui constate et celui qui valide.
      this.prisma.paymentReceipt.create({
        data: {
          transactionId,
          declaredAmount: input.declaredAmount ?? transaction.sourceAmount,
          declaredRef: input.declaredRef ?? null,
          attestedById: agent.id,
        },
      }),
      this.prisma.transaction.update({
        where: { id: transactionId },
        data: {
          status: TransactionStatus.PAIEMENT_CONFIRME,
          paidAt: new Date(),
          depositMethod: methode,
        },
      }),
    ]);

    await this.audit.record({
      userId: agent.id,
      action: 'paiement.attestation-comptoir',
      entity: 'Transaction',
      entityId: transactionId,
      before: { status: transaction.status },
      after: {
        reference: transaction.reference,
        modeDepot: methode,
        montantConstate: (input.declaredAmount ?? transaction.sourceAmount).toString(),
        referencePaiement: input.declaredRef ?? null,
      },
      ip,
    });

    const executed = await this.executor.execute(transactionId, agent, ip);

    await this.notifications.notify({
      userId: transaction.clientId,
      title: 'Paiement confirmé',
      body: `Votre paiement a été confirmé au comptoir et le change exécuté (${executed.reference}).`,
      deepLink: `/transaction/${transactionId}`,
    });
    return executed;
  }
}
