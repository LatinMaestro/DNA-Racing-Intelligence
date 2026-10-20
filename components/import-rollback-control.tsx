"use client";

import { useActionState } from "react";
import {
  submitImportRollbackFormAction,
  type ImportRollbackFormState,
} from "@/app/(private)/imports/actions";

export function ImportRollbackControl({
  batchId,
}: Readonly<{ batchId: string }>) {
  const [result, formAction, pending] = useActionState<
    ImportRollbackFormState | null,
    FormData
  >(submitImportRollbackFormAction, null);
  const fieldSuffix = batchId.replaceAll(/[^a-zA-Z0-9_-]/g, "-");
  const reasonId = `rollback-reason-${fieldSuffix}`;
  const confirmationId = `rollback-confirm-${fieldSuffix}`;

  return (
    <form
      action={formAction}
      aria-label="Restore prior accepted dataset"
      className="w-full rounded-lg border border-[var(--warning)]/50 p-4"
    >
      <input name="batchId" type="hidden" value={batchId} />
      <label className="grid gap-2 text-sm" htmlFor={reasonId}>
        Rollback reason
        <textarea
          className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2"
          disabled={pending}
          id={reasonId}
          maxLength={500}
          minLength={10}
          name="rollbackReason"
          placeholder="Why the prior accepted dataset should be restored"
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
          Restore the prior accepted version and queue its aggregate refresh.
        </span>
      </label>
      <button
        className="mt-3 rounded-lg border border-[var(--warning)] px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? "Recording rollback…" : "Restore prior accepted dataset"}
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
