import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationChannel } from '@prisma/client';
import { createTransport, type Transporter } from 'nodemailer';
import type { Env } from '../../config/env';
import type { DeliveryResult, NotificationTransport, OutboundMessage } from './transport';

/**
 * Courriel — le canal de secours, celui qui laisse une trace consultable par le
 * client sans dépendre de son téléphone.
 *
 * En développement, il pointe sur **Mailpit** : rien ne sort du poste, et tout
 * est relisible sur http://localhost:8036. C'est ce qui permet de vérifier
 * l'envoi pour de vrai plutôt que de se contenter d'un journal.
 */
@Injectable()
export class EmailTransport implements NotificationTransport {
  readonly channel = NotificationChannel.EMAIL;
  private readonly logger = new Logger(EmailTransport.name);
  private readonly transporter: Transporter | null;
  private readonly from: string;

  constructor(private readonly config: ConfigService<Env, true>) {
    const host = this.config.get('SMTP_HOST', { infer: true });
    const port = Number(this.config.get('SMTP_PORT', { infer: true }));
    this.from = this.config.get('MAIL_FROM', { infer: true });

    this.transporter = host
      ? createTransport({
          host,
          port,
          // Mailpit ne fait pas de TLS : `secure: false` est correct ici, et le
          // serveur de production imposera STARTTLS de lui-même sur le 587.
          secure: false,
          ignoreTLS: true,
        })
      : null;
  }

  isConfigured(): boolean {
    return this.transporter !== null;
  }

  async send(message: OutboundMessage): Promise<DeliveryResult> {
    if (!this.transporter) {
      return { channel: this.channel, delivered: false, detail: 'SMTP non configuré' };
    }
    if (!message.recipient.email) {
      return { channel: this.channel, delivered: false, detail: 'aucune adresse connue' };
    }

    try {
      await this.transporter.sendMail({
        from: this.from,
        to: message.recipient.email,
        subject: message.title,
        text: `${message.body}\n\n— HadjChanges, bureau de change`,
        html: this.render(message),
      });
      return { channel: this.channel, delivered: true };
    } catch (error) {
      this.logger.warn(`Courriel non remis à ${message.recipient.email} : ${String(error)}`);
      return { channel: this.channel, delivered: false, detail: String(error) };
    }
  }

  /** Gabarit sobre aux couleurs du projet — bleu nuit, filet doré. */
  private render(message: OutboundMessage): string {
    return `<!doctype html>
<html lang="fr"><body style="margin:0;background:#F5F8FC;font-family:Helvetica,Arial,sans-serif;color:#0B1A2A">
  <div style="max-width:560px;margin:24px auto;background:#FFFFFF;border-radius:12px;overflow:hidden;border:1px solid #D8E3EF">
    <div style="background:#0B2A4A;padding:20px 24px">
      <div style="color:#FFFFFF;font-size:18px;font-weight:bold">HadjChanges</div>
      <div style="color:#A9C2DC;font-size:12px">Bureau de change &middot; Abidjan</div>
    </div>
    <div style="height:3px;background:#C9A227"></div>
    <div style="padding:24px">
      <h1 style="margin:0 0 12px;font-size:18px;color:#0F3D6B">${escapeHtml(message.title)}</h1>
      <p style="margin:0;font-size:15px;line-height:22px">${escapeHtml(message.body)}</p>
    </div>
    <div style="padding:16px 24px;border-top:1px solid #D8E3EF;font-size:12px;color:#5A6B7D">
      Message automatique — inutile d'y répondre.
    </div>
  </div>
</body></html>`;
  }
}

/** Le corps vient de données métier : on ne l'injecte jamais brut dans du HTML. */
const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
