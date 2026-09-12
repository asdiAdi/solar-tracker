export default function LoadingSpinner({
  label = "Loading",
}: {
  label?: string;
}) {
  return (
    <span className="loading-spinner" role="status" aria-label={label}>
      <span className="loading-spinner-ring" aria-hidden="true" />
      <span className="visually-hidden">{label}…</span>
    </span>
  );
}
