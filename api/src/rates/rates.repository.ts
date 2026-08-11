import { Injectable } from '@nestjs/common';
import { Prisma, type ExchangeRate } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Accès à la table de taux. Cette table est **append-only** : on n'écrase
 * jamais une ligne, on publie une nouvelle version. « Le taux courant » n'est
 * donc pas une colonne, c'est le résultat d'une requête — toute la logique de
 * résolution est ici, et nulle part ailleurs.
 */
@Injectable()
export class RatesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Version applicable maintenant pour une devise.
   * Un taux propre à l'agence l'emporte sur le taux global ; à défaut, le taux
   * global s'applique. Les deux sont cherchés en une requête puis départagés.
   */
  async current(currencyId: string, agencyId?: string | null): Promise<ExchangeRate | null> {
    const candidates = await this.prisma.exchangeRate.findMany({
      where: {
        currencyId,
        effectiveFrom: { lte: new Date() },
        OR: [{ agencyId: null }, ...(agencyId ? [{ agencyId }] : [])],
      },
      orderBy: { effectiveFrom: 'desc' },
      take: 20,
    });
    if (candidates.length === 0) return null;
    return (
      candidates.find((rate) => agencyId != null && rate.agencyId === agencyId) ??
      candidates.find((rate) => rate.agencyId === null) ??
      null
    );
  }

  /** Version précédente d'un même périmètre — sert à calculer la variation. */
  previous(rate: ExchangeRate): Promise<ExchangeRate | null> {
    return this.prisma.exchangeRate.findFirst({
      where: {
        currencyId: rate.currencyId,
        agencyId: rate.agencyId,
        effectiveFrom: { lt: rate.effectiveFrom },
      },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  history(currencyId: string, take: number): Promise<ExchangeRate[]> {
    return this.prisma.exchangeRate.findMany({
      where: { currencyId },
      orderBy: { effectiveFrom: 'desc' },
      take,
      include: { createdBy: { select: { firstName: true, lastName: true } }, agency: true },
    });
  }

  publish(data: Prisma.ExchangeRateUncheckedCreateInput): Promise<ExchangeRate> {
    return this.prisma.exchangeRate.create({ data });
  }
}
