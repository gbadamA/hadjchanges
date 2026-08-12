import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DepositMethod, Role } from '@prisma/client';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser, Public, Roles } from '../common/decorators';
import { ApiZodBody, ZBody } from '../common/zod';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from './settings.service';

export interface PublicSettings {
  /** Numéro sur lequel le client dépose, par mode de paiement. */
  depositNumbers: Partial<Record<DepositMethod, string>>;
  rateLockMinutes: number;
}

/**
 * Réglages modifiables depuis le pilotage, avec leur nature.
 *
 * **Liste blanche volontaire** : l'API n'accepte que ces clés. Sans elle, un
 * `PATCH /settings/nimporte-quoi` créerait des lignes fantômes que personne ne
 * lit, et un réglage mal orthographié passerait inaperçu jusqu'au jour où le
 * code chercherait l'ancien nom.
 *
 * ⚠️ **Aucun secret ici.** Les jetons WhatsApp et Twilio restent dans `.env` :
 * une clé d'API en base est une clé qui fuit par un export, une sauvegarde ou
 * un écran partagé.
 */
const EDITABLE = {
  depositNumberOrange: { label: 'Numéro de dépôt Orange Money', kind: 'phone' },
  depositNumberMtn: { label: 'Numéro de dépôt MTN MoMo', kind: 'phone' },
  depositNumberMoov: { label: 'Numéro de dépôt Moov Money', kind: 'phone' },
  rateLockMinutes: { label: 'Durée du taux verrouillé (minutes)', kind: 'number' },
  rateStaleHours: { label: 'Alerte si un taux n’est pas republié depuis (heures)', kind: 'number' },
  lcbFtThresholdXof: { label: 'Seuil de déclaration LCB-FT (XOF)', kind: 'number' },
  defaultDailyLimitXof: { label: 'Plafond journalier par défaut (XOF)', kind: 'number' },
  defaultMonthlyLimitXof: { label: 'Plafond mensuel par défaut (XOF)', kind: 'number' },
} as const;

type EditableKey = keyof typeof EDITABLE;

const updateSchema = z.object({
  value: z.string().trim().min(1, 'Une valeur est requise.').max(120),
});

@ApiTags('réglages')
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Tous les réglages modifiables, avec leur valeur courante. */
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Get()
  @ApiOperation({ summary: 'Réglages système modifiables.' })
  async all() {
    const stored = await this.prisma.setting.findMany();
    const byKey = new Map(stored.map((row) => [row.key, row]));

    return Object.entries(EDITABLE).map(([key, meta]) => ({
      key,
      label: meta.label,
      kind: meta.kind,
      value: byKey.get(key)?.value ?? '',
      updatedAt: byKey.get(key)?.updatedAt.toISOString() ?? null,
    }));
  }

  /**
   * Modification d'un réglage. Réservée au super-administrateur : ces valeurs
   * pilotent des seuils réglementaires et le numéro sur lequel les clients
   * envoient leur argent.
   */
  @Roles(Role.SUPER_ADMIN)
  @Patch(':key')
  @ApiOperation({ summary: 'Modifier un réglage système.' })
  @ApiZodBody('UpdateSetting', updateSchema)
  async update(
    @Param('key') key: string,
    @ZBody(updateSchema) body: z.infer<typeof updateSchema>,
    @CurrentUser() current: AuthUser,
    @Req() request: Request,
  ) {
    const meta = EDITABLE[key as EditableKey];
    if (!meta) throw new NotFoundException(`Réglage « ${key} » inconnu.`);

    if (meta.kind === 'number' && !/^\d+(\.\d+)?$/.test(body.value)) {
      throw new BadRequestException('Ce réglage attend un nombre.');
    }
    // Numéro ivoirien : 10 chiffres. Un numéro de dépôt erroné envoie l'argent
    // des clients chez quelqu'un d'autre — le contrôle vaut la peine.
    if (meta.kind === 'phone' && !/^\d{10}$/.test(body.value.replace(/\s/g, ''))) {
      throw new BadRequestException('Un numéro de dépôt compte 10 chiffres.');
    }

    const before = await this.prisma.setting.findUnique({ where: { key } });
    const value = meta.kind === 'phone' ? body.value.replace(/\s/g, '') : body.value;

    const updated = await this.prisma.setting.upsert({
      where: { key },
      create: { key, value, label: meta.label },
      update: { value, label: meta.label },
    });

    await this.audit.record({
      userId: current.id,
      action: 'setting.update',
      entity: 'Setting',
      entityId: key,
      before: { value: before?.value ?? null },
      after: { value },
      ip: request.ip,
    });

    return { key, value: updated.value, label: meta.label };
  }

  /**
   * Réglages publics — **strictement ceux dont le client a besoin pour payer**.
   * Les seuils de conformité, plafonds et paramètres internes ne sortent pas
   * d'ici : cette route est ouverte, donc tout ce qu'elle renvoie est public.
   */
  @Public()
  @Get('public')
  @ApiOperation({ summary: 'Numéros de dépôt et durée du verrou de taux.' })
  async publicSettings(): Promise<PublicSettings> {
    const [orange, mtn, moov, lockMinutes] = await Promise.all([
      this.settings.getString('depositNumberOrange'),
      this.settings.getString('depositNumberMtn'),
      this.settings.getString('depositNumberMoov'),
      this.settings.rateLockMinutes(),
    ]);

    return {
      depositNumbers: {
        [DepositMethod.ORANGE_MONEY]: orange,
        [DepositMethod.MTN_MOMO]: mtn,
        [DepositMethod.MOOV_MONEY]: moov,
      },
      rateLockMinutes: lockMinutes,
    };
  }
}
