import Link from "next/link";

import type {
  TournamentCandidateRanking,
  TournamentCandidateRankingResult,
} from "@/domain/tournament-candidate-ranking";
import type { TournamentCoreSelectionState } from "@/lib/tournament-core-selection-service";

type SaveAction = (formData: FormData) => Promise<void>;

function href(tournamentId: string, bracketId: string): string {
  return (
    `/tournaments?tournamentId=${encodeURIComponent(tournamentId)}` +
    `&bracketId=${encodeURIComponent(bracketId)}#tournament-core-selection`
  );
}

function label(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function uniqueCandidates(
  bracket: TournamentCandidateRankingResult,
): readonly TournamentCandidateRanking[] {
  const candidates = new Map<string, TournamentCandidateRanking>();
  for (const group of bracket.leaderboardGroups) {
    for (const candidate of group.candidates) {
      if (!candidates.has(candidate.coreId)) {
        candidates.set(candidate.coreId, candidate);
      }
    }
  }
  return [...candidates.values()].sort(
    (left, right) =>
      (left.groupReviewRank ?? Number.MAX_SAFE_INTEGER) -
        (right.groupReviewRank ?? Number.MAX_SAFE_INTEGER) ||
      left.coreId.localeCompare(right.coreId, "en", { numeric: true }),
  );
}

export function TournamentCoreSelectionPanel({
  brackets,
  selectedBracket,
  selectionState,
  saveAction,
}: Readonly<{
  brackets: readonly TournamentCandidateRankingResult[];
  selectedBracket: Readonly<{
    tournamentId: string;
    bracketId: string;
  }> | null;
  selectionState: TournamentCoreSelectionState;
  saveAction: SaveAction;
}>) {
  const active =
    selectedBracket === null
      ? null
      : (brackets.find(
          (bracket) =>
            bracket.tournamentId === selectedBracket.tournamentId &&
            bracket.bracketId === selectedBracket.bracketId,
        ) ?? null);
  const candidates = active === null ? [] : uniqueCandidates(active);
  const selectedCoreIds = new Set(selectionState.selection?.coreIds ?? []);
  const selectionConnected = selectionState.connectionStatus === "connected";
  const saveDisabled =
    active === null ||
    !selectionConnected ||
    active.candidateSnapshotVersion === "snapshot-unbound";

  return (
    <section
      aria-labelledby="tournament-core-selection-heading"
      className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6"
      id="tournament-core-selection"
    >
      <p className="text-sm font-semibold text-[var(--accent)]">
        Qualification planning
      </p>
      <h2
        className="mt-2 text-xl font-semibold"
        id="tournament-core-selection-heading"
      >
        Pick a Tournament and select advisory Cores
      </h2>
      <p className="mt-3 max-w-4xl leading-7 text-[var(--muted)]">
        Choose an accepted Tournament split to review every evidence-backed
        Vault candidate in one table. Saved choices are owner-scoped planning
        records only; they never enter a race and remain bound to the exact rule
        and candidate snapshot.
      </p>

      {brackets.length === 0 ? (
        <p className="mt-5 rounded-xl border border-[var(--border)] p-4 text-sm text-[var(--muted)]">
          No accepted Tournament configuration exists. Nothing is invented: add
          a complete owner-confirmed split before selecting Cores.
        </p>
      ) : (
        <>
          <nav
            aria-label="Choose Tournament split"
            className="mt-5 flex flex-wrap gap-2"
          >
            {brackets.map((bracket) => (
              <Link
                aria-current={
                  active?.tournamentId === bracket.tournamentId &&
                  active.bracketId === bracket.bracketId
                    ? "page"
                    : undefined
                }
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface)]"
                href={href(bracket.tournamentId, bracket.bracketId)}
                key={JSON.stringify([bracket.tournamentId, bracket.bracketId])}
              >
                {bracket.tournamentLabel} — {bracket.splitLabel}
              </Link>
            ))}
          </nav>

          {active === null ? (
            <p className="mt-5 text-sm text-[var(--muted)]">
              Select a Tournament split to open its whole-Vault analysis.
            </p>
          ) : (
            <form action={saveAction} className="mt-6">
              <input
                name="tournamentId"
                type="hidden"
                value={active.tournamentId}
              />
              <input name="bracketId" type="hidden" value={active.bracketId} />
              <input
                name="configurationVersion"
                type="hidden"
                value={active.configurationVersion}
              />
              <input
                name="candidateSnapshotVersion"
                type="hidden"
                value={active.candidateSnapshotVersion}
              />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-left text-sm">
                  <caption className="mb-3 text-left font-semibold">
                    {active.tournamentLabel} — {active.splitLabel} ·{" "}
                    {candidates.length} distinct Vault candidates
                  </caption>
                  <thead className="border-b border-[var(--border)] text-xs text-[var(--muted)] uppercase">
                    <tr>
                      <th className="px-2 py-3">Run</th>
                      <th className="px-2 py-3">Core</th>
                      <th className="px-2 py-3">Group</th>
                      <th className="px-2 py-3">Review rank</th>
                      <th className="px-2 py-3">Metric</th>
                      <th className="px-2 py-3">Time evidence</th>
                      <th className="px-2 py-3">Confidence</th>
                      <th className="px-2 py-3">Maiden</th>
                      <th className="px-2 py-3">Freshness</th>
                      <th className="px-2 py-3">Disposition</th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidates.map((candidate) => {
                      const ineligible = candidate.disposition === "ineligible";
                      return (
                        <tr
                          className="border-b border-[var(--border)]"
                          key={candidate.coreId}
                        >
                          <td className="px-2 py-3">
                            <input
                              aria-label={`Select Core ${candidate.coreId}`}
                              defaultChecked={selectedCoreIds.has(
                                candidate.coreId,
                              )}
                              disabled={ineligible || saveDisabled}
                              name="coreId"
                              type="checkbox"
                              value={candidate.coreId}
                            />
                          </td>
                          <td className="px-2 py-3 font-semibold">
                            <Link
                              className="text-[var(--accent)] hover:underline"
                              href={`/search-core?q=${encodeURIComponent(candidate.coreId)}&coreId=${encodeURIComponent(candidate.coreId)}#selected-core`}
                            >
                              {candidate.coreId}
                            </Link>
                          </td>
                          <td className="px-2 py-3">
                            {candidate.leaderboardGroupLabel}
                          </td>
                          <td className="px-2 py-3">
                            {candidate.groupReviewRank ?? "Unavailable"}
                          </td>
                          <td className="px-2 py-3">
                            {candidate.configuredMetricRank ?? "Unavailable"}
                          </td>
                          <td className="px-2 py-3">
                            {label(candidate.timeEvidence)}
                          </td>
                          <td className="px-2 py-3">
                            {label(candidate.evidenceConfidence)}
                          </td>
                          <td className="px-2 py-3">
                            {label(candidate.maidenState)}
                          </td>
                          <td className="px-2 py-3">
                            {label(candidate.freshness)}
                          </td>
                          <td className="px-2 py-3">
                            {label(candidate.disposition)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {candidates.length === 0 ? (
                <p className="mt-4 text-sm text-[var(--muted)]">
                  No evidence-backed Vault candidates are available for this
                  split. Missing evidence remains unavailable, not zero.
                </p>
              ) : null}
              <button
                className="mt-5 rounded-lg border border-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent)] disabled:cursor-not-allowed disabled:border-[var(--border)] disabled:text-[var(--muted)]"
                disabled={saveDisabled}
                type="submit"
              >
                Save selected Cores
              </button>
              <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
                {selectionState.selection === null
                  ? "No saved selection exists for this exact Tournament snapshot."
                  : `${selectionState.selection.coreIds.length} Cores saved at ${selectionState.selection.updatedAt}.`}
              </p>
            </form>
          )}
        </>
      )}
    </section>
  );
}
