import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type { Env } from '../config/env';
import {
  toTransactionView,
  type TransactionView,
  type TransactionWithRelations,
} from '../transactions/transactions.view';

/** Une salle par client : personne ne reçoit les transactions d'un autre. */
const userRoom = (userId: string): string => `tx:user:${userId}`;

/**
 * Suivi des transactions EN DIRECT (cahier §3.2 « Suivi en temps réel du statut
 * de chaque transaction », §4 « affichage en temps réel »).
 *
 * Contrairement à la passerelle des taux, celle-ci est **authentifiée** : un
 * statut de transaction est une donnée personnelle. Le jeton est lu dans le
 * `handshake`, pas dans un en-tête — une poignée de main WebSocket n'en porte
 * pas de façon fiable selon les plateformes.
 *
 * ⚠️ Une connexion sans jeton valide est **fermée**, pas laissée ouverte en
 * lecture seule : un socket muet ressemble à un socket qui fonctionne, et le
 * client attendrait indéfiniment des messages qui ne viendraient jamais.
 */
@WebSocketGateway({ cors: { origin: true, credentials: true }, namespace: '/transactions' })
export class TransactionsGateway implements OnGatewayConnection {
  private readonly logger = new Logger(TransactionsGateway.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @WebSocketServer()
  private server!: Server;

  handleConnection(client: Socket): void {
    const token = this.tokenOf(client);
    if (!token) {
      client.emit('auth:error', 'Jeton manquant.');
      client.disconnect(true);
      return;
    }
    try {
      const payload = this.jwt.verify<{ sub: string }>(token, {
        secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
      });
      void client.join(userRoom(payload.sub));
    } catch {
      // Jeton expiré ou falsifié : on le dit, le client sait alors qu'il doit
      // rafraîchir sa session plutôt que d'attendre dans le vide.
      client.emit('auth:error', 'Session expirée.');
      client.disconnect(true);
    }
  }

  /**
   * Diffuse une transaction à son client, ET renvoie sa vue réseau.
   *
   * Les deux gestes sont réunis **exprès**. Séparés, on peut renvoyer une vue
   * sans l'avoir diffusée : le client garde alors un écran figé, et le défaut
   * ne se voit qu'à l'usage, longtemps après. Ici, tout point de mutation qui
   * renvoie une transaction la diffuse par construction.
   */
  publishAndView(
    transaction: TransactionWithRelations,
    options: { withClient?: boolean } = {},
  ): TransactionView {
    const view = toTransactionView(transaction, options);
    if (this.server) {
      // La vue envoyée au client ne contient JAMAIS le bloc `client` : il sait
      // déjà qui il est, et l'exposer ferait fuiter des données par le socket.
      this.server
        .to(userRoom(transaction.clientId))
        .emit('transaction:updated', toTransactionView(transaction));
      this.logger.log(`Transaction ${transaction.reference} → ${transaction.status} diffusée`);
    }
    return view;
  }

  /** Le jeton arrive par `auth` (recommandé) ou par la requête, selon le client. */
  private tokenOf(client: Socket): string | null {
    const fromAuth = (client.handshake.auth as { token?: unknown } | undefined)?.token;
    if (typeof fromAuth === 'string' && fromAuth.length > 0) return fromAuth;
    const fromQuery = client.handshake.query.token;
    if (typeof fromQuery === 'string' && fromQuery.length > 0) return fromQuery;
    return null;
  }
}
