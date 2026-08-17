'use client';

import { useCallback, useEffect, useState } from 'react';
import { AreaChart, BarList, Donut } from '../../../components/charts';
import {
  ApiError,
  downloadProtected,
  MOVEMENT_LABEL,
  reporting,
  type ReportingOverview,
} from '../../../lib/api';
import { useAuth } from '../../../lib/auth';

/** Fenêtres proposées : celles qu'on demande vraiment en réunion. */
const RANGES = [
  { days: 7, label: '7 jours' },
  { days: 30, label: '30 jours' },
  { days: 90, label: '90 jours' },
];

/** Couleurs des moyens de dépôt — miroir de `depositColors` dans tokens.ts. */
const DEPOSIT_COLOR: Record<string, string> = {
  ORANGE_MONEY: '#F26522',
  MTN_MOMO: '#FFCB05',
  MOOV_MONEY: '#0A5FBF',
  WAVE: '#1DC8F2',
  CARTE_BANCAIRE: '#1B2A8F',
  ESPECES_AGENCE: '#12B76A',
};

const DEPOSIT_LABEL: Record<string, string> = {
  ORANGE_MONEY: 'Orange Money',
  MTN_MOMO: 'MTN MoMo',
  MOOV_MONEY: 'Moov Money',
  WAVE: 'Wave',
  CARTE_BANCAIRE: 'Carte bancaire',
  ESPECES_AGENCE: 'Espèces en agence',
};

/** Accord en nombre : « 1 opération » et non « 1 opérations ». */
const plural = (count: number, singular: string, plural_: string): string =>
  `${count} ${count > 1 ? plural_ : singular}`;

const compact = (value: string | number): string => {
  const amount = Number(value);
  if (amount >= 1_000_000)
    return `${(amount / 1_000_000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M`;
  if (amount >= 1_000) return `${Math.round(amount / 1_000)} k`;
  return amount.toLocaleString('fr-FR', { maximumFractionDigits: 0 });
};

/**
 * Tableau de bord de l'exploitant (cahier §3.1).
 *
 * Le volume affiché est le chiffre **réalisé** — les opérations dont le change
 * a effectivement été exécuté. Les opérations en cours sont montrées à part :
 * les additionner gonflerait les chiffres de direction avec des intentions.
 */
export default function RapportsPage() {
  const { token } = useAuth();
  const [days, setDays] = useState(30);
  const [report, setReport] = useState<ReportingOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const from = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
      setReport(await reporting.overview(token, { from }));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Rapport illisible.');
    } finally {
      setLoading(false);
    }
  }, [token, days]);

  useEffect(() => {
    void load();
  }, [load]);

  async function exportCsv() {
    if (!token) return;
    setExporting(true);
    setError(null);
    try {
      const from = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
      await downloadProtected(
        `/api/reporting/export?format=csv&from=${from}`,
        'rapport.csv',
        token,
      );
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Export impossible.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Bandeau signature : le seul endroit du dashboard où le dégradé
          diplomatique occupe une vraie surface. */}
      <header className="banner-diplomatic animate-fade-up overflow-hidden rounded-lg p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-caption uppercase tracking-[0.2em] text-white/70">Pilotage</p>
            <h1 className="font-display text-display">Rapports</h1>
            <p className="text-white/80">
              Volumes réalisés, commissions générées et répartitions de l’activité.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {RANGES.map((range) => (
              <button
                key={range.days}
                onClick={() => setDays(range.days)}
                className={`lift rounded-full px-4 py-2 text-body transition ${
                  days === range.days
                    ? 'bg-white text-primary shadow-card'
                    : 'bg-white/10 text-white hover:bg-white/20'
                }`}
              >
                {range.label}
              </button>
            ))}
            <button
              onClick={() => void exportCsv()}
              disabled={exporting || !report}
              className="lift rounded-full bg-secondary px-4 py-2 text-body font-medium text-light-text disabled:opacity-40"
            >
              Export comptable
            </button>
          </div>
        </div>
      </header>

      {error ? (
        <p className="rounded-sm border-l-4 border-danger bg-danger/10 p-3 text-body text-danger">
          {error}
        </p>
      ) : null}

      {loading && !report ? (
        <p className="text-light-muted dark:text-dark-muted">Calcul en cours…</p>
      ) : null}

      {report ? (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi
              label="Volume réalisé"
              value={`${compact(report.totals.volumeXof)} FCFA`}
              hint={plural(report.totals.operations, 'opération exécutée', 'opérations exécutées')}
              delay={0}
            />
            <Kpi
              label="Commissions"
              value={`${compact(report.totals.commissionXof)} FCFA`}
              hint="Produit du bureau sur la période"
              delay={80}
              highlight
            />
            <Kpi
              label="Opération moyenne"
              value={`${compact(report.totals.averageXof)} FCFA`}
              hint={plural(report.totals.clients, 'client servi', 'clients servis')}
              delay={160}
            />
            <Kpi
              label="En cours"
              value={`${compact(report.totals.pendingXof)} FCFA`}
              hint={plural(
                report.totals.pendingOperations,
                'opération non exécutée',
                'opérations non exécutées',
              )}
              delay={240}
            />
          </section>

          <section className="surface lift animate-fade-up p-6" style={{ animationDelay: '120ms' }}>
            <div className="mb-4 flex items-baseline justify-between gap-3">
              <h2 className="font-display text-h2">Volume quotidien</h2>
              <span className="text-caption text-light-muted dark:text-dark-muted">
                du {new Date(report.period.from).toLocaleDateString('fr-FR')} au{' '}
                {new Date(report.period.to).toLocaleDateString('fr-FR')}
              </span>
            </div>
            <AreaChart points={report.series} />
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="surface lift animate-fade-up p-6" style={{ animationDelay: '180ms' }}>
              <h2 className="mb-4 font-display text-h2">Devises échangées</h2>
              <BarList
                data={report.byCurrency.map((row) => ({
                  label: row.code,
                  value: Number(row.volumeXof),
                  hint: `${compact(row.volumeXof)} FCFA · ${row.operations} op.`,
                }))}
              />
            </section>

            <section className="surface lift animate-fade-up p-6" style={{ animationDelay: '240ms' }}>
              <h2 className="mb-4 font-display text-h2">Moyens de paiement</h2>
              <Donut
                total={`${compact(report.totals.volumeXof)} FCFA`}
                slices={report.byDeposit.map((row) => ({
                  label: DEPOSIT_LABEL[row.method] ?? MOVEMENT_LABEL[row.method] ?? row.method,
                  value: Number(row.volumeXof),
                  color: DEPOSIT_COLOR[row.method] ?? '#5A6B7D',
                }))}
              />
            </section>

            <section className="surface lift animate-fade-up p-6" style={{ animationDelay: '300ms' }}>
              <h2 className="mb-4 font-display text-h2">Agences</h2>
              <BarList
                accent="#111A63"
                data={report.byAgency.map((row) => ({
                  label: row.name,
                  value: Number(row.volumeXof),
                  hint: `${compact(row.volumeXof)} FCFA · ${row.operations} op.`,
                }))}
              />
            </section>

            <section className="surface lift animate-fade-up p-6" style={{ animationDelay: '360ms' }}>
              <h2 className="mb-4 font-display text-h2">Sens des opérations</h2>
              <BarList
                accent="#12B76A"
                data={report.byDirection.map((row) => ({
                  label:
                    row.direction === 'VENTE_DEVISE'
                      ? 'Le client achète des devises'
                      : 'Le client vend ses devises',
                  value: Number(row.volumeXof),
                  hint: `${compact(row.volumeXof)} FCFA · ${row.operations} op.`,
                }))}
              />
            </section>
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * Chiffre clé. `highlight` réserve l'or au produit du bureau — le seul chiffre
 * qu'un dirigeant cherche en premier — avec un halo qui respire lentement.
 */
function Kpi({
  label,
  value,
  hint,
  delay,
  highlight = false,
}: {
  label: string;
  value: string;
  hint: string;
  delay: number;
  highlight?: boolean;
}) {
  return (
    <div
      className={`surface lift animate-fade-up p-5 ${highlight ? 'animate-breathe border-secondary/40' : ''}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <p className="text-caption uppercase tracking-wide text-light-muted dark:text-dark-muted">
        {label}
      </p>
      <p
        className={`tabular mt-1 text-h1 font-semibold ${
          highlight ? 'text-secondary-hover' : 'text-primary'
        }`}
      >
        {value}
      </p>
      <p className="mt-1 text-caption text-light-muted dark:text-dark-muted">{hint}</p>
    </div>
  );
}
