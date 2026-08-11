import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { api, BASE_URL } from './api';
import type { RateRow } from './models';

interface RatesState {
  rows: RateRow[];
  loading: boolean;
  error: string | null;
  /** Code de la devise dont le taux vient de changer — pour un effet visuel bref. */
  justUpdated: string | null;
  reload: () => void;
}

/**
 * Taux du jour, tenus à jour EN DIRECT (cahier §4).
 *
 * Le premier chargement passe par HTTP, la suite arrive par WebSocket. Le
 * serveur envoie la ligne complète, donc une mise à jour ne coûte aucun
 * aller-retour supplémentaire — un taux publié apparaît immédiatement sur le
 * téléphone, sans que l'utilisateur ait à tirer pour rafraîchir.
 */
export function useRates(agencyId?: string): RatesState {
  const [rows, setRows] = useState<RateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [justUpdated, setJustUpdated] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .rates(agencyId)
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Taux indisponibles.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agencyId, tick]);

  useEffect(() => {
    const socket: Socket = io(`${BASE_URL}/rates`, { transports: ['websocket'] });
    if (agencyId) socket.emit('watch:agency', agencyId);

    socket.on('rates:updated', (row: RateRow) => {
      setRows((current) => {
        const index = current.findIndex((item) => item.currency.code === row.currency.code);
        if (index === -1) return [...current, row];
        const next = [...current];
        next[index] = row;
        return next;
      });
      setJustUpdated(row.currency.code);
      setTimeout(() => setJustUpdated(null), 2000);
    });

    // Sans cette fermeture, chaque remontage ouvre une connexion de plus et
    // l'app finit avec une poignée de sockets vivants en arrière-plan.
    return () => {
      socket.close();
    };
  }, [agencyId]);

  return { rows, loading, error, justUpdated, reload: () => setTick((value) => value + 1) };
}
