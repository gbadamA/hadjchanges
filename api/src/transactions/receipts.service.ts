import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ReceiptStatus, Role, TransactionStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/auth-user';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import type { UploadedDocument } from '../kyc/kyc.service';
import { ExchangeExecutor } from './exchange-executor';
import { TransactionStateMachine } from './transaction-state-machine';
import type { ReceiptRejectInput, ReceiptReviewInput } from './transactions.schemas';
import { toTransactionView, transactionInclude, type TransactionView } from './transactions.view';

const ACCEPTED_MIME = ['image/jpeg', 'image/png', 'image/heic', 'image/webp', 'application/pdf'];
const MAX_BYTES = 8 * 1024 * 1024;

export interface ReceiptQueueRow {
  id: string;
  status: ReceiptStatus;
  createdAt: string;
  declaredAmount: string | null;
  declaredRef: string | null;
  transaction: TransactionView;
}

/**
 * Reçus de paiement : le client dépose sa preuve, un agent la contrôle.
 *
 * C'est le point de contrôle humain qui remplace, pour l'instant, une
 * passerelle de paiement automatique (CLAUDE.md §6). Le jour où l'encaissement
 * sera automatisé, c'est un webhook qui déclenchera la même transition — la
 * machine à états ne bouge pas.
 */
@Injectable()
export class ReceiptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly machine: TransactionStateMachine,
    private readonly executor: ExchangeExecutor,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Dépôt de la preuve de paiement par le client. */
  async submit(
    transactionId: string,
    file: UploadedDocument | undefined,
    client: AuthUser,
    ip?: string,
  ): Promise<TransactionView> {
    if (!file) throw new BadRequestException('Le reçu de paiement est obligatoire.');
    if (!ACCEPTED_MIME.includes(file.mimetype)) {
      throw new BadRequestException('Format non accepté (JPEG, PNG, HEIC ou PDF).');
    }
    if (file.buffer.byteLength > MAX_BYTES) {
      throw new BadRequestException('Fichier trop volumineux (8 Mo maximum).');
    }

    const transaction = await this.prisma.transaction.findUnique({ where: { id: transactionId } });
    if (!transaction || transaction.clientId !== client.id) {
      throw new NotFoundException('Transaction introuvable.');
    }
    this.machine.assert(transaction.status, TransactionStatus.RECU_SOUMIS);

    const stored = await this.storage.save(file, `receipts/${transaction.id}`);

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.paymentReceipt.create({
        data: {
          transactionId,
          fileUrl: stored.key,
          mimeType: stored.mimeType,
          status: ReceiptStatus.EN_ATTENTE,
        },
      });
      return tx.transaction.update({
        where: { id: transactionId },
        data: { status: TransactionStatus.RECU_SOUMIS, receiptSubmittedAt: new Date() },
        include: transactionInclude,
      });
    });

    await this.audit.record({
      userId: client.id,
      action: 'receipt.submit',
      entity: 'Transaction',
      entityId: transactionId,
      after: { reference: transaction.reference },
      ip,
    });
    return toTransactionView(updated);
  }

  /** File de contrôle du dashboard (cahier §3.1 : « file dédiée »). */
  async queue(viewer: AuthUser, status: ReceiptStatus): Promise<ReceiptQueueRow[]> {
    const receipts = await this.prisma.paymentReceipt.findMany({
      where: {
        status,
        // Un opérateur ne contrôle que les reçus de son agence.
        transaction:
          viewer.role === Role.OPERATEUR && viewer.agencyId
            ? { agencyId: viewer.agencyId }
            : undefined,
      },
      orderBy: { createdAt: 'asc' }, // le plus ancien d'abord : personne n'attend indéfiniment
      take: 100,
      include: { transaction: { include: transactionInclude } },
    });

    return receipts.map((receipt) => ({
      id: receipt.id,
      status: receipt.status,
      createdAt: receipt.createdAt.toISOString(),
      declaredAmount: receipt.declaredAmount?.toString() ?? null,
      declaredRef: receipt.declaredRef,
      transaction: toTransactionView(receipt.transaction, { withClient: true }),
    }));
  }

  /** Lecture du justificatif — mêmes règles que pour une pièce d'identité. */
  async readFile(id: string, viewer: AuthUser): Promise<{ buffer: Buffer; mimeType: string }> {
    const receipt = await this.prisma.paymentReceipt.findUnique({
      where: { id },
      include: { transaction: { select: { clientId: true } } },
    });
    if (!receipt) throw new NotFoundException('Reçu introuvable.');

    const isOwner = receipt.transaction.clientId === viewer.id;
    if (!isOwner && viewer.role === Role.CLIENT) throw new NotFoundException('Reçu introuvable.');

    return { buffer: await this.storage.read(receipt.fileUrl), mimeType: receipt.mimeType };
  }

  /**
   * Validation du reçu **et exécution du change dans la foulée**.
   *
   * Les deux ne sont pas séparés côté agent : valider un reçu, c'est décider
   * que l'argent est arrivé. Laisser une transaction « reçu validé » sans
   * change exécuté créerait une file d'attente fantôme que personne ne relève.
   */
  async approve(
    id: string,
    input: ReceiptReviewInput,
    reviewer: AuthUser,
    ip?: string,
  ): Promise<TransactionView> {
    const receipt = await this.pending(id);
    this.machine.assert(receipt.transaction.status, TransactionStatus.RECU_VALIDE);

    await this.prisma.$transaction([
      this.prisma.paymentReceipt.update({
        where: { id },
        data: {
          status: ReceiptStatus.VALIDE,
          declaredAmount: input.declaredAmount ?? null,
          declaredRef: input.declaredRef ?? null,
          validatedById: reviewer.id,
          validatedAt: new Date(),
          rejectReason: null,
        },
      }),
      this.prisma.transaction.update({
        where: { id: receipt.transactionId },
        data: { status: TransactionStatus.RECU_VALIDE, receiptReviewedAt: new Date() },
      }),
    ]);

    await this.audit.record({
      userId: reviewer.id,
      action: 'receipt.approve',
      entity: 'PaymentReceipt',
      entityId: id,
      after: {
        transactionId: receipt.transactionId,
        declaredAmount: input.declaredAmount ?? null,
      },
      ip,
    });

    const executed = await this.executor.execute(receipt.transactionId, reviewer, ip);

    await this.notifications.notify({
      userId: receipt.transaction.clientId,
      title: 'Paiement confirmé',
      body: `Votre reçu a été validé et le change exécuté (${executed.reference}).`,
      deepLink: `/transaction/${receipt.transactionId}`,
    });
    return executed;
  }

  async reject(
    id: string,
    input: ReceiptRejectInput,
    reviewer: AuthUser,
    ip?: string,
  ): Promise<TransactionView> {
    const receipt = await this.pending(id);
    this.machine.assert(receipt.transaction.status, TransactionStatus.RECU_REJETE);

    const [, updated] = await this.prisma.$transaction([
      this.prisma.paymentReceipt.update({
        where: { id },
        data: {
          status: ReceiptStatus.REJETE,
          rejectReason: input.reason,
          validatedById: reviewer.id,
          validatedAt: new Date(),
        },
      }),
      this.prisma.transaction.update({
        where: { id: receipt.transactionId },
        data: { status: TransactionStatus.RECU_REJETE, receiptReviewedAt: new Date() },
        include: transactionInclude,
      }),
    ]);

    await this.audit.record({
      userId: reviewer.id,
      action: 'receipt.reject',
      entity: 'PaymentReceipt',
      entityId: id,
      after: { transactionId: receipt.transactionId, reason: input.reason },
      ip,
    });
    await this.notifications.notify({
      userId: receipt.transaction.clientId,
      title: 'Reçu de paiement refusé',
      body: `${input.reason} Déposez un nouveau justificatif depuis votre transaction.`,
      deepLink: `/transaction/${receipt.transactionId}`,
    });

    return toTransactionView(updated, { withClient: true });
  }

  private async pending(id: string) {
    const receipt = await this.prisma.paymentReceipt.findUnique({
      where: { id },
      include: { transaction: true },
    });
    if (!receipt) throw new NotFoundException('Reçu introuvable.');
    if (receipt.status !== ReceiptStatus.EN_ATTENTE) {
      // Deux agents devant la même file ne doivent pas trancher deux fois.
      throw new ConflictException('Ce reçu a déjà été traité.');
    }
    return receipt as typeof receipt & { declaredAmount: Prisma.Decimal | null };
  }
}
