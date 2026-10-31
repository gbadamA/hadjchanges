import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PayoutStatus, Role, TransactionStatus } from '@prisma/client';
import type { Request, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { ADMIN_ROLES, type AuthUser } from '../common/auth-user';
import { CurrentUser, Public, Roles } from '../common/decorators';
import { CheckoutService, type IssueTraitement } from './checkout.service';
import { PaymentService } from './payment.service';
import { PaiementSimuleAdapter } from './payment.simule';
import { PayoutService, type VueVersement } from './payout.service';
import { ReconciliationService } from './reconciliation.service';
import { SignatureInvalideError } from './wave.signature';

/** Agents habilités à engager des fonds. */
const STAFF = [Role.OPERATEUR, Role.ADMIN, Role.SUPER_ADMIN] as const;

@ApiTags('paiements')
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly payouts: PayoutService,
    private readonly reconciliation: ReconciliationService,
    private readonly paiements: PaymentService,
    private readonly prisma: PrismaService,
  ) {}

  @Roles(Role.CLIENT)
  @Post('transactions/:id/checkout')
  @ApiOperation({
    summary: 'Ouvrir une session de paiement mobile money pour une opération.',
  })
  ouvrir(
    @Param('id') id: string,
    @CurrentUser() client: AuthUser,
  ): Promise<{ urlPaiement: string; idSession: string; expireLe: string | null; reel: boolean }> {
    return this.checkout.ouvrir(id, client);
  }

  /**
   * Envoi des fonds au bénéficiaire par mobile money.
   *
   * ⚠️ Réservé aux agents, et **jamais au client** : c'est un décaissement.
   * Un client qui pourrait le déclencher pourrait se faire virer les fonds
   * avant tout contrôle.
   */
  @Roles(...STAFF)
  @Post('transactions/:id/payout')
  @ApiOperation({ summary: 'Envoyer les fonds au bénéficiaire (mobile money).' })
  verser(
    @Param('id') id: string,
    @CurrentUser() operateur: AuthUser,
    @Req() requete: Request,
  ): Promise<VueVersement> {
    return this.payouts.verser(id, operateur, requete.ip);
  }

  /**
   * Force un rapprochement sans attendre le passage de la minute.
   *
   * Utile en exploitation : quand un versement traîne « en cours », un
   * responsable veut savoir maintenant, pas dans une minute. Réservé à
   * l'encadrement, parce qu'un rapprochement peut clôturer des opérations.
   */
  @Roles(...ADMIN_ROLES)
  @Post('reconciliation')
  @ApiOperation({ summary: 'Déclencher un rapprochement des paiements maintenant.' })
  rapprocher(): Promise<{ versements: number; encaissements: number }> {
    return this.reconciliation.tourner();
  }

  @Roles(...STAFF)
  @Get('transactions/:id/payouts')
  @ApiOperation({ summary: 'Versements tentés sur une opération, le plus récent d’abord.' })
  listerVersements(@Param('id') id: string): Promise<VueVersement[]> {
    return this.payouts.lister(id);
  }

  /**
   * Point d'entrée des événements de l'opérateur de paiement.
   *
   * ⚠️ **Public par nécessité** : l'opérateur n'a pas de jeton de notre API.
   * L'authentification est assurée par la SIGNATURE de l'événement, vérifiée
   * avant toute lecture du contenu — c'est elle qui tient lieu d'identité ici.
   *
   * ⚠️ Répond **200 dès que l'événement est durablement enregistré**, même
   * lorsqu'il ne correspond à rien chez nous. Seule une signature invalide est
   * refusée. L'opérateur réessaie pendant 3 jours sur une réponse non-2xx :
   * renvoyer une erreur pour un problème qui n'est pas le sien le ferait
   * marteler l'API pendant trois jours.
   */
  @Public()
  @Post('wave/webhook')
  @HttpCode(200)
  @ApiExcludeEndpoint()
  async webhook(
    @Req() requete: RawBodyRequest<Request>,
    @Headers('wave-signature') signature: string | undefined,
  ): Promise<{ recu: true; issue: IssueTraitement }> {
    const rawBody = requete.rawBody;
    if (!rawBody) {
      // Ne jamais retomber sur `JSON.stringify(req.body)` : la signature ne
      // correspondrait plus. Mieux vaut une erreur franche qu'une
      // vérification qui passe à côté.
      throw new UnauthorizedException(
        'Corps brut indisponible : vérification de signature impossible.',
      );
    }

    try {
      const resultat = await this.checkout.traiterEvenement(
        rawBody,
        signature,
        requete.ip,
      );
      return { recu: true, issue: resultat.issue };
    } catch (cause) {
      if (cause instanceof SignatureInvalideError) {
        // 401 : le seul refus légitime. Un événement non authentique ne doit
        // laisser aucune trace exploitable côté métier.
        throw new UnauthorizedException(cause.message);
      }
      throw cause;
    }
  }

  // -------------------------------------------------------------------------
  // Pages de retour
  // -------------------------------------------------------------------------

  /**
   * Pages d'atterrissage après paiement.
   *
   * ⚠️ Elles n'ont **aucune valeur probante** : seul le webhook signé fait
   * foi. Un client qui bidouille l'adresse de retour ne doit pas pouvoir faire
   * croire qu'il a payé. C'est pourquoi ces routes n'écrivent rien.
   */
  @Public()
  @Get('retour/succes')
  @ApiExcludeEndpoint()
  retourSucces(@Query('ref') reference: string | undefined, @Res() reponse: Response): void {
    this.pageSimple(
      reponse,
      'Paiement reçu',
      `Nous avons bien reçu votre paiement${reference ? ` pour l’opération ${this.echapper(reference)}` : ''}. ` +
        'La confirmation apparaît dans l’application dès que notre système l’a enregistrée.',
    );
  }

  @Public()
  @Get('retour/echec')
  @ApiExcludeEndpoint()
  retourEchec(@Query('ref') reference: string | undefined, @Res() reponse: Response): void {
    this.pageSimple(
      reponse,
      'Paiement non abouti',
      `Votre paiement${reference ? ` pour l’opération ${this.echapper(reference)}` : ''} n’a pas abouti. ` +
        'Vous pouvez réessayer depuis l’application.',
    );
  }

  // -------------------------------------------------------------------------
  // Simulation — absente en production
  // -------------------------------------------------------------------------

  /**
   * Page qui remplace l'application de l'opérateur en développement.
   *
   * ⚠️ Rend 404 dès que l'adaptateur réel est en service, et le module de
   * paiement refuse de démarrer en simulation hors développement : ces routes
   * ne peuvent donc pas exister en production. Un bouton « déclarer payé »
   * joignable en production serait une porte ouverte sur la caisse.
   */
  @Public()
  @Get('simulation/:idSession')
  @ApiExcludeEndpoint()
  pageSimulation(@Param('idSession') idSession: string, @Res() reponse: Response): void {
    this.simulateur();
    this.pageSimple(
      reponse,
      'Paiement simulé',
      'Aucun argent ne circule : l’opérateur ne fournit aucun environnement de test, ' +
        'ce simulateur en tient lieu.',
      `<form method="post" action="/api/payments/simulation/${this.echapper(idSession)}/reussir">
         <button class="ok" type="submit">Payer</button>
       </form>
       <form method="post" action="/api/payments/simulation/${this.echapper(idSession)}/echouer">
         <button class="ko" type="submit">Simuler un échec</button>
       </form>`,
    );
  }

  @Public()
  @Post('simulation/:idSession/:issue')
  @ApiExcludeEndpoint()
  async agirSimulation(
    @Param('idSession') idSession: string,
    @Param('issue') issue: string,
    @Req() requete: Request,
    @Res() reponse: Response,
  ): Promise<void> {
    const simulateur = this.simulateur();
    if (issue !== 'reussir' && issue !== 'echouer') {
      throw new NotFoundException('Issue de simulation inconnue.');
    }

    simulateur.marquer(idSession, issue === 'reussir' ? 'REUSSI' : 'ECHOUE');

    // ⚠️ On repasse par le VRAI chemin : événement signé, puis
    // `traiterEvenement` qui vérifie la signature, la fenêtre de rejeu et le
    // dédoublonnage. Court-circuiter la vérification en simulation
    // laisserait le code réellement déployé inexercé jusqu'au premier
    // paiement d'un vrai client.
    const { corps, signature } = simulateur.fabriquerEvenementSigne(idSession);
    const resultat = await this.checkout.traiterEvenement(corps, signature, requete.ip);

    this.pageSimple(
      reponse,
      issue === 'reussir' ? 'Paiement simulé accepté' : 'Échec simulé',
      `Traitement : ${resultat.issue}${resultat.reference ? ` — opération ${this.echapper(resultat.reference)}` : ''}. ` +
        'Vous pouvez revenir à l’application.',
    );
  }

  /**
   * Remet un versement réussi dans l'état « en cours », et son opération en
   * attente de retrait.
   *
   * ⚠️ Route d'ESSAI, inatteignable dès que l'adaptateur réel tourne — même
   * garde que les pages de simulation. Elle existe parce qu'aucun webhook
   * n'avertit de l'issue d'un versement : sans moyen de reconstituer l'état
   * « en cours », le rapprochement — la seule chose qui dénoue ces versements —
   * ne serait jamais éprouvé avant de servir sur de l'argent réel.
   */
  @Roles(...ADMIN_ROLES)
  @Post('_test/remettre-en-cours')
  @ApiExcludeEndpoint()
  async remettreEnCours(
    @Body('transactionId') transactionId: string,
  ): Promise<{ remis: number }> {
    this.simulateur();
    const { count } = await this.prisma.paymentPayout.updateMany({
      where: { transactionId, status: PayoutStatus.REUSSI },
      data: { status: PayoutStatus.EN_COURS, lastCheckedAt: null },
    });
    if (count > 0) {
      await this.prisma.transaction.update({
        where: { id: transactionId },
        data: { status: TransactionStatus.PRETE_POUR_RETRAIT, closedAt: null },
      });
    }
    return { remis: count };
  }

  /** Rend le simulateur, ou 404 si l'adaptateur réel est en service. */
  private simulateur(): PaiementSimuleAdapter {
    if (!(this.paiements instanceof PaiementSimuleAdapter)) {
      throw new NotFoundException('Route inexistante.');
    }
    return this.paiements;
  }

  /** Échappement HTML : ces valeurs viennent de l'extérieur. */
  private echapper(valeur: string): string {
    return valeur.replace(
      /[&<>"']/g,
      (caractere) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[caractere] ??
        caractere,
    );
  }

  private pageSimple(
    reponse: Response,
    titre: string,
    texte: string,
    complement = '',
  ): void {
    reponse
      .status(200)
      .type('html')
      .send(
        `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${this.echapper(titre)} — HadjChanges</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:grid; place-items:center;
         font-family: system-ui, sans-serif; background:#0B2A4A; color:#fff;
         padding:24px; box-sizing:border-box; }
  main { max-width:30rem; text-align:center; }
  h1 { font-size:1.4rem; margin:0 0 .75rem; }
  p { line-height:1.6; opacity:.9; margin:0 0 1.5rem; }
  form { display:inline-block; margin:.25rem; }
  button { font:inherit; padding:.7rem 1.4rem; border:0; border-radius:.5rem;
           cursor:pointer; color:#0B2A4A; background:#C9A227; }
  button.ko { background:transparent; color:#fff; border:1px solid rgba(255,255,255,.4); }
</style></head><body><main>
<h1>${this.echapper(titre)}</h1><p>${texte}</p>${complement}
</main></body></html>`,
      );
  }
}
