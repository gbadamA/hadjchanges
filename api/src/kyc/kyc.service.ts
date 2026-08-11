import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { KycStatus, Role, type KycDocument } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/auth-user';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import type { RejectKycInput, SubmitKycInput } from './kyc.schemas';

/** Ce qui sort de l'API : jamais la clé de stockage brute. */
export interface KycDocumentView {
  id: string;
  type: KycDocument['type'];
  status: KycStatus;
  documentNumber: string | null;
  expiresAt: string | null;
  hasSelfie: boolean;
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

export interface UploadedDocument {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}

/** Formats acceptés : une photo ou un PDF scanné. Rien d'exécutable. */
const ACCEPTED_MIME = ['image/jpeg', 'image/png', 'image/heic', 'image/webp', 'application/pdf'];
const MAX_BYTES = 8 * 1024 * 1024;

@Injectable()
export class KycService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Dépôt de la pièce d'identité par le client.
   *
   * Un seul dossier vivant à la fois : re-déposer alors qu'un dossier est en
   * attente créerait deux files pour la même personne, et re-déposer une pièce
   * quand on est déjà validé n'a pas de sens. La re-soumission après REJET,
   * elle, est explicitement prévue par le cahier §3.2.
   */
  async submit(
    input: SubmitKycInput,
    files: { document?: UploadedDocument; selfie?: UploadedDocument },
    client: AuthUser,
    ip?: string,
  ): Promise<KycDocumentView> {
    if (!files.document) throw new BadRequestException('La pièce d’identité est obligatoire.');
    this.assertAcceptable(files.document, 'la pièce d’identité');
    if (files.selfie) this.assertAcceptable(files.selfie, 'le selfie');

    const user = await this.prisma.user.findUnique({ where: { id: client.id } });
    if (!user) throw new NotFoundException('Compte introuvable.');
    if (user.kycStatus === KycStatus.VALIDE) {
      throw new ConflictException('Votre identité est déjà vérifiée.');
    }
    if (user.kycStatus === KycStatus.EN_ATTENTE) {
      throw new ConflictException('Un dossier est déjà en cours de vérification.');
    }

    const stored = await this.storage.save(files.document, `kyc/${client.id}`);
    const selfie = files.selfie ? await this.storage.save(files.selfie, `kyc/${client.id}`) : null;

    const [document] = await this.prisma.$transaction([
      this.prisma.kycDocument.create({
        data: {
          userId: client.id,
          type: input.type,
          fileUrl: stored.key,
          selfieUrl: selfie?.key ?? null,
          documentNumber: input.documentNumber ?? null,
          expiresAt: input.expiresAt ?? null,
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
      after: { type: document.type, hasSelfie: selfie !== null },
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

  /**
   * Lecture du fichier déposé. **Le contrôle d'accès est ici**, pas dans un
   * dossier statique : seul le propriétaire ou un agent habilité voit la pièce.
   */
  async readFile(
    id: string,
    kind: 'document' | 'selfie',
    viewer: AuthUser,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const document = await this.prisma.kycDocument.findUnique({ where: { id } });
    if (!document) throw new NotFoundException('Document introuvable.');

    const isOwner = document.userId === viewer.id;
    const isStaff = viewer.role !== Role.CLIENT;
    // Même réponse dans les deux cas : ne pas révéler l'existence d'un dossier.
    if (!isOwner && !isStaff) throw new NotFoundException('Document introuvable.');

    const key = kind === 'selfie' ? document.selfieUrl : document.fileUrl;
    if (!key) throw new NotFoundException('Aucun selfie sur ce dossier.');

    const buffer = await this.storage.read(key);
    return { buffer, mimeType: key.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg' };
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
      body: 'Votre pièce d’identité a été validée. Vous pouvez désormais effectuer vos opérations de change.',
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
      body: `${input.reason} Vous pouvez déposer une nouvelle pièce depuis votre compte.`,
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

  private assertAcceptable(file: UploadedDocument, label: string): void {
    if (!ACCEPTED_MIME.includes(file.mimetype)) {
      throw new BadRequestException(`Format non accepté pour ${label} (JPEG, PNG, HEIC ou PDF).`);
    }
    if (file.buffer.byteLength > MAX_BYTES) {
      throw new BadRequestException(`Fichier trop volumineux pour ${label} (8 Mo maximum).`);
    }
  }

  private toView(document: KycDocument, rejectReason?: string | null): KycDocumentView {
    return {
      id: document.id,
      type: document.type,
      status: document.status,
      documentNumber: document.documentNumber,
      expiresAt: document.expiresAt?.toISOString() ?? null,
      hasSelfie: document.selfieUrl !== null,
      rejectReason: rejectReason ?? document.rejectReason,
      createdAt: document.createdAt.toISOString(),
      reviewedAt: document.reviewedAt?.toISOString() ?? null,
    };
  }
}
