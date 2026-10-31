import { Global, Logger, Module } from '@nestjs/common';
import { type Env, loadEnv } from '../config/env';
import { NotificationsModule } from '../notifications/notifications.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { CheckoutService } from './checkout.service';
import { PaymentService } from './payment.service';
import { PaiementSimuleAdapter } from './payment.simule';
import { PaymentsController } from './payments.controller';
import { PayoutService } from './payout.service';
import { ReconciliationService } from './reconciliation.service';
import { WavePaymentAdapter } from './payment.wave';

/**
 * Choix de l'adaptateur.
 *
 * Fonction exportée plutôt que fermeture anonyme dans le module : ses deux
 * refus de démarrer protègent de l'argent, ils doivent donc être éprouvables
 * sans lever tout Nest (voir `scripts-verif/wave-config-check.ts`).
 */
export function construireAdaptateurPaiement(env: Env): PaymentService {
  const logger = new Logger('PaymentsModule');

  if (env.PAYMENT_DRIVER === 'wave') {
    const manquantes = (['WAVE_API_KEY', 'WAVE_WEBHOOK_SECRET'] as const).filter(
      (cle) => !env[cle],
    );
    if (manquantes.length > 0) {
      throw new Error(
        `PAYMENT_DRIVER=wave mais ${manquantes.join(', ')} manque(nt). ` +
          'Renseignez-les ou repassez PAYMENT_DRIVER=simulation.',
      );
    }
    // ⚠️ Sans environnement de test chez Wave, ce message est le seul
    // avertissement avant que de l'argent réel ne circule.
    logger.warn(
      'Paiements RÉELS (Wave) : chaque encaissement et chaque versement ' +
        'déplace de l’argent. Wave ne fournit aucun bac à sable.',
    );
    return new WavePaymentAdapter({
      apiKey: env.WAVE_API_KEY,
      webhookSecret: env.WAVE_WEBHOOK_SECRET,
      baseUrl: env.WAVE_BASE_URL,
    });
  }

  // ⚠️ Simulation EN PRODUCTION : des clients verraient leurs opérations
  // passer en « payé » sans avoir rien payé. C'est pire qu'une panne, puisque
  // rien ne le signalerait — d'où ce refus net de démarrer.
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'PAYMENT_DRIVER=simulation en production : les opérations seraient ' +
        'déclarées payées sans aucun paiement réel. Renseignez ' +
        'WAVE_API_KEY et WAVE_WEBHOOK_SECRET, puis PAYMENT_DRIVER=wave.',
    );
  }

  // Le simulateur signe ses événements : à défaut de secret configuré, un
  // secret de développement stable, pour que la vérification de signature soit
  // réellement exercée plutôt que contournée.
  return new PaiementSimuleAdapter(
    env.API_PUBLIC_URL,
    env.WAVE_WEBHOOK_SECRET || 'secret-de-simulation-hadjchanges',
  );
}

/**
 * Global, comme le stockage : les paiements servent aux opérations, aux
 * versements et à la caisse.
 *
 * L'adaptateur est choisi **au démarrage** par `PAYMENT_DRIVER`. Le métier
 * injecte `PaymentService` et ignore lequel tourne (DIP).
 *
 * ⚠️ Deux refus de démarrer, volontaires, sur le modèle de `StorageModule` :
 * une configuration de paiement incohérente ne doit jamais se rattraper
 * discrètement, parce que les deux retombées possibles sont graves — soit on
 * déplace de l'argent réel sans l'avoir voulu, soit on encaisse dans le vide en
 * croyant encaisser pour de bon.
 */
/**
 * Global pour l'adaptateur : les paiements servent aux opérations, aux
 * versements et à la caisse.
 *
 * ⚠️ `TransactionsModule` est importé ici, et non l'inverse : la machine à
 * états ignore tout des paiements, c'est le paiement qui vient s'y brancher.
 * Le jour où une transaction aura besoin du port, elle l'obtiendra par la
 * portée globale, sans import — donc sans cycle.
 */
@Global()
@Module({
  imports: [TransactionsModule, RealtimeModule, NotificationsModule],
  controllers: [PaymentsController],
  providers: [
    {
      provide: PaymentService,
      useFactory: (): PaymentService => construireAdaptateurPaiement(loadEnv()),
    },
    CheckoutService,
    PayoutService,
    ReconciliationService,
  ],
  exports: [PaymentService, CheckoutService, PayoutService],
})
export class PaymentsModule {}
