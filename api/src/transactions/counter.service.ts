import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  KycStatus,
  Prisma,
  Role,
  TransactionChannel,
  TransactionDirection,
  TransactionStatus,
  type User,
} from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from '../auth/password.service';
import type { AuthUser } from '../common/auth-user';
import { ComplianceService } from '../compliance/compliance.service';
import { PrismaService } from '../prisma/prisma.service';
import { QuoteCalculator } from '../quotes/quote-calculator';
import { RatesService } from '../rates/rates.service';
import { SettingsService } from '../settings/settings.service';
import { ExchangeExecutor } from './exchange-executor';
import type { CounterTransactionInput } from './counter.schemas';
import { toTransactionView, transactionInclude, type TransactionView } from './transactions.view';

@Injectable()
export class CounterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rates: RatesService,
    private readonly calculator: QuoteCalculator,
    private readonly executor: ExchangeExecutor,
    private readonly compliance: ComplianceService,
    private readonly settings: SettingsService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Opération au guichet, en un seul geste : l'agent saisit, le change
   * s'exécute, la caisse bouge, le client repart avec son argent et son reçu.
   *
   * C'est **volontairement atomique côté métier**. Découper en « créer » puis
   * « exécuter » puis « clôturer » obligerait l'agent à trois clics pendant que
   * le client attend au comptoir, et laisserait des opérations à moitié faites
   * si quelqu'un s'interrompt.
   */
  async execute(input: CounterTransactionInput, operator: AuthUser, ip?: string): Promise<TransactionView> {
    const agencyId = await this.resolveAgency(input.agencyId, operator);
    const customer = await this.upsertCustomer(input, operator, ip);
    const priced = await this.price(input);

    // Le plafond s'applique aussi au guichet : un client qui se voit refuser
    // dans l'application ne doit pas contourner en venant au comptoir.
    await this.assertWithinLimits(customer, priced.amountXof);

    const created = await this.prisma.transaction.create({
      data: {
        reference: await this.nextReference(),
        clientId: customer.id,
        operatorId: operator.id,
        agencyId,
        channel: TransactionChannel.GUICHET,
        beneficiaryName: input.beneficiary?.name ?? null,
        beneficiaryPhone: input.beneficiary?.phone ?? null,
        beneficiaryRelation: input.beneficiary?.relation ?? null,
        direction: input.direction,
        sourceCurrencyId: priced.sourceCurrency.id,
        targetCurrencyId: priced.targetCurrency.id,
        sourceAmount: priced.sourceAmount,
        targetAmount: priced.targetAmount,
        appliedRate: priced.appliedRate,
        commissionPct: priced.commissionPct,
        commissionAmount: priced.commissionAmount,
        amountXof: priced.amountXof,
        rateId: priced.rateId,
        // Espèces des deux côtés : le client pose des billets, on lui en rend.
        depositMethod: 'ESPECES_AGENCE',
        payoutMethod: 'ESPECES_AGENCE',
        payoutDetails: input.note ?? null,
        status: TransactionStatus.CREEE,
      },
    });

    await this.audit.record({
      userId: operator.id,
      action: 'transaction.counter',
      entity: 'Transaction',
      entityId: created.id,
      after: {
        reference: created.reference,
        amountXof: created.amountXof.toString(),
        client: `${customer.firstName} ${customer.lastName}`,
        beneficiaire: input.beneficiary?.name ?? null,
      },
      ip,
    });

    // Vigilance avant que l'argent ne sorte : un signalement qui arriverait
    // après la remise des billets ne servirait plus à rien.
    await this.compliance.screen(created);

    // Le change et les mouvements de caisse, puis la clôture : le client part
    // avec ses fonds, il n'y a rien à « mettre à disposition » plus tard.
    await this.executor.execute(created.id, operator, ip);
    const closed = await this.prisma.transaction.update({
      where: { id: created.id },
      data: {
        status: TransactionStatus.CLOTUREE,
        readyAt: new Date(),
        closedAt: new Date(),
      },
      include: transactionInclude,
    });

    return toTransactionView(closed, { withClient: true });
  }

  /**
   * Retrouve le client par son téléphone, ou le crée.
   *
   * ⚠️ **Un habitué n'est pas un nouveau client à chaque passage** : sans cette
   * réconciliation, ses cumuls LCB-FT repartiraient de zéro à chaque visite et
   * le fractionnement deviendrait invisible.
   *
   * Le compte créé n'a pas de mot de passe utilisable : la personne n'a rien
   * demandé. Elle pourra le réclamer plus tard via l'application.
   */
  private async upsertCustomer(
    input: CounterTransactionInput,
    operator: AuthUser,
    ip?: string,
  ): Promise<User> {
    const { customer } = input;
    const existing = await this.prisma.user.findUnique({ where: { phone: customer.phone } });

    if (existing) {
      if (existing.role !== Role.CLIENT) {
        throw new BadRequestException('Ce numéro est celui d’un compte interne.');
      }
      // Le KYC de l'application prime : ne pas écraser une pièce déjà validée
      // par le back-office avec un simple contrôle de visu.
      if (existing.kycStatus !== KycStatus.VALIDE) {
        await this.recordIdentity(existing.id, input, operator, ip);
      }
      return existing;
    }

    const created = await this.prisma.user.create({
      data: {
        firstName: customer.firstName,
        lastName: customer.lastName,
        phone: customer.phone,
        email: customer.email ?? null,
        role: Role.CLIENT,
        // L'agent a vu la pièce : l'identité est vérifiée, au sens du cahier.
        kycStatus: KycStatus.VALIDE,
        kycValidatedAt: new Date(),
        // Mot de passe inutilisable : personne ne le connaît, pas même nous.
        passwordHash: await this.passwords.hash(randomBytes(32).toString('hex')),
      },
    });

    await this.recordIdentity(created.id, input, operator, ip);
    await this.audit.record({
      userId: operator.id,
      action: 'client.counter_create',
      entity: 'User',
      entityId: created.id,
      after: { phone: customer.phone, piece: customer.idType },
      ip,
    });
    return created;
  }

  /** Trace de la pièce présentée — sans scan, mais avec type et numéro. */
  private async recordIdentity(
    userId: string,
    input: CounterTransactionInput,
    operator: AuthUser,
    ip?: string,
  ): Promise<void> {
    await this.prisma.kycDocument.create({
      data: {
        userId,
        type: input.customer.idType,
        // Pas de fichier : la pièce a été vue au comptoir, pas photographiée.
        fileUrl: null,
        documentNumber: input.customer.idNumber,
        expiresAt: input.customer.idExpiresAt ?? null,
        status: KycStatus.VALIDE,
        reviewedById: operator.id,
        reviewedAt: new Date(),
      },
    });
    await this.prisma.user.update({
      where: { id: userId },
      data: { kycStatus: KycStatus.VALIDE, kycValidatedAt: new Date(), kycRejectReason: null },
    });
    await this.audit.record({
      userId: operator.id,
      action: 'kyc.counter_check',
      entity: 'User',
      entityId: userId,
      after: { type: input.customer.idType, numero: input.customer.idNumber },
      ip,
    });
  }

  private async price(input: CounterTransactionInput) {
    const base = await this.prisma.currency.findFirst({ where: { isBase: true } });
    if (!base) throw new NotFoundException('Aucune devise de référence configurée.');
    if (input.currencyCode === base.code) {
      throw new BadRequestException(
        'Une opération de change met en jeu une devise étrangère et le FCFA.',
      );
    }

    const foreign = await this.prisma.currency.findUnique({ where: { code: input.currencyCode } });
    if (!foreign || !foreign.active) throw new NotFoundException('Devise inconnue ou inactive.');

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
      throw new BadRequestException('Montant trop faible : la commission absorbe l’opération.');
    }
    return { ...result, rateId: rate.id };
  }

  private async assertWithinLimits(customer: User, amountXof: Prisma.Decimal): Promise<void> {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const sum = await this.prisma.transaction.aggregate({
      where: {
        clientId: customer.id,
        createdAt: { gte: startOfDay },
        status: { not: TransactionStatus.ANNULEE },
      },
      _sum: { amountXof: true },
    });

    const limit =
      customer.dailyLimitXof ??
      new Prisma.Decimal(
        await this.settings.getNumber('defaultDailyLimitXof', 'DEFAULT_DAILY_LIMIT_XOF'),
      );

    if ((sum._sum.amountXof ?? new Prisma.Decimal(0)).plus(amountXof).greaterThan(limit)) {
      throw new BadRequestException(
        `Plafond journalier dépassé pour ce client (${limit.toString()} FCFA). Un responsable peut le relever depuis la fiche client.`,
      );
    }
  }

  /**
   * Agence de l'opération : celle de l'agent qui saisit. Un responsable sans
   * rattachement doit la désigner — on ne devine pas où l'argent est compté.
   */
  private async resolveAgency(requested: string | undefined, operator: AuthUser): Promise<string> {
    if (operator.role === Role.OPERATEUR) {
      if (!operator.agencyId) {
        throw new BadRequestException(
          'Vous n’êtes rattaché à aucune agence : impossible de mouvementer une caisse.',
        );
      }
      // Un opérateur ne sert que sa caisse, même s'il demande autre chose.
      return operator.agencyId;
    }

    const agencyId = requested ?? operator.agencyId;
    if (!agencyId) throw new BadRequestException('Précisez l’agence où se fait l’échange.');
    const agency = await this.prisma.agency.findUnique({ where: { id: agencyId } });
    if (!agency || !agency.active) throw new NotFoundException('Agence inconnue ou fermée.');
    return agency.id;
  }

  private async nextReference(): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.prisma.transaction.count({
      where: { createdAt: { gte: new Date(year, 0, 1) } },
    });
    return `HC-${year}-${String(count + 1).padStart(6, '0')}`;
  }
}

export const COUNTER_DIRECTIONS = [
  TransactionDirection.ACHAT_DEVISE,
  TransactionDirection.VENTE_DEVISE,
] as const;
