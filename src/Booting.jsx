/**
 * The Suspense fallback.
 *
 * Its own module so the entry point contains no component definition — which
 * also keeps React Fast Refresh working in development.
 */
export default function Booting({ label = "Loading…" }) {
  return (
    <div
      style={{
        display: "grid",
        placeItems: "center",
        minHeight: "60vh",
        color: "var(--ink-500)",
        font: "400 0.95rem/1.5 var(--font-body), system-ui, sans-serif",
      }}
      role="status"
    >
      {label}
    </div>
  );
}
