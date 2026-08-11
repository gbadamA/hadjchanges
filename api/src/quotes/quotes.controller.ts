import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser, Public, Roles } from '../common/decorators';
import { ApiZodBody, ZBody } from '../common/zod';
import { lockSchema, simulateSchema, type LockInput, type SimulateInput } from './quotes.schemas';
import { QuotesService, type QuoteView } from './quotes.service';

@ApiTags('simulation')
@Controller('quotes')
export class QuotesController {
  constructor(private readonly quotes: QuotesService) {}

  /**
   * Simuler est libre : c'est la vitrine du bureau. Le quota est large mais
   * existe — un simulateur ouvert est aussi une porte pour aspirer les taux.
   */
  @Public()
  @Post('simulate')
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Simuler une conversion (taux + commission), sans compte.' })
  @ApiZodBody('Simulate', simulateSchema)
  simulate(@ZBody(simulateSchema) body: SimulateInput): Promise<QuoteView> {
    return this.quotes.simulate(body);
  }

  /**
   * Verrouiller engage le bureau sur un prix : réservé au client identifié.
   * Le KYC n'est PAS exigé ici — il l'est pour transiger (brique 4). Un client
   * en cours de vérification doit pouvoir préparer son opération.
   */
  @Roles(Role.CLIENT)
  @Post('lock')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Verrouiller le taux d’une simulation pour une durée limitée.' })
  @ApiZodBody('LockQuote', lockSchema)
  lock(@ZBody(lockSchema) body: LockInput, @CurrentUser() current: AuthUser): Promise<QuoteView> {
    return this.quotes.lock(body, current);
  }

  @Roles(Role.CLIENT)
  @Get(':id')
  @ApiOperation({ summary: 'Relire un devis verrouillé (le sien uniquement).' })
  find(@Param('id') id: string, @CurrentUser() current: AuthUser): Promise<QuoteView> {
    return this.quotes.findOwned(id, current);
  }
}
