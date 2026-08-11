import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role, type AuditLog } from '@prisma/client';
import { z } from 'zod';
import { Roles } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';

const querySchema = z.object({
  entity: z.string().trim().min(1).optional(),
  entityId: z.string().trim().min(1).optional(),
  action: z.string().trim().min(1).optional(),
  take: z.coerce.number().int().positive().max(200).default(100),
});

type AuditRow = AuditLog & {
  user: { firstName: string; lastName: string; role: Role } | null;
};

/**
 * Consultation du journal d'audit (cahier §3.1, « journal d'activité »).
 *
 * **Lecture seule, et réservée à l'encadrement.** Un journal qu'on peut
 * modifier ne prouve rien ; un journal que tout le monde lit expose qui a
 * traité quel dossier. Il n'existe donc ni écriture ni suppression par l'API.
 */
@ApiTags('audit')
@Controller('audit')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Get()
  @ApiOperation({ summary: 'Journal d’activité, le plus récent en tête.' })
  list(@Query() query: unknown): Promise<AuditRow[]> {
    const { entity, entityId, action, take } = querySchema.parse(query);
    return this.prisma.auditLog.findMany({
      where: { entity, entityId, action },
      orderBy: { createdAt: 'desc' },
      take,
      include: { user: { select: { firstName: true, lastName: true, role: true } } },
    });
  }
}
