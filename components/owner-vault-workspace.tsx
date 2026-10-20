import Link from "next/link";

import { OwnerVaultMutationForm } from "@/components/owner-vault-mutation-form";
import { AcceptedApiHistory } from "@/components/search-core-workspace";
import type { OwnerVaultSelectedHistory } from "@/lib/owner-vault-selected-history-service";
import {
  OWNER_CORE_CATALOGUE_LIST_LIMIT,
  OWNER_VAULT_LIST_LIMIT,
  ownerVaultClasses,
  ownerVaultElements,
  ownerVaultSexes,
  type OwnerVaultCataloguePageState,
} from "@/lib/owner-vault-catalogue-service";

const connectionCopy = {
  identity_not_connected: {
    heading: "Vault data not connected",
    detail: "Sign-in identity is not connected to the private owner allowlist.",
  },
  persistence_not_configured: {
    heading: "Vault data not connected",
    detail:
      "The owner Vault database runtime is not configured for this environment.",
  },
  read_failed: {
    heading: "Vault records temporarily unavailable",
    detail:
      "The owner-scoped Vault read could not be completed. All catalogue rows and ownership controls are withheld; no cached or inferred ownership is shown.",
  },
  integrity_failed: {
    heading: "Vault records failed validation",
    detail:
      "The saved Vault projection contains invalid or inconsistent rows. All catalogue rows and ownership controls remain withheld until the projection is repaired.",
  },
} as const;

function optionLabel(value: string): string {
  return value === "X-Class"
    ? value
    : value.charAt(0).toUpperCase() + value.slice(1);
}

export function OwnerVaultWorkspace({
  state,
  selectedHistory,
}: Readonly<{
  state: OwnerVaultCataloguePageState;
  selectedHistory?: OwnerVaultSelectedHistory;
}>) {
  const connected = state.connectionStatus === "connected";
  const catalogueMode = state.filters.scope === "catalogue";
  const apiSnapshot =
    state.coverage === "accepted_owner_api_snapshot" &&
    state.apiSnapshot !== null &&
    state.apiSnapshot !== undefined;
  const resultLimit = catalogueMode
    ? OWNER_CORE_CATALOGUE_LIST_LIMIT
    : OWNER_VAULT_LIST_LIMIT;
  const resultLimitReached = connected && state.cores.length >= resultLimit;
  const resultLimitCopy = [
    `This ${catalogueMode ? "Core catalogue" : "My Vault"} search reached its ${resultLimit.toLocaleString("en-AU")}-core result limit.`,
    "Counts reflect returned records, not verified totals; additional matching cores may be omitted.",
    "Narrow the filters or search by exact Core ID.",
  ].join(" ");
  const unavailable = connected ? null : connectionCopy[state.connectionStatus];

  return (
    <div className="space-y-8">
      <header className="max-w-4xl">
        <p className="text-sm font-semibold text-[var(--accent)]">
          {apiSnapshot
            ? "Accepted owner API snapshot"
            : "Owner-maintained registry"}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          My Vault
        </h1>
        <p className="mt-4 text-base leading-7 text-[var(--muted)]">
          {apiSnapshot
            ? "Browse the current owner-scoped Cores published by the accepted DNA API generation. Maiden eligibility and registry edits stay unavailable until an owner-maintained registry record exists."
            : "Maintain current ownership and Maiden eligibility directly against the Core Details catalogue. Removing a core from My Vault does not delete its historical racing, lineage, breeding, lifecycle or economic evidence."}
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
          aria-current={!catalogueMode ? "page" : undefined}
        >
          My cores
        </Link>
        {apiSnapshot ? null : (
          <Link
            className={`rounded-lg border px-4 py-2 text-sm font-semibold ${
              catalogueMode
                ? "border-[var(--accent)] text-[var(--accent)]"
                : "border-[var(--border)] text-[var(--muted)]"
            }`}
            href="/vault?scope=catalogue"
            aria-current={catalogueMode ? "page" : undefined}
          >
            Find core to add
          </Link>
        )}
      </nav>

      {selectedHistory?.selectionRequested ? (
        <section
          aria-labelledby="selected-vault-history-heading"
          className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5"
          id="selected-vault-history"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-semibold" id="selected-vault-history-heading">
              {selectedHistory.selectedCore
                ? `Accepted race history — ${selectedHistory.selectedCore.displayName} (Core ${selectedHistory.selectedCore.sourceCoreId})`
                : "Selected Vault Core unavailable"}
            </h2>
            <Link
              className="text-sm font-semibold text-[var(--accent)] underline underline-offset-4"
              href="/vault"
            >
              Close history
            </Link>
          </div>
          {selectedHistory.acceptedHistory ? (
            <AcceptedApiHistory
              state={selectedHistory.acceptedHistory}
              filters={{ mode: "all", distance: null }}
            />
          ) : (
            <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
              This Core ID was not in the returned owned Vault selection. Clear
              filters and select an owned Core; no unowned history was read.
            </p>
          )}
          <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
            Historical evidence only, not live race data or automatically
            validated analytical scope. Unsupported formats remain unavailable.
          </p>
        </section>
      ) : null}

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
          <h2 className="text-lg font-semibold">{unavailable?.heading}</h2>
          <p className="mt-3 text-[var(--muted)]">{unavailable?.detail}</p>
        </section>
      ) : (
        <section aria-labelledby="vault-results">
          {state.publication ? (
            <div
              className="mb-5 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4"
              aria-labelledby="vault-publication-heading"
            >
              <h2 className="font-semibold" id="vault-publication-heading">
                Accepted Core Details source
              </h2>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                Dataset {state.publication.coreDatasetVersionId} · import{" "}
                {state.publication.importBatchId} ·{" "}
                {state.publication.coreCount.toLocaleString("en-AU")} accepted
                cores from{" "}
                {state.publication.sourceRowCount.toLocaleString("en-AU")}{" "}
                source rows
              </p>
              <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                Source SHA256 {state.publication.sourceSha256} · evidence sealed{" "}
                {state.publication.evidenceSealedAt} · aggregates refreshed{" "}
                {state.publication.aggregateRefreshedAt}
              </p>
            </div>
          ) : apiSnapshot ? (
            <div className="mb-5 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
              <h2 className="font-semibold">Accepted DNA API owner snapshot</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                Generation {state.apiSnapshot?.generationId} ·{" "}
                {state.apiSnapshot?.coreCount.toLocaleString("en-AU")} current
                owner Cores
              </p>
              <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                Observed {state.apiSnapshot?.oldestObservedAt} to{" "}
                {state.apiSnapshot?.newestObservedAt}. This source confirms
                current ownership, not Maiden eligibility or editable registry
                state.
              </p>
            </div>
          ) : null}
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold" id="vault-results">
                {catalogueMode ? "Core catalogue results" : "Active My Vault"}
              </h2>
              <p className="mt-2 text-sm text-[var(--muted)]">
                {`${state.cores.length.toLocaleString("en-AU")} core${state.cores.length === 1 ? "" : "s"} shown`}
              </p>
            </div>
          </div>

          {resultLimitReached ? (
            <p
              className="mt-3 max-w-3xl text-sm leading-6 text-[var(--warning)]"
              role="status"
            >
              {resultLimitCopy}
            </p>
          ) : null}

          {state.cores.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6">
              <p className="font-semibold">
                {catalogueMode
                  ? "No Core Details match these filters."
                  : "No active Vault cores match these filters."}
              </p>
            </div>
          ) : (
            <>
              <details className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
                <summary className="cursor-pointer py-2 font-semibold">
                  Compact roster · {state.cores.length} cores shown
                </summary>
                <p className="mt-3 text-sm text-[var(--muted)]">
                  Returned records only; current filters still apply. Open a
                  Core&apos;s controls below to review ownership or Maiden
                  state.
                </p>
                <div
                  className="mt-4 max-w-full overflow-x-auto rounded-lg border border-[var(--border)]"
                  role="region"
                  aria-label="Compact Vault roster"
                  tabIndex={0}
                >
                  <table className="w-full text-left text-sm">
                    <caption className="sr-only">
                      Filtered Vault registry with Core identity and recorded
                      Maiden eligibility
                    </caption>
                    <thead className="bg-[var(--surface)]">
                      <tr>
                        {[
                          "Core",
                          "Element",
                          "Breed / class",
                          "Sex",
                          "F-number",
                          "Recorded state",
                        ].map((column) => (
                          <th
                            className="p-3 whitespace-nowrap"
                            scope="col"
                            key={column}
                          >
                            {column}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {state.cores.map((core) => (
                        <tr
                          className="border-t border-[var(--border)]"
                          key={core.sourceCoreId}
                        >
                          <th
                            scope="row"
                            className="sticky left-0 bg-[var(--surface-raised)] p-3 text-left font-normal"
                          >
                            <a
                              className="font-semibold text-[var(--accent)] underline underline-offset-4"
                              href={`#vault-core-${encodeURIComponent(core.sourceCoreId)}`}
                            >
                              {core.displayName}
                            </a>
                            <p className="mt-1 text-xs text-[var(--muted)]">
                              Core ID {core.sourceCoreId}
                            </p>
                          </th>
                          <td className="p-3">{core.element}</td>
                          <td className="p-3 whitespace-nowrap">
                            {core.coreClass}
                          </td>
                          <td className="p-3">{optionLabel(core.sex)}</td>
                          <td className="p-3">F{core.fNumber}</td>
                          <td className="p-3">
                            {core.inMyVault ? "In My Vault" : "Not in My Vault"}
                            <p className="mt-1 text-xs text-[var(--muted)]">
                              {core.meEligible === null
                                ? "ME eligibility unavailable"
                                : core.meEligible
                                  ? "ME eligible"
                                  : "Not ME eligible"}
                            </p>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
              <div className="mt-4 grid gap-4 xl:grid-cols-2">
                {state.cores.map((core) => (
                  <article
                    className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5"
                    key={core.sourceCoreId}
                    id={`vault-core-${core.sourceCoreId}`}
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
                        <Link
                          className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-semibold text-[var(--accent)] hover:bg-[var(--surface)]"
                          href={`/vault?coreId=${encodeURIComponent(core.sourceCoreId)}#selected-vault-history`}
                        >
                          View history in My Vault
                        </Link>
                      ) : null}
                      <Link
                        className="rounded-lg border border-[var(--accent)] px-3 py-2 text-sm font-semibold text-[var(--accent)] hover:bg-[var(--surface)]"
                        href={`/search-core?q=${encodeURIComponent(
                          core.sourceCoreId,
                        )}&coreId=${encodeURIComponent(core.sourceCoreId)}`}
                      >
                        View race evidence
                      </Link>
                      {core.version === null || core.meEligible === null ? (
                        <p className="basis-full text-xs leading-5 text-[var(--muted)]">
                          Owner registry controls are unavailable for this API
                          snapshot row.
                        </p>
                      ) : (
                        <OwnerVaultMutationForm core={core} />
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
