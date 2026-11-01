import { Injectable, Logger } from '@nestjs/common';
import { PaymentStatus, PayoutStatus, Role, TransactionStatus } from '@prisma/client';
import type { AuthUser } from '../common/auth-user';
import { loadEnv } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentService } from './payment.service';

/**
 * Lectures du tableau des paiements mobile money.
 *
 * Séparé des services qui AGISSENT (`CheckoutService`, `PayoutService`) : ici
 * on ne fait que regarder. Un service qui lit et qui engage de l'argent finit
 * par rendre le second difficile à relire.
 */

export interface LigneJournal {
  id: string;
  sens: 'ENTREE' | 'SORTIE';
  reference: string;
  statut: string;
  montantXof: string;
  fraisXof: string | null;
  tiers: string | null;
  codeEchec: string | null;
  le: string;
}

export interface AVerser {
  transactionId: string;
  reference: string;
  montantXof: string;
  beneficiaire: string;
  mobile: string | null;
  tentativesEchouees: number;
  agence: string | null;
}

export interface TableauPaiements {
  fournisseur: string;
  /** Faux quand les paiements sont simulés : à dire, jamais à cacher. */
  reel: boolean;
  /**
   * Solde du flottant, ou `null` si le fournisseur est injoignable.
   *
   * ⚠️ Nul plutôt qu'une erreur : un flottant illisible ne doit pas empêcher
   * d'afficher la liste des fonds à envoyer, qui est l'essentiel de la page.
   */
  soldeXof: string | null;
  aVerser: AVerser[];
  journal: LigneJournal[];
  /** Encaissements en attente depuis trop longtemps : à surveiller. */
  encaissementsEnAttente: number;
  /** Versements dont l'issue est inconnue : le rapprochement s'en occupe. */
  versementsEnCours: number;
}

@Injectable()
export class PaymentsOverviewService {
  private readonly logger = new Logger(PaymentsOverviewService.name);
  private readonly env = loadEnv();

  constructor(
    private readonly prisma: PrismaService,
    private readonly paiements: PaymentService,
  ) {}

  async tableau(viewer: AuthUser): Promise<TableauPaiements> {
    // Un opérateur ne voit que son agence, comme partout ailleurs.
    const portee =
      viewer.role === Role.OPERATEUR && viewer.agencyId ? { agencyId: viewer.agencyId } : {};

    const [solde, aVerser, encaissements, versements, enAttente, enCours] = await Promise.all([
      this.solde(),
      this.aVerser(portee),
      this.prisma.paymentCheckout.findMany({
        orderBy: { createdAt: 'desc' },
        take: 15,
        include: { transaction: { select: { reference: true, agencyId: true } } },
      }),
      this.prisma.paymentPayout.findMany({
        orderBy: { createdAt: 'desc' },
        take: 15,
        include: { transaction: { select: { reference: true, agencyId: true } } },
      }),
      this.prisma.paymentCheckout.count({ where: { status: PaymentStatus.EN_COURS } }),
      this.prisma.paymentPayout.count({ where: { status: PayoutStatus.EN_COURS } }),
    ]);

    const journal: LigneJournal[] = [
      ...encaissements.map((row) => ({
        id: row.id,
        sens: 'ENTREE' as const,
        reference: row.transaction.reference,
        statut: row.status,
        montantXof: row.amountXof.toString(),
        fraisXof: null,
        tiers: null,
        codeEchec: row.failureCode,
        le: row.createdAt.toISOString(),
      })),
      ...versements.map((row) => ({
        id: row.id,
        sens: 'SORTIE' as const,
        reference: row.transaction.reference,
        statut: row.status,
        montantXof: row.receiveAmountXof.toString(),
        fraisXof: row.feeXof?.toString() ?? null,
        tiers: row.mobile,
        codeEchec: row.failureCode,
        le: row.createdAt.toISOString(),
      })),
    ]
      .sort((a, b) => b.le.localeCompare(a.le))
      .slice(0, 20);

    return {
      fournisseur: this.paiements.nom,
      reel: this.paiements.reel,
      soldeXof: solde,
      aVerser,
      journal,
      encaissementsEnAttente: enAttente,
      versementsEnCours: enCours,
    };
  }

  /** Flottant du fournisseur, `null` s'il ne répond pas. */
  private async solde(): Promise<string | null> {
    try {
      return String(await this.paiements.lireSoldeXof());
    } catch (cause) {
      this.logger.warn(
        `Solde ${this.paiements.nom} illisible : ` +
          `${cause instanceof Error ? cause.message : String(cause)}`,
      );
      return null;
    }
  }

  /**
   * Opérations dont les fonds attendent d'être envoyés.
   *
   * Le cœur de la page : c'est la file de travail. On exclut celles qui ont
   * déjà un versement réussi ou en cours — relancer l'une d'elles enverrait
   * l'argent deux fois.
   */
  private async aVerser(portee: { agencyId?: string }): Promise<AVerser[]> {
    const lignes = await this.prisma.transaction.findMany({
      where: {
        ...portee,
        status: TransactionStatus.PRETE_POUR_RETRAIT,
        payoutMethod: 'MOBILE_MONEY',
        // Le versement n'envoie que du XOF : la devise cible doit l'être.
        targetCurrency: { code: this.env.BASE_CURRENCY },
        payouts: {
          none: { status: { in: [PayoutStatus.REUSSI, PayoutStatus.EN_COURS] } },
        },
      },
      orderBy: { readyAt: 'asc' }, // le plus ancien d'abord : personne n'attend indéfiniment
      take: 50,
      select: {
        id: true,
        reference: true,
        targetAmount: true,
        beneficiaryName: true,
        beneficiaryPhone: true,
        payoutDetails: true,
        agency: { select: { name: true } },
        client: { select: { firstName: true, lastName: true, phone: true } },
        _count: { select: { payouts: true } },
      },
    });

    return lignes.map((ligne) => ({
      transactionId: ligne.id,
      reference: ligne.reference,
      montantXof: ligne.targetAmount.toString(),
      beneficiaire:
        ligne.beneficiaryName ??
        `${ligne.client.firstName} ${ligne.client.lastName}`.trim(),
      mobile: ligne.beneficiaryPhone ?? ligne.payoutDetails ?? ligne.client.phone,
      // Toutes les lignes existantes sont des échecs, puisque les réussies et
      // les en-cours sont exclues par la requête.
      tentativesEchouees: ligne._count.payouts,
      agence: ligne.agency?.name ?? null,
    }));
  }
}
