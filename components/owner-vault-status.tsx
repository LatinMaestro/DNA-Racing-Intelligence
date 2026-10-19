import Link from "next/link";

import {
  OWNER_VAULT_LIST_LIMIT,
  type OwnerVaultCataloguePageState,
} from "@/lib/owner-vault-catalogue-service";

const cappedResultsNotice =
  `The owner-scoped Vault list reached its ${OWNER_VAULT_LIST_LIMIT.toLocaleString("en-AU")}-core limit. ` +
  "Active and ME-eligible counts describe returned records, not verified totals; additional owned cores may be omitted.";

const unavailableCopy = {
  identity_not_connected: {
    badge: "Owner setup pending",
    detail: null,
  },
  persistence_not_configured: {
    badge: "Owner setup pending",
    detail: null,
  },
  read_failed: {
    badge: "Vault read unavailable",
    detail:
      "The owner-scoped Vault read failed. Counts are withheld rather than shown as zero or recovered from historical races.",
  },
  integrity_failed: {
    badge: "Vault validation failed",
    detail:
      "The saved Vault projection failed validation. Counts are withheld until the owner registry is repaired.",
  },
} as const;

export function OwnerVaultStatus({
  state,
}: Readonly<{ state: OwnerVaultCataloguePageState }>) {
  const connected = state.connectionStatus === "connected";
  const meEligible = state.cores.filter((core) => core.meEligible).length;
  const atResultLimit =
    connected && state.cores.length >= OWNER_VAULT_LIST_LIMIT;
  const unavailable = connected
    ? null
    : unavailableCopy[state.connectionStatus];

  return (
    <section
      aria-label="My Vault owner-maintained status"
      className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold tracking-wider text-[var(--accent)] uppercase">
            My Vault
          </p>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Owner-maintained current ownership and ME eligibility.
          </p>
        </div>
        <span className="rounded-full border border-[var(--border)] px-3 py-1 text-xs font-semibold text-[var(--warning)]">
          {connected ? "Owner registry connected" : unavailable?.badge}
        </span>
      </div>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-[var(--muted)]">Active cores shown</dt>
          <dd className="mt-1 font-medium">
            {connected
              ? state.cores.length.toLocaleString("en-AU")
              : "Not available"}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">ME eligible shown</dt>
          <dd className="mt-1 font-medium">
            {connected ? meEligible.toLocaleString("en-AU") : "Not available"}
          </dd>
        </div>
      </dl>
      {atResultLimit ? (
        <p
          className="mt-4 text-xs leading-5 text-[var(--warning)]"
          role="status"
        >
          {cappedResultsNotice}
        </p>
      ) : null}
      {unavailable?.detail ? (
        <p
          className="mt-4 text-xs leading-5 text-[var(--warning)]"
          role="status"
        >
          {unavailable.detail}
        </p>
      ) : null}
      <p className="mt-4 text-xs leading-5 text-[var(--muted)]">
        This private registry is the current-state authority. It is maintained
        in the website and is not inferred from historical races or a Vault CSV.
      </p>
      <Link
        className="mt-4 inline-flex rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-semibold"
        href="/vault"
      >
        Open My Vault
      </Link>
    </section>
  );
}
