import type { MaidenVaultAllocation } from "@/domain/maiden-vault-allocation";
import type { MaidenWorkspaceConnectionStatus } from "@/lib/maiden-workspace-service";

const connectionCopy: Record<
  MaidenWorkspaceConnectionStatus,
  Readonly<{ heading: string; detail: string }>
> = {
  identity_not_connected: {
    heading: "Owner identity not connected",
    detail:
      "Maiden evidence remains unavailable until the signed-in owner is verified against the server-side allowlist.",
  },
  persistence_not_configured: {
    heading: "Maiden read model not connected",
    detail:
      "Owner verification is available, but the compact private allocation repository is not configured. No raw history is scanned on this page.",
  },
  read_model_connected: {
    heading: "Current Maiden review evidence connected",
    detail:
      "The current Vault snapshot and experimental projections support review only. They do not prove historical entitlement or authorise commitment.",
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

function valueIndex(basisPoints: number): string {
  return `${basisPoints.toLocaleString("en-AU")} / 10,000`;
}

export function MaidenWorkspace({
  allocation,
  lastImportedAt,
  connectionStatus,
}: Readonly<{
  allocation: MaidenVaultAllocation | null;
  lastImportedAt: string | null;
  connectionStatus: MaidenWorkspaceConnectionStatus;
}>) {
  const connection = connectionCopy[connectionStatus];

  return (
    <div className="space-y-8">
      <header className="max-w-4xl">
        <p className="text-sm font-semibold text-[var(--accent)]">
          Phase 5 allocation review
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          Maiden strategy
        </h1>
        <p className="mt-4 text-base leading-7 text-[var(--muted)]">
          Compare the strongest credible Bike, Car and Horse opportunities
          across the Vault. Maiden eligibility is preserved for the strongest
          projected mode-specific opportunity, not the first available event.
        </p>
      </header>

      <section
        aria-labelledby="maiden-connection"
        className="rounded-2xl border border-[var(--warning)]/50 bg-[var(--surface-raised)] p-6"
      >
        <h2 className="text-lg font-semibold" id="maiden-connection">
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
          Maiden commitment unavailable
        </button>
      </section>

      <section aria-labelledby="maiden-allocation">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold" id="maiden-allocation">
              Experimental Vault allocation
            </h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Current replacement snapshot · Last imported{" "}
              {timestamp(lastImportedAt)}
            </p>
          </div>
          <span className="rounded-full border border-[var(--border)] px-3 py-1 text-xs font-semibold text-[var(--warning)]">
            Gates C and D not passed
          </span>
        </div>

        {allocation === null ? (
          <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6">
            <h3 className="font-semibold">No accepted Maiden evidence</h3>
            <p className="mt-3 max-w-3xl leading-7 text-[var(--muted)]">
              Missing allocation evidence is unavailable. It does not mean no
              cores are Maiden eligible or that no future tournament is
              suitable.
            </p>
          </div>
        ) : (
          <div className="mt-4 space-y-5">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5">
              <h3 className="font-semibold">Provisional review set</h3>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                {allocation.assignments.length.toLocaleString("en-AU")}{" "}
                provisional allocation
                {allocation.assignments.length === 1 ? "" : "s"} · no
                entitlement mutation · no live field
              </p>
              <p className="mt-2 text-sm text-[var(--warning)]">
                {allocation.warnings.map(label).join(" · ")}
              </p>
            </div>

            {allocation.candidates.length === 0 ? (
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5">
                <h3 className="font-semibold">
                  No candidates in configured brackets
                </h3>
              </div>
            ) : (
              <ul className="grid gap-4 xl:grid-cols-2">
                {allocation.candidates.map((candidate) => (
                  <li
                    className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5"
                    key={candidate.candidateId}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-bold tracking-wider text-[var(--accent)] uppercase">
                          {candidate.mode} · {candidate.tournamentLabel}
                        </p>
                        <h3 className="mt-2 text-lg font-semibold">
                          Core {candidate.coreId}
                        </h3>
                      </div>
                      <span className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--muted)]">
                        {label(candidate.status)}
                      </span>
                    </div>
                    <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
                      <div>
                        <dt className="text-[var(--muted)]">Bracket</dt>
                        <dd className="mt-1 font-semibold">
                          {candidate.bracketLabel}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[var(--muted)]">
                          Experimental time-led value index
                        </dt>
                        <dd className="mt-1 font-semibold">
                          {valueIndex(candidate.projectedValueBasisPoints)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[var(--muted)]">Lifecycle</dt>
                        <dd className="mt-1 font-semibold">
                          {label(candidate.lifecycleState)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[var(--muted)]">Time evidence</dt>
                        <dd className="mt-1 font-semibold">
                          {label(candidate.timeEvidence)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[var(--muted)]">
                          Historical star support
                        </dt>
                        <dd className="mt-1 font-semibold">
                          {label(candidate.historicalStarSupport)} · supporting
                          only
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[var(--muted)]">
                          Cross-mode evidence
                        </dt>
                        <dd className="mt-1 font-semibold">
                          {candidate.crossModeEvidenceComplete
                            ? "Complete"
                            : "Incomplete"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[var(--muted)]">Freshness</dt>
                        <dd className="mt-1 font-semibold">
                          {label(candidate.freshness)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[var(--muted)]">
                          Data current through
                        </dt>
                        <dd className="mt-1 font-semibold">
                          {timestamp(candidate.dataCurrentThrough)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[var(--muted)]">
                          Evidence binding
                        </dt>
                        <dd className="mt-1 font-semibold">
                          Snapshot {candidate.candidateSnapshotVersion} ·
                          Projection {candidate.projectionVersion}
                        </dd>
                      </div>
                    </dl>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
