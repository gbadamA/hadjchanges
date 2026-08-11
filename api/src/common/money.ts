import { Prisma } from '@prisma/client';

/**
 * Arithmétique monétaire. Règle unique du projet : **jamais de `number` pour un
 * montant ou un taux**. Un `0.1 + 0.2` en flottant sur des millions de FCFA
 * finit en écart de caisse.
 */
export type Money = Prisma.Decimal;

export const toDecimal = (value: Prisma.Decimal.Value): Money => new Prisma.Decimal(value);

export const ZERO = (): Money => new Prisma.Decimal(0);

/** Arrondi d'un montant au nombre de décimales de sa devise (XOF = 0, EUR = 2). */
export const roundAmount = (value: Prisma.Decimal.Value, decimals: number): Money =>
  new Prisma.Decimal(value).toDecimalPlaces(decimals, Prisma.Decimal.ROUND_HALF_UP);

/** Taux : toujours 6 décimales, comme la colonne. */
export const roundRate = (value: Prisma.Decimal.Value): Money =>
  new Prisma.Decimal(value).toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP);

/** Commission d'un montant, en pourcentage. */
export const commissionOf = (
  amount: Prisma.Decimal.Value,
  pct: Prisma.Decimal.Value,
  decimals: number,
): Money => roundAmount(new Prisma.Decimal(amount).mul(new Prisma.Decimal(pct)).div(100), decimals);

/** Sérialisation d'un Decimal pour le JSON : une chaîne, jamais un float. */
export const decimalToString = (value: Prisma.Decimal | null | undefined): string | null =>
  value == null ? null : value.toString();
