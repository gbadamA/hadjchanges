import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DepositMethod } from '@prisma/client';
import { Public } from '../common/decorators';
import { SettingsService } from './settings.service';

export interface PublicSettings {
  /** Numéro sur lequel le client dépose, par mode de paiement. */
  depositNumbers: Partial<Record<DepositMethod, string>>;
  rateLockMinutes: number;
}

@ApiTags('réglages')
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

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
