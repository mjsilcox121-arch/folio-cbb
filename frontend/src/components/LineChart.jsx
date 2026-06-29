// src/components/LineChart.jsx
// Interactive SVG line chart with hover tooltip, used in team modal and portfolio page.

import { useState, useRef, useCallback } from "react";

export default function LineChart({ data, labels, color = "#1D9E75", height = 120, currentIdx = null, tooltipRows = null }) {
  const [hovIdx, setHovIdx] = useState(null);
  const svgRef = useRef(null);

  if (!data || data.length < 2) return null;
  const W = 560, H = height;
  const pad = { top: 10, right: 10, bottom: 24, left: 44 };
  const iw = W - pad.left - pad.right, ih = H - pad.top - pad.bottom;
  const min = Math.min(...data), max = Math.max(...data), range = max - min || 1;
  const px = (i) => pad.left + (i / (data.length - 1)) * iw;
  const py = (v) => pad.top + ih - ((v - min) / range) * ih;
  const pts = data.map((v, i) => `${px(i)},${py(v)}`).join(" ");
  const area = `${px(0)},${pad.top + ih} ${pts} ${px(data.length - 1)},${pad.top + ih}`;
  const yT = Array.from({ length: 5 }, (_, i) => min + (range * i) / 4);
  const step = Math.max(1, Math.floor(data.length / 5));
  const xIdx = data.map((_, i) => (i % step === 0 || i === data.length - 1) ? i : null).filter(i => i !== null);
  const gid = `g${color.replace(/\W/g, "")}${height}`;

  const handleMouseMove = useCallback((e) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const relX = (e.clientX - rect.left) * (W / rect.width) - pad.left;
    const idx = Math.round(relX / (iw / (data.length - 1)));
    if (idx >= 0 && idx < data.length) setHovIdx(idx);
    else setHovIdx(null);
  }, [data.length, iw]);

  const rawTip = hovIdx != null ? tooltipRows?.[hovIdx] : null;
  let tooltipLines = null;
  if (hovIdx != null) {
    if (Array.isArray(rawTip) && rawTip.length > 0) tooltipLines = rawTip;
    else if (typeof rawTip === "string" && rawTip) tooltipLines = [rawTip];
    else tooltipLines = [`Value: ${data[hovIdx].toFixed(2)}`];
  }
  const txRaw = hovIdx != null ? px(hovIdx) : 0;
  const tooltipW = 170;
  const tx = Math.min(Math.max(txRaw - tooltipW / 2, pad.left), W - tooltipW - 4);
  const tyBase = hovIdx != null ? py(data[hovIdx]) : 0;
  const tooltipH = tooltipLines ? 18 + tooltipLines.length * 16 : 0;
  const ty = tyBase - tooltipH - 12 < pad.top ? tyBase + 14 : tyBase - tooltipH - 12;

  return (
    <div style={{ position: "relative" }}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: "auto", display: "block", cursor: "crosshair" }}
        onMouseMove={handleMouseMove} onMouseLeave={() => setHovIdx(null)}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.15" />
            <stop offset="100%" stopColor={color} stopOpacity="0.01" />
          </linearGradient>
        </defs>
        <polygon points={area} fill={`url(#${gid})`} />
        {yT.map((t, i) => (
          <g key={i}>
            <line x1={pad.left} y1={py(t)} x2={pad.left + iw} y2={py(t)} stroke="#e8e4dc" strokeWidth="1" />
            <text x={pad.left - 6} y={py(t) + 4} textAnchor="end" fontSize="10" fill="#aaa">{t.toFixed(1)}</text>
          </g>
        ))}
        {xIdx.map((i) => (
          <text key={i} x={px(i)} y={H - 4} textAnchor="middle" fontSize="10" fill="#aaa">
            {labels?.[i]?.replace("Week ", "W").split(" ")[0] ?? `W${i + 1}`}
          </text>
        ))}
        <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {data.map((v, i) => (
          <circle key={i} cx={px(i)} cy={py(v)}
            r={i === hovIdx ? 6 : i === currentIdx ? 4.5 : 2.5}
            fill={i === hovIdx ? color : i === currentIdx ? color : "#fff"}
            stroke={color} strokeWidth="1.5" style={{ transition: "r 0.1s" }} />
        ))}
        {hovIdx != null && (
          <line x1={px(hovIdx)} y1={pad.top} x2={px(hovIdx)} y2={pad.top + ih}
            stroke={color} strokeWidth="1" strokeDasharray="3 3" opacity="0.5" />
        )}
        {tooltipLines && hovIdx != null && (
          <g>
            <rect x={tx} y={ty} width={tooltipW} height={tooltipH} rx="5" ry="5"
              fill="#0d1b2a" opacity="0.88" />
            <text x={tx + 8} y={ty + 13} fontSize="10" fill="#aaa" fontFamily="Arial">
              {labels?.[hovIdx] ?? `W${hovIdx + 1}`}
            </text>
            {tooltipLines.map((line, li) => (
              <text key={li} x={tx + 8} y={ty + 13 + (li + 1) * 16} fontSize="11" fill="#fff" fontFamily="Arial">{line}</text>
            ))}
          </g>
        )}
      </svg>
    </div>
  );
}
