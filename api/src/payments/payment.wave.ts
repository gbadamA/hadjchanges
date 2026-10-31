import { Logger } from '@nestjs/common';
import {
  type DemandeEncaissement,
  type DemandeVersement,
  type EtatEncaissement,
  type EtatVersement,
  type EvenementPaiement,
  type IssuePaiement,
  type IssueVersement,
  type MontantXof,
  PaymentService,
  type SessionEncaissement,
} from './payment.service';
import { verifierSignatureWave } from './wave.signature';

/**
 * Adaptateur **réel** de l'API Wave Business.
 *
 * Écrit strictement sur les noms de champs documentés (`error_url`,
 * `success_url`, `wave_launch_url`, `receive_amount`…). Ne pas les deviner :
 * une intégration antérieure de ce dépôt avait inventé `callback_url` et
 * `checkout_url`, et aurait échoué à chaque appel.
 *
 * ⚠️ Aucun environnement de test n'existe chez Wave. Tout appel passé ici
 * déplace de l'argent réel. L'adaptateur simulé est le défaut.
 */

const DEVISE = 'XOF';

interface SessionWave {
  id: string;
  wave_launch_url?: string;
  amount?: string;
  client_reference?: string | null;
  checkout_status?: string;
  payment_status?: string;
  transaction_id?: string | null;
  when_expires?: string | null;
  last_payment_error?: { code?: string; message?: string } | null;
}

interface VersementWave {
  id: string;
  status?: string;
  fee?: string;
  payout_error?: { error_code?: string; error_message?: string } | null;
}

/** Erreur portant le code Wave, pour que l'appelant puisse décider. */
export class WaveError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus: number,
  ) {
    super(message);
    this.name = 'WaveError';
  }
}

export interface WaveConfig {
  apiKey: string;
  webhookSecret: string;
  baseUrl: string;
}

export class WavePaymentAdapter extends PaymentService {
  readonly nom = 'Wave';
  readonly reel = true;

  private readonly logger = new Logger(WavePaymentAdapter.name);

  constructor(private readonly config: WaveConfig) {
    super();
  }

  // -------------------------------------------------------------------------
  // Encaissement
  // -------------------------------------------------------------------------

  async ouvrirEncaissement(demande: DemandeEncaissement): Promise<SessionEncaissement> {
    // ⚠️ AUCUNE reprise ici, volontairement. Contrairement aux versements,
    // l'API de paiement n'accepte pas de clé d'idempotence : rejouer l'appel
    // après un délai réseau créerait une SECONDE session de paiement, et le
    // client pourrait payer deux fois la même opération.
    const session = await this.appeler<SessionWave>(
      'POST',
      '/v1/checkout/sessions',
      {
        amount: this.versChaine(demande.montantXof),
        currency: DEVISE,
        success_url: demande.urlSucces,
        error_url: demande.urlEchec,
        client_reference: demande.reference,
        ...(demande.mobilePayeur ? { restrict_payer_mobile: demande.mobilePayeur } : {}),
      },
      { reprise: false },
    );

    if (!session.wave_launch_url) {
      throw new WaveError(
        'reponse-incomplete',
        "Wave n'a pas renvoyé d'adresse de paiement (wave_launch_url).",
        502,
      );
    }

    return {
      idSession: session.id,
      urlPaiement: session.wave_launch_url,
      expireLe: session.when_expires ? new Date(session.when_expires) : null,
    };
  }

  async lireEncaissement(idSession: string): Promise<EtatEncaissement> {
    const session = await this.appeler<SessionWave>(
      'GET',
      `/v1/checkout/sessions/${encodeURIComponent(idSession)}`,
    );
    return this.traduireSession(session);
  }

  async chercherEncaissementParReference(reference: string): Promise<EtatEncaissement | null> {
    const reponse = await this.appeler<{ result?: SessionWave[] }>(
      'GET',
      `/v1/checkout/sessions/search?client_reference=${encodeURIComponent(reference)}`,
    );
    const sessions = reponse.result ?? [];
    if (sessions.length === 0) return null;
    // Plusieurs sessions peuvent porter la même référence si le client a
    // abandonné puis recommencé : un paiement réussi l'emporte sur le reste.
    const reussie = sessions.find((s) => this.issueSession(s) === 'REUSSI');
    return this.traduireSession(reussie ?? sessions[sessions.length - 1]);
  }

  // -------------------------------------------------------------------------
  // Versement
  // -------------------------------------------------------------------------

  async verser(demande: DemandeVersement): Promise<EtatVersement> {
    const versement = await this.appeler<VersementWave>(
      'POST',
      '/v1/payout',
      {
        currency: DEVISE,
        receive_amount: this.versChaine(demande.montantRecuXof),
        mobile: demande.mobile,
        client_reference: demande.reference,
        ...(demande.nom ? { name: demande.nom } : {}),
        // Wave tronque au-delà de 40 caractères : on coupe nous-mêmes plutôt
        // que de laisser l'appel être refusé pour un motif trop long.
        ...(demande.motif ? { payment_reason: demande.motif.slice(0, 40) } : {}),
      },
      {
        // La reprise est SÛRE ici, et seulement ici, parce que la clé
        // d'idempotence garantit qu'un même appel rejoué n'envoie pas deux fois
        // l'argent. Elle vient de l'appelant et ne doit jamais être régénérée.
        cleIdempotence: demande.cleIdempotence,
        reprise: true,
      },
    );
    return this.traduireVersement(versement);
  }

  async lireVersement(idVersement: string): Promise<EtatVersement> {
    const versement = await this.appeler<VersementWave>(
      'GET',
      `/v1/payout/${encodeURIComponent(idVersement)}`,
    );
    return this.traduireVersement(versement);
  }

  async lireSoldeXof(): Promise<MontantXof> {
    const solde = await this.appeler<{ amount?: string; currency?: string }>('GET', '/v1/balance');
    return this.versNombre(solde.amount) ?? 0;
  }

  // -------------------------------------------------------------------------
  // Webhook
  // -------------------------------------------------------------------------

  verifierEvenement(rawBody: Buffer, enTeteSignature: string | undefined): EvenementPaiement {
    // Lève si l'événement n'est pas authentique : l'appelant ne doit PAS
    // rattraper cette erreur pour continuer malgré tout.
    verifierSignatureWave(rawBody, enTeteSignature, this.config.webhookSecret);

    // Parsé seulement APRÈS vérification, et sur les mêmes octets.
    const evenement = JSON.parse(rawBody.toString('utf8')) as {
      id?: string;
      type?: string;
      data?: SessionWave;
    };

    if (!evenement.id || !evenement.type) {
      throw new WaveError(
        'evenement-incomplet',
        "Événement Wave sans identifiant ni type : impossible à dédoublonner.",
        400,
      );
    }

    const porteUnEncaissement = evenement.type.startsWith('checkout.session.');
    return {
      idEvenement: evenement.id,
      type: evenement.type,
      encaissement:
        porteUnEncaissement && evenement.data ? this.traduireSession(evenement.data) : null,
    };
  }

  // -------------------------------------------------------------------------
  // Traduction
  // -------------------------------------------------------------------------

  private issueSession(session: SessionWave): IssuePaiement {
    // ⚠️ La documentation se contredit : l'énumération annonce
    // `payment_status` ∈ {processing, cancelled, succeeded} et
    // `checkout_status` ∈ {open, complete, expired}, mais l'exemple de
    // l'événement `checkout.session.payment_failed` montre « failed » pour les
    // DEUX. On accepte donc les deux vocabulaires : s'en tenir à l'énumération
    // ferait passer un échec réel pour un paiement encore en cours, et
    // l'opération resterait bloquée.
    if (session.payment_status === 'succeeded') return 'REUSSI';
    if (session.checkout_status === 'expired') return 'EXPIRE';
    if (session.payment_status === 'cancelled' || session.payment_status === 'failed') {
      return 'ECHOUE';
    }
    if (session.checkout_status === 'failed') return 'ECHOUE';
    return 'EN_COURS';
  }

  private traduireSession(session: SessionWave): EtatEncaissement {
    return {
      idSession: session.id,
      reference: session.client_reference ?? null,
      issue: this.issueSession(session),
      montantXof: this.versNombre(session.amount),
      idTransaction: session.transaction_id ?? null,
      codeEchec: session.last_payment_error?.code ?? null,
    };
  }

  private traduireVersement(versement: VersementWave): EtatVersement {
    const issues: Record<string, IssueVersement> = {
      processing: 'EN_COURS',
      succeeded: 'REUSSI',
      failed: 'ECHOUE',
      reversed: 'ANNULE',
    };
    return {
      idVersement: versement.id,
      // Un statut inconnu est traité comme EN COURS, pas comme un échec : la
      // tâche de rapprochement le réinterrogera. Conclure « échoué » à tort
      // relancerait un virement déjà parti.
      issue: issues[versement.status ?? ''] ?? 'EN_COURS',
      fraisXof: this.versNombre(versement.fee),
      codeEchec: versement.payout_error?.error_code ?? null,
    };
  }

  /** Wave exige des montants en CHAÎNE, et refuse les décimales en XOF. */
  private versChaine(montant: MontantXof): string {
    if (!Number.isInteger(montant) || montant <= 0) {
      throw new WaveError(
        'montant-invalide',
        `Montant XOF invalide (${montant}) : un entier positif est attendu.`,
        400,
      );
    }
    return String(montant);
  }

  private versNombre(valeur: string | undefined | null): MontantXof | null {
    if (valeur === undefined || valeur === null || valeur === '') return null;
    const nombre = Number(valeur);
    return Number.isFinite(nombre) ? Math.round(nombre) : null;
  }

  // -------------------------------------------------------------------------
  // Transport
  // -------------------------------------------------------------------------

  /** Codes pour lesquels Wave demande de rejouer, avec la MÊME clé. */
  private rejouable(status: number): boolean {
    return status === 408 || status === 429 || status >= 500;
  }

  private async appeler<T>(
    methode: 'GET' | 'POST',
    chemin: string,
    corps?: unknown,
    options: { cleIdempotence?: string; reprise?: boolean } = {},
  ): Promise<T> {
    const maxTentatives = options.reprise ? 4 : 1;
    let attenteMs = 1000;
    let derniere: WaveError | null = null;

    for (let tentative = 1; tentative <= maxTentatives; tentative++) {
      let reponse: Response;
      try {
        reponse = await fetch(`${this.config.baseUrl}${chemin}`, {
          method: methode,
          headers: {
            authorization: `Bearer ${this.config.apiKey}`,
            ...(corps === undefined ? {} : { 'content-type': 'application/json' }),
            ...(options.cleIdempotence ? { 'Idempotency-Key': options.cleIdempotence } : {}),
          },
          body: corps === undefined ? undefined : JSON.stringify(corps),
        });
      } catch (cause) {
        // Réseau coupé : pour un appel idempotent on rejoue, sinon on remonte.
        derniere = new WaveError('reseau-indisponible', 'Wave est injoignable.', 503);
        if (tentative < maxTentatives) {
          await this.patienter(attenteMs);
          attenteMs *= 2;
          continue;
        }
        throw derniere;
      }

      const texte = await reponse.text();

      if (reponse.ok) {
        // Certains points de terminaison répondent 200 avec un corps VIDE
        // (remboursement, annulation, expiration).
        return (texte ? (JSON.parse(texte) as T) : ({} as T));
      }

      derniere = this.erreurDepuis(texte, reponse.status);
      if (this.rejouable(reponse.status) && tentative < maxTentatives) {
        this.logger.warn(
          `Wave ${methode} ${chemin} : ${reponse.status} (${derniere.code}), nouvelle tentative ${tentative + 1}/${maxTentatives}.`,
        );
        await this.patienter(attenteMs);
        attenteMs *= 2;
        continue;
      }
      throw derniere;
    }

    throw derniere ?? new WaveError('inconnu', 'Appel Wave échoué.', 500);
  }

  /**
   * Extrait le code d'erreur, quelle que soit la forme.
   *
   * ⚠️ Wave répond les erreurs sous QUATRE formes selon le point de
   * terminaison : `{code,message}`, `{error,message}`, `{error_code,…}` et
   * `{error:{code,…}}`. N'en lire qu'une laisserait des erreurs sans code, donc
   * indécidables côté appelant.
   */
  private erreurDepuis(texte: string, status: number): WaveError {
    let code = `http-${status}`;
    let message = `Wave a refusé l'appel (${status}).`;
    try {
      const corps = JSON.parse(texte) as Record<string, unknown>;
      const imbrique =
        typeof corps.error === 'object' && corps.error !== null
          ? (corps.error as Record<string, unknown>)
          : null;
      const trouve =
        (typeof corps.code === 'string' && corps.code) ||
        (typeof corps.error_code === 'string' && corps.error_code) ||
        (typeof corps.error === 'string' && corps.error) ||
        (typeof imbrique?.code === 'string' && imbrique.code) ||
        null;
      if (trouve) code = trouve;
      const texteMessage =
        (typeof corps.message === 'string' && corps.message) ||
        (typeof corps.error_message === 'string' && corps.error_message) ||
        (typeof imbrique?.message === 'string' && imbrique.message) ||
        null;
      if (texteMessage) message = texteMessage;
    } catch {
      // Corps non-JSON : une page d'erreur de passerelle. On garde le générique
      // plutôt que de remonter du HTML à l'appelant.
    }
    return new WaveError(code, message, status);
  }

  private patienter(ms: number): Promise<void> {
    return new Promise((resoudre) => setTimeout(resoudre, ms));
  }
}
