import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  KycStatus,
  Prisma,
  Role,
  TransactionStatus,
  type Currency,
  type Quote,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/auth-user';
import { ComplianceService } from '../compliance/compliance.service';
import { ReceiptPdfService } from '../documents/receipt-pdf.service';
import { StorageService } from '../storage/storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { QuoteCalculator } from '../quotes/quote-calculator';
import { RatesService } from '../rates/rates.service';
import { SettingsService } from '../settings/settings.service';
import { TransactionStateMachine } from './transaction-state-machine';
import type { CancelInput, CreateTransactionInput, TransactionListInput } from './transactions.schemas';
import { toTransactionView, transactionInclude, type TransactionView } from './transactions.view';

@Injectable()
export class TransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rates: RatesService,
    private readonly calculator: QuoteCalculator,
    private readonly settings: SettingsService,
    private readonly machine: TransactionStateMachine,
    private readonly audit: AuditService,
    private readonly pdf: ReceiptPdfService,
    private readonly storage: StorageService,
    private readonly compliance: ComplianceService,
  ) {}

  /**
   * Création d'une transaction. C'est ici que le KYC devient bloquant
   * (cahier §3.2) — **côté serveur**, pas seulement dans l'app : masquer un
   * bouton n'empêche personne d'envoyer un POST.
   */
  async create(input: CreateTransactionInput, client: AuthUser, ip?: string): Promise<TransactionView> {
    const user = await this.prisma.user.findUnique({ where: { id: client.id } });
    if (!user) throw new NotFoundException('Compte introuvable.');
    // Le blocage de compte est refusé en amont, par `JwtStrategy` : un compte
    // bloqué n'atteint aucune route. Le redoubler ici donnerait deux endroits
    // à corriger le jour où la règle change.
    if (user.kycStatus !== KycStatus.VALIDE) {
      throw new ForbiddenException(
        'Votre identité doit être vérifiée avant toute opération de change.',
      );
    }

    const priced = input.quoteId
      ? await this.fromQuote(input.quoteId, client)
      : await this.fromLiveRate(input);

    await this.assertWithinLimits(user.id, priced.amountXof, user.dailyLimitXof, user.monthlyLimitXof);

    const agencyId = input.agencyId ?? priced.agencyId ?? (await this.defaultAgencyId());

    const transaction = await this.prisma.$transaction(async (tx) => {
      // Le devis est consommé DANS la même transaction que la création : deux
      // requêtes simultanées ne peuvent pas s'adosser au même verrou.
      if (priced.quote) {
        const consumed = await tx.quote.updateMany({
          where: { id: priced.quote.id, consumedAt: null },
          data: { consumedAt: new Date() },
        });
        if (consumed.count === 0) {
          throw new ConflictException('Ce devis a déjà servi à une transaction.');
        }
      }

      return tx.transaction.create({
        data: {
          reference: await this.nextReference(tx),
          clientId: client.id,
          agencyId,
          direction: priced.direction,
          sourceCurrencyId: priced.sourceCurrency.id,
          targetCurrencyId: priced.targetCurrency.id,
          sourceAmount: priced.sourceAmount,
          targetAmount: priced.targetAmount,
          appliedRate: priced.appliedRate,
          commissionPct: priced.commissionPct,
          commissionAmount: priced.commissionAmount,
          amountXof: priced.amountXof,
          rateId: priced.rateId,
          quoteId: priced.quote?.id ?? null,
          rateLockedUntil: priced.quote?.lockedUntil ?? null,
          depositMethod: input.depositMethod,
          payoutMethod: input.payoutMethod,
          payoutDetails: input.payoutDetails ?? null,
          status: TransactionStatus.CREEE,
        },
        include: transactionInclude,
      });
    });

    await this.audit.record({
      userId: client.id,
      action: 'transaction.create',
      entity: 'Transaction',
      entityId: transaction.id,
      after: {
        reference: transaction.reference,
        amountXof: transaction.amountXof.toString(),
        fromQuote: priced.quote?.reference ?? null,
      },
      ip,
    });

    // Vigilance LCB-FT : au moment de la CRÉATION, pas de l'exécution. Un
    // signalement qui n'arrive qu'après le change laisserait passer l'argent
    // avant que quiconque ait pu regarder.
    await this.compliance.screen(transaction);

    return toTransactionView(transaction);
  }

  async mine(client: AuthUser, status?: TransactionStatus): Promise<TransactionView[]> {
    const rows = await this.prisma.transaction.findMany({
      where: { clientId: client.id, status },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: transactionInclude,
    });
    return rows.map((row) => toTransactionView(row));
  }

  async findOne(id: string, viewer: AuthUser): Promise<TransactionView> {
    const transaction = await this.prisma.transaction.findUnique({
      where: { id },
      include: transactionInclude,
    });
    if (!transaction) throw new NotFoundException('Transaction introuvable.');

    const isStaff = viewer.role !== Role.CLIENT;
    if (!isStaff && transaction.clientId !== viewer.id) {
      throw new NotFoundException('Transaction introuvable.');
    }
    return toTransactionView(transaction, { withClient: isStaff });
  }

  /** Liste du dashboard, avec les filtres du cahier §3.1. */
  async list(query: TransactionListInput, viewer: AuthUser): Promise<TransactionView[]> {
    const currency = query.currencyCode
      ? await this.prisma.currency.findUnique({ where: { code: query.currencyCode } })
      : null;

    const rows = await this.prisma.transaction.findMany({
      where: {
        status: query.status,
        // Un opérateur ne voit que son agence : la restriction est ici, pas
        // dans l'interface (CLAUDE.md §4).
        agencyId: viewer.role === Role.OPERATEUR ? (viewer.agencyId ?? undefined) : query.agencyId,
        createdAt: { gte: query.from, lte: query.to },
        ...(currency
          ? { OR: [{ sourceCurrencyId: currency.id }, { targetCurrencyId: currency.id }] }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: query.take,
      include: transactionInclude,
    });
    return rows.map((row) => toTransactionView(row, { withClient: true }));
  }

  async cancel(id: string, input: CancelInput, actor: AuthUser, ip?: string): Promise<TransactionView> {
    const transaction = await this.prisma.transaction.findUnique({ where: { id } });
    if (!transaction) throw new NotFoundException('Transaction introuvable.');
    if (actor.role === Role.CLIENT && transaction.clientId !== actor.id) {
      throw new NotFoundException('Transaction introuvable.');
    }
    this.machine.assert(transaction.status, TransactionStatus.ANNULEE);

    const updated = await this.prisma.transaction.update({
      where: { id },
      data: {
        status: TransactionStatus.ANNULEE,
        cancelledAt: new Date(),
        cancelReason: input.reason ?? (actor.role === Role.CLIENT ? 'Annulée par le client.' : null),
      },
      include: transactionInclude,
    });

    await this.audit.record({
      userId: actor.id,
      action: 'transaction.cancel',
      entity: 'Transaction',
      entityId: id,
      before: { status: transaction.status },
      after: { status: TransactionStatus.ANNULEE, reason: updated.cancelReason },
      ip,
    });
    return toTransactionView(updated, { withClient: actor.role !== Role.CLIENT });
  }

  /** L'argent est disponible : le client peut venir le chercher. */
  markReady(id: string, actor: AuthUser, ip?: string): Promise<TransactionView> {
    return this.advance(id, TransactionStatus.PRETE_POUR_RETRAIT, 'readyAt', actor, ip);
  }

  /** Remis au client : l'opération est terminée, et son justificatif est émis. */
  async close(id: string, actor: AuthUser, ip?: string): Promise<TransactionView> {
    const closed = await this.advance(id, TransactionStatus.CLOTUREE, 'closedAt', actor, ip);
    // Le justificatif est produit ici, pas au téléchargement : il doit refléter
    // l'opération telle qu'elle était à la clôture, même relu des mois après.
    await this.ensurePdf(id);
    return closed;
  }

  /**
   * Justificatif final. Généré à la clôture, puis servi depuis le stockage.
   * Régénéré si le fichier manque (montée de version, purge) — mais toujours à
   * partir des valeurs figées dans la ligne, jamais des taux du jour.
   */
  async receiptPdf(id: string, viewer: AuthUser): Promise<{ buffer: Buffer; filename: string }> {
    const transaction = await this.prisma.transaction.findUnique({
      where: { id },
      include: transactionInclude,
    });
    if (!transaction) throw new NotFoundException('Transaction introuvable.');
    if (viewer.role === Role.CLIENT && transaction.clientId !== viewer.id) {
      throw new NotFoundException('Transaction introuvable.');
    }
    if (transaction.status !== TransactionStatus.CLOTUREE) {
      throw new ConflictException(
        'Le justificatif n’est disponible qu’une fois l’opération clôturée.',
      );
    }

    const key = transaction.finalReceiptPdfUrl ?? (await this.ensurePdf(id));
    return {
      buffer: await this.storage.read(key),
      filename: `justificatif-${transaction.reference}.pdf`,
    };
  }

  private async ensurePdf(id: string): Promise<string> {
    const transaction = await this.prisma.transaction.findUnique({
      where: { id },
      include: transactionInclude,
    });
    if (!transaction) throw new NotFoundException('Transaction introuvable.');
    if (transaction.finalReceiptPdfUrl) return transaction.finalReceiptPdfUrl;

    const buffer = await this.pdf.build(transaction);
    const stored = await this.storage.save(
      { buffer, mimetype: 'application/pdf', originalname: `${transaction.reference}.pdf` },
      `justificatifs/${transaction.clientId}`,
    );
    await this.prisma.transaction.update({
      where: { id },
      data: { finalReceiptPdfUrl: stored.key },
    });
    return stored.key;
  }

  /** Lignes complètes pour l'export — mêmes filtres que la liste écran. */
  async forExport(query: TransactionListInput, viewer: AuthUser) {
    const currency = query.currencyCode
      ? await this.prisma.currency.findUnique({ where: { code: query.currencyCode } })
      : null;

    return this.prisma.transaction.findMany({
      where: {
        status: query.status,
        agencyId: viewer.role === Role.OPERATEUR ? (viewer.agencyId ?? undefined) : query.agencyId,
        createdAt: { gte: query.from, lte: query.to },
        ...(currency
          ? { OR: [{ sourceCurrencyId: currency.id }, { targetCurrencyId: currency.id }] }
          : {}),
        // Un export client ne contient que ses propres opérations.
        ...(viewer.role === Role.CLIENT ? { clientId: viewer.id } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 5000,
      include: transactionInclude,
    });
  }

  private async advance(
    id: string,
    to: TransactionStatus,
    stamp: 'readyAt' | 'closedAt',
    actor: AuthUser,
    ip?: string,
  ): Promise<TransactionView> {
    const transaction = await this.prisma.transaction.findUnique({ where: { id } });
    if (!transaction) throw new NotFoundException('Transaction introuvable.');
    this.machine.assert(transaction.status, to);

    const updated = await this.prisma.transaction.update({
      where: { id },
      data: { status: to, [stamp]: new Date(), operatorId: actor.id },
      include: transactionInclude,
    });
    await this.audit.record({
      userId: actor.id,
      action: `transaction.${to.toLowerCase()}`,
      entity: 'Transaction',
      entityId: id,
      before: { status: transaction.status },
      after: { status: to },
      ip,
    });
    return toTransactionView(updated, { withClient: true });
  }

  /** Prix garanti : on relit le devis, on ne recalcule rien. */
  private async fromQuote(quoteId: string, client: AuthUser) {
    const quote = await this.prisma.quote.findUnique({
      where: { id: quoteId },
      include: { sourceCurrency: true, targetCurrency: true },
    });
    if (!quote || quote.clientId !== client.id) throw new NotFoundException('Devis introuvable.');
    if (quote.consumedAt) throw new ConflictException('Ce devis a déjà servi à une transaction.');
    if (quote.lockedUntil.getTime() <= Date.now()) {
      throw new ConflictException(
        'Le taux verrouillé a expiré. Relancez une simulation pour obtenir le taux du moment.',
      );
    }

    return {
      quote: quote as Quote,
      direction: quote.direction,
      sourceCurrency: quote.sourceCurrency,
      targetCurrency: quote.targetCurrency,
      sourceAmount: quote.sourceAmount,
      targetAmount: quote.targetAmount,
      appliedRate: quote.appliedRate,
      commissionPct: quote.commissionPct,
      commissionAmount: quote.commissionAmount,
      amountXof: quote.amountXof,
      rateId: quote.rateId,
      agencyId: quote.agencyId,
    };
  }

  /** Sans devis : le prix est celui du moment, calculé par la MÊME fonction. */
  private async fromLiveRate(input: CreateTransactionInput) {
    const base = await this.prisma.currency.findFirst({ where: { isBase: true } });
    if (!base) throw new NotFoundException('Aucune devise de référence configurée.');

    const foreign = await this.prisma.currency.findUnique({
      where: { code: input.currencyCode ?? '' },
    });
    if (!foreign || !foreign.active) throw new NotFoundException('Devise inconnue ou inactive.');

    const rate = await this.rates.currentFor(foreign.code, input.agencyId ?? null);
    const result = this.calculator.compute({
      direction: input.direction!,
      foreign,
      base,
      rate,
      amount: input.amount!,
      side: input.side ?? 'SOURCE',
    });
    if (result.targetAmount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Montant trop faible : la commission absorbe l’opération.');
    }

    return {
      quote: null,
      direction: input.direction!,
      sourceCurrency: result.sourceCurrency as Currency,
      targetCurrency: result.targetCurrency as Currency,
      sourceAmount: result.sourceAmount,
      targetAmount: result.targetAmount,
      appliedRate: result.appliedRate,
      commissionPct: result.commissionPct,
      commissionAmount: result.commissionAmount,
      amountXof: result.amountXof,
      rateId: rate.id,
      agencyId: input.agencyId ?? null,
    };
  }

  /**
   * Plafonds journalier et mensuel (cahier §3.1). Les transactions annulées ne
   * comptent pas : rien n'a été échangé.
   */
  private async assertWithinLimits(
    userId: string,
    amountXof: Prisma.Decimal,
    daily: Prisma.Decimal | null,
    monthly: Prisma.Decimal | null,
  ): Promise<void> {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const sum = async (since: Date): Promise<Prisma.Decimal> => {
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

    const dailyLimit = daily ?? new Prisma.Decimal(await this.limitSetting('defaultDailyLimitXof'));
    const monthlyLimit =
      monthly ?? new Prisma.Decimal(await this.limitSetting('defaultMonthlyLimitXof'));

    if ((await sum(startOfDay)).plus(amountXof).greaterThan(dailyLimit)) {
      throw new ForbiddenException(
        `Plafond journalier dépassé (${dailyLimit.toString()} FCFA). Contactez le bureau pour le relever.`,
      );
    }
    if ((await sum(startOfMonth)).plus(amountXof).greaterThan(monthlyLimit)) {
      throw new ForbiddenException(
        `Plafond mensuel dépassé (${monthlyLimit.toString()} FCFA). Contactez le bureau pour le relever.`,
      );
    }
  }

  private limitSetting(key: 'defaultDailyLimitXof' | 'defaultMonthlyLimitXof'): Promise<number> {
    return this.settings.getNumber(
      key,
      key === 'defaultDailyLimitXof' ? 'DEFAULT_DAILY_LIMIT_XOF' : 'DEFAULT_MONTHLY_LIMIT_XOF',
    );
  }

  private async defaultAgencyId(): Promise<string> {
    const agency = await this.prisma.agency.findFirst({
      where: { active: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!agency) throw new NotFoundException('Aucune agence active configurée.');
    return agency.id;
  }

  /** HC-2026-000042 — lisible, communicable par téléphone. */
  private async nextReference(tx: Prisma.TransactionClient): Promise<string> {
    const year = new Date().getFullYear();
    const count = await tx.transaction.count({
      where: { createdAt: { gte: new Date(year, 0, 1) } },
    });
    return `HC-${year}-${String(count + 1).padStart(6, '0')}`;
  }
}
