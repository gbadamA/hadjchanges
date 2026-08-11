import { Controller, Get, NotFoundException, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { KycStatus, Prisma, Role } from '@prisma/client';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser, Roles } from '../common/decorators';
import { ApiZodBody, ZBody } from '../common/zod';
import { PrismaService } from '../prisma/prisma.service';

const listSchema = z.object({
  search: z.string().trim().max(80).optional(),
  kycStatus: z.nativeEnum(KycStatus).optional(),
  blocked: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
  take: z.coerce.number().int().positive().max(200).default(100),
});

/** `null` remet le plafond du compte sur le réglage global — ce n'est pas « zéro ». */
const limitsSchema = z.object({
  dailyLimitXof: z.number().nonnegative().nullable().optional(),
  monthlyLimitXof: z.number().nonnegative().nullable().optional(),
});

const blockSchema = z.object({
  reason: z.string().trim().min(10, 'Le motif doit être explicite.').max(300),
});

const MANAGERS = [Role.ADMIN, Role.SUPER_ADMIN] as const;

/**
 * Fiche client (cahier §3.1) : identité, statut KYC, plafonds, blocage.
 *
 * Séparé de `StaffController` : ce sont deux populations, deux écrans et deux
 * jeux de règles. Un client n'a pas d'agence, un agent n'a pas de plafond.
 */
@ApiTags('clients')
@Controller('clients')
export class ClientsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Roles(...MANAGERS)
  @Get()
  @ApiOperation({ summary: 'Liste des clients, filtrable.' })
  async list(@Query() query: unknown) {
    const { search, kycStatus, blocked, take } = listSchema.parse(query);

    const rows = await this.prisma.user.findMany({
      where: {
        role: Role.CLIENT,
        kycStatus,
        blocked,
        ...(search
          ? {
              OR: [
                { firstName: { contains: search, mode: 'insensitive' } },
                { lastName: { contains: search, mode: 'insensitive' } },
                { phone: { contains: search } },
                { email: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        email: true,
        kycStatus: true,
        blocked: true,
        blockedReason: true,
        dailyLimitXof: true,
        monthlyLimitXof: true,
        createdAt: true,
        _count: { select: { transactions: true } },
      },
    });

    return rows.map((row) => ({
      ...row,
      dailyLimitXof: row.dailyLimitXof?.toString() ?? null,
      monthlyLimitXof: row.monthlyLimitXof?.toString() ?? null,
      createdAt: row.createdAt.toISOString(),
      transactions: row._count.transactions,
      _count: undefined,
    }));
  }

  @Roles(...MANAGERS)
  @Patch(':id/limits')
  @ApiOperation({ summary: 'Fixer les plafonds d’un client (null = réglage global).' })
  @ApiZodBody('ClientLimits', limitsSchema)
  async setLimits(
    @Param('id') id: string,
    @ZBody(limitsSchema) body: z.infer<typeof limitsSchema>,
    @CurrentUser() current: AuthUser,
    @Req() request: Request,
  ) {
    const client = await this.client(id);

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        ...('dailyLimitXof' in body
          ? { dailyLimitXof: body.dailyLimitXof === null ? null : new Prisma.Decimal(body.dailyLimitXof ?? 0) }
          : {}),
        ...('monthlyLimitXof' in body
          ? {
              monthlyLimitXof:
                body.monthlyLimitXof === null ? null : new Prisma.Decimal(body.monthlyLimitXof ?? 0),
            }
          : {}),
      },
    });

    await this.audit.record({
      userId: current.id,
      action: 'client.limits',
      entity: 'User',
      entityId: id,
      before: {
        dailyLimitXof: client.dailyLimitXof?.toString() ?? null,
        monthlyLimitXof: client.monthlyLimitXof?.toString() ?? null,
      },
      after: {
        dailyLimitXof: updated.dailyLimitXof?.toString() ?? null,
        monthlyLimitXof: updated.monthlyLimitXof?.toString() ?? null,
      },
      ip: request.ip,
    });

    return {
      id: updated.id,
      dailyLimitXof: updated.dailyLimitXof?.toString() ?? null,
      monthlyLimitXof: updated.monthlyLimitXof?.toString() ?? null,
    };
  }

  /**
   * Blocage. Le motif est **obligatoire** : un compte bloqué sans raison écrite
   * est une décision qu'aucun collègue ne pourra reprendre, ni défendre.
   */
  @Roles(...MANAGERS)
  @Post(':id/block')
  @ApiOperation({ summary: 'Bloquer un compte client, avec motif.' })
  @ApiZodBody('BlockClient', blockSchema)
  async block(
    @Param('id') id: string,
    @ZBody(blockSchema) body: z.infer<typeof blockSchema>,
    @CurrentUser() current: AuthUser,
    @Req() request: Request,
  ) {
    await this.client(id);
    const updated = await this.prisma.user.update({
      where: { id },
      data: { blocked: true, blockedReason: body.reason },
    });

    await this.audit.record({
      userId: current.id,
      action: 'client.block',
      entity: 'User',
      entityId: id,
      after: { blocked: true, reason: body.reason },
      ip: request.ip,
    });
    return { id: updated.id, blocked: updated.blocked, blockedReason: updated.blockedReason };
  }

  @Roles(...MANAGERS)
  @Post(':id/unblock')
  @ApiOperation({ summary: 'Débloquer un compte client.' })
  async unblock(
    @Param('id') id: string,
    @CurrentUser() current: AuthUser,
    @Req() request: Request,
  ) {
    const client = await this.client(id);
    const updated = await this.prisma.user.update({
      where: { id },
      data: { blocked: false, blockedReason: null },
    });

    await this.audit.record({
      userId: current.id,
      action: 'client.unblock',
      entity: 'User',
      entityId: id,
      before: { blocked: true, reason: client.blockedReason },
      after: { blocked: false },
      ip: request.ip,
    });
    return { id: updated.id, blocked: updated.blocked };
  }

  private async client(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    // Passer par cette route pour toucher à un compte interne serait un
    // contournement de la gestion d'équipe : on refuse.
    if (!user || user.role !== Role.CLIENT) throw new NotFoundException('Client introuvable.');
    return user;
  }
}
