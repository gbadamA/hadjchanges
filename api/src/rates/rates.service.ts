import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Currency, type ExchangeRate } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/auth-user';
import { decimalToString, roundRate } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { RatesRepository } from './rates.repository';
import type { PublishRateInput } from './rates.schemas';

export type Trend = 'up' | 'down' | 'flat';

/** Une ligne du tableau des taux du jour, telle que l'affichent mobile et dashboard. */
export interface RateBoardRow {
  currency: { code: string; name: string; symbol: string; decimals: number };
  buyRate: string;
  sellRate: string;
  commissionPct: string;
  /** Variation du taux de vente par rapport à la version précédente. */
  trend: Trend;
  trendPct: string;
  effectiveFrom: string;
  /** Vrai si le taux n'a pas été republié depuis `RATE_STALE_HOURS` (alerte §3.1). */
  stale: boolean;
  /** Renseigné quand un taux propre à l'agence s'applique. */
  agencyId: string | null;
}

@Injectable()
export class RatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rates: RatesRepository,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Tableau des taux du jour. Public : consulter et simuler ne demande aucun
   * compte (cahier §3.2). Une devise sans taux publié est simplement absente —
   * mieux vaut ne rien afficher qu'un taux inventé.
   */
  async board(agencyId?: string | null): Promise<RateBoardRow[]> {
    const currencies = await this.prisma.currency.findMany({
      where: { active: true, isBase: false },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });
    const staleHours = await this.settings.rateStaleHours();
    const staleBefore = new Date(Date.now() - staleHours * 3_600_000);

    const rows: RateBoardRow[] = [];
    for (const currency of currencies) {
      const rate = await this.rates.current(currency.id, agencyId);
      if (!rate) continue;
      const previous = await this.rates.previous(rate);
      rows.push(this.toRow(currency, rate, previous, staleBefore));
    }
    return rows;
  }

  /** Taux applicable à une devise donnée — la brique de simulation s'appuie dessus. */
  async currentFor(currencyCode: string, agencyId?: string | null): Promise<ExchangeRate> {
    const currency = await this.prisma.currency.findUnique({
      where: { code: currencyCode.toUpperCase() },
    });
    if (!currency || !currency.active) {
      throw new NotFoundException(`Devise ${currencyCode} inconnue ou inactive.`);
    }
    const rate = await this.rates.current(currency.id, agencyId);
    if (!rate) throw new NotFoundException(`Aucun taux publié pour ${currency.code}.`);
    return rate;
  }

  async history(currencyCode: string, take = 50): Promise<unknown[]> {
    const currency = await this.prisma.currency.findUnique({
      where: { code: currencyCode.toUpperCase() },
    });
    if (!currency) throw new NotFoundException(`Devise ${currencyCode} inconnue.`);
    const versions = await this.rates.history(currency.id, take);
    return versions.map((version) => ({
      ...version,
      buyRate: decimalToString(version.buyRate),
      sellRate: decimalToString(version.sellRate),
      commissionPct: decimalToString(version.commissionPct),
    }));
  }

  /**
   * Publier une nouvelle version d'un taux. Jamais une mise à jour : chaque
   * publication laisse la précédente en place, ce qui EST l'historique des
   * variations demandé au cahier §3.1.
   */
  async publish(input: PublishRateInput, author: AuthUser, ip?: string | null): Promise<unknown> {
    const currency = await this.prisma.currency.findUnique({
      where: { code: input.currencyCode },
    });
    if (!currency) throw new NotFoundException(`Devise ${input.currencyCode} inconnue.`);
    if (currency.isBase) {
      throw new BadRequestException(
        "La devise de référence n'a pas de taux : tout est exprimé par rapport à elle.",
      );
    }
    if (input.agencyId) {
      const agency = await this.prisma.agency.findUnique({ where: { id: input.agencyId } });
      if (!agency) throw new NotFoundException('Agence inconnue.');
    }

    const previous = await this.rates.current(currency.id, input.agencyId ?? null);
    const created = await this.rates.publish({
      currencyId: currency.id,
      buyRate: roundRate(input.buyRate),
      sellRate: roundRate(input.sellRate),
      commissionPct: new Prisma.Decimal(input.commissionPct),
      agencyId: input.agencyId ?? null,
      effectiveFrom: input.effectiveFrom ?? new Date(),
      createdById: author.id,
    });

    await this.audit.record({
      userId: author.id,
      action: 'rate.publish',
      entity: 'ExchangeRate',
      entityId: created.id,
      before: previous
        ? { buyRate: previous.buyRate.toString(), sellRate: previous.sellRate.toString() }
        : null,
      after: { buyRate: created.buyRate.toString(), sellRate: created.sellRate.toString() },
      ip,
    });

    return {
      ...created,
      buyRate: decimalToString(created.buyRate),
      sellRate: decimalToString(created.sellRate),
      commissionPct: decimalToString(created.commissionPct),
      currency: currency.code,
    };
  }

  private toRow(
    currency: Currency,
    rate: ExchangeRate,
    previous: ExchangeRate | null,
    staleBefore: Date,
  ): RateBoardRow {
    let trend: Trend = 'flat';
    let trendPct = '0';
    if (previous && !previous.sellRate.equals(0)) {
      const delta = rate.sellRate.minus(previous.sellRate);
      if (!delta.equals(0)) {
        trend = delta.greaterThan(0) ? 'up' : 'down';
        trendPct = delta.div(previous.sellRate).mul(100).toDecimalPlaces(2).toString();
      }
    }

    return {
      currency: {
        code: currency.code,
        name: currency.name,
        symbol: currency.symbol,
        decimals: currency.decimals,
      },
      buyRate: rate.buyRate.toString(),
      sellRate: rate.sellRate.toString(),
      commissionPct: rate.commissionPct.toString(),
      trend,
      trendPct,
      effectiveFrom: rate.effectiveFrom.toISOString(),
      stale: rate.effectiveFrom < staleBefore,
      agencyId: rate.agencyId,
    };
  }
}
