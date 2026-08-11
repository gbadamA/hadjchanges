import { Injectable } from '@nestjs/common';
import { Prisma, TransactionDirection, type Currency, type ExchangeRate } from '@prisma/client';
import { roundAmount } from '../common/money';

/**
 * Le calcul du change. **Une seule fonction dans tout le projet fait cette
 * arithmétique** : le simulateur public, le verrou de taux et l'exécution de la
 * transaction l'appellent tous. Deux calculs qui divergent, c'est un écart de
 * caisse à la fin du mois.
 *
 * Conventions (fixées ici, valables partout) :
 * - Les taux sont exprimés en XOF pour UNE unité de devise étrangère.
 * - `buyRate`  : ce que le bureau paie au client qui apporte la devise.
 * - `sellRate` : ce que le client paie pour obtenir la devise.
 * - **La commission se prélève toujours sur la jambe en XOF**, jamais sur la
 *   devise étrangère : c'est la monnaie dans laquelle le bureau gagne sa vie,
 *   et c'est celle que le client comprend.
 */

/** Sur quelle jambe porte le montant saisi par le client. */
export type QuoteSide = 'SOURCE' | 'TARGET';

export interface QuoteRequest {
  direction: TransactionDirection;
  /** Devise étrangère concernée (jamais la devise de référence). */
  foreign: Currency;
  base: Currency;
  rate: ExchangeRate;
  amount: Prisma.Decimal.Value;
  side: QuoteSide;
}

export interface QuoteResult {
  sourceCurrency: Currency;
  targetCurrency: Currency;
  sourceAmount: Prisma.Decimal;
  targetAmount: Prisma.Decimal;
  appliedRate: Prisma.Decimal;
  commissionPct: Prisma.Decimal;
  commissionAmount: Prisma.Decimal;
  /** Contre-valeur en XOF — sert aux plafonds et aux seuils LCB-FT. */
  amountXof: Prisma.Decimal;
}

@Injectable()
export class QuoteCalculator {
  compute(request: QuoteRequest): QuoteResult {
    const { direction, foreign, base, rate } = request;
    const isSale = direction === TransactionDirection.VENTE_DEVISE;

    // VENTE_DEVISE : le client donne des XOF et reçoit de la devise.
    // ACHAT_DEVISE : le client donne de la devise et reçoit des XOF.
    const sourceCurrency = isSale ? base : foreign;
    const targetCurrency = isSale ? foreign : base;
    const appliedRate = isSale ? rate.sellRate : rate.buyRate;
    const pct = rate.commissionPct;

    const amount = new Prisma.Decimal(request.amount);

    if (isSale) {
      // Jambe XOF = source. Le client paie sa commission sur ce qu'il verse.
      const xof =
        request.side === 'SOURCE'
          ? amount
          : // Saisie inverse : « je veux recevoir 500 € ». On remonte au brut
            // XOF commission comprise, sinon le client reçoit moins que demandé.
            roundAmount(
              amount.mul(appliedRate).div(new Prisma.Decimal(1).minus(pct.div(100))),
              base.decimals,
            );
      const commission = roundAmount(xof.mul(pct).div(100), base.decimals);
      const net = xof.minus(commission);
      const foreignAmount =
        request.side === 'TARGET' ? amount : roundAmount(net.div(appliedRate), foreign.decimals);

      return {
        sourceCurrency,
        targetCurrency,
        sourceAmount: roundAmount(xof, base.decimals),
        targetAmount: foreignAmount,
        appliedRate,
        commissionPct: pct,
        commissionAmount: commission,
        amountXof: roundAmount(xof, base.decimals),
      };
    }

    // ACHAT_DEVISE : jambe XOF = cible. Le brut est ce que vaut la devise
    // apportée ; la commission se retranche de ce que le client reçoit.
    const foreignAmount =
      request.side === 'SOURCE'
        ? amount
        : // « je veux recevoir 300 000 FCFA » : il faut apporter davantage,
          // puisque la commission sera prélevée sur le brut.
          roundAmount(
            amount.div(new Prisma.Decimal(1).minus(pct.div(100))).div(appliedRate),
            foreign.decimals,
          );
    const gross = roundAmount(foreignAmount.mul(appliedRate), base.decimals);
    const commission = roundAmount(gross.mul(pct).div(100), base.decimals);

    return {
      sourceCurrency,
      targetCurrency,
      sourceAmount: foreignAmount,
      targetAmount: gross.minus(commission),
      appliedRate,
      commissionPct: pct,
      commissionAmount: commission,
      amountXof: gross,
    };
  }
}
