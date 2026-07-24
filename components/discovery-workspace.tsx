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
      "Owner verification is available, but the compact private candidate repository is not configured. No raw history is scanned on this page.",
  },
  read_model_connected: {
    heading: "Historical Discovery evidence connected",
    detail:
      "The review queue describes exact-distance evidence gaps. It does not authorise race entry, automatic stopping or a quality claim.",
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
          Phase 3 evidence review
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          Discovery
        </h1>
        <p className="mt-4 text-base leading-7 text-[var(--muted)]">
          Review exact core, mode and distance evidence gaps. Ten races is a
          minimum coverage boundary, direct results remain primary and resolved
          lineage supplies hypotheses only.
        </p>
      </header>

      <section
        aria-labelledby="discovery-connection"
        className="rounded-2xl border border-[var(--warning)]/50 bg-[var(--surface-raised)] p-6"
      >
        <h2 className="text-lg font-semibold" id="discovery-connection">
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
          Race entry unavailable
        </button>
      </section>

      <section aria-labelledby="discovery-plan">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold" id="discovery-plan">
              Experimental probe review
            </h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Historical snapshot · Last imported {timestamp(lastImportedAt)}
            </p>
          </div>
          <span className="rounded-full border border-[var(--border)] px-3 py-1 text-xs font-semibold text-[var(--warning)]">
            Gate C not passed
          </span>
        </div>

        {candidates.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6">
            <h3 className="font-semibold">No accepted Discovery candidates</h3>
            <p className="mt-3 max-w-3xl leading-7 text-[var(--muted)]">
              Missing candidate evidence is unavailable. It does not mean every
              core has sufficient coverage or that no Discovery work remains.
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
                      Core {candidate.coreId}
                    </h3>
                  </div>
                  <span className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--muted)]">
                    {label(candidate.reviewPriority)} review
                  </span>
                </div>

                <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-[var(--muted)]">Direct races</dt>
                    <dd className="mt-1 font-semibold">
                      {candidate.directRaceCount.toLocaleString("en-AU")}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[var(--muted)]">
                      Observations to minimum
                    </dt>
                    <dd className="mt-1 font-semibold">
                      {candidate.observationsToMinimum.toLocaleString("en-AU")}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[var(--muted)]">Evidence purpose</dt>
                    <dd className="mt-1 font-semibold">
                      {label(candidate.evidencePurpose)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[var(--muted)]">Lineage context</dt>
                    <dd className="mt-1 font-semibold">
                      {candidate.lineageRelationship === null
                        ? "Not available"
                        : label(candidate.lineageRelationship)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[var(--muted)]">
                      Tournament relevance
                    </dt>
                    <dd className="mt-1 font-semibold">
                      {label(candidate.tournamentRelevance)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[var(--muted)]">Maiden state</dt>
                    <dd className="mt-1 font-semibold">
                      {label(candidate.maidenState)}
                    </dd>
                  </div>
                </dl>

                <div className="mt-5 border-t border-[var(--border)] pt-4 text-sm text-[var(--muted)]">
                  <p>
                    Data current through{" "}
                    {timestamp(candidate.dataCurrentThrough)} ·{" "}
                    {label(candidate.freshness)}
                  </p>
                  <p className="mt-1">
                    {candidate.warnings.map(label).join(" · ")}
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
