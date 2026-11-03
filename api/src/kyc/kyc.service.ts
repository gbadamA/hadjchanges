import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { KycStatus, type KycDocument } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/auth-user';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import type { RejectKycInput, SubmitKycInput } from './kyc.schemas';

export interface KycDocumentView {
  id: string;
  type: KycDocument['type'];
  status: KycStatus;
  documentNumber: string | null;
  expiresAt: string | null;
  rejectReason: string | null;
  createdAt: string;
  reviewedAt: string | null;
  client?: {
    id: string;
    firstName: string;
    lastName: string;
    phone: string;
    email: string | null;
  };
}

@Injectable()
export class KycService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Déclaration de la pièce d'identité par le client, sans photo : l'agent
   * en vérifie l'original de visu avant de valider.
   *
   * Un seul dossier vivant à la fois : re-déclarer alors qu'un dossier est en
   * attente créerait deux files pour la même personne, et re-déclarer une pièce
   * quand on est déjà validé n'a pas de sens. La re-soumission après REJET,
   * elle, est explicitement prévue par le cahier §3.2.
   */
  async submit(input: SubmitKycInput, client: AuthUser, ip?: string): Promise<KycDocumentView> {
    const user = await this.prisma.user.findUnique({ where: { id: client.id } });
    if (!user) throw new NotFoundException('Compte introuvable.');
    if (user.kycStatus === KycStatus.VALIDE) {
      throw new ConflictException('Votre identité est déjà vérifiée.');
    }
    if (user.kycStatus === KycStatus.EN_ATTENTE) {
      throw new ConflictException('Un dossier est déjà en cours de vérification.');
    }

    // Sans photo, le numéro est la seule chose qui relie la pièce à une
    // personne : une pièce déjà validée sur un autre compte signale un prête-nom
    // ou une usurpation. Même message dans tous les cas, sans dire à qui.
    const usedElsewhere = await this.prisma.kycDocument.findFirst({
      where: {
        type: input.type,
        documentNumber: input.documentNumber,
        status: KycStatus.VALIDE,
        userId: { not: client.id },
      },
      select: { id: true },
    });
    if (usedElsewhere) {
      throw new ConflictException(
        'Cette pièce est déjà associée à un autre compte. Présentez-vous en agence.',
      );
    }

    const [document] = await this.prisma.$transaction([
      this.prisma.kycDocument.create({
        data: {
          userId: client.id,
          type: input.type,
          fileUrl: null,
          documentNumber: input.documentNumber,
          expiresAt: input.expiresAt,
          status: KycStatus.EN_ATTENTE,
        },
      }),
      this.prisma.user.update({
        where: { id: client.id },
        // Le motif du rejet précédent disparaît : il portait sur l'ancien dépôt.
        data: { kycStatus: KycStatus.EN_ATTENTE, kycRejectReason: null },
      }),
    ]);

    await this.audit.record({
      userId: client.id,
      action: 'kyc.submit',
      entity: 'KycDocument',
      entityId: document.id,
      after: { type: document.type, documentNumber: document.documentNumber },
      ip,
    });

    return this.toView(document);
  }

  /** Dossier courant du client — celui que l'app affiche. */
  async mine(client: AuthUser): Promise<{ status: KycStatus; document: KycDocumentView | null }> {
    const user = await this.prisma.user.findUnique({ where: { id: client.id } });
    if (!user) throw new NotFoundException('Compte introuvable.');

    const document = await this.prisma.kycDocument.findFirst({
      where: { userId: client.id },
      orderBy: { createdAt: 'desc' },
    });
    return {
      status: user.kycStatus,
      document: document ? this.toView(document, user.kycRejectReason) : null,
    };
  }

  /** File d'attente du dashboard (cahier §3.1). */
  async queue(status: KycStatus, take: number): Promise<KycDocumentView[]> {
    const documents = await this.prisma.kycDocument.findMany({
      where: { status },
      orderBy: { createdAt: 'asc' }, // le plus ancien d'abord : personne ne doit être oublié
      take,
      include: {
        user: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
      },
    });
    return documents.map((document) => ({
      ...this.toView(document),
      client: document.user,
    }));
  }

  async approve(id: string, reviewer: AuthUser, ip?: string): Promise<KycDocumentView> {
    const document = await this.pending(id);

    const [updated] = await this.prisma.$transaction([
      this.prisma.kycDocument.update({
        where: { id },
        data: {
          status: KycStatus.VALIDE,
          reviewedById: reviewer.id,
          reviewedAt: new Date(),
          rejectReason: null,
        },
      }),
      this.prisma.user.update({
        where: { id: document.userId },
        data: {
          kycStatus: KycStatus.VALIDE,
          kycValidatedAt: new Date(),
          kycRejectReason: null,
        },
      }),
    ]);

    await this.audit.record({
      userId: reviewer.id,
      action: 'kyc.approve',
      entity: 'KycDocument',
      entityId: id,
      before: { status: document.status },
      after: { status: KycStatus.VALIDE, clientId: document.userId },
      ip,
    });
    await this.notifications.notify({
      userId: document.userId,
      title: 'Identité vérifiée',
      body: 'Votre identité a été vérifiée. Vous pouvez désormais effectuer vos opérations de change.',
      deepLink: '/compte',
    });

    return this.toView(updated);
  }

  async reject(
    id: string,
    input: RejectKycInput,
    reviewer: AuthUser,
    ip?: string,
  ): Promise<KycDocumentView> {
    const document = await this.pending(id);

    const [updated] = await this.prisma.$transaction([
      this.prisma.kycDocument.update({
        where: { id },
        data: {
          status: KycStatus.REJETE,
          reviewedById: reviewer.id,
          reviewedAt: new Date(),
          rejectReason: input.reason,
        },
      }),
      this.prisma.user.update({
        where: { id: document.userId },
        // Le motif est porté par le compte : c'est ce que l'app affiche au client.
        data: { kycStatus: KycStatus.REJETE, kycRejectReason: input.reason },
      }),
    ]);

    await this.audit.record({
      userId: reviewer.id,
      action: 'kyc.reject',
      entity: 'KycDocument',
      entityId: id,
      before: { status: document.status },
      after: { status: KycStatus.REJETE, reason: input.reason },
      ip,
    });
    await this.notifications.notify({
      userId: document.userId,
      title: 'Pièce d’identité refusée',
      body: `${input.reason} Vous pouvez déclarer à nouveau votre pièce depuis votre compte.`,
      deepLink: '/kyc',
    });

    return this.toView(updated, input.reason);
  }

  private async pending(id: string): Promise<KycDocument> {
    const document = await this.prisma.kycDocument.findUnique({ where: { id } });
    if (!document) throw new NotFoundException('Document introuvable.');
    if (document.status !== KycStatus.EN_ATTENTE) {
      // Deux agents ouvrant la même file ne doivent pas trancher deux fois.
      throw new ConflictException('Ce dossier a déjà été traité.');
    }
    return document;
  }

  private toView(document: KycDocument, rejectReason?: string | null): KycDocumentView {
    return {
      id: document.id,
      type: document.type,
      status: document.status,
      documentNumber: document.documentNumber,
      expiresAt: document.expiresAt?.toISOString() ?? null,
      rejectReason: rejectReason ?? document.rejectReason,
      createdAt: document.createdAt.toISOString(),
      reviewedAt: document.reviewedAt?.toISOString() ?? null,
    };
  }
}
