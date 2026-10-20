"use client";

import { useActionState } from "react";
import {
  submitImportAggregateRetryFormAction,
  type ImportAggregateRetryFormState,
} from "@/app/(private)/imports/actions";

export function ImportAggregateRetryControl({
  failedRefreshId,
}: Readonly<{ failedRefreshId: string }>) {
  const [result, formAction, pending] = useActionState<
    ImportAggregateRetryFormState | null,
    FormData
  >(submitImportAggregateRetryFormAction, null);
  const suffix = failedRefreshId.replaceAll(/[^a-zA-Z0-9_-]/g, "-");
  const reasonId = `aggregate-retry-reason-${suffix}`;
  const confirmationId = `aggregate-retry-confirm-${suffix}`;

  return (
    <form
      action={formAction}
      aria-label="Retry failed aggregate refresh"
      className="w-full rounded-lg border border-[var(--warning)]/50 p-4"
    >
      <input name="failedRefreshId" type="hidden" value={failedRefreshId} />
      <label className="grid gap-2 text-sm" htmlFor={reasonId}>
        Retry reason
        <textarea
          className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2"
          disabled={pending}
          id={reasonId}
          maxLength={500}
          minLength={10}
          name="retryReason"
          placeholder="Why this failed aggregate refresh should run again"
          required
          rows={2}
        />
      </label>
      <label
        className="mt-3 flex items-start gap-2 text-sm"
        htmlFor={confirmationId}
      >
        <input
          disabled={pending}
          id={confirmationId}
          name="explicitlyConfirmed"
          required
          type="checkbox"
          value="yes"
        />
        <span>
          Queue this failed aggregate refresh for background processing.
        </span>
      </label>
      <button
        className="mt-3 rounded-lg border border-[var(--warning)] px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? "Queueing retry…" : "Retry aggregate refresh"}
      </button>
      {result === null ? null : (
        <p
          aria-live="polite"
          className="mt-3 text-sm leading-6 text-[var(--muted)]"
          role="status"
        >
          <strong>{result.title}.</strong> {result.detail}
        </p>
      )}
    </form>
  );
}
