type FreshnessStatusProps = {
  source: "Race" | "Vault" | "Arena" | "Core";
};

export function FreshnessStatus({ source }: FreshnessStatusProps) {
  return (
    <section
      aria-label={`${source} data freshness`}
      className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold tracking-wider text-[var(--accent)] uppercase">
            {source} snapshot
          </p>
          <p className="mt-1 text-sm text-[var(--muted)]">
            No accepted import in this scaffold.
          </p>
        </div>
        <span className="rounded-full border border-[var(--border)] px-3 py-1 text-xs font-semibold text-[var(--warning)]">
          Awaiting data foundation
        </span>
      </div>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-[var(--muted)]">Data current through</dt>
          <dd className="mt-1 font-medium">Not available</dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Last imported</dt>
          <dd className="mt-1 font-medium">Not available</dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Freshness</dt>
          <dd className="mt-1 font-medium">Unknown</dd>
        </div>
      </dl>
      <p className="mt-4 text-xs leading-5 text-[var(--muted)]">
        Imported data will be labelled as a historical snapshot, never as live
        game state.
      </p>
    </section>
  );
}
