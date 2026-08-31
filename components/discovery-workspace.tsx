import type { DiscoveryDecisionCandidate } from "@/domain/discovery-decision-guidance";
import type { DiscoveryWorkspaceConnectionStatus } from "@/lib/discovery-workspace-service";
import {
  DiscoveryStudyWorkspace,
  type DiscoveryStudyFilters,
  type DiscoveryStudyView,
} from "./discovery-study-workspace";

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
}: Readonly<{
  candidates: readonly DiscoveryDecisionCandidate[];
  lastImportedAt: string | null;
  connectionStatus: DiscoveryWorkspaceConnectionStatus;
  study?: DiscoveryStudyView | null;
  studyFilters?: DiscoveryStudyFilters;
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
              No under-tested direct sample, validated lineage hypothesis or
              matched class, element and F-number population pattern is
              currently available.
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
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--muted)]">
                      {label(candidate.reviewPriority)} priority
                    </span>
                    <span className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--muted)]">
                      {label(candidate.confidence)} confidence
                    </span>
                    <span className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--muted)]">
                      {label(candidate.benchmarkAssessment)} benchmark
                    </span>
                  </div>
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
                      {candidate.recommendedDecisionProbeSize === 0
                        ? "No probe recommended"
                        : `${candidate.recommendedDecisionProbeSize} race${candidate.recommendedDecisionProbeSize === 1 ? "" : "s"}`}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[var(--muted)]">Guidance</dt>
                    <dd className="mt-1 font-semibold">
                      {label(candidate.decisionGuidance)}
                    </dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-[var(--muted)]">Decision rationale</dt>
                    <dd className="mt-1 font-semibold">
                      {decisionReasonSummary(candidate)}
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
                  <div>
                    <dt className="text-[var(--muted)]">Evidence basis</dt>
                    <dd className="mt-1 font-semibold">
                      {candidate.lineageRelationship === null
                        ? "Direct imported results"
                        : candidate.lineageRelationship === "population_pattern"
                          ? `Population Pattern hypothesis · ${candidate.lineageRaceCount.toLocaleString("en-AU")} supporting races`
                          : `${label(candidate.lineageRelationship)} hypothesis · ${candidate.lineageRaceCount.toLocaleString("en-AU")} lineage races`}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[var(--muted)]">
                      Direct time evidence
                    </dt>
                    <dd className="mt-1 font-semibold">
                      {directTimeSummary(candidate)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[var(--muted)]">Time consistency</dt>
                    <dd className="mt-1 font-semibold">
                      {consistencySummary(candidate)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[var(--muted)]">Winner benchmark</dt>
                    <dd className="mt-1 font-semibold">
                      {winningBenchmarkSummary(candidate)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[var(--muted)]">Top-three benchmark</dt>
                    <dd className="mt-1 font-semibold">
                      {topThreeBenchmarkSummary(candidate)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[var(--muted)]">
                      Yellow support (source Gold)
                    </dt>
                    <dd className="mt-1 font-semibold">
                      {goldSummary(candidate)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[var(--muted)]">Blue support</dt>
                    <dd className="mt-1 font-semibold">
                      {blueSummary(candidate)}
                    </dd>
                  </div>
                </dl>

                <div className="mt-5 border-t border-[var(--border)] pt-4 text-sm text-[var(--muted)]">
                  <p>
                    Data current through{" "}
                    {timestamp(candidate.dataCurrentThrough)} ·{" "}
                    {label(candidate.freshness)}
                  </p>
                  {candidate.benchmarkEvidence === null ? null : (
                    <p className="mt-1">
                      Benchmark current through{" "}
                      {timestamp(
                        candidate.benchmarkEvidence.dataCurrentThrough,
                      )}
                      {" · "}
                      {candidate.benchmarkEvidence.raceEntryCount.toLocaleString(
                        "en-AU",
                      )}{" "}
                      exact-distance historical entries
                    </p>
                  )}
                  {candidate.warnings.length > 0 ? (
                    <p className="mt-1">
                      {candidate.warnings.map(label).join(" · ")}
                    </p>
                  ) : null}
                  <p className="mt-2">
                    Benchmark ranges are descriptive historical distributions,
                    not guaranteed targets. Lower elapsed time remains better.
                  </p>
                  <p className="mt-2">
                    Yellow (source Gold) uses eligible assignment opportunities
                    only. Blue uses its recorded assignment opportunities. Raw
                    star rate or conversion does not improve priority without
                    pre-race opposition-quality evidence.
                  </p>
                  <p className="mt-2">
                    Reassess after the probe. Lineage or population evidence
                    nominates a test only; it does not replace direct evidence
                    or prove performance.
                  </p>
                  <p className="mt-2">
                    Stop guidance deprioritises only this core, mode and exact
                    distance. It never stops the core automatically or replaces
                    owner judgement.
                  </p>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <DiscoveryStudyWorkspace filters={studyFilters} study={study} />
    </div>
  );
}
