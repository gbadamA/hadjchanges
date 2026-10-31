import { createHmac, randomBytes } from 'node:crypto';
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
 * Adaptateur **simulé** — l'adaptateur par défaut, et le seul utilisable en
 * développement.
 *
 * ⚠️ Il n'existe pas de bac à sable chez Wave : aucune clé de test, aucun
 * environnement d'essai. Sans cet adaptateur, éprouver le parcours de paiement
 * d'un bureau de change signifierait virer de l'argent réel à chaque
 * exécution. Ce n'est pas un bouchon de confort, c'est la seule façon
 * responsable de développer cette fonctionnalité.
 *
 * Il reproduit fidèlement ce qui compte :
 * - les mêmes formes d'identifiants (`cos-…`, `pt-…`, `pb-…`) ;
 * - l'expiration des sessions au bout de 30 minutes ;
 * - l'idempotence des versements, et le refus `idempotency-mismatch` quand une
 *   clé déjà vue revient avec un corps différent ;
 * - des frais de versement, pour que la caisse soit éprouvée avec un écart ;
 * - des événements signés **exactement** comme Wave les signe, afin que le code
 *   de vérification réellement utilisé en production soit celui qu'on éprouve.
 *
 * L'état vit en mémoire : un redémarrage le perd, ce qui est sans conséquence
 * en développement et empêche de le prendre pour une source de vérité.
 */

/** Taux de frais simulé, pour que l'écart de caisse ne soit jamais nul. */
const FRAIS_PCT = 1;

interface SessionSimulee {
  id: string;
  reference: string;
  montantXof: MontantXof;
  issue: IssuePaiement;
  idTransaction: string | null;
  codeEchec: string | null;
  expireLe: Date;
}

interface VersementSimule {
  id: string;
  reference: string;
  montantRecuXof: MontantXof;
  mobile: string;
  issue: IssueVersement;
  fraisXof: MontantXof;
  codeEchec: string | null;
  empreinteDemande: string;
}

export class PaiementSimuleAdapter extends PaymentService {
  readonly nom = 'Simulation';
  readonly reel = false;

  private readonly logger = new Logger(PaiementSimuleAdapter.name);
  private readonly sessions = new Map<string, SessionSimulee>();
  private readonly versements = new Map<string, VersementSimule>();
  /** Clé d'idempotence → identifiant de versement déjà créé. */
  private readonly parCle = new Map<string, string>();
  private soldeXof = 50_000_000;

  constructor(
    /** Base publique de l'API, pour fabriquer l'adresse de la page de paiement. */
    private readonly baseUrlApi: string,
    /** Même secret que celui attendu des webhooks : on signe pour de vrai. */
    private readonly webhookSecret: string,
  ) {
    super();
    this.logger.warn(
      'Paiements SIMULÉS : aucun argent ne circule. Wave ne fournit aucun ' +
        'environnement de test, le simulateur est donc le mode par défaut.',
    );
  }

  // -------------------------------------------------------------------------
  // Encaissement
  // -------------------------------------------------------------------------

  ouvrirEncaissement(demande: DemandeEncaissement): Promise<SessionEncaissement> {
    const id = `cos-${randomBytes(7).toString('hex')}`;
    const session: SessionSimulee = {
      id,
      reference: demande.reference,
      montantXof: demande.montantXof,
      issue: 'EN_COURS',
      idTransaction: null,
      codeEchec: null,
      // Même durée que Wave : le verrou de taux et la session doivent expirer
      // ensemble, et ce comportement doit être éprouvable.
      expireLe: new Date(Date.now() + 30 * 60 * 1000),
    };
    this.sessions.set(id, session);

    return Promise.resolve({
      idSession: id,
      // Page locale qui remplace l'application Wave, avec un bouton « payer »
      // et un bouton « échouer » : les deux issues doivent être atteignables.
      urlPaiement: `${this.baseUrlApi}/api/payments/simulation/${id}`,
      expireLe: session.expireLe,
    });
  }

  lireEncaissement(idSession: string): Promise<EtatEncaissement> {
    const session = this.sessions.get(idSession);
    if (!session) {
      return Promise.reject(new Error(`Session simulée inconnue : ${idSession}`));
    }
    return Promise.resolve(this.traduire(this.peremption(session)));
  }

  chercherEncaissementParReference(reference: string): Promise<EtatEncaissement | null> {
    const trouvees = [...this.sessions.values()].filter((s) => s.reference === reference);
    if (trouvees.length === 0) return Promise.resolve(null);
    const reussie = trouvees.find((s) => s.issue === 'REUSSI');
    return Promise.resolve(this.traduire(this.peremption(reussie ?? trouvees[trouvees.length - 1])));
  }

  /**
   * Force l'issue d'une session, comme le ferait le client dans Wave.
   *
   * Hors du port : aucun code métier ne doit pouvoir déclarer un paiement
   * réussi. Seule la route de simulation s'en sert, et elle n'existe pas en
   * production.
   */
  marquer(idSession: string, issue: 'REUSSI' | 'ECHOUE'): EtatEncaissement {
    const session = this.sessions.get(idSession);
    if (!session) throw new Error(`Session simulée inconnue : ${idSession}`);
    this.peremption(session);
    if (session.issue === 'EXPIRE') {
      throw new Error('Session simulée expirée : elle ne peut plus être payée.');
    }
    session.issue = issue;
    if (issue === 'REUSSI') {
      session.idTransaction = `T${randomBytes(5).toString('hex').toUpperCase()}`;
      session.codeEchec = null;
      this.soldeXof += session.montantXof;
    } else {
      session.codeEchec = 'insufficient-funds';
    }
    return this.traduire(session);
  }

  /**
   * Fabrique un événement signé, identique dans sa forme à celui de Wave.
   *
   * Permet d'éprouver le point d'entrée webhook de bout en bout — signature,
   * fenêtre de rejeu, dédoublonnage — sans compte Wave.
   */
  fabriquerEvenementSigne(idSession: string): { corps: Buffer; signature: string } {
    const session = this.sessions.get(idSession);
    if (!session) throw new Error(`Session simulée inconnue : ${idSession}`);

    const corps = Buffer.from(
      JSON.stringify({
        id: `EV_${randomBytes(8).toString('hex')}`,
        type:
          session.issue === 'REUSSI'
            ? 'checkout.session.completed'
            : 'checkout.session.payment_failed',
        data: {
          id: session.id,
          amount: String(session.montantXof),
          currency: 'XOF',
          client_reference: session.reference,
          checkout_status: session.issue === 'REUSSI' ? 'complete' : 'open',
          payment_status: session.issue === 'REUSSI' ? 'succeeded' : 'failed',
          transaction_id: session.idTransaction,
          last_payment_error: session.codeEchec ? { code: session.codeEchec } : null,
        },
      }),
      'utf8',
    );

    const t = String(Math.floor(Date.now() / 1000));
    const v1 = createHmac('sha256', this.webhookSecret)
      .update(t, 'utf8')
      .update(corps)
      .digest('hex');
    return { corps, signature: `t=${t},v1=${v1}` };
  }

  // -------------------------------------------------------------------------
  // Versement
  // -------------------------------------------------------------------------

  verser(demande: DemandeVersement): Promise<EtatVersement> {
    const empreinte = JSON.stringify([
      demande.montantRecuXof,
      demande.mobile,
      demande.reference,
    ]);

    // Idempotence, reproduite telle que Wave la décrit : une clé déjà vue rend
    // le MÊME versement, et la même clé avec un corps différent est refusée.
    const dejaVu = this.parCle.get(demande.cleIdempotence);
    if (dejaVu) {
      const precedent = this.versements.get(dejaVu)!;
      if (precedent.empreinteDemande !== empreinte) {
        return Promise.reject(
          Object.assign(new Error('idempotency-mismatch'), { code: 'idempotency-mismatch' }),
        );
      }
      return Promise.resolve(this.traduireVersement(precedent));
    }

    const frais = Math.ceil((demande.montantRecuXof * FRAIS_PCT) / 100);
    const total = demande.montantRecuXof + frais;
    if (total > this.soldeXof) {
      return Promise.reject(
        Object.assign(new Error('insufficient-funds'), { code: 'insufficient-funds' }),
      );
    }

    const id = `pt-${randomBytes(7).toString('hex')}`;
    const versement: VersementSimule = {
      id,
      reference: demande.reference,
      montantRecuXof: demande.montantRecuXof,
      mobile: demande.mobile,
      // Wave exécute les versements de façon synchrone, mais annonce aussi un
      // état `processing` : on rend REUSSI tout en laissant la relecture
      // possible, pour que la tâche de rapprochement soit éprouvable.
      issue: 'REUSSI',
      fraisXof: frais,
      codeEchec: null,
      empreinteDemande: empreinte,
    };
    this.versements.set(id, versement);
    this.parCle.set(demande.cleIdempotence, id);
    this.soldeXof -= total;

    return Promise.resolve(this.traduireVersement(versement));
  }

  lireVersement(idVersement: string): Promise<EtatVersement> {
    const versement = this.versements.get(idVersement);
    if (!versement) {
      return Promise.reject(new Error(`Versement simulé inconnu : ${idVersement}`));
    }
    return Promise.resolve(this.traduireVersement(versement));
  }

  lireSoldeXof(): Promise<MontantXof> {
    return Promise.resolve(this.soldeXof);
  }

  // -------------------------------------------------------------------------
  // Webhook
  // -------------------------------------------------------------------------

  verifierEvenement(rawBody: Buffer, enTeteSignature: string | undefined): EvenementPaiement {
    // Même vérification qu'en production, sur le même code : si la signature
    // était ignorée en simulation, le chemin réellement déployé ne serait
    // jamais exercé avant le premier vrai paiement.
    verifierSignatureWave(rawBody, enTeteSignature, this.webhookSecret);

    const evenement = JSON.parse(rawBody.toString('utf8')) as {
      id?: string;
      type?: string;
      data?: {
        id?: string;
        amount?: string;
        client_reference?: string | null;
        payment_status?: string;
        checkout_status?: string;
        transaction_id?: string | null;
        last_payment_error?: { code?: string } | null;
      };
    };
    if (!evenement.id || !evenement.type) {
      throw new Error('Événement simulé sans identifiant ni type.');
    }

    const data = evenement.data;
    return {
      idEvenement: evenement.id,
      type: evenement.type,
      encaissement:
        evenement.type.startsWith('checkout.session.') && data?.id
          ? {
              idSession: data.id,
              reference: data.client_reference ?? null,
              issue:
                data.payment_status === 'succeeded'
                  ? 'REUSSI'
                  : data.checkout_status === 'expired'
                    ? 'EXPIRE'
                    : data.payment_status === 'failed' || data.payment_status === 'cancelled'
                      ? 'ECHOUE'
                      : 'EN_COURS',
              montantXof: data.amount ? Number(data.amount) : null,
              idTransaction: data.transaction_id ?? null,
              codeEchec: data.last_payment_error?.code ?? null,
            }
          : null,
    };
  }

  // -------------------------------------------------------------------------

  /** Applique l'expiration au passage, comme le ferait Wave de son côté. */
  private peremption(session: SessionSimulee): SessionSimulee {
    if (session.issue === 'EN_COURS' && session.expireLe.getTime() < Date.now()) {
      session.issue = 'EXPIRE';
    }
    return session;
  }

  private traduire(session: SessionSimulee): EtatEncaissement {
    return {
      idSession: session.id,
      reference: session.reference,
      issue: session.issue,
      montantXof: session.montantXof,
      idTransaction: session.idTransaction,
      codeEchec: session.codeEchec,
    };
  }

  private traduireVersement(versement: VersementSimule): EtatVersement {
    return {
      idVersement: versement.id,
      issue: versement.issue,
      fraisXof: versement.fraisXof,
      codeEchec: versement.codeEchec,
    };
  }
}
