import type { NotificationChannel } from '@prisma/client';

/** Ce qu'un transport reçoit : le message, et de quoi joindre le destinataire. */
export interface OutboundMessage {
  title: string;
  body: string;
  deepLink?: string | null;
  recipient: {
    userId: string;
    phone: string;
    email: string | null;
    /** Jetons Expo enregistrés par les appareils du client. */
    pushTokens: string[];
  };
}

export interface DeliveryResult {
  channel: NotificationChannel;
  delivered: boolean;
  /** Renseigné quand le transport n'est pas configuré ou a échoué. */
  detail?: string;
}

/**
 * Port de sortie d'une notification.
 *
 * Chaque canal (push, email, WhatsApp, SMS) l'implémente. Le service ne connaît
 * que cette interface : ajouter un fournisseur se fait en ajoutant une classe,
 * sans toucher au métier qui déclenche la notification (OCP + DIP).
 *
 * **Un transport ne lève jamais.** Il rend un résultat, y compris en échec :
 * une notification ratée ne doit pas faire échouer le change qu'elle annonce.
 */
export interface NotificationTransport {
  readonly channel: NotificationChannel;
  /** Faux quand la configuration manque — le service passe au canal suivant. */
  isConfigured(): boolean;
  send(message: OutboundMessage): Promise<DeliveryResult>;
}
