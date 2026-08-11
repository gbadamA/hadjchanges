import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import type { Env } from '../config/env';

/**
 * Réglages modifiables sans redéploiement (seuils, délais, numéros de dépôt).
 *
 * Ordre de résolution : valeur en base > variable d'environnement > défaut.
 * L'environnement sert d'amorçage, la base fait foi une fois renseignée —
 * c'est ce qui permet à un super-admin de changer un seuil sans toucher au VPS.
 */
@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async getNumber(key: string, envKey: keyof Env): Promise<number> {
    const stored = await this.prisma.setting.findUnique({ where: { key } });
    if (stored) {
      const parsed = Number(stored.value);
      if (!Number.isNaN(parsed)) return parsed;
    }
    return Number(this.config.get(envKey, { infer: true }));
  }

  async getString(key: string, fallback = ''): Promise<string> {
    const stored = await this.prisma.setting.findUnique({ where: { key } });
    return stored?.value ?? fallback;
  }

  /** Durée de validité du taux verrouillé à la simulation (minutes). */
  rateLockMinutes(): Promise<number> {
    return this.getNumber('rateLockMinutes', 'RATE_LOCK_MINUTES');
  }

  /** Au-delà de ce délai sans publication, un taux est signalé comme périmé. */
  rateStaleHours(): Promise<number> {
    return this.getNumber('rateStaleHours', 'RATE_STALE_HOURS');
  }

  /** Seuil de déclaration LCB-FT, en XOF. */
  lcbFtThresholdXof(): Promise<number> {
    return this.getNumber('lcbFtThresholdXof', 'LCB_FT_THRESHOLD_XOF');
  }
}
