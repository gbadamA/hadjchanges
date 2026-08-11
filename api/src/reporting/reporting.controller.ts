import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { Response } from 'express';
import { z } from 'zod';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser, Roles } from '../common/decorators';
import { ReportingService, type ReportingOverview } from './reporting.service';

const overviewQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  agencyId: z.string().cuid().optional(),
});

const exportQuerySchema = overviewQuerySchema.extend({
  format: z.literal('csv').default('csv'),
});

/**
 * Reporting (cahier §3.1). Ouvert aux opérateurs — restreint à leur agence par
 * le service — parce qu'un chef d'agence a besoin de voir son activité, pas
 * seulement la direction.
 */
@ApiTags('rapports')
@Controller('reporting')
export class ReportingController {
  constructor(private readonly reporting: ReportingService) {}

  @Roles(Role.OPERATEUR, Role.ADMIN, Role.SUPER_ADMIN)
  @Get('overview')
  @ApiOperation({ summary: 'Volumes, commissions et répartitions sur une période.' })
  overview(@Query() query: unknown, @CurrentUser() current: AuthUser): Promise<ReportingOverview> {
    return this.reporting.overview(overviewQuerySchema.parse(query), current);
  }

  /**
   * Export comptable : la série journalière, une ligne par jour.
   * Même contrat de fichier que les autres exports — point-virgule et BOM,
   * pour qu'Excel francophone l'ouvre sans manipulation.
   */
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Get('export')
  @ApiOperation({ summary: 'Export comptable de la période (CSV).' })
  async export(
    @Query() query: unknown,
    @CurrentUser() current: AuthUser,
    @Res() response: Response,
  ): Promise<void> {
    const parsed = exportQuerySchema.parse(query);
    const report = await this.reporting.overview(parsed, current);

    const lines = [
      'Jour;Opérations;Volume (XOF);Commissions (XOF)',
      ...report.series.map((point) =>
        [
          point.day,
          point.operations,
          point.volumeXof.replace('.', ','),
          point.commissionXof.replace('.', ','),
        ].join(';'),
      ),
      // Le total est dans le fichier : sans lui, chacun refait la somme dans
      // son coin et les chiffres divergent d'une réunion à l'autre.
      [
        'TOTAL',
        report.totals.operations,
        report.totals.volumeXof.replace('.', ','),
        report.totals.commissionXof.replace('.', ','),
      ].join(';'),
    ];

    const body = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from(lines.join('\r\n'), 'utf8'),
    ]);

    response.setHeader('content-type', 'text/csv; charset=utf-8');
    response.setHeader(
      'content-disposition',
      `attachment; filename="hadjchanges-rapport-${report.period.from}_${report.period.to}.csv"`,
    );
    response.setHeader('cache-control', 'no-store, private');
    response.send(body);
  }
}
