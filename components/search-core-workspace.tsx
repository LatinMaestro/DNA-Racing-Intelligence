import Link from "next/link";

import {
  ownerVaultClasses,
  ownerVaultElements,
  ownerVaultSexes,
  type OwnerVaultCataloguePageState,
} from "@/lib/owner-vault-catalogue-service";

function optionLabel(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function SearchCoreWorkspace({
  state,
}: Readonly<{ state: OwnerVaultCataloguePageState }>) {
  const connected = state.connectionStatus === "connected";

  return (
    <div className="space-y-8">
      <header className="max-w-4xl">
        <p className="text-sm font-semibold text-[var(--accent)]">
          Game-wide due diligence
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          Search Core
        </h1>
        <p className="mt-4 text-base leading-7 text-[var(--muted)]">
          Search accepted Core Details by name or Core ID before considering a
          marketplace purchase. This is a private research view only: it does not
          connect a wallet, buy a core or infer current ownership from race history.
        </p>
      </header>

      <form
        action="/search-core"
        className="grid gap-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5 md:grid-cols-2 xl:grid-cols-6"
        method="get"
      >
        <label className="md:col-span-2 xl:col-span-2">
          <span className="text-sm font-semibold">Name or Core ID</span>
          <input
            className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
            defaultValue={state.filters.query ?? ""}
            maxLength={128}
            name="q"
            placeholder="Search game-wide Core Details"
            type="search"
          />
        </label>
        <label>
          <span className="text-sm font-semibold">Element</span>
          <select
            className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
            defaultValue={state.filters.element ?? ""}
            name="element"
          >
            <option value="">All</option>
            {ownerVaultElements.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="text-sm font-semibold">Breed / class</span>
          <select
            className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
            defaultValue={state.filters.coreClass ?? ""}
            name="coreClass"
          >
            <option value="">All</option>
            {ownerVaultClasses.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="text-sm font-semibold">Sex</span>
          <select
            className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
            defaultValue={state.filters.sex ?? ""}
            name="sex"
          >
            <option value="">All</option>
            {ownerVaultSexes.map((value) => (
              <option key={value} value={value}>
                {optionLabel(value)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="text-sm font-semibold">F-number</span>
          <input
            className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
            defaultValue={state.filters.fNumber?.toString() ?? ""}
            min={1}
            name="fNumber"
            placeholder="Any"
            type="number"
          />
        </label>
        <div className="flex items-end gap-2 md:col-span-2 xl:col-span-6">
          <button
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
            type="submit"
          >
            Search
          </button>
          <Link
            className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold"
            href="/search-core"
          >
            Clear
          </Link>
        </div>
      </form>

      {!connected ? (
        <section className="rounded-2xl border border-[var(--warning)]/50 bg-[var(--surface-raised)] p-6">
          <h2 className="text-lg font-semibold">Search Core is not connected</h2>
          <p className="mt-3 text-[var(--muted)]">
            {state.connectionStatus === "identity_not_connected"
              ? "Sign in with the authorised private owner account to use Search Core."
              : "The private database runtime is not configured for this environment."}
          </p>
        </section>
      ) : (
        <section aria-labelledby="search-core-results">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold" id="search-core-results">
                Core Details results
              </h2>
              <p className="mt-2 text-sm text-[var(--muted)]">
                {state.cores.length.toLocaleString("en-AU")} matching core
                {state.cores.length === 1 ? "" : "s"}. Results are bounded to 50.
              </p>
            </div>
          </div>

          {state.cores.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6">
              <p className="font-semibold">No Core Details match these filters.</p>
            </div>
          ) : (
            <div className="mt-4 grid gap-4 xl:grid-cols-2">
              {state.cores.map((core) => (
                <article
                  className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5"
                  key={core.sourceCoreId}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold">
                        {core.displayName}
                      </h3>
                      <p className="mt-1 text-sm text-[var(--muted)]">
                        Core ID {core.sourceCoreId}
                      </p>
                    </div>
                    <span className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs font-semibold">
                      {core.inMyVault ? "In My Vault" : "Not in My Vault"}
                    </span>
                  </div>
                  <dl className="mt-5 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                    <div>
                      <dt className="text-[var(--muted)]">Element</dt>
                      <dd className="mt-1 font-semibold">{core.element}</dd>
                    </div>
                    <div>
                      <dt className="text-[var(--muted)]">Breed / class</dt>
                      <dd className="mt-1 font-semibold">{core.coreClass}</dd>
                    </div>
                    <div>
                      <dt className="text-[var(--muted)]">Sex</dt>
                      <dd className="mt-1 font-semibold">
                        {optionLabel(core.sex)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[var(--muted)]">F-number</dt>
                      <dd className="mt-1 font-semibold">F{core.fNumber}</dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6">
        <h2 className="text-lg font-semibold">Evidence boundary</h2>
        <p className="mt-3 max-w-4xl text-sm leading-6 text-[var(--muted)]">
          This first Search Core view exposes authoritative Core Details and the
          separately maintained My Vault state. Historical mode/distance,
          benchmark and lineage evidence will remain clearly labelled as imported
          or experimental when connected; no predictive claim is made here.
        </p>
      </section>
    </div>
  );
}
