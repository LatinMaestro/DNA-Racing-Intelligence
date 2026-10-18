import Link from "next/link";

import type { TournamentHorseScreeningState } from "@/lib/tournament-horse-screening-service";

const statusCopy = {
  identity_not_connected:
    "Owner identity must be verified before private Horse screening evidence can be read.",
  persistence_not_configured:
    "The private Horse screening snapshot repository is not configured.",
  snapshot_unavailable:
    "No accepted Horse 1v1 screening snapshot has been published. Missing evidence remains unavailable.",
  snapshot_read_failed:
    "The private Horse screening snapshot could not be read. No cached or inferred replacement is shown.",
  snapshot_invalid:
    "The published Horse screening snapshot failed integrity checks. No ranking is shown until a valid last-good snapshot is published.",
} as const;

function percentage(value: number | null): string {
  return value === null
    ? "Unavailable"
    : new Intl.NumberFormat("en-AU", {
        style: "percent",
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }).format(value / 1_000_000);
}

function timestamp(value: string): string {
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function label(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function candidateDisposition(
  disposition:
    | "screened_candidate"
    | "inferred_candidate"
    | "best_shot"
    | "evidence_unavailable",
): string {
  switch (disposition) {
    case "screened_candidate":
      return "Meets direct 50% screen";
    case "inferred_candidate":
      return "Meets transfer 50% screen";
    case "best_shot":
      return "Below 50% · best shot";
    case "evidence_unavailable":
      return "Evidence unavailable";
  }
}

type ConnectedSnapshot = NonNullable<TournamentHorseScreeningState["snapshot"]>;
type Candidate = ConnectedSnapshot["candidates"][number];

type CandidateGroup = Readonly<{
  key: string;
  element: string;
  distanceMetres: number;
  candidates: readonly Candidate[];
}>;

function candidateGroups(
  candidates: readonly Candidate[],
): readonly CandidateGroup[] {
  const grouped = new Map<
    string,
    { element: string; distanceMetres: number; candidates: Candidate[] }
  >();
  for (const candidate of candidates) {
    const key = JSON.stringify([candidate.element, candidate.distanceMetres]);
    const group = grouped.get(key);
    if (group) {
      group.candidates.push(candidate);
    } else {
      grouped.set(key, {
        element: candidate.element,
        distanceMetres: candidate.distanceMetres,
        candidates: [candidate],
      });
    }
  }
  return [...grouped.entries()].map(([key, group]) => ({ key, ...group }));
}

export function TournamentHorseScreeningPanel({
  state,
}: Readonly<{ state: TournamentHorseScreeningState }>) {
  const snapshot = state.snapshot;
  return (
    <section
      aria-labelledby="horse-one-v-one-screening"
      className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[var(--accent)]">
            Horse tournament evidence
          </p>
          <h2
            className="mt-2 text-xl font-semibold"
            id="horse-one-v-one-screening"
          >
            Independent 1v1 candidate screening
          </h2>
        </div>
        <span className="rounded-full border border-[var(--warning)]/60 px-3 py-1 text-xs font-semibold text-[var(--warning)]">
          Experimental · decision disabled
        </span>
      </div>

      {snapshot === null ? (
        <p className="mt-4 max-w-4xl leading-7 text-[var(--muted)]">
          {statusCopy[state.connectionStatus]}
        </p>
      ) : (
        <>
          <p className="mt-4 max-w-4xl text-sm leading-6 text-[var(--muted)]">
            Direct 1v1 probabilities use only accepted two-gate evidence. Wider
            exact-distance Horse races appear separately as format-transfer
            screening and never prove a 1v1 specialist. Fees, prizes and
            expected value remain unavailable.
          </p>
          <dl className="mt-4 grid gap-3 text-xs text-[var(--muted)] sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt>Evidence cutoff</dt>
              <dd className="mt-1 font-semibold text-[var(--foreground)]">
                {timestamp(snapshot.evidenceCutoff)} UTC
              </dd>
            </div>
            <div>
              <dt>Published</dt>
              <dd className="mt-1 font-semibold text-[var(--foreground)]">
                {timestamp(snapshot.publishedAt)} UTC
              </dd>
            </div>
            <div>
              <dt>Source snapshot</dt>
              <dd className="mt-1 break-all font-semibold text-[var(--foreground)]">
                {snapshot.sourceSnapshotVersion}
              </dd>
            </div>
            <div>
              <dt>Screening model</dt>
              <dd className="mt-1 break-all font-semibold text-[var(--foreground)]">
                {snapshot.modelVersion}
              </dd>
            </div>
            <div>
              <dt>Published snapshot</dt>
              <dd className="mt-1 break-all font-semibold text-[var(--foreground)]">
                {snapshot.snapshotVersion}
              </dd>
            </div>
          </dl>
          <div className="mt-5 space-y-4">
            {candidateGroups(snapshot.candidates).map((group, groupIndex) => {
              const screened = group.candidates.filter((candidate) =>
                ["screened_candidate", "inferred_candidate"].includes(
                  candidate.disposition,
                ),
              ).length;
              const reviewRequired = group.candidates.filter(
                (candidate) => candidate.status === "review_required",
              ).length;
              const unavailable = group.candidates.filter(
                (candidate) => candidate.status === "unavailable",
              ).length;
              return (
                <details
                  className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"
                  key={group.key}
                  open={groupIndex === 0}
                >
                  <summary className="cursor-pointer font-semibold">
                    {group.element} ·{" "}
                    {group.distanceMetres.toLocaleString("en-AU")} m ·{" "}
                    {group.candidates.length} owned Cores
                  </summary>
                  <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                    {screened} meet the experimental 50% screen ·{" "}
                    {reviewRequired} transfer-review · {unavailable} unavailable
                  </p>
                  <ol className="mt-4 grid gap-4 lg:grid-cols-2">
                    {group.candidates.map((candidate, index) => (
                      <li
                        className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4"
                        key={candidate.coreId}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-semibold text-[var(--accent)]">
                              Group screening rank {index + 1}
                            </p>
                            <h3 className="mt-1 font-semibold">
                              {candidate.name}
                            </h3>
                            <p className="mt-1 text-xs text-[var(--muted)]">
                              Core {candidate.coreId}
                            </p>
                            <Link
                              aria-label={`View ${candidate.name} Core profile`}
                              className="mt-3 inline-flex rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-semibold text-[var(--accent)] hover:bg-[var(--surface)]"
                              href={`/search-core?q=${encodeURIComponent(
                                candidate.coreId,
                              )}&coreId=${encodeURIComponent(candidate.coreId)}`}
                            >
                              View Core profile
                            </Link>
                          </div>
                          <div className="text-right text-xs font-semibold text-[var(--warning)]">
                            <p>{candidateDisposition(candidate.disposition)}</p>
                            <p className="mt-1 text-[var(--muted)]">
                              {candidate.formatTransferStatus === "direct"
                                ? "Direct 1v1 evidence"
                                : candidate.formatTransferStatus ===
                                    "inference_only"
                                  ? "Transfer inference only"
                                  : "Evidence unavailable"}
                            </p>
                          </div>
                        </div>
                        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                          <div>
                            <dt className="text-[var(--muted)]">
                              Direct field P(win)
                            </dt>
                            <dd className="mt-1 font-semibold">
                              {percentage(
                                candidate.expectedFieldPWinMillionths,
                              )}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-[var(--muted)]">
                              Direct top-10% stress P(win)
                            </dt>
                            <dd className="mt-1 font-semibold">
                              {percentage(
                                candidate.topTenPercentStressPWinMillionths,
                              )}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-[var(--muted)]">
                              Exact-distance transfer
                            </dt>
                            <dd className="mt-1 font-semibold">
                              {percentage(
                                candidate.projectedFieldOutperformanceMillionths,
                              )}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-[var(--muted)]">
                              Transfer top-10% stress
                            </dt>
                            <dd className="mt-1 font-semibold">
                              {percentage(
                                candidate.projectedTopTenPercentOutperformanceMillionths,
                              )}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-[var(--muted)]">
                              Evidence samples
                            </dt>
                            <dd className="mt-1 font-semibold">
                              {candidate.candidateSampleCount} all-format ·{" "}
                              {candidate.candidateDirectOneVOneSampleCount}{" "}
                              direct 1v1
                            </dd>
                          </div>
                          <div>
                            <dt className="text-[var(--muted)]">
                              Opponent coverage
                            </dt>
                            <dd className="mt-1 font-semibold">
                              {candidate.fieldOpponentCoreCount} field ·{" "}
                              {candidate.stressOpponentCoreCount} stress
                            </dd>
                          </div>
                          <div>
                            <dt className="text-[var(--muted)]">
                              Evidence state
                            </dt>
                            <dd className="mt-1 font-semibold">
                              {label(candidate.status)}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-[var(--muted)]">Economics</dt>
                            <dd className="mt-1 font-semibold">Unavailable</dd>
                          </div>
                        </dl>
                      </li>
                    ))}
                  </ol>
                </details>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
