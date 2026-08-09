import { FreshnessStatus } from "@/components/freshness-status";

const readiness = [
  [
    "Recommendations",
    "Unavailable until accepted imports and validated analytical evidence are connected.",
  ],
  [
    "Economic reporting",
    "No figures are shown until validated ledger records exist.",
  ],
  [
    "Hosting",
    "Private hosting is active. Automatic Git deployments remain disabled.",
  ],
] as const;

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <header className="max-w-4xl">
        <p className="text-sm font-semibold text-[var(--accent)]">
          Private owner workspace
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-5xl">
          Evidence before recommendations.
        </h1>
        <p className="mt-5 max-w-3xl text-base leading-7 text-[var(--muted)]">
          The private workspace is online. Recommendations and financial totals
          remain evidence-gated until accepted imports and validated aggregates
          are connected.
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
          Current operating boundaries
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
