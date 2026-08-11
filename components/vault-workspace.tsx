import type {
  OwnerVaultCatalogueFilters,
  OwnerVaultCataloguePageState,
} from "@/lib/owner-vault-catalogue-service";

const connectionCopy = {
  identity_not_connected: {
    heading: "Owner identity not connected",
    detail:
      "Sign in with the authorised owner account to view or maintain the private Vault.",
  },
  persistence_not_configured: {
    heading: "Private Vault storage not connected",
    detail:
      "The owner account is recognised, but the private database runtime is not configured yet.",
  },
  connected: {
    heading: "Private Vault connected",
    detail:
      "Current ownership and Maiden Eligibility are maintained here against durable Core Details IDs.",
  },
} as const;

function selected(value: string | null, candidate: string) {
  return value === candidate;
}

function FilterForm({ filters }: Readonly<{ filters: OwnerVaultCatalogueFilters }>) {
  return (
    <form className="grid gap-4 md:grid-cols-2 xl:grid-cols-6" method="get">
      <input name="scope" type="hidden" value="vault" />
      <label className="xl:col-span-2">
        <span className="text-sm font-medium">Core name or ID</span>
        <input
          className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
          defaultValue={filters.query ?? ""}
          maxLength={128}
          name="query"
          placeholder="Search My Vault"
          type="search"
        />
      </label>
      <label>
        <span className="text-sm font-medium">Element</span>
        <select
          className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
          defaultValue={filters.element ?? ""}
          name="element"
        >
          <option value="">All</option>
          {(["Metal", "Fire", "Earth", "Water"] as const).map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className="text-sm font-medium">Breed / class</span>
        <select
          className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
          defaultValue={filters.coreClass ?? ""}
          name="coreClass"
        >
          <option value="">All</option>
          {(["Genesis", "Morphed", "Freak", "X-Class"] as const).map(
            (value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ),
          )}
        </select>
      </label>
      <label>
        <span className="text-sm font-medium">Sex</span>
        <select
          className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
          defaultValue={filters.sex ?? ""}
          name="sex"
        >
          <option value="">All</option>
          <option value="female">Female</option>
          <option value="male">Male</option>
        </select>
      </label>
      <label>
        <span className="text-sm font-medium">F-number</span>
        <input
          className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
          defaultValue={filters.fNumber ?? ""}
          min={1}
          name="fNumber"
          type="number"
        />
      </label>
      <div className="flex items-end gap-3 md:col-span-2 xl:col-span-6">
        <button
          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
          type="submit"
        >
          Apply filters
        </button>
        <a
          className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold"
          href="/vault"
        >
          Clear
        </a>
      </div>
    </form>
  );
}

export function VaultWorkspace({
  state,
}: Readonly<{ state: OwnerVaultCataloguePageState }>) {
  const connection = connectionCopy[state.connectionStatus];
  const meEligibleCount = state.cores.filter((core) => core.meEligible).length;

  return (
    <div className="space-y-8">
      <header className="max-w-4xl">
        <p className="text-sm font-semibold text-[var(--accent)]">Private owner Vault</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          My Vault
        </h1>
        <p className="mt-4 text-base leading-7 text-[var(--muted)]">
          Search the accepted Core Details catalogue and maintain current private
          ownership separately from imported race history. Race results never
          infer whether a core is currently owned.
        </p>
      </header>

      <section
        aria-labelledby="vault-connection"
        className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6"
      >
        <h2 className="text-lg font-semibold" id="vault-connection">
          {connection.heading}
        </h2>
        <p className="mt-2 max-w-4xl text-sm leading-6 text-[var(--muted)]">
          {connection.detail}
        </p>
      </section>

      <section
        aria-labelledby="vault-filters"
        className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6"
      >
        <h2 className="text-lg font-semibold" id="vault-filters">
          Find owned cores
        </h2>
        <div className="mt-4">
          <FilterForm filters={state.filters} />
        </div>
      </section>

      <section aria-labelledby="vault-summary">
        <h2 className="text-xl font-semibold" id="vault-summary">
          Current Vault
        </h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5">
            <dt className="text-sm text-[var(--muted)]">Matching owned cores</dt>
            <dd className="mt-2 text-2xl font-semibold tabular-nums">
              {state.cores.length.toLocaleString("en-AU")}
            </dd>
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5">
            <dt className="text-sm text-[var(--muted)]">ME eligible</dt>
            <dd className="mt-2 text-2xl font-semibold tabular-nums">
              {meEligibleCount.toLocaleString("en-AU")}
            </dd>
          </div>
        </dl>
      </section>

      <section
        aria-labelledby="owned-core-registry"
        className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6"
      >
        <h2 className="text-lg font-semibold" id="owned-core-registry">
          Owned-core registry
        </h2>
        {state.cores.length === 0 ? (
          <p className="mt-4 leading-7 text-[var(--muted)]">
            No owned cores match these filters. Use Search Core when you want to
            inspect a game-wide core that is not currently in My Vault.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-[var(--border)]">
            {state.cores.map((core) => (
              <li className="grid gap-3 py-4 md:grid-cols-[1fr_auto]" key={core.sourceCoreId}>
                <div>
                  <p className="font-semibold">{core.displayName}</p>
                  <p className="mt-1 font-mono text-sm text-[var(--muted)]">
                    {core.sourceCoreId}
                  </p>
                  <p className="mt-2 text-sm text-[var(--muted)]">
                    {core.element} · {core.coreClass} · {core.sex} · F{core.fNumber}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 md:justify-end">
                  <span className="rounded-full border border-[var(--border)] px-3 py-1 text-xs font-semibold">
                    In My Vault
                  </span>
                  <span className="rounded-full border border-[var(--border)] px-3 py-1 text-xs font-semibold">
                    {core.meEligible ? "ME eligible" : "Not ME eligible"}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-sm leading-6 text-[var(--muted)]">
        Maiden Eligibility is private current state and only applies to an active
        owned core. It remains separate from ownership and historical race evidence.
      </p>
    </div>
  );
}
