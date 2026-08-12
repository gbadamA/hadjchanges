import { Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { NotificationChannel, Role, type Notification } from '@prisma/client';
import { z } from 'zod';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser, Roles } from '../common/decorators';
import { ApiZodBody, ZBody } from '../common/zod';
import { NotificationsService } from './notifications.service';
import { RateAlertsService } from './rate-alerts.service';

const deviceSchema = z.object({
  /** Jeton Expo de l'appareil : `ExponentPushToken[...]`. */
  token: z.string().trim().min(10).max(200),
  platform: z.enum(['ios', 'android', 'web']),
});

const testSchema = z.object({
  channel: z.nativeEnum(NotificationChannel),
});

const rateAlertSchema = z.object({
  currencyCode: z.string().trim().toUpperCase().length(3),
  thresholdRate: z.number().positive().max(1_000_000),
});

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly rateAlerts: RateAlertsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Mes notifications, la plus récente en tête.' })
  list(@CurrentUser() current: AuthUser): Promise<Notification[]> {
    return this.notifications.listFor(current.id);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Nombre de notifications non lues (pastille).' })
  async unread(@CurrentUser() current: AuthUser): Promise<{ unread: number }> {
    return { unread: await this.notifications.unreadCount(current.id) };
  }

  @Post('read')
  @HttpCode(200)
  @ApiOperation({ summary: 'Marquer toutes mes notifications comme lues.' })
  async read(@CurrentUser() current: AuthUser): Promise<{ marked: number }> {
    return { marked: await this.notifications.markRead(current.id) };
  }

  /** Enregistrement de l'appareil pour les notifications poussées. */
  @Post('devices')
  @HttpCode(200)
  @ApiOperation({ summary: 'Enregistrer cet appareil pour les notifications push.' })
  @ApiZodBody('RegisterDevice', deviceSchema)
  async registerDevice(
    @ZBody(deviceSchema) body: z.infer<typeof deviceSchema>,
    @CurrentUser() current: AuthUser,
  ): Promise<{ registered: boolean }> {
    await this.notifications.registerDevice(current.id, body.token, body.platform);
    return { registered: true };
  }

  @Delete('devices')
  @ApiOperation({ summary: 'Oublier cet appareil (déconnexion).' })
  async forgetDevice(
    @Query('token') token: string,
    @CurrentUser() current: AuthUser,
  ): Promise<{ removed: boolean }> {
    await this.notifications.forgetDevice(current.id, token ?? '');
    return { removed: true };
  }

  /** Diagnostic d'exploitation : quels canaux sont réellement branchés. */
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Get('channels')
  @ApiOperation({ summary: 'Canaux de notification disponibles.' })
  channels() {
    return this.notifications.availableChannels();
  }

  /**
   * Envoi d'essai — la façon de vérifier que des identifiants fraîchement
   * posés fonctionnent, sans attendre qu'un vrai client déclenche une
   * notification.
   *
   * ⚠️ **Le message part toujours vers le compte appelant**, jamais vers un
   * destinataire choisi : un point d'envoi libre serait un relais de spam offert
   * à quiconque obtiendrait un jeton d'administrateur.
   */
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Post('test')
  @HttpCode(200)
  @ApiOperation({ summary: 'S’envoyer un message d’essai pour valider un canal.' })
  @ApiZodBody('TestNotification', testSchema)
  async test(
    @ZBody(testSchema) body: z.infer<typeof testSchema>,
    @CurrentUser() current: AuthUser,
  ) {
    const results = await this.notifications.notify({
      userId: current.id,
      title: 'Essai de configuration',
      body: `Message d'essai envoyé depuis le pilotage HadjChanges le ${new Date().toLocaleString('fr-FR')}. Si vous le recevez, le canal est opérationnel.`,
      channels: [body.channel],
    });

    const result = results[0];
    return {
      channel: body.channel,
      // Aucun résultat = le transport n'est pas configuré, il a été écarté.
      attempted: results.length > 0,
      delivered: result?.delivered ?? false,
      detail: result?.detail ?? 'canal non configuré — renseignez ses identifiants dans .env',
    };
  }

  // --- Alertes de taux favorable -------------------------------------------

  @Roles(Role.CLIENT)
  @Get('rate-alerts')
  @ApiOperation({ summary: 'Mes devises surveillées.' })
  listAlerts(@CurrentUser() current: AuthUser) {
    return this.rateAlerts.listFor(current);
  }

  @Roles(Role.CLIENT)
  @Post('rate-alerts')
  @ApiOperation({ summary: 'Être prévenu quand une devise passe sous un seuil.' })
  @ApiZodBody('RateAlert', rateAlertSchema)
  createAlert(
    @ZBody(rateAlertSchema) body: z.infer<typeof rateAlertSchema>,
    @CurrentUser() current: AuthUser,
  ) {
    return this.rateAlerts.create(body, current);
  }

  @Roles(Role.CLIENT)
  @Delete('rate-alerts/:id')
  @ApiOperation({ summary: 'Ne plus surveiller cette devise.' })
  removeAlert(@Param('id') id: string, @CurrentUser() current: AuthUser) {
    return this.rateAlerts.remove(id, current);
  }
}
