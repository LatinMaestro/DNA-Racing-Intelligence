import type { PrivateProductionReadiness } from "@/domain/private-production-readiness";
import type { ReadinessWorkspaceConnectionStatus } from "@/lib/readiness-workspace-service";

const connectionCopy: Record<
  ReadinessWorkspaceConnectionStatus,
  Readonly<{ heading: string; detail: string }>
> = {
  identity_not_connected: {
    heading: "Owner identity not connected",
    detail:
      "Readiness evidence remains unavailable until the signed-in owner is verified against the server-side allowlist.",
  },
  persistence_not_configured: {
    heading: "Readiness evidence not connected",
    detail:
      "Owner verification is available, but the compact exact-head assessment repository is not configured.",
  },
  read_model_connected: {
    heading: "Readiness evidence connected",
    detail:
      "This workspace reports evidence and blockers only. It cannot enable a provider, domain, public route or Production.",
  },
};

function label(value: string): string {
  return value
    .split("_")
    .map((part) => {
      const normalized = part.toLowerCase();
      return normalized.charAt(0).toUpperCase() + normalized.slice(1);
    })
    .join(" ");
}

export function ReadinessWorkspace({
  assessmentId,
  assessedAt,
  assessmentVersion,
  exactHeadSha,
  evidenceCurrentThrough,
  evidenceFreshness,
  readiness,
  connectionStatus,
}: Readonly<{
  assessmentId: string | null;
  assessedAt: string | null;
  assessmentVersion: string | null;
  exactHeadSha: string | null;
  evidenceCurrentThrough: string | null;
  evidenceFreshness: "current" | "ageing" | "stale" | null;
  readiness: PrivateProductionReadiness | null;
  connectionStatus: ReadinessWorkspaceConnectionStatus;
}>) {
  const connection = connectionCopy[connectionStatus];

  return (
    <div className="space-y-8">
      <header className="max-w-4xl">
        <p className="text-sm font-semibold text-[var(--accent)]">
          Phase 9 evidence review
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          Readiness
        </h1>
        <p className="mt-4 text-base leading-7 text-[var(--muted)]">
          Consolidate exact-head CI, protected imports, recovery, capacity,
          security, accessibility, migration and analytical gates without
          converting missing evidence into a pass.
        </p>
      </header>

      <section
        aria-labelledby="readiness-connection"
        className="rounded-2xl border border-[var(--warning)]/50 bg-[var(--surface-raised)] p-6"
      >
        <h2 className="text-lg font-semibold" id="readiness-connection">
          {connection.heading}
        </h2>
        <p className="mt-3 max-w-4xl leading-7 text-[var(--muted)]">
          {connection.detail}
        </p>
        <button
          className="mt-5 cursor-not-allowed rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-semibold text-[var(--muted)]"
          disabled
          type="button"
        >
          Production activation unavailable
        </button>
      </section>

      <section aria-labelledby="readiness-checks">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold" id="readiness-checks">
              Exact-head evidence
            </h2>
            <p className="mt-2 font-mono text-xs text-[var(--muted)]">
              {assessmentId === null
                ? "No accepted assessment"
                : `${assessmentId} · ${assessmentVersion} · ${exactHeadSha}`}
            </p>
            {evidenceCurrentThrough === null ? null : (
              <p className="mt-2 text-xs text-[var(--muted)]">
                Evidence current through {evidenceCurrentThrough} ·{" "}
                {label(evidenceFreshness ?? "unknown")} · Assessed{" "}
                {assessedAt ?? "Not available"}
              </p>
            )}
          </div>
          <span className="rounded-full border border-[var(--border)] px-3 py-1 text-xs font-semibold text-[var(--warning)]">
            {readiness === null ? "Not assessed" : label(readiness.status)}
          </span>
        </div>

        {readiness === null ? (
          <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6">
            <h3 className="font-semibold">No accepted readiness evidence</h3>
            <p className="mt-3 max-w-3xl leading-7 text-[var(--muted)]">
              Missing evidence remains review-required. Production stays
              disabled and fail-closed.
            </p>
          </div>
        ) : (
          <ul className="mt-4 grid gap-4 xl:grid-cols-2">
            {readiness.checks.map((check) => (
              <li
                className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5"
                key={check.code}
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-semibold">{label(check.code)}</h3>
                  <span className="text-xs font-semibold text-[var(--warning)]">
                    {label(check.status)}
                  </span>
                </div>
                <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
                  {check.detail}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
