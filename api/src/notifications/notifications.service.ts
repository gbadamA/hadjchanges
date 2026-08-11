import { Injectable, Logger } from '@nestjs/common';
import { NotificationChannel, type Notification } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmailTransport } from './transports/email.transport';
import { ExpoPushTransport } from './transports/expo-push.transport';
import { SmsTransport, WhatsAppTransport } from './transports/messaging.transports';
import type { DeliveryResult, NotificationTransport, OutboundMessage } from './transports/transport';

export interface NotificationInput {
  userId: string;
  title: string;
  body: string;
  /** Route applicative visée au tap, ex. `/compte`. */
  deepLink?: string | null;
  /**
   * Canaux souhaités, par ordre de préférence. Par défaut : push puis email.
   * Le SMS et WhatsApp coûtent de l'argent — on ne les déclenche que pour ce
   * qui le justifie (fonds disponibles, identité rejetée).
   */
  channels?: NotificationChannel[];
}

const DEFAULT_CHANNELS: NotificationChannel[] = [
  NotificationChannel.PUSH,
  NotificationChannel.EMAIL,
];

/**
 * Notifications utilisateur.
 *
 * Le métier appelle `notify()` sans savoir par où le message partira : les
 * transports sont des ports interchangeables (`transports/transport.ts`).
 * Ajouter un fournisseur ne touche aucun appelant.
 *
 * Deux règles non négociables :
 *  1. **Une notification n'échoue jamais bruyamment.** Le change, la validation
 *     de reçu ou le rejet d'identité qu'elle accompagne doivent aboutir même si
 *     tous les canaux sont muets.
 *  2. **La trace en base est écrite d'abord**, avant toute tentative d'envoi :
 *     l'application doit pouvoir afficher le message même si le push échoue.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly transports: NotificationTransport[];

  constructor(
    private readonly prisma: PrismaService,
    push: ExpoPushTransport,
    email: EmailTransport,
    whatsapp: WhatsAppTransport,
    sms: SmsTransport,
  ) {
    this.transports = [push, email, whatsapp, sms];
  }

  async notify(input: NotificationInput): Promise<DeliveryResult[]> {
    const channels = input.channels ?? DEFAULT_CHANNELS;

    try {
      const recipient = await this.prisma.user.findUnique({
        where: { id: input.userId },
        select: {
          id: true,
          phone: true,
          email: true,
          pushTokens: { select: { token: true } },
        },
      });
      if (!recipient) {
        this.logger.warn(`Notification sans destinataire : ${input.userId}`);
        return [];
      }

      // 1. La trace, toujours. C'est elle que l'app affiche.
      await this.prisma.notification.create({
        data: {
          userId: input.userId,
          channel: channels[0] ?? NotificationChannel.PUSH,
          title: input.title,
          body: input.body,
          deepLink: input.deepLink ?? null,
          sentAt: new Date(),
        },
      });

      // 2. Les envois sortants, en parallèle : un canal lent ne doit pas
      // retarder les autres.
      const message: OutboundMessage = {
        title: input.title,
        body: input.body,
        deepLink: input.deepLink,
        recipient: {
          userId: recipient.id,
          phone: recipient.phone,
          email: recipient.email,
          pushTokens: recipient.pushTokens.map((row) => row.token),
        },
      };

      const results = await Promise.all(
        this.transports
          .filter((transport) => channels.includes(transport.channel) && transport.isConfigured())
          .map((transport) => transport.send(message)),
      );

      const failed = results.filter((result) => !result.delivered);
      if (failed.length > 0) {
        // On journalise l'échec sur la trace : au support de savoir si le
        // client a pu être joint, sans avoir à fouiller les logs.
        await this.prisma.notification.updateMany({
          where: { userId: input.userId, error: null, readAt: null },
          data: {
            error: failed.map((result) => `${result.channel}: ${result.detail ?? 'échec'}`).join(' · '),
          },
        });
      }
      return results;
    } catch (error) {
      this.logger.error(`Notification non traitée pour ${input.userId} : ${String(error)}`);
      return [];
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

  unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, readAt: null } });
  }

  /**
   * Enregistrement d'un appareil. `upsert` sur le jeton : réinstaller
   * l'application ne doit pas créer un doublon qui recevrait deux fois le même
   * message.
   */
  async registerDevice(userId: string, token: string, platform: string): Promise<void> {
    await this.prisma.pushToken.upsert({
      where: { token },
      create: { userId, token, platform },
      update: { userId, platform },
    });
  }

  async forgetDevice(userId: string, token: string): Promise<void> {
    await this.prisma.pushToken.deleteMany({ where: { userId, token } });
  }

  /** Canaux réellement disponibles — utile au diagnostic d'exploitation. */
  availableChannels(): Array<{ channel: NotificationChannel; configured: boolean }> {
    return this.transports.map((transport) => ({
      channel: transport.channel,
      configured: transport.isConfigured(),
    }));
  }
}
