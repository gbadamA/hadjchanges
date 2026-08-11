import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationChannel } from '@prisma/client';
import type { Env } from '../../config/env';
import type { DeliveryResult, NotificationTransport, OutboundMessage } from './transport';

/**
 * Numéro ivoirien vers le format international attendu par WhatsApp et Twilio.
 * `0709000001` → `+2250709000001`. Un numéro déjà international passe tel quel.
 */
export const toE164 = (phone: string): string => {
  const digits = phone.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('225')) return `+${digits}`;
  return `+225${digits.replace(/^0+/, '')}`;
};

/**
 * WhatsApp Business (Meta Cloud API) — le canal que les clients lisent vraiment
 * en Côte d'Ivoire.
 *
 * ⚠️ **Sans identifiants, le transport se déclare non configuré** et le service
 * passe au canal suivant. Il ne fait pas semblant d'avoir envoyé : une
 * notification qu'on croit partie est pire qu'une notification manquante.
 */
@Injectable()
export class WhatsAppTransport implements NotificationTransport {
  readonly channel = NotificationChannel.WHATSAPP;
  private readonly logger = new Logger(WhatsAppTransport.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  private get token(): string {
    return this.config.get('WHATSAPP_TOKEN', { infer: true }) ?? '';
  }

  private get phoneId(): string {
    return this.config.get('WHATSAPP_PHONE_ID', { infer: true }) ?? '';
  }

  isConfigured(): boolean {
    return this.token.length > 0 && this.phoneId.length > 0;
  }

  async send(message: OutboundMessage): Promise<DeliveryResult> {
    if (!this.isConfigured()) {
      return { channel: this.channel, delivered: false, detail: 'WhatsApp non configuré' };
    }

    try {
      const response = await fetch(`https://graph.facebook.com/v21.0/${this.phoneId}/messages`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: toE164(message.recipient.phone),
          type: 'text',
          text: { body: `*${message.title}*\n\n${message.body}` },
        }),
      });

      if (!response.ok) {
        const detail = await response.text();
        this.logger.warn(`WhatsApp a refusé l'envoi (${response.status}) : ${detail.slice(0, 200)}`);
        return { channel: this.channel, delivered: false, detail: `HTTP ${response.status}` };
      }
      return { channel: this.channel, delivered: true };
    } catch (error) {
      return { channel: this.channel, delivered: false, detail: String(error) };
    }
  }
}

/** SMS via Twilio — le filet de sécurité quand le client n'a pas de données. */
@Injectable()
export class SmsTransport implements NotificationTransport {
  readonly channel = NotificationChannel.SMS;
  private readonly logger = new Logger(SmsTransport.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  private get sid(): string {
    return this.config.get('TWILIO_ACCOUNT_SID', { infer: true }) ?? '';
  }

  private get authToken(): string {
    return this.config.get('TWILIO_AUTH_TOKEN', { infer: true }) ?? '';
  }

  private get from(): string {
    return this.config.get('TWILIO_FROM', { infer: true }) ?? '';
  }

  isConfigured(): boolean {
    return this.sid.length > 0 && this.authToken.length > 0 && this.from.length > 0;
  }

  async send(message: OutboundMessage): Promise<DeliveryResult> {
    if (!this.isConfigured()) {
      return { channel: this.channel, delivered: false, detail: 'SMS non configuré' };
    }

    try {
      const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${this.sid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            authorization: `Basic ${Buffer.from(`${this.sid}:${this.authToken}`).toString('base64')}`,
            'content-type': 'application/x-www-form-urlencoded',
          },
          // Un SMS se paie au segment de 160 caractères : on tronque plutôt que
          // d'envoyer trois messages pour une phrase de courtoisie.
          body: new URLSearchParams({
            To: toE164(message.recipient.phone),
            From: this.from,
            Body: `${message.title} — ${message.body}`.slice(0, 320),
          }).toString(),
        },
      );

      if (!response.ok) {
        this.logger.warn(`SMS refusé (${response.status}).`);
        return { channel: this.channel, delivered: false, detail: `HTTP ${response.status}` };
      }
      return { channel: this.channel, delivered: true };
    } catch (error) {
      return { channel: this.channel, delivered: false, detail: String(error) };
    }
  }
}
