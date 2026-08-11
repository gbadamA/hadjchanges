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
   *
   * Règle : **un taux propre à l'agence l'emporte toujours sur le taux global**,
   * quelle que soit l'ancienneté relative des deux. Une agence à tarif
   * différencié (l'aéroport, par exemple) applique une politique décidée ;
   * republier le taux global ne doit pas l'effacer en silence.
   *
   * ⚠️ Corollaire : un taux d'agence oublié reste appliqué. C'est
   * l'indicateur de fraîcheur (`stale`) qui doit le signaler — il est calculé
   * par périmètre, donc il attrape ce cas.
   *
   * ⚠️ Chaque périmètre est cherché par SA PROPRE requête. Une seule requête
   * fenêtrée (`take: n`) donnait un résultat qui dépendait du nombre de
   * publications globales récentes : passé la fenêtre, le taux d'agence
   * disparaissait des candidats et le taux global reprenait la main sans que
   * personne ne l'ait décidé. Ne pas refactoriser en une requête unique.
   */
  async current(currencyId: string, agencyId?: string | null): Promise<ExchangeRate | null> {
    const now = new Date();
    const latestFor = (scope: string | null): Promise<ExchangeRate | null> =>
      this.prisma.exchangeRate.findFirst({
        where: { currencyId, agencyId: scope, effectiveFrom: { lte: now } },
        orderBy: { effectiveFrom: 'desc' },
      });

    if (agencyId) {
      const own = await latestFor(agencyId);
      if (own) return own;
    }
    return latestFor(null);
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
