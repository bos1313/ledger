"use client";

import { useMemo, useRef, useState } from "react";

type Point = { date: string; rate: string };

const W = 720;
const H = 260;
const M = { top: 16, right: 64, bottom: 28, left: 56 };
const PLOT_W = W - M.left - M.right;
const PLOT_H = H - M.top - M.bottom;

const fmtRate = (n: number) => n.toLocaleString("hr-HR", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const fmtDay = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}. ${m}. ${y}.`;
};
const fmtShort = (iso: string, withYear: boolean) => {
  const [y, m, d] = iso.split("-");
  return withYear ? `${d}. ${m}. ${y}.` : `${d}. ${m}.`;
};

/**
 * Line chart of one rate over time, plain SVG (no chart library).
 * Rates arrive as exact decimal strings; converting to Number here is fine because it is
 * only used to place pixels, never to calculate money.
 */
export function RateChart({ points, label }: { points: Point[]; label: string }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [active, setActive] = useState<number | null>(null);

  const geo = useMemo(() => {
    const values = points.map((p) => Number(p.rate));
    const min = Math.min(...values);
    const max = Math.max(...values);
    const pad = (max - min || max * 0.01) * 0.1;
    const lo = min - pad;
    const hi = max + pad;
    const x = (i: number) => M.left + (points.length === 1 ? PLOT_W / 2 : (i / (points.length - 1)) * PLOT_W);
    const y = (v: number) => M.top + (1 - (v - lo) / (hi - lo)) * PLOT_H;
    const line = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
    const area = `${line}L${x(values.length - 1).toFixed(1)},${M.top + PLOT_H}L${x(0).toFixed(1)},${M.top + PLOT_H}Z`;
    const yTicks = [0, 1, 2, 3].map((k) => lo + ((hi - lo) * (k + 0.5)) / 4);
    const xTicks = [...new Set([0, Math.round((points.length - 1) / 2), points.length - 1])];
    return { values, x, y, line, area, yTicks, xTicks };
  }, [points]);

  if (points.length === 0) return <p className="muted">Nema podataka za odabrano razdoblje.</p>;

  const last = points.length - 1;
  const shown = active ?? last;
  const longRange = Date.parse(points[last].date) - Date.parse(points[0].date) > 180 * 86_400_000;

  function onPointerMove(e: React.PointerEvent<SVGRectElement>) {
    const box = svgRef.current!.getBoundingClientRect();
    const svgX = ((e.clientX - box.left) / box.width) * W;
    const i = Math.round(((svgX - M.left) / PLOT_W) * last);
    setActive(Math.min(Math.max(i, 0), last));
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowLeft") setActive((a) => Math.max((a ?? last) - 1, 0));
    else if (e.key === "ArrowRight") setActive((a) => Math.min((a ?? last) + 1, last));
    else if (e.key === "Escape") setActive(null);
    else return;
    e.preventDefault();
  }

  const tipLeftPct = (geo.x(shown) / W) * 100;

  return (
    <div className="chart">
      <div className="chart-plot">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`${label}: od ${fmtDay(points[0].date)} do ${fmtDay(points[last].date)}, zadnji tečaj ${fmtRate(geo.values[last])}`}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onBlur={() => setActive(null)}
        >
          {geo.yTicks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={M.left + PLOT_W} y1={geo.y(t)} y2={geo.y(t)} className="grid" />
              <text x={M.left - 8} y={geo.y(t)} className="tick" textAnchor="end" dominantBaseline="middle">
                {fmtRate(t)}
              </text>
            </g>
          ))}
          {geo.xTicks.map((i) => (
            <text
              key={i}
              x={geo.x(i)}
              y={H - 8}
              className="tick"
              textAnchor={i === 0 ? "start" : i === last ? "end" : "middle"}
            >
              {fmtShort(points[i].date, longRange)}
            </text>
          ))}

          <path d={geo.area} className="area" />
          <path d={geo.line} className="line" />

          {/* Selective direct label: only the latest value. */}
          <circle cx={geo.x(last)} cy={geo.y(geo.values[last])} r={4} className="dot" />
          {active === null && (
            <text x={geo.x(last) + 10} y={geo.y(geo.values[last])} className="end-label" dominantBaseline="middle">
              {fmtRate(geo.values[last])}
            </text>
          )}

          {active !== null && (
            <g pointerEvents="none">
              <line x1={geo.x(active)} x2={geo.x(active)} y1={M.top} y2={M.top + PLOT_H} className="crosshair" />
              <circle cx={geo.x(active)} cy={geo.y(geo.values[active])} r={5} className="dot" />
            </g>
          )}

          {/* Hit target: the whole plot, so the reader aims at a date, not at a 2px line. */}
          <rect
            x={M.left}
            y={M.top}
            width={PLOT_W}
            height={PLOT_H}
            fill="transparent"
            onPointerMove={onPointerMove}
            onPointerLeave={() => setActive(null)}
          />
        </svg>

        {active !== null && (
          <div className="chart-tip" style={{ left: `${tipLeftPct}%` }} role="status">
            <strong>{fmtRate(geo.values[active])}</strong>
            <span>{fmtDay(points[active].date)}</span>
          </div>
        )}
      </div>

      <details className="chart-table">
        <summary>Prikaži kao tablicu</summary>
        <table>
          <thead>
            <tr>
              <th>Datum</th>
              <th className="num">{label}</th>
            </tr>
          </thead>
          <tbody>
            {[...points].reverse().map((p) => (
              <tr key={p.date}>
                <td>{fmtDay(p.date)}</td>
                <td className="num">{fmtRate(Number(p.rate))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
