import React, { useId, useState } from 'react';

const W = 320;
const H = 132;
const PAD = { l: 38, r: 12, t: 22, b: 22 };

const niceTicks = (min, max) => {
  if (min === max) return [min];
  const span = max - min;
  return [min, min + span / 2, max];
};

/**
 * One measure over time: 2px line, 8px points with a surface ring, three recessive gridlines,
 * first/last date on the x-axis, and tap/hover to read any point. A hidden table carries the data for screen readers.
 */
export default function TrendChart({ title, points, format = (v) => String(v), dateLabel = (d) => d, color = '#10b981', better }) {
  const [sel, setSel] = useState(points.length - 1);
  const uid = useId().replace(/:/g, '');
  if (!points.length) return null;

  const vals = points.map((p) => p.value);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  const padY = (hi - lo || Math.abs(hi) * 0.05 || 1) * 0.25;
  lo -= padY;
  hi += padY;
  const x = (i) => PAD.l + (points.length === 1 ? (W - PAD.l - PAD.r) / 2 : (i * (W - PAD.l - PAD.r)) / (points.length - 1));
  const y = (v) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const s = points[Math.min(sel, points.length - 1)];
  const sx = x(Math.min(sel, points.length - 1));
  const first = points[0].value;
  const last = points.at(-1).value;
  const change = last - first;
  const tone = !better || Math.abs(change) < 1e-9 ? 'flat' : (change > 0) === (better === 'up') ? 'good' : 'bad';
  const tipW = 104;
  const tipX = Math.max(PAD.l, Math.min(W - PAD.r - tipW, sx - tipW / 2));

  return (
    <figure className="trend">
      <figcaption className="trend-head">
        <span className="trend-title">{title}</span>
        {points.length > 1 && (
          <span className={`trend-change trend-${tone}`}>
            {tone === 'good' ? '▲' : tone === 'bad' ? '▼' : '•'} {change >= 0 ? '+' : ''}
            {format(change, true)} overall
          </span>
        )}
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="trend-svg" role="img" aria-label={`${title}: ${points.map((p) => `${dateLabel(p.date)} ${format(p.value)}`).join(', ')}`}>
        <defs>
          <linearGradient id={`fill${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.14" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {niceTicks(lo + padY, hi - padY).map((t, i) => (
          <g key={i}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="#eef2f5" strokeWidth="1" />
            <text x={PAD.l - 6} y={y(t) + 3.5} textAnchor="end" className="trend-axis">
              {format(t)}
            </text>
          </g>
        ))}
        <text x={PAD.l} y={H - 6} className="trend-axis">{dateLabel(points[0].date)}</text>
        {points.length > 1 && (
          <text x={W - PAD.r} y={H - 6} textAnchor="end" className="trend-axis">
            {dateLabel(points.at(-1).date)}
          </text>
        )}
        {points.length > 1 && <path d={`${path} L${x(points.length - 1)},${H - PAD.b} L${x(0)},${H - PAD.b} Z`} fill={`url(#fill${uid})`} />}
        {points.length > 1 && <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
        <line x1={sx} x2={sx} y1={PAD.t - 4} y2={H - PAD.b} stroke="#cbd5e1" strokeWidth="1" strokeDasharray="2 3" />
        {points.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.value)} r={i === sel ? 5 : 4} fill={i === sel ? color : '#fff'} stroke={i === sel ? '#fff' : color} strokeWidth="2" />
        ))}
        <g transform={`translate(${tipX},2)`} className="trend-tip">
          <rect width={tipW} height="18" rx="9" fill="#0f172a" />
          <text x={tipW / 2} y="12.5" textAnchor="middle" fill="#fff">
            {format(s.value)} · {dateLabel(s.date)}
          </text>
        </g>
        {points.map((p, i) => {
          const left = i === 0 ? PAD.l - 10 : (x(i - 1) + x(i)) / 2;
          const right = i === points.length - 1 ? W : (x(i) + x(i + 1)) / 2;
          return (
            <rect
              key={`hit${i}`}
              x={left}
              y={0}
              width={Math.max(8, right - left)}
              height={H}
              fill="transparent"
              onMouseEnter={() => setSel(i)}
              onClick={() => setSel(i)}
              style={{ cursor: 'pointer' }}
            />
          );
        })}
      </svg>
      <table className="sr-only">
        <caption>{title}</caption>
        <tbody>
          {points.map((p, i) => (
            <tr key={i}>
              <td>{dateLabel(p.date)}</td>
              <td>{format(p.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** Small bar chart for counts per period (e.g. training days per week). */
export function MiniBars({ title, bars, max, formatLabel, note }) {
  const top = Math.max(max || 0, ...bars.map((b) => b.value), 1);
  const bw = (W - PAD.l - PAD.r) / bars.length;
  const h = 110;
  const base = h - 20;
  return (
    <figure className="trend">
      <figcaption className="trend-head">
        <span className="trend-title">{title}</span>
        {note && <span className="trend-change trend-flat">{note}</span>}
      </figcaption>
      <svg viewBox={`0 0 ${W} ${h}`} className="trend-svg" role="img" aria-label={`${title}: ${bars.map((b) => `${formatLabel(b)} ${b.value}`).join(', ')}`}>
        <line x1={PAD.l} x2={W - PAD.r} y1={base} y2={base} stroke="#e6eaef" />
        {bars.map((b, i) => {
          const bh = (b.value / top) * (base - 16);
          const bx = PAD.l + i * bw + 2;
          return (
            <g key={i}>
              {b.value > 0 && <rect x={bx} y={base - bh} width={bw - 4} height={bh} rx="4" fill={b.highlight ? '#10b981' : '#a7f3d0'} />}
              <text x={bx + (bw - 4) / 2} y={base - bh - 4} textAnchor="middle" className="trend-axis">
                {b.value}
              </text>
              <text x={bx + (bw - 4) / 2} y={h - 6} textAnchor="middle" className="trend-axis">
                {formatLabel(b)}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
