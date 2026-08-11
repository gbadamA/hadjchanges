'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ApiError,
  fetchProtectedImage,
  kyc,
  type KycDocumentRow,
  type KycStatus,
} from '../../../lib/api';
import { useAuth } from '../../../lib/auth';

const TABS: Array<{ status: KycStatus; label: string }> = [
  { status: 'EN_ATTENTE', label: 'À vérifier' },
  { status: 'VALIDE', label: 'Validées' },
  { status: 'REJETE', label: 'Rejetées' },
];

const TYPE_LABEL: Record<string, string> = {
  CNI: 'Carte nationale d’identité',
  PASSEPORT: 'Passeport',
  PERMIS: 'Permis de conduire',
  CARTE_CONSULAIRE: 'Carte consulaire',
};

/**
 * File de validation des identités (cahier §3.1).
 *
 * L'agent doit voir la pièce et décider sans quitter l'écran : la liste à
 * gauche, le document à droite, les deux actions dessous. Un rejet exige un
 * motif — c'est ce motif que le client recevra, et lui seul lui dira quoi
 * corriger.
 */
export default function KycQueuePage() {
  const { token } = useAuth();
  const [status, setStatus] = useState<KycStatus>('EN_ATTENTE');
  const [rows, setRows] = useState<KycDocumentRow[]>([]);
  const [selected, setSelected] = useState<KycDocumentRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const data = await kyc.queue(status, token);
      setRows(data);
      setSelected(data[0] ?? null);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'File illisible.');
    } finally {
      setLoading(false);
    }
  }, [status, token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(action: 'approve' | 'reject') {
    if (!token || !selected) return;
    if (action === 'reject' && reason.trim().length < 10) {
      setError('Le motif doit être explicite : c’est lui que le client recevra.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (action === 'approve') await kyc.approve(selected.id, token);
      else await kyc.reject(selected.id, reason.trim(), token);
      setReason('');
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Décision impossible.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-display text-h1">Identités</h1>
        <p className="text-light-muted dark:text-dark-muted">
          Aucune opération de change n’est possible tant qu’une identité n’est pas validée.
        </p>
      </header>

      <div className="flex gap-2">
        {TABS.map((tab) => (
          <button
            key={tab.status}
            onClick={() => setStatus(tab.status)}
            className={`rounded-full px-4 py-2 text-body transition ${
              status === tab.status
                ? 'bg-primary text-white'
                : 'bg-light-surface text-light-muted hover:bg-light-surface-alt dark:bg-dark-surface dark:text-dark-muted'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error ? (
        <p className="rounded-sm border-l-4 border-danger bg-danger/10 p-3 text-body text-danger">
          {error}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <ul className="space-y-2">
          {loading ? <li className="text-light-muted dark:text-dark-muted">Chargement…</li> : null}
          {!loading && rows.length === 0 ? (
            <li className="rounded-md border border-dashed border-light-border p-6 text-center text-light-muted dark:border-dark-border dark:text-dark-muted">
              Aucun dossier dans cette file.
            </li>
          ) : null}
          {rows.map((row) => (
            <li key={row.id}>
              <button
                onClick={() => {
                  setSelected(row);
                  setReason('');
                }}
                className={`w-full rounded-md border p-4 text-left transition ${
                  selected?.id === row.id
                    ? 'border-primary bg-primary/5'
                    : 'border-light-border bg-light-surface hover:border-tertiary dark:border-dark-border dark:bg-dark-surface'
                }`}
              >
                <p className="font-medium">
                  {row.client?.firstName} {row.client?.lastName}
                </p>
                <p className="text-caption text-light-muted dark:text-dark-muted">
                  {row.client?.phone} · {TYPE_LABEL[row.type] ?? row.type}
                </p>
                <p className="text-caption text-light-muted dark:text-dark-muted">
                  Déposé le {new Date(row.createdAt).toLocaleDateString('fr-FR')}
                </p>
              </button>
            </li>
          ))}
        </ul>

        {selected ? (
          <section className="space-y-4 rounded-md border border-light-border bg-light-surface p-6 dark:border-dark-border dark:bg-dark-surface">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="font-display text-h2">
                  {selected.client?.firstName} {selected.client?.lastName}
                </h2>
                <p className="text-light-muted dark:text-dark-muted">
                  {TYPE_LABEL[selected.type] ?? selected.type}
                  {selected.documentNumber ? ` · nº ${selected.documentNumber}` : ''}
                </p>
              </div>
              <span className="rounded-full bg-secondary/15 px-3 py-1 text-caption text-secondary-hover">
                {selected.hasSelfie ? 'Selfie fourni' : 'Sans selfie'}
              </span>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <ProtectedImage id={selected.id} kind="document" label="Pièce d’identité" />
              {selected.hasSelfie ? (
                <ProtectedImage id={selected.id} kind="selfie" label="Selfie" />
              ) : null}
            </div>

            {selected.rejectReason ? (
              <p className="rounded-sm bg-danger/10 p-3 text-body text-danger">
                Motif du rejet : {selected.rejectReason}
              </p>
            ) : null}

            {selected.status === 'EN_ATTENTE' ? (
              <div className="space-y-3 border-t border-light-border pt-4 dark:border-dark-border">
                <textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  rows={2}
                  placeholder="Motif du rejet — transmis au client, il doit dire quoi corriger."
                  className="w-full rounded-sm border border-light-border bg-light-bg p-3 text-body outline-none focus:border-tertiary dark:border-dark-border dark:bg-dark-bg"
                />
                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={() => void decide('approve')}
                    disabled={busy}
                    className="rounded-sm bg-success px-5 py-2.5 font-medium text-white transition hover:opacity-90 disabled:opacity-40"
                  >
                    Valider l’identité
                  </button>
                  <button
                    onClick={() => void decide('reject')}
                    disabled={busy || reason.trim().length < 10}
                    className="rounded-sm border border-danger px-5 py-2.5 font-medium text-danger transition hover:bg-danger/10 disabled:opacity-40"
                  >
                    Rejeter
                  </button>
                </div>
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Une pièce d'identité ne se charge pas par `<img src>` : l'URL exige un jeton
 * en en-tête. On récupère le binaire, on en fait une URL d'objet locale, et on
 * la révoque au démontage pour ne pas laisser le fichier en mémoire.
 */
function ProtectedImage({
  id,
  kind,
  label,
}: {
  id: string;
  kind: 'document' | 'selfie';
  label: string;
}) {
  const { token } = useAuth();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!token) return;
    let objectUrl: string | null = null;
    let cancelled = false;

    fetchProtectedImage(id, kind, token)
      .then((result) => {
        objectUrl = result;
        if (cancelled) URL.revokeObjectURL(result);
        else setUrl(result);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id, kind, token]);

  return (
    <figure className="space-y-2">
      <figcaption className="text-caption font-medium">{label}</figcaption>
      <div className="grid h-56 place-items-center overflow-hidden rounded-sm border border-light-border bg-light-bg dark:border-dark-border dark:bg-dark-bg">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- URL d'objet locale, pas une ressource distante optimisable
          <img src={url} alt={label} className="h-full w-full object-contain" />
        ) : (
          <span className="text-caption text-light-muted dark:text-dark-muted">
            {failed ? 'Document illisible' : 'Chargement…'}
          </span>
        )}
      </div>
    </figure>
  );
}
