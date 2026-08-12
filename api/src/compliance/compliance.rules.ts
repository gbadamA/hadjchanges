import { ComplianceSeverity, Prisma, type Transaction, type User } from '@prisma/client';

/**
 * Règles de vigilance LCB-FT (cahier §3.1 « rapport de conformité :
 * transactions suspectes, seuils dépassés »).
 *
 * Chaque règle est une **fonction pure** : elle reçoit un contexte figé et
 * répond « rien à signaler » ou une alerte motivée. En ajouter une se fait en
 * ajoutant une entrée à `RULES`, sans toucher au service qui les exécute (OCP).
 *
 * ⚠️ Ces règles **signalent**, elles ne bloquent pas. Le blocage relève d'une
 * décision humaine (plafond, suspension de compte) : un automate qui refuse une
 * opération légitime coûte un client, un automate qui la signale coûte une
 * minute d'examen.
 */

export interface ComplianceContext {
  transaction: Transaction;
  client: User;
  /** Seuil de déclaration en vigueur, en XOF (réglage `lcbFtThresholdXof`). */
  thresholdXof: Prisma.Decimal;
  /** Cumul des opérations non annulées du client sur les 7 derniers jours. */
  last7DaysXof: Prisma.Decimal;
  last7DaysCount: number;
  last24hCount: number;
  accountAgeDays: number;
}

export interface ComplianceFinding {
  rule: string;
  severity: ComplianceSeverity;
  message: string;
}

const fcfa = (value: Prisma.Decimal): string =>
  `${Number(value).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA`;

export interface ComplianceRule {
  code: string;
  evaluate: (context: ComplianceContext) => ComplianceFinding | null;
}

export const RULES: ComplianceRule[] = [
  {
    /** Le cas de base : une opération unique au-dessus du seuil de déclaration. */
    code: 'SEUIL_DECLARATION',
    evaluate: ({ transaction, thresholdXof }) =>
      transaction.amountXof.greaterThanOrEqualTo(thresholdXof)
        ? {
            rule: 'SEUIL_DECLARATION',
            severity: ComplianceSeverity.CRITIQUE,
            message: `Opération de ${fcfa(transaction.amountXof)}, au-dessus du seuil de déclaration de ${fcfa(thresholdXof)}. Constituer le dossier réglementaire.`,
          }
        : null,
  },
  {
    /**
     * Fractionnement : le contournement classique du seuil. Plusieurs
     * opérations qui restent chacune en dessous, mais dont le cumul le dépasse
     * sur une semaine. C'est le motif que le seuil unitaire ne voit jamais.
     */
    code: 'FRACTIONNEMENT',
    evaluate: ({ transaction, thresholdXof, last7DaysXof, last7DaysCount }) => {
      const belowUnitThreshold = transaction.amountXof.lessThan(thresholdXof);
      const cumulative = last7DaysXof.plus(transaction.amountXof);
      return belowUnitThreshold && last7DaysCount >= 2 && cumulative.greaterThanOrEqualTo(thresholdXof)
        ? {
            rule: 'FRACTIONNEMENT',
            severity: ComplianceSeverity.ALERTE,
            message: `${last7DaysCount + 1} opérations sur 7 jours cumulant ${fcfa(cumulative)}, chacune sous le seuil. Vérifier s'il s'agit d'un fractionnement.`,
          }
        : null;
    },
  },
  {
    /**
     * Un compte tout neuf qui manipule des sommes importantes. Pas une preuve
     * de quoi que ce soit — d'où la sévérité basse — mais un motif d'attention
     * bien connu.
     */
    code: 'COMPTE_RECENT',
    evaluate: ({ transaction, thresholdXof, accountAgeDays }) =>
      accountAgeDays <= 7 && transaction.amountXof.greaterThanOrEqualTo(thresholdXof.mul(0.3))
        ? {
            rule: 'COMPTE_RECENT',
            severity: ComplianceSeverity.INFO,
            message: `Compte ouvert il y a ${accountAgeDays} jour(s) pour une opération de ${fcfa(transaction.amountXof)}.`,
          }
        : null,
  },
  {
    /**
     * Fonds remis à quelqu'un d'autre que le client.
     *
     * Ce n'est pas suspect en soi — on envoie de l'argent à sa famille tous les
     * jours. Ça le devient quand le montant est significatif : c'est le montage
     * le plus banal pour faire circuler de l'argent sous le nom d'un tiers.
     */
    code: 'BENEFICIAIRE_TIERS',
    evaluate: ({ transaction, thresholdXof }) =>
      transaction.beneficiaryName &&
      transaction.amountXof.greaterThanOrEqualTo(thresholdXof.mul(0.5))
        ? {
            rule: 'BENEFICIAIRE_TIERS',
            severity: ComplianceSeverity.ALERTE,
            message: `${fcfa(transaction.amountXof)} remis à un tiers (${transaction.beneficiaryName}${transaction.beneficiaryRelation ? `, ${transaction.beneficiaryRelation}` : ''}). Vérifier le lien déclaré avec le client.`,
          }
        : null,
  },
  {
    /** Rythme anormal : cinq opérations dans la journée sortent de l'usage. */
    code: 'RYTHME_INHABITUEL',
    evaluate: ({ last24hCount }) =>
      last24hCount >= 5
        ? {
            rule: 'RYTHME_INHABITUEL',
            severity: ComplianceSeverity.ALERTE,
            message: `${last24hCount + 1} opérations en 24 heures pour ce client. Vérifier la cohérence avec son profil.`,
          }
        : null,
  },
];

/** Exécute toutes les règles et rend les signalements, sans les persister. */
export const evaluateAll = (context: ComplianceContext): ComplianceFinding[] =>
  RULES.map((rule) => rule.evaluate(context)).filter(
    (finding): finding is ComplianceFinding => finding !== null,
  );
