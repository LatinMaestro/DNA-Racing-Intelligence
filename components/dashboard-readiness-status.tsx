import Link from "next/link";

import type { DashboardReadinessPageState } from "@/lib/dashboard-readiness-service";

const statusCopy = {
  identity_not_connected: {
    badge: "Identity not connected",
    detail:
      "Commissioning evidence remains unavailable until the signed-in owner matches the server-side allowlist.",
  },
  persistence_not_configured: {
    badge: "Evidence not connected",
    detail:
      "The compact owner-scoped readiness assessment repository is not configured here.",
  },
  assessment_unavailable: {
    badge: "Assessment unavailable",
    detail:
      "No accepted exact-head readiness assessment is published. Missing evidence remains review-required.",
  },
  assessment_read_failed: {
    badge: "Assessment read failed",
    detail:
      "Readiness evidence could not be verified. No cached, stale or inferred replacement is treated as accepted.",
  },
  assessment_integrity_failed: {
    badge: "Assessment integrity failed",
    detail:
      "The persisted assessment failed exact-head or publication-integrity checks. All readiness gates remain withheld and no missing value is treated as a pass.",
  },
  assessment_connected: {
    badge: "Assessment connected",
    detail:
      "The latest owner-scoped exact-head assessment passed repository and publication-integrity checks.",
  },
} as const;

function label(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function timestamp(value: string | null): string {
  if (value === null) return "Not available";
  return value.replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

export function DashboardReadinessStatus({
  state,
}: Readonly<{ state: DashboardReadinessPageState }>) {
  const copy = statusCopy[state.connectionStatus];
  const checkCounts = state.readiness?.checks.reduce(
    (counts, check) => ({
      ...counts,
      [check.status]: counts[check.status] + 1,
    }),
    { pass: 0, review: 0, block: 0 },
  );

  return (
    <section
      aria-labelledby="dashboard-readiness-heading"
      className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            className="text-xl font-semibold"
            id="dashboard-readiness-heading"
          >
            Commissioning readiness
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
            {copy.detail}
          </p>
        </div>
        <span className="rounded-full border border-[var(--border)] px-3 py-1 text-xs font-semibold text-[var(--warning)]">
          {copy.badge}
        </span>
      </div>

      <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
        <div>
          <dt className="text-[var(--muted)]">Overall state</dt>
          <dd className="mt-1 font-semibold">
            {state.readiness === null
              ? "Not assessed"
              : label(state.readiness.status)}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Evidence current through</dt>
          <dd className="mt-1 font-semibold">
            {timestamp(state.evidenceCurrentThrough)}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Freshness</dt>
          <dd className="mt-1 font-semibold">
            {state.evidenceFreshness === null
              ? "Unknown"
              : label(state.evidenceFreshness)}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Checks</dt>
          <dd className="mt-1 font-semibold">
            {checkCounts === undefined
              ? "Not available"
              : `${checkCounts.pass} pass · ${checkCounts.review} review · ${checkCounts.block} block`}
          </dd>
        </div>
      </dl>

      {state.exactHeadSha === null ? null : (
        <p className="mt-4 break-all font-mono text-xs text-[var(--muted)]">
          Exact assessed head: {state.exactHeadSha}
        </p>
      )}
      <p className="mt-4 text-xs leading-5 text-[var(--muted)]">
        This summary is read-only. It cannot deploy, enable Production or change
        provider settings.
      </p>
      <Link
        className="mt-4 inline-flex rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-semibold text-[var(--accent)] hover:bg-[var(--surface)]"
        href="/readiness"
      >
        Review readiness evidence
      </Link>
    </section>
  );
}
