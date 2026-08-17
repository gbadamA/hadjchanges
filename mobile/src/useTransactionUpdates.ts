import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import { BASE_URL } from './api';
import { useAuth } from './auth';
import type { Transaction } from './models';

/**
 * Statuts de transaction reçus EN DIRECT (cahier §3.2 « Suivi en temps réel »).
 *
 * Sans ça, un client qui regarde sa transaction pendant que l'opérateur valide
 * son reçu voit un écran figé : il doit quitter la fiche et la rouvrir pour
 * apprendre que son change est passé. C'est précisément le moment où il
 * regarde, donc le pire moment pour ne rien montrer.
 *
 * ⚠️ La fonction de rappel est gardée dans une `ref`. Passée directement en
 * dépendance, une fonction recréée à chaque rendu fermerait et rouvrirait le
 * socket en boucle — le suivi « temps réel » ne recevrait jamais rien.
 */
export function useTransactionUpdates(
  onUpdate: (transaction: Transaction) => void,
  /**
   * Appelé après une RE-connexion du socket, jamais à la première.
   *
   * ⚠️ Indispensable en hébergement gratuit : le service s'endort après ~15 min
   * sans trafic, ce qui coupe le socket. Les changements de statut survenus
   * pendant la veille ne sont diffusés à personne — sans rechargement au
   * réveil, l'écran affiche un statut périmé en donnant l'impression d'être à
   * jour, ce qui est pire qu'un écran visiblement figé.
   */
  onReconnect?: () => void,
): void {
  const { accessToken } = useAuth();
  const handler = useRef(onUpdate);
  handler.current = onUpdate;
  const reconnect = useRef(onReconnect);
  reconnect.current = onReconnect;

  useEffect(() => {
    if (!accessToken) return;

    // Le jeton passe par `auth` : une poignée de main WebSocket ne transporte
    // pas d'en-tête `Authorization` de façon fiable selon les plateformes.
    const socket: Socket = io(`${BASE_URL}/transactions`, {
      transports: ['websocket'],
      auth: { token: accessToken },
    });

    socket.on('transaction:updated', (row: Transaction) => handler.current(row));

    // La toute première connexion n'est PAS une reconnexion : l'écran vient de
    // charger ses données, les redemander serait un aller-retour pour rien.
    let dejaConnecte = false;
    socket.on('connect', () => {
      if (dejaConnecte) reconnect.current?.();
      dejaConnecte = true;
    });

    return () => {
      socket.close();
    };
  }, [accessToken]);
}
