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
    state.generationId !== null &&
    state.rosterVersionId !== null;

  return (
    <section
      aria-labelledby="pro-league-plan-persistence"
      className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5"
    >
      <h2 className="text-lg font-semibold" id="pro-league-plan-persistence">
        Owner roster persistence
      </h2>
      {state.status === "saved" ? (
        <div className="mt-3 text-sm leading-6">
          <p className="font-semibold text-[var(--accent)]">
            Immutable 25-Core roster persisted
          </p>
          <p className="mt-1 text-[var(--muted)]">
            Roster saved {timestamp(state.rosterSavedAt)}. Full-gate map
            persistence remains separate and pending; nothing was submitted to
            DNA Esports.
          </p>
        </div>
      ) : (
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
          {state.status === "not_saved"
            ? "The approved generated 25-Core roster is ready for an explicit owner persistence confirmation. The legacy one-Core-per-line repository is not used for the approved full-gate plan."
            : state.status === "persistence_not_configured"
              ? "The owner-scoped roster repository is not configured in this environment."
              : state.status === "read_failed"
                ? "The saved roster state could not be verified. No replacement roster is shown."
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
              Persist this exact accepted 25-Core roster. This does not register
              a team, submit a roster, set a map, enter a race or perform any
              game action.
            </span>
          </label>
          <button
            className="rounded-lg border border-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent)] disabled:opacity-50"
            disabled={pending}
            type="submit"
          >
            {pending ? "Persisting…" : "Persist owner roster"}
          </button>
          <p aria-live="polite" className="text-sm text-[var(--muted)]">
            {result === "confirmed"
              ? "Owner roster persisted. Refreshing saved evidence."
              : result === "unconfirmed"
                ? "Persistence was not confirmed. Refresh and verify the accepted generation before retrying."
                : ""}
          </p>
        </form>
      ) : null}
    </section>
  );
}
