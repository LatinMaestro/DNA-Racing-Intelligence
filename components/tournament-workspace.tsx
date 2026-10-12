import Link from "next/link";

import type { TournamentCandidateRankingResult } from "@/domain/tournament-candidate-ranking";
import type { TournamentWorkspaceConnectionStatus } from "@/lib/tournament-workspace-service";

const connectionCopy: Record<
  TournamentWorkspaceConnectionStatus,
  Readonly<{ heading: string; detail: string }>
> = {
  identity_not_connected: {
    heading: "Owner identity not connected",
    detail:
      "Tournament evidence remains unavailable until the signed-in owner is verified against the server-side allowlist.",
  },
  persistence_not_configured: {
    heading: "Tournament read model not connected",
    detail:
      "Owner verification is available, but the compact private tournament repository is not configured. No raw race history is scanned on this page.",
  },
  read_model_connected: {
    heading: "Historical tournament evidence connected",
    detail:
      "Group-scoped candidate order follows the bound configuration and candidate snapshot. Imported history is not the current field and does not authorise entry.",
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

const timestampFormatter = new Intl.DateTimeFormat("en-AU", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

function timestamp(value: string | null) {
  if (value === null) return "Not available";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Not available";
  return <time dateTime={value}>{timestampFormatter.format(parsed)} UTC</time>;
}

const missingOptimizerEvidence = [
  "1v1 opponent-field P(win)",
  "Configured qualification probability",
  "Same-element top-10% stress P(win)",
  "Actual fee/prize economic break-even",
  "Per-race and campaign expected value",
] as const;

const carOneVOneScreeningDisclosure =
  "The owner's 50% Car 1v1 P(win) screening rule is not evaluated here. " +
  "It differs from the 50% race-gate occupancy cap and does not, by " +
  "itself, establish positive expected value without fee/prize evidence.";

export function TournamentWorkspace({
  brackets,
  lastImportedAt,
  connectionStatus,
}: Readonly<{
  brackets: readonly TournamentCandidateRankingResult[];
  lastImportedAt: string | null;
  connectionStatus: TournamentWorkspaceConnectionStatus;
}>) {
  const connection = connectionCopy[connectionStatus];

  return (
    <div className="space-y-8">
      <header className="max-w-4xl">
        <p className="text-sm font-semibold text-[var(--accent)]">
          Phase 4 qualification review
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          Tournaments
        </h1>
        <p className="mt-4 text-base leading-7 text-[var(--muted)]">
          Review candidates within their configured leaderboard groups. The 50%
          race gate is a hard cap, not a target, and Maiden eligibility is
          preserved for the strongest credible mode-specific opportunity.
        </p>
      </header>

      <section
        aria-labelledby="tournament-connection"
        className="rounded-2xl border border-[var(--warning)]/50 bg-[var(--surface-raised)] p-6"
      >
        <h2 className="text-lg font-semibold" id="tournament-connection">
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
          Tournament entry unavailable
        </button>
      </section>

      <section
        aria-labelledby="tournament-optimizer-status"
        className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6"
      >
        <h2 className="text-lg font-semibold" id="tournament-optimizer-status">
          Calibrated tournament optimiser not commissioned
        </h2>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
          These historical, group-scoped metric ranks are preliminary review
          evidence, not calculated tournament-strength probabilities or profit
          recommendations. The approved same-mode, exact-distance, gate, format
          and element opponent-distribution methodology is not yet connected to
          this ranking view.
        </p>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          {missingOptimizerEvidence.map((metric) => (
            <div key={metric}>
              <dt className="text-[var(--muted)]">{metric}</dt>
              <dd className="mt-1 font-semibold">Not computed</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-xs leading-5 text-[var(--muted)]">
          {carOneVOneScreeningDisclosure}
        </p>
      </section>

      <section aria-labelledby="tournament-candidates">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold" id="tournament-candidates">
              Experimental candidate review
            </h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Historical snapshot · Last imported {timestamp(lastImportedAt)}
            </p>
          </div>
          <span className="rounded-full border border-[var(--border)] px-3 py-1 text-xs font-semibold text-[var(--warning)]">
            Gate C not passed
          </span>
        </div>

        {brackets.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6">
            <h3 className="font-semibold">No accepted tournament evidence</h3>
            <p className="mt-3 max-w-3xl leading-7 text-[var(--muted)]">
              Missing candidate evidence is unavailable. It does not mean there
              are no eligible cores, no tournament opportunity or no remaining
              qualification work.
            </p>
          </div>
        ) : (
          <div className="mt-4 space-y-5">
            {brackets.map((bracket) => (
              <article
                className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5"
                key={JSON.stringify([bracket.tournamentId, bracket.bracketId])}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold tracking-wider text-[var(--accent)] uppercase">
                      {bracket.tournamentLabel}
                    </p>
                    <h3 className="mt-2 text-lg font-semibold">
                      {bracket.splitLabel}
                    </h3>
                    <p className="mt-2 text-xs text-[var(--muted)]">
                      {label(bracket.mode)} ·{" "}
                      {bracket.eligibleDistancesMetres
                        .map(
                          (distance) => `${distance.toLocaleString("en-AU")} m`,
                        )
                        .join(" · ")}{" "}
                      · {label(bracket.discoveryRelevance)} Discovery relevance
                    </p>
                    <p className="mt-2 text-xs text-[var(--muted)]">
                      Configuration {bracket.configurationVersion} · Candidate
                      snapshot {bracket.candidateSnapshotVersion}
                    </p>
                    {bracket.configurationAuthority ? (
                      <p className="mt-2 text-xs text-[var(--muted)]">
                        Rule authority ·{" "}
                        {label(bracket.configurationAuthority.status)}
                        {bracket.configurationAuthority.reasons.length > 0
                          ? ` · ${bracket.configurationAuthority.reasons
                              .map(label)
                              .join(" · ")}`
                          : ""}
                      </p>
                    ) : null}
                  </div>
                  <span className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--muted)]">
                    {bracket.qualificationMetricLabel}
                  </span>
                </div>

                {bracket.leaderboardGroups.length === 0 ? (
                  <p className="mt-5 text-sm leading-6 text-[var(--muted)]">
                    No candidates are available for this split.
                  </p>
                ) : (
                  <div className="mt-5 space-y-5">
                    {bracket.leaderboardGroups.map((group) => (
                      <section
                        aria-labelledby={`${bracket.bracketId}-${group.leaderboardGroupId}`}
                        className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"
                        key={group.leaderboardGroupId}
                      >
                        <h4
                          className="font-semibold"
                          id={`${bracket.bracketId}-${group.leaderboardGroupId}`}
                        >
                          {group.leaderboardGroupLabel}
                        </h4>
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          Group-scoped ranks; equal metric ranks remain ties.
                        </p>
                        <ol className="mt-4 grid gap-3 lg:grid-cols-2">
                          {group.candidates.map((candidate) => (
                            <li
                              className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4"
                              key={candidate.coreId}
                            >
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                  <p className="font-semibold">
                                    Core {candidate.coreId}
                                  </p>
                                  <p className="mt-1 text-sm text-[var(--muted)]">
                                    {candidate.groupReviewRank === null
                                      ? "Not in group review order"
                                      : `Group review rank ${candidate.groupReviewRank}`}
                                  </p>
                                  <Link
                                    aria-label={`View Core ${candidate.coreId} racing history`}
                                    className="mt-3 inline-flex rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-semibold text-[var(--accent)] hover:bg-[var(--surface)]"
                                    href={`/search-core?q=${encodeURIComponent(
                                      candidate.coreId,
                                    )}&coreId=${encodeURIComponent(candidate.coreId)}`}
                                  >
                                    View Core profile
                                  </Link>
                                </div>
                                <span className="text-xs font-semibold text-[var(--warning)]">
                                  {label(candidate.disposition)}
                                </span>
                              </div>
                              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                                <div>
                                  <dt className="text-[var(--muted)]">
                                    Qualification metric
                                  </dt>
                                  <dd className="mt-1 font-semibold">
                                    {candidate.configuredMetricRank === null
                                      ? "Unavailable"
                                      : `Group rank ${candidate.configuredMetricRank}`}
                                  </dd>
                                </div>
                                <div>
                                  <dt className="text-[var(--muted)]">
                                    Time evidence
                                  </dt>
                                  <dd className="mt-1 font-semibold">
                                    {label(candidate.timeEvidence)}
                                  </dd>
                                </div>
                                <div>
                                  <dt className="text-[var(--muted)]">
                                    Evidence confidence
                                  </dt>
                                  <dd className="mt-1 font-semibold">
                                    {label(candidate.evidenceConfidence)}
                                  </dd>
                                </div>
                                <div>
                                  <dt className="text-[var(--muted)]">
                                    Maiden state
                                  </dt>
                                  <dd className="mt-1 font-semibold">
                                    {label(candidate.maidenState)}
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
                                    Last imported
                                  </dt>
                                  <dd className="mt-1 font-semibold">
                                    {timestamp(candidate.lastImported)}
                                  </dd>
                                </div>
                                <div>
                                  <dt className="text-[var(--muted)]">
                                    Historical freshness
                                  </dt>
                                  <dd className="mt-1 font-semibold">
                                    {label(candidate.freshness)}
                                  </dd>
                                </div>
                              </dl>
                              <p className="mt-4 text-sm text-[var(--muted)]">
                                {candidate.warnings.map(label).join(" · ")}
                              </p>
                            </li>
                          ))}
                        </ol>
                      </section>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
