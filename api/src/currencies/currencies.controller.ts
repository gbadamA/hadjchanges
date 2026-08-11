import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { Role, type Currency } from '@prisma/client';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser, Public, Roles } from '../common/decorators';
import { ApiZodBody, ZBody } from '../common/zod';
import { PrismaService } from '../prisma/prisma.service';

const createCurrencySchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .length(3, 'Le code ISO 4217 fait 3 lettres (EUR, USD, GBP…).'),
  name: z.string().trim().min(2).max(60),
  symbol: z.string().trim().min(1).max(6),
  decimals: z.number().int().min(0).max(4).default(2),
  sortOrder: z.number().int().min(0).default(0),
});

const updateCurrencySchema = createCurrencySchema.partial().extend({
  active: z.boolean().optional(),
});

@ApiTags('devises')
@Controller('currencies')
export class CurrenciesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Devises actives, devise de référence comprise.' })
  list(): Promise<Currency[]> {
    return this.prisma.currency.findMany({
      where: { active: true },
      orderBy: [{ isBase: 'desc' }, { sortOrder: 'asc' }, { code: 'asc' }],
    });
  }

  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Post()
  @ApiOperation({ summary: 'Ajouter une devise échangeable.' })
  @ApiZodBody('CreateCurrency', createCurrencySchema)
  async create(
    @ZBody(createCurrencySchema) body: z.infer<typeof createCurrencySchema>,
    @CurrentUser() current: AuthUser,
  ): Promise<Currency> {
    // `isBase` n'est pas exposé : la devise de référence est posée au seed et
    // ne se change pas par API — tout l'historique des montants en dépend.
    const currency = await this.prisma.currency.create({ data: { ...body, isBase: false } });
    await this.audit.record({
      userId: current.id,
      action: 'currency.create',
      entity: 'Currency',
      entityId: currency.id,
      after: currency,
    });
    return currency;
  }

  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Patch(':id')
  @ApiOperation({ summary: 'Modifier ou désactiver une devise.' })
  @ApiZodBody('UpdateCurrency', updateCurrencySchema)
  async update(
    @Param('id') id: string,
    @ZBody(updateCurrencySchema) body: z.infer<typeof updateCurrencySchema>,
    @CurrentUser() current: AuthUser,
  ): Promise<Currency> {
    const before = await this.prisma.currency.findUniqueOrThrow({ where: { id } });
    const after = await this.prisma.currency.update({ where: { id }, data: body });
    await this.audit.record({
      userId: current.id,
      action: 'currency.update',
      entity: 'Currency',
      entityId: id,
      before,
      after,
    });
    return after;
  }
}
