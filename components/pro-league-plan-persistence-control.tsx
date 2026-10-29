"use client";

import { useActionState } from "react";
import { confirmProLeaguePlanFormAction } from "@/app/(private)/pro-league/actions";
import type { ProLeaguePlanPersistenceState } from "@/lib/pro-league-plan-persistence-service";

function timestamp(value: string | null): string {
  if (value === null) return "Unavailable";
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

export function ProLeaguePlanPersistenceControl({
  state,
}: Readonly<{ state: ProLeaguePlanPersistenceState }>) {
  const [result, action, pending] = useActionState(
    confirmProLeaguePlanFormAction,
    "idle",
  );
  const canConfirm =
    state.status === "not_saved" &&
    state.requiredAssignmentCount === 1_021 &&
    state.generationId !== null &&
    state.rosterVersionId !== null &&
    state.lineupVersionId !== null;

  return (
    <section
      aria-labelledby="pro-league-plan-persistence"
      className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5"
    >
      <h2 className="text-lg font-semibold" id="pro-league-plan-persistence">
        Owner roster and map persistence
      </h2>
      {state.status === "saved" ? (
        <div className="mt-3 text-sm leading-6">
          <p className="font-semibold text-[var(--accent)]">
            Immutable roster and full-gate maps persisted
          </p>
          <p className="mt-1 text-[var(--muted)]">
            Roster saved {timestamp(state.rosterSavedAt)}; all four maps and
            1,021 gate assignments saved {timestamp(state.lineupSavedAt)}.
            Nothing was submitted to DNA Esports.
          </p>
        </div>
      ) : (
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
          {state.status === "lead_only_saved"
            ? `The immutable 25-Core roster and ${state.persistedAssignmentCount ?? 0} lead-Core race lines are saved, but the full-gate plan requires ${state.requiredAssignmentCount ?? "unknown"} Core assignments. Full-gate persistence is not commissioned; no game action was submitted.`
            : state.status === "not_saved"
              ? state.persistedAssignmentCount === state.requiredAssignmentCount
                ? "The approved generated 25-Core roster and complete full-gate assignments are ready for explicit owner persistence confirmation."
                : "The approved generated 25-Core roster and all 1,021 full-gate assignments are ready for explicit owner persistence confirmation."
              : state.status === "persistence_not_configured"
                ? "The owner-scoped roster and lineup repositories are not configured in this environment."
                : state.status === "read_failed"
                  ? state.failureStage === "lineup_read"
                    ? "The saved lineup state could not be verified. No replacement maps are shown."
                    : state.failureStage === "integrity"
                      ? "The saved roster or lineup did not match the accepted generation. No replacement plan is shown."
                      : "The saved roster state could not be verified. No replacement roster is shown."
                  : "No complete accepted 25-Core roster is available to persist."}
        </p>
      )}
      {canConfirm ? (
        <form action={action} className="mt-4 space-y-3">
          <input
            name="expectedGenerationId"
            type="hidden"
            value={state.generationId ?? ""}
          />
          <input
            name="expectedLineupVersionId"
            type="hidden"
            value={state.lineupVersionId ?? ""}
          />
          <input
            name="expectedRosterVersionId"
            type="hidden"
            value={state.rosterVersionId ?? ""}
          />
          <label className="flex items-start gap-3 text-sm">
            <input
              className="mt-1"
              name="confirmed"
              required
              type="checkbox"
              value="confirmed"
            />
            <span>
              Persist this exact accepted 25-Core roster and its four complete
              full-gate maps. This does not register a team, submit a roster,
              set a game map, enter a race or perform any game action.
            </span>
          </label>
          <button
            className="rounded-lg border border-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent)] disabled:opacity-50"
            disabled={pending}
            type="submit"
          >
            {pending ? "Persisting…" : "Persist roster and maps"}
          </button>
          <p aria-live="polite" className="text-sm text-[var(--muted)]">
            {result === "confirmed"
              ? "Owner roster and maps persisted. Refreshing saved evidence."
              : result === "unconfirmed"
                ? "Persistence was not confirmed. Refresh and verify the accepted generation before retrying."
                : ""}
          </p>
        </form>
      ) : null}
    </section>
  );
}
