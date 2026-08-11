import { Controller, Get, NotFoundException, Param, Patch, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser, Roles } from '../common/decorators';
import { ApiZodBody, ZBody } from '../common/zod';
import { PrismaService } from '../prisma/prisma.service';
import { publicUserSelect, type PublicUser } from './users.repository';

const assignSchema = z.object({
  /** null détache l'opérateur de son agence (mutation, départ). */
  agencyId: z.string().cuid().nullable(),
});

const listSchema = z.object({
  role: z.nativeEnum(Role).optional(),
  agencyId: z.string().cuid().optional(),
});

/**
 * Comptes internes (cahier §3.1 « affectation des opérateurs aux agences »).
 *
 * Séparé de `UsersController`, qui sert le profil du porteur du jeton : ici on
 * agit **sur d'autres personnes**, ce qui n'est pas la même responsabilité ni
 * les mêmes droits.
 */
@ApiTags('équipe')
@Controller('staff')
export class StaffController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Get()
  @ApiOperation({ summary: 'Comptes internes (opérateurs, admins).' })
  list(@Query() query: unknown): Promise<PublicUser[]> {
    const { role, agencyId } = listSchema.parse(query);
    return this.prisma.user.findMany({
      // Les clients ne sont pas de l'équipe : ils ont leur propre écran.
      where: { role: role ?? { not: Role.CLIENT }, agencyId },
      orderBy: [{ role: 'asc' }, { lastName: 'asc' }],
      select: publicUserSelect,
    });
  }

  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Patch(':id/agency')
  @ApiOperation({ summary: 'Affecter un opérateur à une agence (ou l’en détacher).' })
  @ApiZodBody('AssignAgency', assignSchema)
  async assign(
    @Param('id') id: string,
    @ZBody(assignSchema) body: z.infer<typeof assignSchema>,
    @CurrentUser() current: AuthUser,
    @Req() request: Request,
  ): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Compte introuvable.');
    if (user.role !== Role.OPERATEUR) {
      // Un admin travaille sur tout le réseau : lui coller une agence
      // restreindrait ses écrans sans que personne comprenne pourquoi.
      throw new NotFoundException('Seul un opérateur se rattache à une agence.');
    }
    if (body.agencyId) {
      const agency = await this.prisma.agency.findUnique({ where: { id: body.agencyId } });
      if (!agency) throw new NotFoundException('Agence introuvable.');
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: { agencyId: body.agencyId },
      select: publicUserSelect,
    });

    await this.audit.record({
      userId: current.id,
      action: 'staff.assign_agency',
      entity: 'User',
      entityId: id,
      before: { agencyId: user.agencyId },
      after: { agencyId: body.agencyId },
      ip: request.ip,
    });
    return updated;
  }
}
