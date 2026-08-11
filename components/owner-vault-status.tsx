import Link from "next/link";

import type { OwnerVaultCataloguePageState } from "@/lib/owner-vault-catalogue-service";

export function OwnerVaultStatus({
  state,
}: Readonly<{ state: OwnerVaultCataloguePageState }>) {
  const connected = state.connectionStatus === "connected";
  const meEligible = state.cores.filter((core) => core.meEligible).length;

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
          {connected ? "Owner registry connected" : "Owner setup pending"}
        </span>
      </div>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-[var(--muted)]">Active cores</dt>
          <dd className="mt-1 font-medium">
            {connected
              ? state.cores.length.toLocaleString("en-AU")
              : "Not available"}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">ME eligible</dt>
          <dd className="mt-1 font-medium">
            {connected ? meEligible.toLocaleString("en-AU") : "Not available"}
          </dd>
        </div>
      </dl>
      <p className="mt-4 text-xs leading-5 text-[var(--muted)]">
        This private registry is the current-state authority. It is maintained in
        the website and is not inferred from historical races or a Vault CSV.
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
