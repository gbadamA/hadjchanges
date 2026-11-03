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
  /**
   * Contenu du QR marchand du bureau, par réseau : l'agent l'affiche au
   * comptoir et le client le scanne avec l'application de son opérateur.
   * Public par nature — il est fait pour être montré.
   */
  merchantQr: Partial<Record<DepositMethod, string>>;
  rateLockMinutes: number;
}

/** Réseau mobile money → clé du QR marchand en base. */
export const MERCHANT_QR_KEYS = {
  [DepositMethod.WAVE]: 'merchantQrWave',
  [DepositMethod.ORANGE_MONEY]: 'merchantQrOrange',
  [DepositMethod.MTN_MOMO]: 'merchantQrMtn',
  [DepositMethod.MOOV_MONEY]: 'merchantQrMoov',
} as const;

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
  depositNumberWave: { label: 'Numéro de dépôt Wave', kind: 'phone' },
  // Contenu brut du QR marchand, relevé en scannant l'autocollant fourni par
  // l'opérateur. Jamais retapé à la main : un caractère faux et l'argent du
  // client part chez un autre marchand.
  merchantQrWave: { label: 'QR marchand Wave', kind: 'qr' },
  merchantQrOrange: { label: 'QR marchand Orange Money', kind: 'qr' },
  merchantQrMtn: { label: 'QR marchand MTN MoMo', kind: 'qr' },
  merchantQrMoov: { label: 'QR marchand Moov Money', kind: 'qr' },
  rateLockMinutes: { label: 'Durée du taux verrouillé (minutes)', kind: 'number' },
  rateStaleHours: { label: 'Alerte si un taux n’est pas republié depuis (heures)', kind: 'number' },
  lcbFtThresholdXof: { label: 'Seuil de déclaration LCB-FT (XOF)', kind: 'number' },
  defaultDailyLimitXof: { label: 'Plafond journalier par défaut (XOF)', kind: 'number' },
  defaultMonthlyLimitXof: { label: 'Plafond mensuel par défaut (XOF)', kind: 'number' },
} as const;

type EditableKey = keyof typeof EDITABLE;

const updateSchema = z.object({
  // 1 000 et non 120 : un QR marchand (EMVCo) dépasse souvent 200 caractères.
  // Les autres natures sont recontrôlées plus bas.
  value: z.string().trim().min(1, 'Une valeur est requise.').max(1000),
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
    if (meta.kind !== 'qr' && body.value.length > 120) {
      throw new BadRequestException('Valeur trop longue (120 caractères maximum).');
    }
    // Un QR marchand est une chaîne opaque, mais jamais une phrase : un espace
    // ou un saut de ligne signale un copier-coller raté plutôt qu'un scan.
    if (meta.kind === 'qr' && (body.value.length < 8 || /\s/.test(body.value))) {
      throw new BadRequestException(
        'Contenu de QR invalide : scannez l’autocollant fourni par l’opérateur.',
      );
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
    const [orange, mtn, moov, wave, lockMinutes] = await Promise.all([
      this.settings.getString('depositNumberOrange'),
      this.settings.getString('depositNumberMtn'),
      this.settings.getString('depositNumberMoov'),
      this.settings.getString('depositNumberWave'),
      this.settings.rateLockMinutes(),
    ]);

    const merchantQr: PublicSettings['merchantQr'] = {};
    for (const [method, key] of Object.entries(MERCHANT_QR_KEYS)) {
      const value = await this.settings.getString(key);
      // Un réglage jamais saisi n'est pas un QR : l'absence doit se voir,
      // pas s'afficher comme un code vide que le client scannerait en vain.
      if (value) merchantQr[method as DepositMethod] = value;
    }

    return {
      depositNumbers: {
        [DepositMethod.ORANGE_MONEY]: orange,
        [DepositMethod.MTN_MOMO]: mtn,
        [DepositMethod.MOOV_MONEY]: moov,
        [DepositMethod.WAVE]: wave,
      },
      merchantQr,
      rateLockMinutes: lockMinutes,
    };
  }
}
