import Link from "next/link";

import { updateVaultCoreFormAction } from "@/app/(private)/vault/actions";
import {
  ownerVaultClasses,
  ownerVaultElements,
  ownerVaultSexes,
  type OwnerVaultCataloguePageState,
} from "@/lib/owner-vault-catalogue-service";

function optionLabel(value: string): string {
  return value === "X-Class"
    ? value
    : value.charAt(0).toUpperCase() + value.slice(1);
}

function mutationForm(
  core: OwnerVaultCataloguePageState["cores"][number],
  operation: "add" | "remove" | "me_on" | "me_off",
  label: string,
) {
  return (
    <form action={updateVaultCoreFormAction}>
      <input name="sourceCoreId" type="hidden" value={core.sourceCoreId} />
      <input
        name="expectedVersion"
        type="hidden"
        value={core.version.toString()}
      />
      <input name="operation" type="hidden" value={operation} />
      <button
        className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-raised)]"
        type="submit"
      >
        {label}
      </button>
    </form>
  );
}

export function OwnerVaultWorkspace({
  state,
}: Readonly<{ state: OwnerVaultCataloguePageState }>) {
  const connected = state.connectionStatus === "connected";
  const catalogueMode = state.filters.scope === "catalogue";

  return (
    <div className="space-y-8">
      <header className="max-w-4xl">
        <p className="text-sm font-semibold text-[var(--accent)]">
          Owner-maintained registry
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          My Vault
        </h1>
        <p className="mt-4 text-base leading-7 text-[var(--muted)]">
          Maintain current ownership and Maiden eligibility directly against the
          Core Details catalogue. Removing a core from My Vault does not delete
          its historical racing, lineage, breeding, lifecycle or economic
          evidence.
        </p>
      </header>

      <nav aria-label="Vault view" className="flex flex-wrap gap-3">
        <Link
          className={`rounded-lg border px-4 py-2 text-sm font-semibold ${
            catalogueMode
              ? "border-[var(--border)] text-[var(--muted)]"
              : "border-[var(--accent)] text-[var(--accent)]"
          }`}
          href="/vault"
        >
          My cores
        </Link>
        <Link
          className={`rounded-lg border px-4 py-2 text-sm font-semibold ${
            catalogueMode
              ? "border-[var(--accent)] text-[var(--accent)]"
              : "border-[var(--border)] text-[var(--muted)]"
          }`}
          href="/vault?scope=catalogue"
        >
          Find core to add
        </Link>
      </nav>

      <form
        action="/vault"
        className="grid gap-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5 md:grid-cols-2 xl:grid-cols-6"
        method="get"
      >
        <input
          name="scope"
          type="hidden"
          value={catalogueMode ? "catalogue" : "vault"}
        />
        <label className="md:col-span-2 xl:col-span-2">
          <span className="text-sm font-semibold">Name or Core ID</span>
          <input
            className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
            defaultValue={state.filters.query ?? ""}
            maxLength={128}
            name="q"
            placeholder="Search cores"
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
            Apply filters
          </button>
          <Link
            className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold"
            href={catalogueMode ? "/vault?scope=catalogue" : "/vault"}
          >
            Clear
          </Link>
        </div>
      </form>

      {!connected ? (
        <section className="rounded-2xl border border-[var(--warning)]/50 bg-[var(--surface-raised)] p-6">
          <h2 className="text-lg font-semibold">Vault data not connected</h2>
          <p className="mt-3 text-[var(--muted)]">
            {state.connectionStatus === "identity_not_connected"
              ? "Sign-in identity is not connected to the private owner allowlist."
              : "The owner Vault database runtime is not configured for this environment."}
          </p>
        </section>
      ) : (
        <section aria-labelledby="vault-results">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold" id="vault-results">
                {catalogueMode ? "Core catalogue results" : "Active My Vault"}
              </h2>
              <p className="mt-2 text-sm text-[var(--muted)]">
                {state.cores.length.toLocaleString("en-AU")} matching core
                {state.cores.length === 1 ? "" : "s"}
              </p>
            </div>
          </div>

          {state.cores.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6">
              <p className="font-semibold">
                {catalogueMode
                  ? "No Core Details match these filters."
                  : "No active Vault cores match these filters."}
              </p>
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

                  <div className="mt-5 flex flex-wrap gap-2 border-t border-[var(--border)] pt-4">
                    {core.inMyVault ? (
                      <>
                        {mutationForm(core, "remove", "Remove from My Vault")}
                        {core.meEligible
                          ? mutationForm(
                              core,
                              "me_off",
                              "ME: Eligible · turn off",
                            )
                          : mutationForm(
                              core,
                              "me_on",
                              "ME: Not eligible · turn on",
                            )}
                      </>
                    ) : (
                      mutationForm(core, "add", "Add to My Vault")
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
