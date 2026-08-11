import { Controller, ForbiddenException, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CashMovementType, Role } from '@prisma/client';
import { Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser, Roles } from '../common/decorators';
import { ApiZodBody, ZBody } from '../common/zod';
import { CashService } from './cash.service';

const movementsQuerySchema = z.object({
  currencyCode: z.string().trim().toUpperCase().length(3).optional(),
  type: z.nativeEnum(CashMovementType).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  take: z.coerce.number().int().positive().max(200).default(100),
});

/**
 * Alimentation et retrait sont réservés à l'encadrement : un opérateur qui
 * pourrait créditer sa propre caisse rendrait la clôture inutile.
 */
const manualMovementSchema = z.object({
  currencyCode: z.string().trim().toUpperCase().length(3),
  type: z.enum([CashMovementType.ALIMENTATION, CashMovementType.RETRAIT, CashMovementType.AJUSTEMENT]),
  amount: z.number().refine((value) => value !== 0, 'Un mouvement de zéro n’a pas de sens.'),
  note: z.string().trim().max(200).optional(),
});

const closeDaySchema = z.object({
  businessDay: z.coerce.date().optional(),
  note: z.string().trim().max(300).optional(),
  counts: z
    .array(
      z.object({
        currencyCode: z.string().trim().toUpperCase().length(3),
        countedAmount: z.number().nonnegative(),
      }),
    )
    .min(1, 'Comptez au moins une devise.'),
});

@ApiTags('caisses')
@Controller('cash')
export class CashController {
  constructor(private readonly cash: CashService) {}

  @Roles(Role.OPERATEUR, Role.ADMIN, Role.SUPER_ADMIN)
  @Get(':agencyId/balances')
  @ApiOperation({ summary: 'Soldes de caisse par devise.' })
  async balances(@Param('agencyId') agencyId: string, @CurrentUser() current: AuthUser) {
    this.assertScope(agencyId, current);
    const balances = await this.cash.balances(agencyId);
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

  @Roles(Role.OPERATEUR, Role.ADMIN, Role.SUPER_ADMIN)
  @Get(':agencyId/movements')
  @ApiOperation({ summary: 'Mouvements de caisse, filtrables.' })
  async movements(
    @Param('agencyId') agencyId: string,
    @Query() query: unknown,
    @CurrentUser() current: AuthUser,
  ) {
    this.assertScope(agencyId, current);
    const rows = await this.cash.movements(agencyId, movementsQuerySchema.parse(query));
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      currency: { code: row.currency.code, decimals: row.currency.decimals },
      amount: row.amount.toString(),
      balanceAfter: row.balanceAfter.toString(),
      note: row.note,
      reference: row.transaction?.reference ?? null,
      author: `${row.createdBy.firstName} ${row.createdBy.lastName}`,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Post(':agencyId/movements')
  @ApiOperation({ summary: 'Alimenter, retirer ou ajuster une caisse.' })
  @ApiZodBody('ManualCashMovement', manualMovementSchema)
  move(
    @Param('agencyId') agencyId: string,
    @ZBody(manualMovementSchema) body: z.infer<typeof manualMovementSchema>,
    @CurrentUser() current: AuthUser,
    @Req() request: Request,
  ) {
    return this.cash.adjust({ agencyId, ...body }, current, request.ip);
  }

  /**
   * La clôture est faite par celui qui tient la caisse — l'opérateur — mais
   * reste ouverte à l'encadrement pour les agences sans opérateur dédié.
   */
  @Roles(Role.OPERATEUR, Role.ADMIN, Role.SUPER_ADMIN)
  @Post(':agencyId/close-day')
  @ApiOperation({ summary: 'Clôture journalière : compter la caisse et constater les écarts.' })
  @ApiZodBody('CloseCashDay', closeDaySchema)
  closeDay(
    @Param('agencyId') agencyId: string,
    @ZBody(closeDaySchema) body: z.infer<typeof closeDaySchema>,
    @CurrentUser() current: AuthUser,
    @Req() request: Request,
  ) {
    this.assertScope(agencyId, current);
    return this.cash.closeDay({ agencyId, ...body }, current, request.ip);
  }

  @Roles(Role.OPERATEUR, Role.ADMIN, Role.SUPER_ADMIN)
  @Get(':agencyId/closures')
  @ApiOperation({ summary: 'Historique des clôtures journalières.' })
  async closures(
    @Param('agencyId') agencyId: string,
    @CurrentUser() current: AuthUser,
    @Query('take') take?: string,
  ) {
    this.assertScope(agencyId, current);
    const rows = await this.cash.closures(agencyId, Math.min(Number(take) || 30, 100));
    return rows.map((row) => ({
      id: row.id,
      businessDay: row.businessDay.toISOString().slice(0, 10),
      closedBy: `${row.closedBy.firstName} ${row.closedBy.lastName}`,
      note: row.note,
      createdAt: row.createdAt.toISOString(),
      lines: row.lines.map((line) => ({
        currency: { code: line.currency.code, decimals: line.currency.decimals },
        expected: line.expected.toString(),
        counted: line.counted.toString(),
        difference: line.difference.toString(),
      })),
    }));
  }

  /** Un opérateur ne voit et ne clôture que la caisse de SON agence. */
  private assertScope(agencyId: string, current: AuthUser): void {
    if (current.role === Role.OPERATEUR && current.agencyId !== agencyId) {
      throw new ForbiddenException('Vous ne pouvez agir que sur la caisse de votre agence.');
    }
  }
}
