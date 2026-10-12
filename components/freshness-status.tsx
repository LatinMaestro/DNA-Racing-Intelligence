import Link from "next/link";

type FreshnessStatusProps = {
  source: "Race" | "Vault" | "Arena" | "Core";
};

const sourceWorkspaces = {
  Core: {
    href: "/core-intelligence?evidence=normal",
    label: "Explore Core performance",
  },
  Race: { href: "/search-core", label: "Search race history" },
  Arena: { href: "/breeding", label: "Review Arena-linked breeding" },
  Vault: { href: "/vault", label: "Open My Vault" },
} as const;

export function FreshnessStatus({ source }: FreshnessStatusProps) {
  const workspace = sourceWorkspaces[source];
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
            Dashboard timestamp receipt not connected.
          </p>
        </div>
        <span className="rounded-full border border-[var(--border)] px-3 py-1 text-xs text-[var(--muted)]">
          Freshness unknown here
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
      <Link
        className="mt-4 inline-flex rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-semibold text-[var(--accent)] hover:bg-[var(--surface-raised)]"
        href={workspace.href}
      >
        {workspace.label}
      </Link>
    </section>
  );
}
