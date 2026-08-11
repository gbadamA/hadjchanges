import { Global, Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { RateAlertsService } from './rate-alerts.service';
import { EmailTransport } from './transports/email.transport';
import { ExpoPushTransport } from './transports/expo-push.transport';
import { SmsTransport, WhatsAppTransport } from './transports/messaging.transports';

/**
 * Global : le KYC, les reçus et les transactions notifient tous le client.
 * Les transports sont fournis ici et injectés dans le service : le métier ne
 * connaît jamais un fournisseur, seulement `NotificationsService`.
 */
@Global()
@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    RateAlertsService,
    ExpoPushTransport,
    EmailTransport,
    WhatsAppTransport,
    SmsTransport,
  ],
  exports: [NotificationsService, RateAlertsService],
})
export class NotificationsModule {}
