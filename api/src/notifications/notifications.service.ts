import { Injectable, Logger } from '@nestjs/common';
import { NotificationChannel, type Notification } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface NotificationInput {
  userId: string;
  title: string;
  body: string;
  /** Route applicative visée au tap, ex. `/compte`. */
  deepLink?: string | null;
  channel?: NotificationChannel;
}

/**
 * Notifications utilisateur.
 *
 * Pour l'instant, **seul le canal interne** est écrit : la notification vit en
 * base et l'application la lit. Les canaux sortants (Expo Push, WhatsApp, SMS,
 * email) viendront en brique 9 et s'ajouteront ici sans changer les appelants —
 * c'est tout l'intérêt de passer par ce service plutôt que d'appeler un
 * fournisseur depuis le métier (OCP).
 *
 * Comme l'audit : une notification qui échoue ne doit jamais faire échouer
 * l'action métier qu'elle accompagne.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async notify(input: NotificationInput): Promise<void> {
    try {
      await this.prisma.notification.create({
        data: {
          userId: input.userId,
          channel: input.channel ?? NotificationChannel.PUSH,
          title: input.title,
          body: input.body,
          deepLink: input.deepLink ?? null,
          sentAt: new Date(),
        },
      });
    } catch (error) {
      this.logger.error(`Notification non enregistrée pour ${input.userId} : ${String(error)}`);
    }
  }

  listFor(userId: string): Promise<Notification[]> {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async markRead(userId: string): Promise<number> {
    const result = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return result.count;
  }
}
