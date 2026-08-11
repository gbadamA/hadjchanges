import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TransactionDirection, type Currency, type Quote } from '@prisma/client';
import type { AuthUser } from '../common/auth-user';
import { PrismaService } from '../prisma/prisma.service';
import { RatesService } from '../rates/rates.service';
import { SettingsService } from '../settings/settings.service';
import { QuoteCalculator, type QuoteResult } from './quote-calculator';
import type { LockInput, SimulateInput } from './quotes.schemas';

/** Vue d'un devis telle qu'elle part sur le réseau (décimaux en chaînes). */
export interface QuoteView {
  reference: string | null;
  direction: TransactionDirection;
  sourceCurrency: string;
  targetCurrency: string;
  sourceAmount: string;
  targetAmount: string;
  appliedRate: string;
  commissionPct: string;
  commissionAmount: string;
  amountXof: string;
  /** null pour une simple simulation : rien n'est garanti tant qu'on ne verrouille pas. */
  lockedUntil: string | null;
  id: string | null;
}

@Injectable()
export class QuotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rates: RatesService,
    private readonly calculator: QuoteCalculator,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Simulation libre, sans compte et sans engagement (cahier §3.2).
   * Rien n'est écrit en base : une simulation n'est pas une promesse.
   */
  async simulate(input: SimulateInput): Promise<QuoteView> {
    const { result } = await this.price(input);
    return this.toView(result, input.direction, null);
  }

  /**
   * Verrouille le taux pour une durée limitée et persiste le devis.
   * C'est le seul moment où le prix devient une promesse — d'où le compte
   * obligatoire et l'échéance (CLAUDE.md §6).
   */
  async lock(input: LockInput, client: AuthUser): Promise<QuoteView> {
    const { result, rateId } = await this.price(input);
    const minutes = await this.settings.rateLockMinutes();

    const quote = await this.prisma.quote.create({
      data: {
        reference: await this.nextReference(),
        clientId: client.id,
        direction: input.direction,
        sourceCurrencyId: result.sourceCurrency.id,
        targetCurrencyId: result.targetCurrency.id,
        sourceAmount: result.sourceAmount,
        targetAmount: result.targetAmount,
        appliedRate: result.appliedRate,
        commissionPct: result.commissionPct,
        commissionAmount: result.commissionAmount,
        amountXof: result.amountXof,
        rateId,
        agencyId: input.agencyId ?? null,
        lockedUntil: new Date(Date.now() + minutes * 60_000),
      },
    });

    return this.toView(result, input.direction, quote);
  }

  async findOwned(id: string, client: AuthUser): Promise<QuoteView> {
    const quote = await this.prisma.quote.findUnique({
      where: { id },
      include: { sourceCurrency: true, targetCurrency: true },
    });
    // Même réponse qu'un identifiant inexistant : ne pas révéler qu'un devis
    // existe chez quelqu'un d'autre.
    if (!quote || quote.clientId !== client.id) throw new NotFoundException('Devis introuvable.');

    return {
      id: quote.id,
      reference: quote.reference,
      direction: quote.direction,
      sourceCurrency: quote.sourceCurrency.code,
      targetCurrency: quote.targetCurrency.code,
      sourceAmount: quote.sourceAmount.toString(),
      targetAmount: quote.targetAmount.toString(),
      appliedRate: quote.appliedRate.toString(),
      commissionPct: quote.commissionPct.toString(),
      commissionAmount: quote.commissionAmount.toString(),
      amountXof: quote.amountXof.toString(),
      lockedUntil: quote.lockedUntil.toISOString(),
    };
  }

  /** Un devis périmé ou déjà consommé ne peut plus porter de transaction. */
  static isUsable(quote: Quote): boolean {
    return quote.consumedAt === null && quote.lockedUntil.getTime() > Date.now();
  }

  private async price(
    input: SimulateInput,
  ): Promise<{ result: QuoteResult; rateId: string }> {
    const base = await this.baseCurrency();
    if (input.currencyCode === base.code) {
      throw new BadRequestException(
        'Une opération de change met en jeu une devise étrangère et le FCFA.',
      );
    }

    const foreign = await this.prisma.currency.findUnique({
      where: { code: input.currencyCode },
    });
    if (!foreign || !foreign.active) {
      throw new NotFoundException(`Devise ${input.currencyCode} inconnue ou inactive.`);
    }

    const rate = await this.rates.currentFor(foreign.code, input.agencyId ?? null);
    const result = this.calculator.compute({
      direction: input.direction,
      foreign,
      base,
      rate,
      amount: input.amount,
      side: input.side,
    });

    if (result.targetAmount.lessThanOrEqualTo(0)) {
      // Arrive sur un montant minuscule : la commission avale tout le change.
      throw new BadRequestException('Montant trop faible : la commission absorbe l’opération.');
    }

    return { result, rateId: rate.id };
  }

  private async baseCurrency(): Promise<Currency> {
    const base = await this.prisma.currency.findFirst({ where: { isBase: true } });
    if (!base) throw new NotFoundException('Aucune devise de référence configurée.');
    return base;
  }

  /** DEV-2026-000042 — lisible, communicable par téléphone. */
  private async nextReference(): Promise<string> {
    const year = new Date().getFullYear();
    const start = new Date(year, 0, 1);
    const count = await this.prisma.quote.count({ where: { createdAt: { gte: start } } });
    return `DEV-${year}-${String(count + 1).padStart(6, '0')}`;
  }

  private toView(
    result: QuoteResult,
    direction: TransactionDirection,
    quote: Quote | null,
  ): QuoteView {
    return {
      id: quote?.id ?? null,
      reference: quote?.reference ?? null,
      direction,
      sourceCurrency: result.sourceCurrency.code,
      targetCurrency: result.targetCurrency.code,
      sourceAmount: result.sourceAmount.toString(),
      targetAmount: result.targetAmount.toString(),
      appliedRate: result.appliedRate.toString(),
      commissionPct: result.commissionPct.toString(),
      commissionAmount: result.commissionAmount.toString(),
      amountXof: result.amountXof.toString(),
      lockedUntil: quote ? quote.lockedUntil.toISOString() : null,
    };
  }
}
