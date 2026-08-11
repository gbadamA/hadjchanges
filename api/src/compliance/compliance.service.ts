import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  ComplianceSeverity,
  Prisma,
  Role,
  TransactionStatus,
  type Transaction,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/auth-user';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { evaluateAll, type ComplianceContext } from './compliance.rules';

export interface AlertFilters {
  resolved?: boolean;
  severity?: ComplianceSeverity;
  take: number;
}

@Injectable()
export class ComplianceService {
  private readonly logger = new Logger(ComplianceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Passe une transaction au crible des règles de vigilance.
   *
   * ⚠️ **Ne doit jamais faire échouer l'opération qu'elle surveille** : une
   * règle en erreur ne peut pas empêcher un change légitime de se conclure. On
   * journalise et on continue — comme pour l'audit.
   */
  async screen(transaction: Transaction): Promise<void> {
    try {
      const context = await this.buildContext(transaction);
      const findings = evaluateAll(context);
      if (findings.length === 0) return;

      await this.prisma.complianceAlert.createMany({
        data: findings.map((finding) => ({
          userId: transaction.clientId,
          transactionId: transaction.id,
          rule: finding.rule,
          severity: finding.severity,
          message: finding.message,
        })),
      });

      this.logger.warn(
        `Vigilance ${transaction.reference} : ${findings.map((finding) => finding.rule).join(', ')}`,
      );
    } catch (error) {
      this.logger.error(`Contrôle de conformité non effectué : ${String(error)}`);
    }
  }

  async alerts(filters: AlertFilters) {
    const rows = await this.prisma.complianceAlert.findMany({
      where: { resolved: filters.resolved, severity: filters.severity },
      // Le plus grave d'abord, puis le plus ancien : une alerte critique qui
      // dort trois jours est pire qu'une info du matin.
      orderBy: [{ severity: 'desc' }, { createdAt: 'asc' }],
      take: filters.take,
      include: {
        user: { select: { id: true, firstName: true, lastName: true, phone: true, blocked: true } },
        transaction: { select: { id: true, reference: true, amountXof: true, status: true } },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      rule: row.rule,
      severity: row.severity,
      message: row.message,
      resolved: row.resolved,
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      client: row.user,
      transaction: row.transaction
        ? {
            id: row.transaction.id,
            reference: row.transaction.reference,
            amountXof: row.transaction.amountXof.toString(),
            status: row.transaction.status,
          }
        : null,
    }));
  }

  /** Marquer traité : l'alerte reste en base, elle sort seulement de la file. */
  async resolve(id: string, actor: AuthUser, ip?: string) {
    const alert = await this.prisma.complianceAlert.findUnique({ where: { id } });
    if (!alert) throw new NotFoundException('Alerte introuvable.');

    const updated = await this.prisma.complianceAlert.update({
      where: { id },
      data: { resolved: true, resolvedAt: new Date() },
    });

    await this.audit.record({
      userId: actor.id,
      action: 'compliance.resolve',
      entity: 'ComplianceAlert',
      entityId: id,
      before: { resolved: alert.resolved },
      after: { resolved: true, rule: alert.rule },
      ip,
    });
    return { id: updated.id, resolved: updated.resolved };
  }

  /** Compteur pour la pastille du menu : combien d'alertes restent ouvertes. */
  async openCount(): Promise<{ total: number; critique: number }> {
    const [total, critique] = await Promise.all([
      this.prisma.complianceAlert.count({ where: { resolved: false } }),
      this.prisma.complianceAlert.count({
        where: { resolved: false, severity: ComplianceSeverity.CRITIQUE },
      }),
    ]);
    return { total, critique };
  }

  /**
   * Consommation des plafonds d'un client — utile au dashboard **et** à l'app :
   * un client doit pouvoir voir ce qu'il lui reste avant de préparer son
   * opération, plutôt que de le découvrir au refus.
   */
  async limits(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Compte introuvable.');

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const used = async (since: Date): Promise<Prisma.Decimal> => {
      const result = await this.prisma.transaction.aggregate({
        where: {
          clientId: userId,
          createdAt: { gte: since },
          status: { not: TransactionStatus.ANNULEE },
        },
        _sum: { amountXof: true },
      });
      return result._sum.amountXof ?? new Prisma.Decimal(0);
    };

    const [dailyUsed, monthlyUsed, dailyLimit, monthlyLimit] = await Promise.all([
      used(startOfDay),
      used(startOfMonth),
      user.dailyLimitXof
        ? Promise.resolve(user.dailyLimitXof)
        : this.settings
            .getNumber('defaultDailyLimitXof', 'DEFAULT_DAILY_LIMIT_XOF')
            .then((value) => new Prisma.Decimal(value)),
      user.monthlyLimitXof
        ? Promise.resolve(user.monthlyLimitXof)
        : this.settings
            .getNumber('defaultMonthlyLimitXof', 'DEFAULT_MONTHLY_LIMIT_XOF')
            .then((value) => new Prisma.Decimal(value)),
    ]);

    return {
      daily: {
        limitXof: dailyLimit.toString(),
        usedXof: dailyUsed.toString(),
        remainingXof: Prisma.Decimal.max(dailyLimit.minus(dailyUsed), 0).toString(),
        /** true quand la limite vient du réglage global, pas du compte. */
        inherited: user.dailyLimitXof === null,
      },
      monthly: {
        limitXof: monthlyLimit.toString(),
        usedXof: monthlyUsed.toString(),
        remainingXof: Prisma.Decimal.max(monthlyLimit.minus(monthlyUsed), 0).toString(),
        inherited: user.monthlyLimitXof === null,
      },
    };
  }

  private async buildContext(transaction: Transaction): Promise<ComplianceContext> {
    const client = await this.prisma.user.findUniqueOrThrow({ where: { id: transaction.clientId } });
    const threshold = await this.settings.lcbFtThresholdXof();

    const since7Days = new Date(Date.now() - 7 * 86_400_000);
    const since24h = new Date(Date.now() - 86_400_000);

    // La transaction en cours est exclue des cumuls : les règles l'ajoutent
    // elles-mêmes, et la compter deux fois déclencherait de fausses alertes.
    const base: Prisma.TransactionWhereInput = {
      clientId: transaction.clientId,
      id: { not: transaction.id },
      status: { not: TransactionStatus.ANNULEE },
    };

    const [week, day] = await Promise.all([
      this.prisma.transaction.aggregate({
        where: { ...base, createdAt: { gte: since7Days } },
        _sum: { amountXof: true },
        _count: { _all: true },
      }),
      this.prisma.transaction.count({ where: { ...base, createdAt: { gte: since24h } } }),
    ]);

    return {
      transaction,
      client,
      thresholdXof: new Prisma.Decimal(threshold),
      last7DaysXof: week._sum.amountXof ?? new Prisma.Decimal(0),
      last7DaysCount: week._count._all,
      last24hCount: day,
      accountAgeDays: Math.floor((Date.now() - client.createdAt.getTime()) / 86_400_000),
    };
  }
}

/** Rôles habilités à consulter la conformité — jamais un opérateur de guichet. */
export const COMPLIANCE_ROLES = [Role.ADMIN, Role.SUPER_ADMIN] as const;
