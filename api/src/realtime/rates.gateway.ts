import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type { RateBoardRow } from '../rates/rates.service';

/** Salle des taux globaux ; une salle par agence pour les taux différenciés. */
const GLOBAL_ROOM = 'rates:global';
const agencyRoom = (agencyId: string): string => `rates:agency:${agencyId}`;

/**
 * Diffusion des taux en direct (cahier §4 : « mise à jour des taux et
 * affichage en temps réel »).
 *
 * Volontairement **sans authentification** : les taux du jour sont publics, et
 * exiger un jeton pour les recevoir compliquerait l'accueil de l'app sans rien
 * protéger. Aucune donnée personnelle ne transite ici — les statuts de
 * transaction, eux, passeront par une passerelle authentifiée (brique 5).
 */
@WebSocketGateway({ cors: { origin: true, credentials: true }, namespace: '/rates' })
export class RatesGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RatesGateway.name);

  @WebSocketServer()
  private server!: Server;

  handleConnection(client: Socket): void {
    void client.join(GLOBAL_ROOM);
  }

  handleDisconnect(): void {
    // Socket.IO quitte les salles tout seul ; rien à faire.
  }

  /** Un client d'agence reçoit en plus les taux différenciés de son agence. */
  @SubscribeMessage('watch:agency')
  watchAgency(client: Socket, agencyId: unknown): void {
    if (typeof agencyId !== 'string' || agencyId.length === 0) return;
    void client.join(agencyRoom(agencyId));
  }

  /**
   * Un taux vient d'être publié. On envoie la LIGNE COMPLÈTE du tableau, pas un
   * simple identifiant : le client doit pouvoir rafraîchir son affichage sans
   * refaire un appel HTTP, sinon le « temps réel » coûte un aller-retour de plus.
   */
  broadcast(row: RateBoardRow, agencyId: string | null): void {
    if (!this.server) return;
    const room = agencyId ? agencyRoom(agencyId) : GLOBAL_ROOM;
    this.server.to(room).emit('rates:updated', row);
    this.logger.log(`Taux ${row.currency.code} diffusé sur ${room}`);
  }
}
