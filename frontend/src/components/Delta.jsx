// src/components/Delta.jsx
// Small badge that displays a positive/negative numeric change.

export default function Delta({ value }) {
  if (value == null || value === 0) return <span className="delta neutral">—</span>;
  return (
    <span className={`delta ${value > 0 ? "up" : "down"}`}>
      {value > 0 ? "▲" : "▼"} {Math.abs(value).toFixed(2)}
    </span>
  );
}
