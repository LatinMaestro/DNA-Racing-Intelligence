"use client";

import { useActionState } from "react";

import { updateVaultCoreFormAction } from "@/app/(private)/vault/actions";
import type { OwnerVaultActionResult } from "@/lib/owner-vault-action-service";
import type { OwnerVaultCatalogueCore } from "@/lib/owner-vault-catalogue-service";

type MutationStatus = "idle" | OwnerVaultActionResult["status"];

const feedback: Record<Exclude<MutationStatus, "idle">, string> = {
  updated:
    "Vault change confirmed. Check the refreshed state before another action.",
  identity_not_connected:
    "Change not confirmed. Sign in as the authorised owner before trying again.",
  persistence_not_configured:
    "Change unavailable because private Vault storage is not configured.",
  invalid_request: "Change rejected. Refresh this page before trying again.",
  conflict:
    "Vault state has changed since this page loaded. Refresh and verify the current state before retrying.",
  core_unavailable:
    "This Core is not available for the requested change. Refresh and review its current state.",
  idempotency_conflict:
    "A conflicting repeated request was detected. Verify the current Vault state before retrying.",
  persistence_unavailable:
    "The result could not be confirmed. Check the current Vault state before retrying; an earlier write might have completed.",
};

export function ownerVaultMutationMessage(
  status: MutationStatus,
): string | null {
  return status === "idle" ? null : feedback[status];
}

export function OwnerVaultMutationForm({
  core,
}: Readonly<{ core: OwnerVaultCatalogueCore }>) {
  const [status, formAction, pending] = useActionState(
    updateVaultCoreFormAction,
    "idle" as MutationStatus,
  );
  if (core.version === null || core.meEligible === null) return null;
  const message = ownerVaultMutationMessage(status);
  const statusClassName =
    status === "updated" ? "text-[var(--muted)]" : "text-[var(--warning)]";
  const buttonClassName =
    "rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-raised)] disabled:cursor-wait disabled:opacity-60";

  return (
    <form
      action={formAction}
      aria-label={`Update Vault state for ${core.displayName}`}
      className="flex flex-wrap items-center gap-2"
    >
      <input name="sourceCoreId" type="hidden" value={core.sourceCoreId} />
      <input
        name="expectedVersion"
        type="hidden"
        value={core.version.toString()}
      />
      {core.inMyVault ? (
        <>
          <button
            className={buttonClassName}
            disabled={pending}
            name="operation"
            type="submit"
            value="remove"
          >
            {pending ? "Saving…" : "Remove from My Vault"}
          </button>
          <button
            className={buttonClassName}
            disabled={pending}
            name="operation"
            type="submit"
            value={core.meEligible ? "me_off" : "me_on"}
          >
            {pending
              ? "Saving…"
              : core.meEligible
                ? "ME: Eligible · turn off"
                : "ME: Not eligible · turn on"}
          </button>
        </>
      ) : (
        <button
          className={buttonClassName}
          disabled={pending}
          name="operation"
          type="submit"
          value="add"
        >
          {pending ? "Saving…" : "Add to My Vault"}
        </button>
      )}
      {message === null ? null : (
        <p
          className={`basis-full text-xs leading-5 ${statusClassName}`}
          role={status === "updated" ? "status" : "alert"}
        >
          {message}
        </p>
      )}
    </form>
  );
}
