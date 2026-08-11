import type { DiscoveryProbeCandidate } from "@/domain/discovery-probe-plan";
import type { DiscoveryWorkspaceConnectionStatus } from "@/lib/discovery-workspace-service";

const connectionCopy: Record<
  DiscoveryWorkspaceConnectionStatus,
  Readonly<{ heading: string; detail: string }>
> = {
  identity_not_connected: {
    heading: "Owner identity not connected",
    detail:
      "Discovery evidence remains unavailable until the signed-in owner is verified against the server-side allowlist.",
  },
  persistence_not_configured: {
    heading: "Discovery read model not connected",
    detail:
      "Owner verification is available, but the manual Vault, performance and lineage repositories are not configured. No raw history is scanned on this page.",
  },
  read_model_connected: {
    heading: "Owned-core Discovery planner connected",
    detail:
      "Candidates come only from active My Vault cores, imported historical performance and validated lineage evidence in the approved priority order, from close family through wider lineage. Recommendations remain advisory and never enter races automatically.",
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

function timestamp(value: string | null): string {
  if (value === null) return "Not available";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Not available";
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(parsed);
}

export function DiscoveryWorkspace({
  candidates,
  lastImportedAt,
  connectionStatus,
}: Readonly<{
  candidates: readonly DiscoveryProbeCandidate[];
  lastImportedAt: string | null;
  connectionStatus: DiscoveryWorkspaceConnectionStatus;
}>) {
  const connection = connectionCopy[connectionStatus];

  return (
    <div className="space-y-8">
      <header className="max-w-4xl">
        <p className="text-sm font-semibold text-[var(--accent)]">
          Owned-core testing planner
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          Discovery
        </h1>
        <p className="mt-4 text-base leading-7 text-[var(--muted)]">
          Prioritise efficient testing of active My Vault cores. Ten
          exact-distance races is the minimum analytical boundary, not proof of
          quality, and the initial probe is deliberately smaller than the full
          remaining sample.
        </p>
      </header>

      <section
        aria-labelledby="discovery-connection"
        className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6"
      >
        <h2 className="text-lg font-semibold" id="discovery-connection">
          {connection.heading}
        </h2>
        <p className="mt-3 max-w-4xl leading-7 text-[var(--muted)]">
          {connection.detail}
        </p>
      </section>

      <section aria-labelledby="discovery-plan">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold" id="discovery-plan">
              Recommended test probes
            </h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Historical snapshot · Last imported {timestamp(lastImportedAt)}
            </p>
          </div>
        </div>

        {candidates.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6">
            <h3 className="font-semibold">No current Discovery candidates</h3>
            <p className="mt-3 max-w-3xl leading-7 text-[var(--muted)]">
              No under-tested direct sample or validated close-family or wider
              lineage hypothesis is currently available. Population-pattern
              evidence remains outside this slice.
            </p>
          </div>
        ) : (
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            {candidates.map((candidate) => (
              <article
                className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5"
                key={JSON.stringify([
                  candidate.coreId,
                  candidate.mode,
                  candidate.distanceMetres,
                ])}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold tracking-wider text-[var(--accent)] uppercase">
                      {candidate.mode} ·{" "}
                      {candidate.distanceMetres.toLocaleString("en-AU")} m
                    </p>
                    <h3 className="mt-2 text-lg font-semibold">
                      {candidate.coreName}
                    </h3>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      Core ID {candidate.coreId}
                    </p>
                  </div>
                  <span className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--muted)]">
                    {label(candidate.reviewPriority)} priority
                  </span>
                </div>

                <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-[var(--muted)]">
                      Current exact-distance sample
                    </dt>
                    <dd className="mt-1 font-semibold">
                      {candidate.directRaceCount.toLocaleString("en-AU")} races
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[var(--muted)]">Races to minimum 10</dt>
                    <dd className="mt-1 font-semibold">
                      {candidate.observationsToMinimum.toLocaleString("en-AU")}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[var(--muted)]">
                      Recommended next probe
                    </dt>
                    <dd className="mt-1 font-semibold">
                      {candidate.recommendedInitialProbeSize === 0
                        ? "No probe recommended"
                        : `${candidate.recommendedInitialProbeSize} race${candidate.recommendedInitialProbeSize === 1 ? "" : "s"}`}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[var(--muted)]">Guidance</dt>
                    <dd className="mt-1 font-semibold">
                      {label(candidate.guidance)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[var(--muted)]">Maiden state</dt>
                    <dd className="mt-1 font-semibold">
                      {label(candidate.maidenState)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[var(--muted)]">Evidence basis</dt>
                    <dd className="mt-1 font-semibold">
                      {candidate.lineageRelationship === null
                        ? "Direct imported results"
                        : `${label(candidate.lineageRelationship)} hypothesis · ${candidate.lineageRaceCount.toLocaleString("en-AU")} lineage races`}
                    </dd>
                  </div>
                </dl>

                <div className="mt-5 border-t border-[var(--border)] pt-4 text-sm text-[var(--muted)]">
                  <p>
                    Data current through{" "}
                    {timestamp(candidate.dataCurrentThrough)} ·{" "}
                    {label(candidate.freshness)}
                  </p>
                  {candidate.warnings.length > 0 ? (
                    <p className="mt-1">
                      {candidate.warnings.map(label).join(" · ")}
                    </p>
                  ) : null}
                  <p className="mt-2">
                    Reassess after the probe. Lineage nominates a test only; it
                    does not replace direct evidence or prove performance.
                  </p>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
