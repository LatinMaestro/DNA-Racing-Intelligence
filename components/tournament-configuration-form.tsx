import type { TournamentCandidateRankingResult } from "@/domain/tournament-candidate-ranking";
import type { TournamentWorkspaceConnectionStatus } from "@/lib/tournament-workspace-service";

type SaveAction = (formData: FormData) => Promise<void>;

function editableConfiguration(
  configuration: NonNullable<
    TournamentCandidateRankingResult["ruleConfiguration"]
  >,
): string {
  const serverDerivedFields = new Set([
    "configurationVersion",
    "candidateSnapshotVersion",
    "updatedAt",
  ]);
  const editable = Object.fromEntries(
    Object.entries(configuration).filter(
      ([field]) => !serverDerivedFields.has(field),
    ),
  );
  return JSON.stringify(editable, null, 2);
}

const starterConfiguration = JSON.stringify(
  {
    tournamentId: "spring-cup-2026",
    tournamentLabel: "Spring Cup",
    seasonLabel: "Unspecified",
    qualificationStartsAt: null,
    qualificationEndsAt: null,
    bracketId: "bike-a",
    splitLabel: "Bike A",
    mode: "bike",
    eligibleDistancesMetres: [1200],
    gateCount: 4,
    entryFee: { amount: "0", asset: "Unspecified" },
    raceFormat: "Unspecified",
    eligibility: {
      breeds: [],
      classes: [],
      elements: [],
      fNumbers: [],
      fNumberRanges: [],
      groups: [],
    },
    leaderboard: {
      splitDimension: "none",
      groups: [],
      qualifyingRaceSemantics: "separate",
    },
    qualification: {
      minimumRaceCount: 1,
      target: { kind: "count", value: 1 },
      rankingMetric: "fastest_single_time",
      topFinishPosition: null,
      pointsTable: {},
      customScoringConfiguration: {},
    },
    discoveryRelevance: "eligible",
    evidence: {
      status: "uncertain",
      notes: "",
      sourceEvidence: "",
      provenance: {},
    },
    campaignAction: null,
  },
  null,
  2,
);

export function TournamentConfigurationForm({
  brackets,
  connectionStatus,
  saveAction,
}: Readonly<{
  brackets: readonly TournamentCandidateRankingResult[];
  connectionStatus: TournamentWorkspaceConnectionStatus;
  saveAction: SaveAction;
}>) {
  const existingConfiguration = brackets.find(
    (bracket) => bracket.ruleConfiguration !== undefined,
  )?.ruleConfiguration;
  const hasExistingConfiguration = brackets.length > 0;
  const disabled = connectionStatus !== "read_model_connected";

  return (
    <section
      aria-labelledby="tournament-configuration-editor"
      className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6"
    >
      <div className="max-w-4xl">
        <p className="text-sm font-semibold text-[var(--accent)]">
          Owner configuration
        </p>
        <h2
          className="mt-2 text-xl font-semibold"
          id="tournament-configuration-editor"
        >
          Add or replace a complete Tournament split
        </h2>
        <p className="mt-3 leading-7 text-[var(--muted)]">
          Submit the complete rule payload used by Tournament and Discovery.
          Versions and timestamps are derived by the server, and every rule
          change invalidates previously bound candidate evidence. This editor
          never submits a Tournament entry.
        </p>
      </div>

      <form action={saveAction} className="mt-6">
        <fieldset disabled={disabled}>
          <label className="block text-sm font-medium">
            Complete Tournament rule configuration
            <textarea
              aria-describedby="tournament-configuration-guidance"
              className="mt-2 min-h-[34rem] w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-mono text-sm"
              defaultValue={
                existingConfiguration === undefined
                  ? hasExistingConfiguration
                    ? ""
                    : starterConfiguration
                  : editableConfiguration(existingConfiguration)
              }
              name="ruleConfiguration"
              required
              spellCheck={false}
            />
          </label>
          <p
            className="mt-3 text-sm leading-6 text-[var(--muted)]"
            id="tournament-configuration-guidance"
          >
            {existingConfiguration !== undefined
              ? "The complete stored rule is prefilled. Review the whole payload before replacing it; partial updates and server-derived version fields are rejected."
              : hasExistingConfiguration
                ? "A legacy configuration exists without a canonical rule payload. Paste its complete reviewed rule before replacing it; partial updates are rejected."
                : "The starter is deliberately review-only. Replace every Unspecified or uncertain rule and add source evidence before relying on candidate output."}
          </p>
          <button
            className="mt-6 rounded-lg border border-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent)] disabled:cursor-not-allowed disabled:border-[var(--border)] disabled:text-[var(--muted)]"
            type="submit"
          >
            Save complete configuration
          </button>
        </fieldset>
      </form>

      {disabled ? (
        <p className="mt-4 text-sm text-[var(--muted)]">
          Configuration editing stays disabled until the owner-scoped database
          read model is connected.
        </p>
      ) : null}
    </section>
  );
}
