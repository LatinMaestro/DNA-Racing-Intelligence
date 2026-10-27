import Link from "next/link";

import type { MaidenVaultAllocation } from "@/domain/maiden-vault-allocation";
import type {
  MaidenEligibilitySummary,
  MaidenWorkspaceConnectionStatus,
} from "@/lib/maiden-workspace-service";

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
  materializedAt,
  snapshotSha256,
  sourceEvidenceSha256,
  connectionStatus,
  eligibilitySummary = null,
}: Readonly<{
  allocation: MaidenVaultAllocation | null;
  lastImportedAt: string | null;
  materializedAt: string | null;
  snapshotSha256: string | null;
  sourceEvidenceSha256: string | null;
  connectionStatus: MaidenWorkspaceConnectionStatus;
  eligibilitySummary?: MaidenEligibilitySummary | null;
}>) {
  const connection = connectionCopy[connectionStatus];
  const allocationByCore = new Map(
    (allocation?.candidates ?? []).map((candidate) => [
      candidate.coreId,
      candidate,
    ]),
  );

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

      <section aria-labelledby="maiden-eligibility">
        <h2 className="text-xl font-semibold" id="maiden-eligibility">
          Current Vault Maiden eligibility
        </h2>
        {eligibilitySummary === null ? (
          <p className="mt-3 text-[var(--muted)]">
            Owner-scoped Vault eligibility evidence is unavailable.
          </p>
        ) : (
          <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5">
            <dl className="grid gap-4 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-[var(--muted)]">Owned Cores</dt>
                <dd className="mt-1 text-lg font-semibold">
                  {eligibilitySummary.ownedCoreCount.toLocaleString("en-AU")}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Known eligible</dt>
                <dd className="mt-1 text-lg font-semibold">
                  {eligibilitySummary.knownEligibleCount.toLocaleString(
                    "en-AU",
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Known not eligible</dt>
                <dd className="mt-1 text-lg font-semibold">
                  {eligibilitySummary.knownNotEligibleCount.toLocaleString(
                    "en-AU",
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Eligibility unknown</dt>
                <dd className="mt-1 text-lg font-semibold">
                  {eligibilitySummary.unknownEligibilityCount.toLocaleString(
                    "en-AU",
                  )}
                </dd>
              </div>
            </dl>
            <p className="mt-4 text-sm leading-6 text-[var(--muted)]">
              Unknown means the accepted owner snapshot does not publish Maiden
              eligibility. It must not be treated as eligible or ineligible.
            </p>
            {eligibilitySummary.generationId === null ? null : (
              <p className="mt-2 break-all font-mono text-xs text-[var(--muted)]">
                Accepted owner generation: {eligibilitySummary.generationId} ·
                observed {timestamp(eligibilitySummary.oldestObservedAt)} to{" "}
                {timestamp(eligibilitySummary.newestObservedAt)}
              </p>
            )}
            <details className="mt-5 border-t border-[var(--border)] pt-4">
              <summary className="cursor-pointer font-semibold">
                View individual Core eligibility
              </summary>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="text-[var(--muted)]">
                    <tr>
                      <th className="pb-3 pr-4 font-medium">Core</th>
                      <th className="pb-3 pr-4 font-medium">Eligibility</th>
                      <th className="pb-3 pr-4 font-medium">Profile</th>
                      <th className="pb-3 font-medium">
                        Accepted strategy evidence
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {eligibilitySummary.cores.map((core) => {
                      const candidate = allocationByCore.get(core.sourceCoreId);
                      return (
                        <tr
                          className="border-t border-[var(--border)] align-top"
                          key={core.sourceCoreId}
                        >
                          <td className="py-3 pr-4">
                            <Link
                              className="font-semibold text-[var(--accent)] hover:underline"
                              href={`/search-core?q=${encodeURIComponent(core.sourceCoreId)}&coreId=${encodeURIComponent(core.sourceCoreId)}`}
                            >
                              {core.displayName}
                            </Link>
                            <span className="mt-1 block font-mono text-xs text-[var(--muted)]">
                              {core.sourceCoreId}
                            </span>
                          </td>
                          <td className="py-3 pr-4 font-semibold">
                            {core.meEligible === true
                              ? "Eligible"
                              : core.meEligible === false
                                ? "Not eligible"
                                : "Unknown"}
                          </td>
                          <td className="py-3 pr-4 text-[var(--muted)]">
                            {core.coreClass} · {core.element} · F{core.fNumber}{" "}
                            · {label(core.sex)}
                          </td>
                          <td className="py-3 text-[var(--muted)]">
                            {candidate === undefined
                              ? "Mode and exact distance unavailable — no accepted Maiden allocation evidence."
                              : `${label(candidate.mode)} · ${candidate.bracketLabel}. Exact distance unavailable in the accepted snapshot.`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </details>
          </div>
        )}
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
            {sourceEvidenceSha256 === null ? null : (
              <p className="mt-2 break-all font-mono text-xs text-[var(--muted)]">
                Accepted source SHA-256: {sourceEvidenceSha256} · Snapshot{" "}
                {snapshotSha256} · Materialized {materializedAt}
              </p>
            )}
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
                    <Link
                      aria-label={`View Core ${candidate.coreId} racing history`}
                      className="mt-3 inline-flex rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-semibold text-[var(--accent)] hover:bg-[var(--surface)]"
                      href={`/search-core?q=${encodeURIComponent(
                        candidate.coreId,
                      )}&coreId=${encodeURIComponent(candidate.coreId)}`}
                    >
                      View Core profile
                    </Link>
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
