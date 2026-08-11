import { Injectable, Logger } from '@nestjs/common';
import { NotificationChannel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { DeliveryResult, NotificationTransport, OutboundMessage } from './transport';

const EXPO_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

interface ExpoTicket {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}

/**
 * Notification poussée sur les téléphones, via le service Expo.
 *
 * Aucune clé n'est nécessaire pour un projet Expo : c'est le **jeton
 * d'appareil** qui autorise l'envoi. Le transport est donc « configuré » dès
 * que le client a au moins un appareil enregistré.
 *
 * ⚠️ Un jeton invalide (`DeviceNotRegistered`) est **supprimé immédiatement** :
 * l'application a été désinstallée ou réinstallée. Le garder ferait échouer
 * chaque envoi suivant, et la file finirait par ne plus rien livrer du tout.
 */
@Injectable()
export class ExpoPushTransport implements NotificationTransport {
  readonly channel = NotificationChannel.PUSH;
  private readonly logger = new Logger(ExpoPushTransport.name);

  constructor(private readonly prisma: PrismaService) {}

  isConfigured(): boolean {
    return true;
  }

  async send(message: OutboundMessage): Promise<DeliveryResult> {
    const tokens = message.recipient.pushTokens;
    if (tokens.length === 0) {
      return { channel: this.channel, delivered: false, detail: 'aucun appareil enregistré' };
    }

    try {
      const response = await fetch(EXPO_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(
          tokens.map((token) => ({
            to: token,
            title: message.title,
            body: message.body,
            sound: 'default',
            data: message.deepLink ? { deepLink: message.deepLink } : {},
          })),
        ),
      });

      if (!response.ok) {
        return { channel: this.channel, delivered: false, detail: `Expo a répondu ${response.status}` };
      }

      const payload = (await response.json()) as { data?: ExpoTicket[] };
      const tickets = payload.data ?? [];

      const dead = tickets
        .map((ticket, index) => ({ ticket, token: tokens[index] }))
        .filter(({ ticket }) => ticket.details?.error === 'DeviceNotRegistered')
        .map(({ token }) => token);

      if (dead.length > 0) {
        await this.prisma.pushToken.deleteMany({ where: { token: { in: dead } } });
        this.logger.log(`${dead.length} jeton(s) obsolète(s) retiré(s).`);
      }

      const ok = tickets.filter((ticket) => ticket.status === 'ok').length;
      return {
        channel: this.channel,
        delivered: ok > 0,
        detail: ok > 0 ? `${ok}/${tokens.length} appareil(s)` : 'aucun appareil joignable',
      };
    } catch (error) {
      // Réseau coupé, DNS, Expo indisponible : on le dit, on ne lève pas.
      return { channel: this.channel, delivered: false, detail: String(error) };
    }
  }
}
