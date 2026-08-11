import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { NotificationChannel, Prisma, type ExchangeRate } from '@prisma/client';
import type { AuthUser } from '../common/auth-user';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

export interface RateAlertInput {
  currencyCode: string;
  /** Seuil : on prévient quand le taux de VENTE passe sous cette valeur. */
  thresholdRate: number;
}

/**
 * Alerte de taux favorable (cahier §3.2, « optionnel, sur devises suivies »).
 *
 * Le sens retenu : on prévient quand **acheter la devise devient moins cher**,
 * c'est-à-dire quand le taux de vente passe SOUS le seuil choisi. C'est la
 * seule lecture utile pour un client qui prépare un voyage ou un pèlerinage —
 * il guette le moment d'acheter, pas celui de vendre.
 */
@Injectable()
export class RateAlertsService {
  private readonly logger = new Logger(RateAlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(input: RateAlertInput, client: AuthUser) {
    const currency = await this.prisma.currency.findUnique({
      where: { code: input.currencyCode },
    });
    if (!currency || !currency.active) {
      throw new NotFoundException(`Devise ${input.currencyCode} inconnue ou inactive.`);
    }
    if (currency.isBase) {
      throw new NotFoundException('La devise de référence ne se surveille pas.');
    }

    // Une seule alerte par devise et par client : en accumuler dix sur l'euro
    // ne servirait qu'à envoyer dix notifications identiques.
    const alert = await this.prisma.rateAlert.upsert({
      where: { userId_currencyId: { userId: client.id, currencyId: currency.id } },
      create: {
        userId: client.id,
        currencyId: currency.id,
        thresholdRate: new Prisma.Decimal(input.thresholdRate),
      },
      update: {
        thresholdRate: new Prisma.Decimal(input.thresholdRate),
        active: true,
        // Le compteur repart : un nouveau seuil mérite un nouveau déclenchement.
        triggeredAt: null,
      },
      include: { currency: true },
    });

    return this.toView(alert);
  }

  async listFor(client: AuthUser) {
    const rows = await this.prisma.rateAlert.findMany({
      where: { userId: client.id },
      orderBy: { createdAt: 'desc' },
      include: { currency: true },
    });
    return rows.map((row) => this.toView(row));
  }

  async remove(id: string, client: AuthUser): Promise<{ id: string }> {
    const deleted = await this.prisma.rateAlert.deleteMany({ where: { id, userId: client.id } });
    if (deleted.count === 0) throw new NotFoundException('Alerte introuvable.');
    return { id };
  }

  /**
   * Appelé à chaque publication de taux.
   *
   * ⚠️ **Ne doit jamais faire échouer la publication** : un taux qui ne
   * s'enregistre pas parce qu'une notification a raté serait une régression
   * bien plus grave que l'alerte manquée.
   *
   * ⚠️ Une alerte déclenchée est **désarmée** (`triggeredAt`) : sans cela,
   * chaque republication sous le seuil renverrait le même message, et le client
   * couperait ses notifications au bout de trois.
   */
  async onRatePublished(rate: ExchangeRate): Promise<number> {
    try {
      // Les taux propres à une agence ne concernent pas une alerte personnelle :
      // le client ne saurait pas de quelle agence on lui parle.
      if (rate.agencyId !== null) return 0;

      const alerts = await this.prisma.rateAlert.findMany({
        where: {
          currencyId: rate.currencyId,
          active: true,
          triggeredAt: null,
          thresholdRate: { gte: rate.sellRate },
        },
        include: { currency: true, user: { select: { id: true } } },
      });
      if (alerts.length === 0) return 0;

      for (const alert of alerts) {
        await this.notifications.notify({
          userId: alert.userId,
          title: `${alert.currency.code} : le taux est passé sous votre seuil`,
          body:
            `1 ${alert.currency.code} vaut désormais ${rate.sellRate.toString()} FCFA à l'achat, ` +
            `sous le seuil de ${alert.thresholdRate.toString()} que vous surveilliez.`,
          deepLink: '/simulateur',
          channels: [NotificationChannel.PUSH, NotificationChannel.EMAIL],
        });
      }

      await this.prisma.rateAlert.updateMany({
        where: { id: { in: alerts.map((alert) => alert.id) } },
        data: { triggeredAt: new Date(), active: false },
      });

      this.logger.log(`${alerts.length} alerte(s) de taux déclenchée(s) sur ${rate.currencyId}.`);
      return alerts.length;
    } catch (error) {
      this.logger.error(`Alertes de taux non traitées : ${String(error)}`);
      return 0;
    }
  }

  private toView(alert: Prisma.RateAlertGetPayload<{ include: { currency: true } }>) {
    return {
      id: alert.id,
      currency: { code: alert.currency.code, symbol: alert.currency.symbol },
      thresholdRate: alert.thresholdRate.toString(),
      active: alert.active,
      triggeredAt: alert.triggeredAt?.toISOString() ?? null,
      createdAt: alert.createdAt.toISOString(),
    };
  }
}
