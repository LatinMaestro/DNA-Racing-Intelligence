import Link from "next/link";

import type { TournamentCandidateRankingResult } from "@/domain/tournament-candidate-ranking";
import {
  tournamentModes,
  type TournamentMode,
} from "@/domain/tournament-configuration";
import type { TournamentWorkspaceConnectionStatus } from "@/lib/tournament-workspace-service";

type SaveAction = (formData: FormData) => Promise<void>;

export type TournamentEditorSelection =
  | Readonly<{
      kind: "existing";
      tournamentId: string;
      bracketId: string;
    }>
  | Readonly<{ kind: "new"; mode: TournamentMode }>
  | null;

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
  if (configuration.campaignAction?.kind === "configured") {
    editable.campaignAction = null;
  }
  return JSON.stringify(editable, null, 2);
}

/**
 * An unconfirmed complete-rule template, not a real event or a prediction.
 * The owner must replace its identifiers, format, distance and source evidence.
 */
export function tournamentStarterConfiguration(mode: TournamentMode): string {
  return JSON.stringify(
    {
      tournamentId: "replace-with-tournament-id",
      tournamentLabel: "Unspecified tournament",
      seasonLabel: "Unspecified",
      qualificationStartsAt: null,
      qualificationEndsAt: null,
      bracketId: `replace-with-${mode}-split-id`,
      splitLabel: "Unspecified split",
      mode,
      eligibleDistancesMetres: [1000],
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
}

function selectedBracketLink(tournamentId: string, bracketId: string): string {
  return (
    `/tournaments?tournamentId=${encodeURIComponent(tournamentId)}` +
    `&bracketId=${encodeURIComponent(bracketId)}`
  );
}

export function TournamentConfigurationForm({
  brackets,
  connectionStatus,
  saveAction,
  selection = null,
}: Readonly<{
  brackets: readonly TournamentCandidateRankingResult[];
  connectionStatus: TournamentWorkspaceConnectionStatus;
  saveAction: SaveAction;
  selection?: TournamentEditorSelection;
}>) {
  const creating =
    selection?.kind === "new" ||
    (selection === null && brackets.length === 0);
  const creationMode = selection?.kind === "new" ? selection.mode : "bike";
  const selectedBracket =
    selection?.kind === "new"
      ? undefined
      : selection?.kind === "existing"
        ? brackets.find(
            (bracket) =>
              bracket.tournamentId === selection.tournamentId &&
              bracket.bracketId === selection.bracketId,
          )
        : (brackets.find(
            (bracket) => bracket.ruleConfiguration !== undefined,
          ) ?? brackets[0]);
  const missingSelection =
    selection?.kind === "existing" && selectedBracket === undefined;
  const existingConfiguration = selectedBracket?.ruleConfiguration;
  const disabled =
    connectionStatus !== "read_model_connected" || missingSelection;
  const editorKey = creating
    ? `new-${creationMode}`
    : selectedBracket === undefined
      ? "no-current-split"
      : JSON.stringify([
          selectedBracket.tournamentId,
          selectedBracket.bracketId,
        ]);
  const editorValue = creating
    ? tournamentStarterConfiguration(creationMode)
    : existingConfiguration === undefined
      ? ""
      : editableConfiguration(existingConfiguration);

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
          Select the exact saved event and split to edit, or start a new Bike,
          Car or Horse split. The full owner-approved rule payload is retained,
          including formats, gate counts, groupings and qualification scoring.
          Versions and timestamps are derived by the server. Every rule change
          invalidates previously bound candidate evidence and campaign
          acknowledgements. This editor never submits a Tournament entry.
        </p>
      </div>

      <nav aria-label="Tournament split editor" className="mt-6 space-y-3">
        <p className="text-sm font-semibold">Saved events and splits</p>
        {brackets.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">
            No saved Tournament split yet. Start with a mode-specific review
            draft below.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {brackets.map((bracket) => {
              const active =
                !creating &&
                selectedBracket?.tournamentId === bracket.tournamentId &&
                selectedBracket.bracketId === bracket.bracketId;
              return (
                <Link
                  aria-current={active ? "page" : undefined}
                  className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:underline"
                  href={selectedBracketLink(
                    bracket.tournamentId,
                    bracket.bracketId,
                  )}
                  key={JSON.stringify([
                    bracket.tournamentId,
                    bracket.bracketId,
                  ])}
                >
                  {bracket.tournamentLabel} — {bracket.splitLabel} (
                  {bracket.mode})
                </Link>
              );
            })}
          </div>
        )}
        <p className="text-sm font-semibold">New event or split</p>
        <div className="flex flex-wrap gap-2">
          {tournamentModes.map((mode) => (
            <Link
              aria-current={
                creating && creationMode === mode ? "page" : undefined
              }
              className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:underline"
              href={`/tournaments?create=${mode}`}
              key={mode}
            >
              New {mode.charAt(0).toUpperCase() + mode.slice(1)} split
            </Link>
          ))}
        </div>
      </nav>

      {missingSelection ? (
        <p className="mt-4 text-sm text-[var(--warning)]" role="status">
          The selected saved tournament and split no longer exist. Choose a
          listed split or start a new review draft before saving.
        </p>
      ) : selectedBracket !== undefined ? (
        <p className="mt-4 text-sm" role="status">
          Editing saved {selectedBracket.mode} split:{" "}
          <strong>
            {selectedBracket.tournamentLabel} — {selectedBracket.splitLabel}
          </strong>
        </p>
      ) : creating ? (
        <p className="mt-4 text-sm text-[var(--muted)]" role="status">
          New {creationMode} review draft. Replace the example identifiers,
          distance, gates, format, fees, qualification rules and missing source
          evidence before relying on it.
        </p>
      ) : null}

      <form action={saveAction} className="mt-6">
        <fieldset disabled={disabled}>
          <label className="block text-sm font-medium">
            Complete Tournament rule configuration
            <textarea
              aria-describedby="tournament-configuration-guidance"
              className="mt-2 min-h-[34rem] w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-mono text-sm"
              defaultValue={editorValue}
              key={editorKey}
              name="ruleConfiguration"
              required
              spellCheck={false}
            />
          </label>
          <p
            className="mt-3 text-sm leading-6 text-[var(--muted)]"
            id="tournament-configuration-guidance"
          >
            {existingConfiguration !== undefined && !creating
              ? "The exact selected stored rule is prefilled. Review the full payload before replacing this split; partial updates and server-derived version fields are rejected."
              : selectedBracket !== undefined
                ? "This legacy split has no canonical rule payload. Supply the full reviewed configuration before saving."
                : missingSelection
                  ? "Select a valid saved split or use a new mode-specific draft."
                  : "The starter is review-only, not an authoritative event. Replace placeholder values and add confirmed source evidence before relying on rankings."}
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
          {missingSelection
            ? "The selected event is unavailable for editing."
            : "Configuration editing stays disabled until the owner-scoped database read model is connected."}
        </p>
      ) : null}
    </section>
  );
}

export function TournamentCampaignActionForm({
  brackets,
  connectionStatus,
  acknowledgementAction,
}: Readonly<{
  brackets: readonly TournamentCandidateRankingResult[];
  connectionStatus: TournamentWorkspaceConnectionStatus;
  acknowledgementAction: SaveAction;
}>) {
  const configurations = brackets
    .map((bracket) => bracket.ruleConfiguration)
    .filter(
      (configuration): configuration is NonNullable<typeof configuration> =>
        configuration !== undefined,
    );

  return (
    <section
      aria-labelledby="tournament-campaign-action"
      className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6"
    >
      <h2 className="text-xl font-semibold" id="tournament-campaign-action">
        Acknowledge campaign guidance
      </h2>
      <p className="mt-3 leading-7 text-[var(--muted)]">
        An acknowledgement is bound to the exact stored rule and candidate
        snapshot. Any later rule, Vault, Core Details, Race Merge, benchmark or
        star-profile drift makes it review-only again. This records an owner
        review; it never enters a race.
      </p>
      <div className="mt-6 space-y-6">
        {configurations.map((configuration) => {
          const unbound =
            connectionStatus !== "read_model_connected" ||
            configuration.candidateSnapshotVersion === null ||
            configuration.candidateSnapshotVersion === "snapshot-unbound";
          return (
            <form
              action={acknowledgementAction}
              className="rounded-xl border border-[var(--border)] p-4"
              key={`${configuration.tournamentId}:${configuration.bracketId}`}
            >
              <p className="font-semibold">
                {configuration.tournamentLabel} — {configuration.splitLabel}
              </p>
              <input
                name="tournamentId"
                type="hidden"
                value={configuration.tournamentId}
              />
              <input
                name="bracketId"
                type="hidden"
                value={configuration.bracketId}
              />
              <input
                name="configurationVersion"
                type="hidden"
                value={configuration.configurationVersion}
              />
              <input
                name="candidateSnapshotVersion"
                type="hidden"
                value={
                  configuration.candidateSnapshotVersion ?? "snapshot-unbound"
                }
              />
              <label className="mt-4 block text-sm font-medium">
                Reviewed guidance
                <input
                  className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
                  disabled={unbound}
                  maxLength={200}
                  name="action"
                  required
                />
              </label>
              <label className="mt-4 block text-sm font-medium">
                Evidence reviewed
                <textarea
                  className="mt-2 min-h-24 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
                  disabled={unbound}
                  maxLength={2000}
                  name="evidence"
                  required
                />
              </label>
              <button
                className="mt-4 rounded-lg border border-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent)] disabled:cursor-not-allowed disabled:border-[var(--border)] disabled:text-[var(--muted)]"
                disabled={unbound}
                type="submit"
              >
                Bind acknowledgement
              </button>
              {unbound ? (
                <p className="mt-3 text-sm text-[var(--muted)]">
                  A current candidate snapshot is required before
                  acknowledgement.
                </p>
              ) : null}
            </form>
          );
        })}
      </div>
    </section>
  );
}
