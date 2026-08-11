import { Controller, ForbiddenException, Get, Param, Patch, Post } from '@nestjs/common';
import { Role, type Agency } from '@prisma/client';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { CashService } from '../cash/cash.service';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser, Public, Roles } from '../common/decorators';
import { ApiZodBody, ZBody } from '../common/zod';
import { PrismaService } from '../prisma/prisma.service';

const createAgencySchema = z.object({
  code: z.string().trim().toUpperCase().min(2).max(12),
  name: z.string().trim().min(2).max(80),
  city: z.string().trim().min(2).max(60),
  address: z.string().trim().max(160).optional(),
  phone: z.string().trim().max(20).optional(),
});

const updateAgencySchema = createAgencySchema.partial().extend({
  active: z.boolean().optional(),
});

@ApiTags('agences')
@Controller('agencies')
export class AgenciesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cashService: CashService,
  ) {}

  /**
   * Soldes de caisse d'une agence, devise par devise (cahier §3.1).
   * Réservé aux agents : c'est l'encaisse du bureau, pas une donnée publique.
   */
  @Roles(Role.OPERATEUR, Role.ADMIN, Role.SUPER_ADMIN)
  @Get(':id/cash')
  @ApiOperation({ summary: 'Soldes de caisse par devise.' })
  async cash(@Param('id') id: string, @CurrentUser() current: AuthUser) {
    // Un opérateur ne consulte que la caisse de son agence.
    if (current.role === Role.OPERATEUR && current.agencyId !== id) {
      throw new ForbiddenException('Vous ne pouvez consulter que la caisse de votre agence.');
    }
    const balances = await this.cashService.balances(id);
    return balances.map((balance) => ({
      currency: {
        code: balance.currency.code,
        symbol: balance.currency.symbol,
        decimals: balance.currency.decimals,
      },
      amount: balance.amount.toString(),
      updatedAt: balance.updatedAt.toISOString(),
    }));
  }

  /** Public : un client doit pouvoir choisir où retirer ses espèces. */
  @Public()
  @Get()
  @ApiOperation({ summary: 'Agences ouvertes au public.' })
  list(): Promise<Agency[]> {
    return this.prisma.agency.findMany({
      where: { active: true },
      orderBy: [{ city: 'asc' }, { name: 'asc' }],
    });
  }

  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Post()
  @ApiOperation({ summary: 'Créer une agence.' })
  @ApiZodBody('CreateAgency', createAgencySchema)
  async create(
    @ZBody(createAgencySchema) body: z.infer<typeof createAgencySchema>,
    @CurrentUser() current: AuthUser,
  ): Promise<Agency> {
    const agency = await this.prisma.agency.create({ data: body });
    await this.audit.record({
      userId: current.id,
      action: 'agency.create',
      entity: 'Agency',
      entityId: agency.id,
      after: agency,
    });
    return agency;
  }

  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Patch(':id')
  @ApiOperation({ summary: 'Modifier ou fermer une agence.' })
  @ApiZodBody('UpdateAgency', updateAgencySchema)
  async update(
    @Param('id') id: string,
    @ZBody(updateAgencySchema) body: z.infer<typeof updateAgencySchema>,
    @CurrentUser() current: AuthUser,
  ): Promise<Agency> {
    const before = await this.prisma.agency.findUniqueOrThrow({ where: { id } });
    const after = await this.prisma.agency.update({ where: { id }, data: body });
    await this.audit.record({
      userId: current.id,
      action: 'agency.update',
      entity: 'Agency',
      entityId: id,
      before,
      after,
    });
    return after;
  }
}
