import type {
  DiscoveryDecisionCandidate,
  DiscoveryDecisionGuidance,
} from "@/domain/discovery-decision-guidance";
import { probeModes, type ProbeMode } from "@/domain/discovery-probe-plan";
import Link from "next/link";
import type {
  DiscoveryAcceptedHistoryCoverage,
  DiscoveryWorkspaceConnectionStatus,
} from "@/lib/discovery-workspace-service";
import type { DiscoveryBenchmarkPublication } from "@/lib/neon-discovery-benchmark-repository";
import {
  DiscoveryStudyWorkspace,
  type DiscoveryStudyFilters,
  type DiscoveryStudyView,
} from "./discovery-study-workspace";

export type DiscoveryCandidateTableFilters = Readonly<{
  query: string;
  mode: "all" | ProbeMode;
  guidance: "all" | DiscoveryDecisionGuidance;
  freshness: "all" | DiscoveryDecisionCandidate["freshness"];
  sort: "core" | "mode" | "distance" | "sample" | "priority" | "freshness";
  direction: "asc" | "desc";
}>;

const defaultCandidateTableFilters: DiscoveryCandidateTableFilters = {
  query: "",
  mode: "all",
  guidance: "all",
  freshness: "all",
  sort: "priority",
  direction: "asc",
};

const guidanceOptions: readonly DiscoveryDecisionGuidance[] = [
  "continue_targeted_probe",
  "continue_single_confirmation",
  "pause_conflicting_evidence",
  "stop_prioritising_this_cell",
  "review_minimum_sample",
  "defer_stale_or_unresolved",
];

const priorityOrder = { high: 0, medium: 1, low: 2, defer: 3 } as const;
const freshnessOrder = { current: 0, ageing: 1, stale: 2, unknown: 3 } as const;

function filteredCandidates(
  candidates: readonly DiscoveryDecisionCandidate[],
  filters: DiscoveryCandidateTableFilters,
): readonly DiscoveryDecisionCandidate[] {
  const query = filters.query.trim().toLocaleLowerCase("en-AU");
  const filtered = candidates.filter(
    (candidate) =>
      (query === "" ||
        candidate.coreName.toLocaleLowerCase("en-AU").includes(query) ||
        candidate.coreId.toLocaleLowerCase("en-AU").includes(query)) &&
      (filters.mode === "all" || candidate.mode === filters.mode) &&
      (filters.guidance === "all" ||
        candidate.decisionGuidance === filters.guidance) &&
      (filters.freshness === "all" ||
        candidate.freshness === filters.freshness),
  );
  const direction = filters.direction === "asc" ? 1 : -1;
  return [...filtered].sort((left, right) => {
    const compared = (() => {
      switch (filters.sort) {
        case "core":
          return left.coreName.localeCompare(right.coreName, "en", {
            numeric: true,
          });
        case "mode":
          return left.mode.localeCompare(right.mode);
        case "distance":
          return left.distanceMetres - right.distanceMetres;
        case "sample":
          return left.directRaceCount - right.directRaceCount;
        case "freshness":
          return (
            freshnessOrder[left.freshness] - freshnessOrder[right.freshness]
          );
        case "priority":
          return (
            priorityOrder[left.reviewPriority] -
            priorityOrder[right.reviewPriority]
          );
      }
    })();
    return compared === 0
      ? left.coreName.localeCompare(right.coreName, "en", { numeric: true })
      : compared * direction;
  });
}

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
      "Owner verification is available, but the manual Vault, performance, lineage and benchmark repositories are not configured. No raw history is scanned on this page.",
  },
  read_model_connected: {
    heading: "Owned-core Discovery planner connected",
    detail:
      "Candidates come only from active My Vault cores and imported historical evidence in the approved order: direct results, close family, wider lineage, then matched population patterns. Exact-distance historical winner and top-three distributions provide comparison context. Recommendations remain advisory and never enter races automatically.",
  },
};

const historicalSnapshotDisclosure =
  "Historical snapshot preview only. This planning result uses the recorded " +
  "cutoff, not today's complete race field. Do not enter races, spend assets " +
  "or stop testing based on this outdated snapshot.";

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

function elapsed(milliseconds: number): string {
  return `${(milliseconds / 1_000).toFixed(3)} s`;
}

function ratio(numerator: number, denominator: number): string {
  if (denominator === 0) return "No assignment opportunities";
  const rate = Math.round((numerator / denominator) * 100);
  return `${numerator}/${denominator} (${rate}%)`;
}

function directTimeSummary(candidate: DiscoveryDecisionCandidate): string {
  const evidence = candidate.directTimeEvidence;
  if (evidence === null) return "Not yet available";
  return `Best ${elapsed(evidence.bestMilliseconds)} · Median ${elapsed(evidence.medianMilliseconds)}`;
}

function consistencySummary(candidate: DiscoveryDecisionCandidate): string {
  const evidence = candidate.directTimeEvidence;
  if (evidence === null) return "Not yet available";
  return `Mean ${elapsed(evidence.meanMilliseconds)} · σ ${elapsed(evidence.standardDeviationMilliseconds)}`;
}

function goldSummary(candidate: DiscoveryDecisionCandidate): string {
  const evidence = candidate.starEvidence;
  if (evidence === null) return "No usable direct star profile";
  const received = ratio(
    evidence.goldReceivedCount,
    evidence.goldAssignmentOpportunityCount,
  );
  return `${received} · ${evidence.goldEligibleRaceCount} Yellow-eligible races`;
}

function blueSummary(candidate: DiscoveryDecisionCandidate): string {
  const evidence = candidate.starEvidence;
  if (evidence === null) return "No usable direct star profile";
  return ratio(
    evidence.blueReceivedCount,
    evidence.blueAssignmentOpportunityCount,
  );
}

function winningBenchmarkSummary(
  candidate: DiscoveryDecisionCandidate,
): string {
  const benchmark = candidate.benchmarkEvidence;
  if (benchmark === null) return "Not available for this exact distance";
  return `Median ${elapsed(benchmark.winningMedianMilliseconds)} · 75th percentile ${elapsed(benchmark.winningP75Milliseconds)} · ${benchmark.winningEntryCount.toLocaleString("en-AU")} winners`;
}

function topThreeBenchmarkSummary(
  candidate: DiscoveryDecisionCandidate,
): string {
  const benchmark = candidate.benchmarkEvidence;
  if (benchmark === null) return "Not available for this exact distance";
  return `Median ${elapsed(benchmark.topThreeMedianMilliseconds)} · 75th percentile ${elapsed(benchmark.topThreeP75Milliseconds)} · ${benchmark.topThreeEntryCount.toLocaleString("en-AU")} top-three results`;
}

function decisionReasonSummary(candidate: DiscoveryDecisionCandidate): string {
  switch (candidate.decisionReason) {
    case "competitive_winner_range":
      return "Direct time reaches the historical winner range; continue a bounded exact-distance probe.";
    case "competitive_top_three_range":
      return "Direct time reaches the historical top-three range; continue a bounded exact-distance probe.";
    case "benchmark_not_available":
      return "No exact-distance benchmark is available; continue only as a small evidence-building probe.";
    case "small_sample_needs_confirmation":
      return "Direct times are outside the historical top-three range, but fewer than four races is too small to deprioritise without one confirmation.";
    case "weak_times_but_positive_star_signal":
      return "Direct times are outside the historical top-three range, but recorded Gold or Blue support conflicts; pause and review rather than spend another race.";
    case "weak_times_without_positive_star_signal":
      return "At least four direct races remain outside the historical top-three range without recorded positive Gold or Blue support; stop prioritising this exact cell, not the core.";
    case "minimum_sample_reached":
      return "The ten-race minimum is reached; review the complete evidence without treating the boundary as proof.";
    case "evidence_stale_or_unresolved":
      return "Evidence is stale or unresolved; defer testing until the data state is trustworthy.";
  }
}

export function DiscoveryWorkspace({
  candidates,
  lastImportedAt,
  publication = null,
  acceptedHistoryCoverage = null,
  connectionStatus,
  study = null,
  studyFilters = {
    mode: "bike",
    squad: "all",
    recommendation: "all",
    distanceMetres: null,
    evidenceBasis: null,
    completion: "all",
    coreStatus: null,
  },
  candidateTableFilters = defaultCandidateTableFilters,
}: Readonly<{
  candidates: readonly DiscoveryDecisionCandidate[];
  lastImportedAt: string | null;
  publication?: DiscoveryBenchmarkPublication | null;
  acceptedHistoryCoverage?: DiscoveryAcceptedHistoryCoverage | null;
  connectionStatus: DiscoveryWorkspaceConnectionStatus;
  study?: DiscoveryStudyView | null;
  studyFilters?: DiscoveryStudyFilters;
  candidateTableFilters?: DiscoveryCandidateTableFilters;
}>) {
  const connection = connectionCopy[connectionStatus];
  const visibleCandidates = filteredCandidates(
    candidates,
    candidateTableFilters,
  );

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
        {connectionStatus === "read_model_connected" && publication !== null ? (
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-[var(--muted)]">Accepted refresh</dt>
              <dd className="mt-1 break-all font-mono">
                {publication.refreshId}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Race dataset version</dt>
              <dd className="mt-1 break-all font-mono">
                {publication.raceDatasetVersionId}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Benchmarks accepted</dt>
              <dd className="mt-1 font-semibold">
                {publication.benchmarkCount.toLocaleString("en-AU")}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Published</dt>
              <dd className="mt-1 font-semibold">
                {timestamp(publication.publishedAt)}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-[var(--muted)]">
                Accepted aggregate payload SHA-256
              </dt>
              <dd className="mt-1 break-all font-mono">
                {publication.payloadSha256}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-[var(--muted)]">
                Accepted source-version SHA-256
              </dt>
              <dd className="mt-1 break-all font-mono">
                {publication.sourceVersionSetSha256}
              </dd>
            </div>
          </dl>
        ) : null}
        {connectionStatus === "read_model_connected" &&
        acceptedHistoryCoverage?.status !== undefined &&
        acceptedHistoryCoverage.status !== "not_used" ? (
          <p className="mt-4 max-w-4xl text-sm leading-6 text-[var(--muted)]">
            Accepted history fallback: {label(acceptedHistoryCoverage.status)} ·{" "}
            {acceptedHistoryCoverage.acceptedRowCount.toLocaleString("en-AU")}{" "}
            rows across{" "}
            {acceptedHistoryCoverage.selectedCoreCount.toLocaleString("en-AU")}{" "}
            of {acceptedHistoryCoverage.ownedCoreCount.toLocaleString("en-AU")}{" "}
            owned Cores.
            {acceptedHistoryCoverage.omittedCoreCount > 0
              ? ` ${acceptedHistoryCoverage.omittedCoreCount.toLocaleString("en-AU")} Cores are omitted from this bounded read, not treated as having no evidence.`
              : ""}
          </p>
        ) : null}
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

        <form className="mt-4 grid gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-4 sm:grid-cols-2 xl:grid-cols-6">
          <label className="text-sm xl:col-span-2">
            <span className="block text-[var(--muted)]">Core name or ID</span>
            <input
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2"
              defaultValue={candidateTableFilters.query}
              name="planQuery"
              placeholder="Search the whole Vault"
            />
          </label>
          <label className="text-sm">
            <span className="block text-[var(--muted)]">Mode</span>
            <select
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2"
              defaultValue={candidateTableFilters.mode}
              name="planMode"
            >
              <option value="all">All modes</option>
              {probeModes.map((mode) => (
                <option key={mode} value={mode}>
                  {label(mode)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-[var(--muted)]">Guidance</span>
            <select
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2"
              defaultValue={candidateTableFilters.guidance}
              name="planGuidance"
            >
              <option value="all">All guidance</option>
              {guidanceOptions.map((guidance) => (
                <option key={guidance} value={guidance}>
                  {label(guidance)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-[var(--muted)]">Freshness</span>
            <select
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2"
              defaultValue={candidateTableFilters.freshness}
              name="planFreshness"
            >
              <option value="all">All freshness</option>
              {(["current", "ageing", "stale", "unknown"] as const).map(
                (freshness) => (
                  <option key={freshness} value={freshness}>
                    {label(freshness)}
                  </option>
                ),
              )}
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-[var(--muted)]">Sort</span>
            <select
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2"
              defaultValue={candidateTableFilters.sort}
              name="planSort"
            >
              <option value="priority">Priority</option>
              <option value="core">Core</option>
              <option value="mode">Mode</option>
              <option value="distance">Distance</option>
              <option value="sample">Sample</option>
              <option value="freshness">Freshness</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-[var(--muted)]">Direction</span>
            <select
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2"
              defaultValue={candidateTableFilters.direction}
              name="planDirection"
            >
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
          </label>
          <input name="mode" type="hidden" value={studyFilters.mode} />
          <div className="flex items-end gap-2 xl:col-span-5">
            <button
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
              type="submit"
            >
              Apply filters
            </button>
            <Link
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold"
              href="/discovery"
            >
              Clear
            </Link>
          </div>
        </form>

        <p className="mt-3 text-sm text-[var(--muted)]" role="status">
          Showing {visibleCandidates.length.toLocaleString("en-AU")} of{" "}
          {candidates.length.toLocaleString("en-AU")} evidence-backed Core, mode
          and exact-distance rows. Cores without usable evidence are not
          presented as zero-performance rows.
        </p>

        {candidates.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6">
            <h3 className="font-semibold">No current Discovery candidates</h3>
            <p className="mt-3 max-w-3xl leading-7 text-[var(--muted)]">
              No under-tested direct sample, validated lineage hypothesis or
              matched class, element and F-number population pattern is
              currently available.
            </p>
          </div>
        ) : visibleCandidates.length === 0 ? (
          <p className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6">
            No evidence-backed rows match these filters.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)]">
            <table className="min-w-[1180px] w-full border-collapse text-left text-sm">
              <thead className="bg-[var(--surface)] text-xs tracking-wide text-[var(--muted)] uppercase">
                <tr>
                  {[
                    "Core",
                    "Mode",
                    "Distance",
                    "Sample",
                    "Best / median",
                    "Benchmark",
                    "Priority",
                    "Guidance",
                    "Next probe",
                    "Freshness",
                    "Evidence details",
                  ].map((heading) => (
                    <th
                      className="border-b border-[var(--border)] px-3 py-3 font-semibold"
                      key={heading}
                      scope="col"
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleCandidates.map((candidate) => (
                  <tr
                    className="align-top odd:bg-[var(--surface-raised)] even:bg-[var(--surface)]"
                    key={JSON.stringify([
                      candidate.coreId,
                      candidate.mode,
                      candidate.distanceMetres,
                    ])}
                  >
                    <th
                      className="border-b border-[var(--border)] px-3 py-3 font-semibold"
                      scope="row"
                    >
                      {candidate.coreName}
                      <span className="mt-1 block font-mono text-xs font-normal text-[var(--muted)]">
                        {candidate.coreId}
                      </span>
                    </th>
                    <td className="border-b border-[var(--border)] px-3 py-3">
                      {label(candidate.mode)}
                    </td>
                    <td className="border-b border-[var(--border)] px-3 py-3 tabular-nums">
                      {candidate.distanceMetres.toLocaleString("en-AU")} m
                    </td>
                    <td className="border-b border-[var(--border)] px-3 py-3 tabular-nums">
                      {candidate.directRaceCount}/10
                    </td>
                    <td className="border-b border-[var(--border)] px-3 py-3">
                      {directTimeSummary(candidate)}
                    </td>
                    <td className="border-b border-[var(--border)] px-3 py-3">
                      {label(candidate.benchmarkAssessment)}
                    </td>
                    <td className="border-b border-[var(--border)] px-3 py-3">
                      {label(candidate.reviewPriority)}
                    </td>
                    <td className="border-b border-[var(--border)] px-3 py-3 font-semibold">
                      {label(candidate.decisionGuidance)}
                    </td>
                    <td className="border-b border-[var(--border)] px-3 py-3 tabular-nums">
                      {candidate.recommendedDecisionProbeSize === 0
                        ? "None"
                        : `${candidate.recommendedDecisionProbeSize} race${candidate.recommendedDecisionProbeSize === 1 ? "" : "s"}`}
                    </td>
                    <td className="border-b border-[var(--border)] px-3 py-3">
                      {label(candidate.freshness)}
                      <span className="mt-1 block text-xs text-[var(--muted)]">
                        {timestamp(candidate.dataCurrentThrough)}
                      </span>
                    </td>
                    <td className="border-b border-[var(--border)] px-3 py-3">
                      <details>
                        <summary className="cursor-pointer font-semibold text-[var(--accent)]">
                          Review evidence
                        </summary>
                        <div className="mt-2 w-80 space-y-2 text-xs leading-5 text-[var(--muted)]">
                          {candidate.freshness === "stale" ? (
                            <p className="text-[var(--warning)]">
                              {historicalSnapshotDisclosure}
                            </p>
                          ) : null}
                          <p>{decisionReasonSummary(candidate)}</p>
                          <p>{consistencySummary(candidate)}</p>
                          <p>Winner: {winningBenchmarkSummary(candidate)}</p>
                          <p>
                            Top three: {topThreeBenchmarkSummary(candidate)}
                          </p>
                          <p>
                            Yellow: {goldSummary(candidate)} · Blue:{" "}
                            {blueSummary(candidate)}
                          </p>
                          <p>
                            {candidate.lineageRelationship === null
                              ? "Direct imported results"
                              : `${label(candidate.lineageRelationship)} hypothesis · ${candidate.lineageRaceCount.toLocaleString("en-AU")} supporting races`}
                          </p>
                          {candidate.warnings.length > 0 ? (
                            <p>{candidate.warnings.map(label).join(" · ")}</p>
                          ) : null}
                          <p>
                            Advisory only. No automatic entry or stop is
                            allowed.
                          </p>
                        </div>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
          Benchmarks are descriptive historical distributions, not guaranteed
          targets. Yellow and Blue use recorded assignment opportunities; raw
          conversion does not improve priority without opposition-quality
          evidence. Stop guidance applies only to one Core, mode and exact
          distance and never acts automatically.
        </p>
      </section>

      <DiscoveryStudyWorkspace filters={studyFilters} study={study} />
    </div>
  );
}
