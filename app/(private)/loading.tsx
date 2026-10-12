export default function PrivatePageLoading() {
  return (
    <section
      aria-atomic="true"
      aria-busy="true"
      aria-labelledby="private-page-loading-title"
      aria-live="polite"
      className="max-w-3xl rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6"
      role="status"
    >
      <h1 className="text-2xl font-semibold" id="private-page-loading-title">
        Loading private page
      </h1>
      <p className="mt-3 leading-7 text-[var(--muted)]">
        Retrieving the latest available private snapshot. Data freshness and
        coverage will be shown when the page is ready.
      </p>
    </section>
  );
}
