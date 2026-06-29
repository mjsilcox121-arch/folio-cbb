// src/components/PieChart.jsx
// Donut pie chart and its legend, used on the portfolio page.

import { useState } from "react";

export function PieChart({ slices, size = 200 }) {
  const total = slices.reduce((s, sl) => s + sl.value, 0);
  const [hovered, setHovered] = useState(null);
  if (total <= 0) return <div className="pie-empty">No data yet.</div>;
  const cx = size / 2, cy = size / 2, r = size / 2 - 8, ri = r * 0.48;
  let angle = -Math.PI / 2;
  const paths = slices.map((sl, i) => {
    const sweep = (sl.value / total) * 2 * Math.PI;
    const a1 = angle, a2 = angle + sweep;
    const large = sweep > Math.PI ? 1 : 0;
    const ox1 = cx + r * Math.cos(a1), oy1 = cy + r * Math.sin(a1);
    const ox2 = cx + r * Math.cos(a2), oy2 = cy + r * Math.sin(a2);
    const ix1 = cx + ri * Math.cos(a2), iy1 = cy + ri * Math.sin(a2);
    const ix2 = cx + ri * Math.cos(a1), iy2 = cy + ri * Math.sin(a1);
    const d = `M ${ox1} ${oy1} A ${r} ${r} 0 ${large} 1 ${ox2} ${oy2} L ${ix1} ${iy1} A ${ri} ${ri} 0 ${large} 0 ${ix2} ${iy2} Z`;
    angle = a2;
    return { d, color: sl.color, label: sl.label, value: sl.value, pct: ((sl.value / total) * 100).toFixed(1), i };
  });
  const hov = hovered != null ? slices[hovered] : null;
  return (
    <div className="pie-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ overflow: "visible" }}>
        {paths.map((p) => (
          <path key={p.i} d={p.d} fill={p.color} stroke="#fff" strokeWidth="2"
            style={{ transform: hovered === p.i ? `scale(1.04)` : "scale(1)", transformOrigin: `${cx}px ${cy}px`, transition: "transform 0.15s", cursor: "pointer" }}
            onMouseEnter={() => setHovered(p.i)} onMouseLeave={() => setHovered(null)} />
        ))}
        <text x={cx} y={cy - 10} textAnchor="middle" fontSize="11" fill="#888" fontFamily="Arial">{hov ? hov.label : "Total"}</text>
        <text x={cx} y={cy + 8}  textAnchor="middle" fontSize="15" fill="#0d1b2a" fontFamily="Arial" fontWeight="700">
          {hov ? `$${hov.value.toFixed(2)}` : `$${total.toFixed(2)}`}
        </text>
        {hov && <text x={cx} y={cy + 24} textAnchor="middle" fontSize="11" fill="#aaa" fontFamily="Arial">{hov.pct}%</text>}
      </svg>
    </div>
  );
}

export function PieLegend({ slices, total }) {
  return (
    <div className="pie-legend">
      {slices.map((sl, i) => (
        <div key={i} className="legend-row">
          <span className="legend-dot" style={{ background: sl.color }} />
          <span className="legend-label">{sl.label}</span>
          <span className="legend-pct">{((sl.value / total) * 100).toFixed(1)}%</span>
          <span className="legend-val">${sl.value.toFixed(2)}</span>
        </div>
      ))}
    </div>
  );
}
