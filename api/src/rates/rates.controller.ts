import { Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { Role } from '@prisma/client';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser, Public, Roles } from '../common/decorators';
import { ApiZodBody, ZBody } from '../common/zod';
import { publishRateSchema, type PublishRateInput } from './rates.schemas';
import { RatesService, type RateBoardRow } from './rates.service';

@ApiTags('taux')
@Controller('rates')
export class RatesController {
  constructor(private readonly rates: RatesService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Taux du jour (achat / vente / commission) — accès libre.' })
  @ApiQuery({ name: 'agencyId', required: false })
  board(@Query('agencyId') agencyId?: string): Promise<RateBoardRow[]> {
    return this.rates.board(agencyId ?? null);
  }

  @Roles(Role.OPERATEUR, Role.ADMIN, Role.SUPER_ADMIN)
  @Get(':code/history')
  @ApiOperation({ summary: "Historique des versions d'un taux (auteur + horodatage)." })
  history(@Param('code') code: string, @Query('take') take?: string): Promise<unknown[]> {
    const limit = Math.min(Math.max(Number(take) || 50, 1), 200);
    return this.rates.history(code, limit);
  }

  /** Publier un taux est réservé à l'administration : un opérateur ne fixe pas les prix. */
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Post()
  @ApiOperation({ summary: 'Publier une nouvelle version de taux (append-only).' })
  @ApiZodBody('PublishRate', publishRateSchema)
  publish(
    @ZBody(publishRateSchema) body: PublishRateInput,
    @CurrentUser() current: AuthUser,
    @Req() req: Request,
  ): Promise<unknown> {
    return this.rates.publish(body, current, req.ip ?? null);
  }
}
