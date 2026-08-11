import { Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ComplianceSeverity } from '@prisma/client';
import type { Request } from 'express';
import { z } from 'zod';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser, Roles } from '../common/decorators';
import { COMPLIANCE_ROLES, ComplianceService } from './compliance.service';

const alertsQuerySchema = z.object({
  resolved: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
  severity: z.nativeEnum(ComplianceSeverity).optional(),
  take: z.coerce.number().int().positive().max(200).default(100),
});

@ApiTags('conformité')
@Controller('compliance')
export class ComplianceController {
  constructor(private readonly compliance: ComplianceService) {}

  @Roles(...COMPLIANCE_ROLES)
  @Get('alerts')
  @ApiOperation({ summary: 'Alertes de vigilance LCB-FT, les plus graves en tête.' })
  alerts(@Query() query: unknown) {
    return this.compliance.alerts(alertsQuerySchema.parse(query));
  }

  @Roles(...COMPLIANCE_ROLES)
  @Get('alerts/count')
  @ApiOperation({ summary: 'Nombre d’alertes ouvertes (pastille du menu).' })
  count() {
    return this.compliance.openCount();
  }

  @Roles(...COMPLIANCE_ROLES)
  @Post('alerts/:id/resolve')
  @ApiOperation({ summary: 'Marquer une alerte comme traitée.' })
  resolve(@Param('id') id: string, @CurrentUser() current: AuthUser, @Req() request: Request) {
    return this.compliance.resolve(id, current, request.ip);
  }

  /**
   * Consommation des plafonds. Un CLIENT peut lire **les siens** : découvrir
   * son plafond au moment du refus est la pire des façons de l'apprendre.
   */
  @Get('limits/me')
  @ApiOperation({ summary: 'Mes plafonds et ce qu’il m’en reste.' })
  myLimits(@CurrentUser() current: AuthUser) {
    return this.compliance.limits(current.id);
  }

  @Roles(...COMPLIANCE_ROLES)
  @Get('limits/:userId')
  @ApiOperation({ summary: 'Plafonds d’un client et leur consommation.' })
  limits(@Param('userId') userId: string) {
    return this.compliance.limits(userId);
  }
}
