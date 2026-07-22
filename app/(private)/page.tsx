import { FreshnessStatus } from "@/components/freshness-status";

const readiness = [
  [
    "Recommendations",
    "No analytical recommendations are generated in Phase 0.",
  ],
  [
    "Economic reporting",
    "No figures are shown until validated ledger records exist.",
  ],
  ["Production", "Disabled pending explicit Gate F approval."],
] as const;

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <header className="max-w-4xl">
        <p className="text-sm font-semibold text-[var(--accent)]">
          Private dashboard foundation
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-5xl">
          Evidence before recommendations.
        </h1>
        <p className="mt-5 max-w-3xl text-base leading-7 text-[var(--muted)]">
          Phase 0 establishes secure boundaries, audit language and module
          structure without inventing race intelligence or vault profit.
        </p>
      </header>
      <div className="grid gap-4 xl:grid-cols-3">
        <FreshnessStatus source="Race" />
        <FreshnessStatus source="Vault" />
        <FreshnessStatus source="Arena" />
      </div>
      <section
        aria-labelledby="readiness-heading"
        className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6"
      >
        <h2 className="text-xl font-semibold" id="readiness-heading">
          Phase 0 controls
        </h2>
        <dl className="mt-5 grid gap-5 md:grid-cols-3">
          {readiness.map(([term, description]) => (
            <div key={term}>
              <dt className="font-semibold text-[var(--accent)]">{term}</dt>
              <dd className="mt-2 text-sm leading-6 text-[var(--muted)]">
                {description}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
