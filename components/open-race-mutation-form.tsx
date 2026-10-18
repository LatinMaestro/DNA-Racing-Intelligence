"use client";

import { useActionState, type ReactNode } from "react";

import {
  lockOpenRaceSessionFormAction,
  recordOpenRaceObservationFormAction,
} from "@/app/(private)/open-race/actions";

type MutationState = "idle" | "confirmed" | "unconfirmed";
type Operation = "lock" | "observation";

export function OpenRaceMutationFeedback({
  state,
  pending,
  operation,
}: Readonly<{ state: MutationState; pending: boolean; operation: Operation }>) {
  if (pending) return <p role="status">Saving evidence…</p>;
  if (state === "idle") return null;
  return (
    <div className="mt-3 text-sm leading-6">
      <p role={state === "confirmed" ? "status" : "alert"}>
        {state === "confirmed"
          ? operation === "lock"
            ? "Field lock saved. Review the refreshed session before recording stars."
            : "Diagnostic observation saved. It remains separate from accepted race results."
          : "Save could not be confirmed. A write might have completed. Reload and check the session before trying again."}
      </p>
      <button
        className="font-semibold text-[var(--accent)] underline"
        onClick={() => window.location.reload()}
        type="button"
      >
        Reload and review session
      </button>
    </div>
  );
}

export function OpenRaceMutationForm({
  operation,
  children,
}: Readonly<{ operation: Operation; children: ReactNode }>) {
  const [state, formAction, pending] = useActionState(
    operation === "lock"
      ? lockOpenRaceSessionFormAction
      : recordOpenRaceObservationFormAction,
    "idle" as MutationState,
  );
  return (
    <form
      action={formAction}
      aria-label={
        operation === "lock"
          ? "Record field lock"
          : "Record diagnostic observation"
      }
      aria-busy={pending}
      className="mt-5 rounded-xl border border-[var(--warning)]/50 bg-[var(--surface)] p-4"
    >
      <fieldset disabled={pending || state !== "idle"}>
        {children}
        <button
          className="mt-4 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          type="submit"
        >
          {pending
            ? "Saving…"
            : operation === "lock"
              ? "Record field lock"
              : "Record diagnostic observation"}
        </button>
      </fieldset>
      <OpenRaceMutationFeedback
        state={state}
        pending={pending}
        operation={operation}
      />
    </form>
  );
}
