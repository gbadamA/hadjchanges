'use client';

import { useId } from 'react';

/**
 * Graphiques **SVG maison** — pas de Recharts ni de D3.
 *
 * Trois raisons : le poids (une dépendance de graphes pèse plus lourd que tout
 * le reste du dashboard), le contrôle du rendu (nos couleurs, nos animations,
 * notre grammaire visuelle), et le fait qu'on n'a besoin que de trois formes.
 *
 * Règles communes à tous les graphes de ce fichier :
 * - `viewBox` + `preserveAspectRatio` : ils se redimensionnent sans JavaScript ;
 * - le tracé s'anime une fois (`draw`, `rise`), jamais en boucle — une courbe
 *   qui bouge sans cesse empêche de lire un chiffre ;
 * - toute valeur affichée reste lisible **sans** l'animation (dégradation
 *   propre si le mouvement est désactivé).
 */

const money = (value: number): string =>
  value >= 1_000_000
    ? `${(value / 1_000_000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M`
    : value >= 1_000
      ? `${Math.round(value / 1_000)} k`
      : String(Math.round(value));

export interface SeriesPoint {
  day: string;
  operations: number;
  volumeXof: string;
  commissionXof: string;
}

/**
 * Courbe d'aire du volume quotidien.
 *
 * L'axe vertical démarre à **zéro**, toujours : un axe tronqué transforme une
 * variation de 2 % en falaise, ce qui est un mensonge visuel dans un tableau de
 * bord financier.
 */
export function AreaChart({ points }: { points: SeriesPoint[] }) {
  const id = useId();
  const width = 720;
  const height = 220;
  const padding = { top: 16, right: 12, bottom: 26, left: 12 };

  if (points.length === 0) {
    return <EmptyChart message="Aucune opération sur la période." />;
  }

  const values = points.map((point) => Number(point.volumeXof));
  const max = Math.max(...values, 1);
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;

  const x = (index: number) =>
    padding.left + (points.length === 1 ? innerWidth / 2 : (index / (points.length - 1)) * innerWidth);
  const y = (value: number) => padding.top + innerHeight - (value / max) * innerHeight;

  const line = values.map((value, index) => `${index === 0 ? 'M' : 'L'} ${x(index)} ${y(value)}`).join(' ');
  const area = `${line} L ${x(values.length - 1)} ${padding.top + innerHeight} L ${x(0)} ${padding.top + innerHeight} Z`;

  // Longueur approchée du tracé : sert à animer le dessin de la courbe.
  const length = values.reduce((total, value, index) => {
    if (index === 0) return 0;
    const dx = x(index) - x(index - 1);
    const dy = y(value) - y(values[index - 1]);
    return total + Math.hypot(dx, dy);
  }, 0);

  const peak = values.indexOf(Math.max(...values));

  return (
    <figure className="space-y-2">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-56 w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label={`Volume quotidien, maximum ${money(max)} FCFA`}
      >
        <defs>
          <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#14507F" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#14507F" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${id}-line`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#0B2A4A" />
            <stop offset="70%" stopColor="#2E7CB8" />
            <stop offset="100%" stopColor="#C9A227" />
          </linearGradient>
        </defs>

        {/* Lignes de repère : discrètes, elles servent à situer, pas à décorer. */}
        {[0.25, 0.5, 0.75, 1].map((ratio) => (
          <line
            key={ratio}
            x1={padding.left}
            x2={width - padding.right}
            y1={padding.top + innerHeight * (1 - ratio)}
            y2={padding.top + innerHeight * (1 - ratio)}
            stroke="currentColor"
            strokeWidth={1}
            className="text-light-border dark:text-dark-border"
            strokeDasharray="3 6"
          />
        ))}

        <path d={area} fill={`url(#${id}-fill)`} className="animate-fill-in" />
        <path
          d={line}
          fill="none"
          stroke={`url(#${id}-line)`}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="animate-draw"
          style={{ '--dash': length, strokeDasharray: length } as React.CSSProperties}
        />

        {/* Le pic est marqué : c'est le seul point qu'on cherche des yeux. */}
        {max > 0 ? (
          <circle cx={x(peak)} cy={y(values[peak])} r={4.5} fill="#C9A227" className="animate-fill-in" />
        ) : null}
      </svg>

      <figcaption className="flex justify-between text-caption text-light-muted dark:text-dark-muted">
        <span>{new Date(points[0].day).toLocaleDateString('fr-FR')}</span>
        <span className="tabular">Pic : {money(max)} FCFA</span>
        <span>{new Date(points[points.length - 1].day).toLocaleDateString('fr-FR')}</span>
      </figcaption>
    </figure>
  );
}

export interface BarDatum {
  label: string;
  value: number;
  hint?: string;
}

/** Barres horizontales : le classement se lit de haut en bas, sans effort. */
export function BarList({ data, accent = '#0F3D6B' }: { data: BarDatum[]; accent?: string }) {
  if (data.length === 0) return <EmptyChart message="Aucune donnée sur la période." />;
  const max = Math.max(...data.map((datum) => datum.value), 1);

  return (
    <ul className="space-y-3">
      {data.map((datum, index) => (
        <li key={datum.label} className="animate-fade-up space-y-1" style={{ animationDelay: `${index * 60}ms` }}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-body font-medium">{datum.label}</span>
            <span className="tabular text-caption text-light-muted dark:text-dark-muted">
              {datum.hint ?? `${money(datum.value)} FCFA`}
            </span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-light-surface-alt dark:bg-dark-surface-alt">
            <div
              className="h-full origin-left rounded-full animate-rise"
              style={{
                width: `${Math.max((datum.value / max) * 100, 2)}%`,
                background: `linear-gradient(90deg, ${accent}, #2E7CB8)`,
                animationDelay: `${index * 60}ms`,
                transform: 'scaleX(1)',
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

export interface DonutSlice {
  label: string;
  value: number;
  color: string;
}

/**
 * Anneau de répartition. Un anneau plutôt qu'un camembert : le trou central
 * accueille le total, qui est l'information la plus demandée.
 */
export function Donut({ slices, total }: { slices: DonutSlice[]; total: string }) {
  const size = 180;
  const stroke = 26;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const sum = slices.reduce((acc, slice) => acc + slice.value, 0);

  if (sum === 0) return <EmptyChart message="Aucune répartition à afficher." />;

  let offset = 0;

  return (
    <div className="flex flex-wrap items-center gap-6">
      <div className="relative">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Répartition">
          <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
            {slices.map((slice, index) => {
              const portion = (slice.value / sum) * circumference;
              const dash = `${portion} ${circumference - portion}`;
              const element = (
                <circle
                  key={slice.label}
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  fill="none"
                  stroke={slice.color}
                  strokeWidth={stroke}
                  strokeDasharray={dash}
                  strokeDashoffset={-offset}
                  className="animate-fill-in"
                  style={{ animationDelay: `${index * 90}ms` }}
                />
              );
              offset += portion;
              return element;
            })}
          </g>
        </svg>
        <div className="absolute inset-0 grid place-content-center text-center">
          <p className="text-caption text-light-muted dark:text-dark-muted">Volume</p>
          <p className="tabular text-h3 font-semibold">{total}</p>
        </div>
      </div>

      <ul className="space-y-2">
        {slices.map((slice, index) => (
          <li
            key={slice.label}
            className="flex animate-fade-up items-center gap-2 text-body"
            style={{ animationDelay: `${index * 60}ms` }}
          >
            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: slice.color }} />
            <span>{slice.label}</span>
            <span className="tabular text-caption text-light-muted dark:text-dark-muted">
              {Math.round((slice.value / sum) * 100)} %
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="grid h-40 place-content-center rounded-sm border border-dashed border-light-border text-caption text-light-muted dark:border-dark-border dark:text-dark-muted">
      {message}
    </div>
  );
}
