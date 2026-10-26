import { CorePerformanceComparison } from "@/components/core-performance-comparison";
import { corePerformanceComparisonRows } from "@/lib/core-performance-comparison";
import Link from "next/link";

import {
  raceModes,
  type CorePerformanceProfile,
} from "@/domain/core-performance";
import type { EvidenceViewFilters } from "@/lib/evidence-view-filters";
import { OWNER_CORE_CATALOGUE_LIST_LIMIT } from "@/lib/owner-vault-catalogue-service";
import type {
  AcceptedCoreHistoryRead,
  SearchCorePageState,
} from "@/lib/search-core-service";

const catalogueConnectionCopy = {
  identity_not_connected: {
    heading: "Core catalogue not connected",
    detail:
      "The signed-in identity is not connected to the private owner allowlist.",
  },
  persistence_not_configured: {
    heading: "Core catalogue not connected",
    detail:
      "The private Core Details database runtime is not configured for this environment.",
  },
  read_failed: {
    heading: "Core catalogue temporarily unavailable",
    detail:
      "The owner-scoped catalogue read could not be completed. Search results and selected Core evidence are withheld; no cached results are shown.",
  },
  integrity_failed: {
    heading: "Core catalogue failed validation",
    detail:
      "The saved catalogue projection contains invalid or inconsistent rows. Search results and selected Core evidence remain withheld until it is repaired.",
  },
} as const;

function label(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function seconds(milliseconds: number): string {
  return `${(milliseconds / 1_000).toFixed(3)} s`;
}

function percentage(numerator: number, denominator: number): string {
  if (denominator === 0) return "—";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function starRate(
  numerator: number,
  denominator: number,
  denominatorLabel: string,
): string {
  return `${percentage(numerator, denominator)} (${numerator}/${denominator} ${denominatorLabel})`;
}

function PerformanceProfile({
  profile,
}: Readonly<{ profile: CorePerformanceProfile }>) {
  const stars = profile.starProfile;
  const sampleLabel =
    profile.sampleStatus === "minimally_analytical"
      ? "10+ race minimum reached"
      : "Hypothesis only";
  const goldRate =
    stars === null
      ? "—"
      : starRate(
          stars.goldReceivedRate.numerator,
          stars.goldReceivedRate.denominator,
          "eligible opportunities",
        );
  const blueRate =
    stars === null
      ? "—"
      : starRate(
          stars.blueReceivedRate.numerator,
          stars.blueReceivedRate.denominator,
          "opportunities",
        );
  const currentThrough = new Date(profile.dataCurrentThrough).toLocaleString(
    "en-AU",
  );

  return (
    <article className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <h4 className="font-semibold">
        {label(profile.mode)} · {profile.distance.toLocaleString("en-AU")} m
      </h4>
      <p className="mt-1 text-xs text-[var(--muted)]">
        {profile.raceCount.toLocaleString("en-AU")} races ·{" "}
        {label(profile.freshness)} · {sampleLabel}
      </p>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
        <div>
          <dt className="text-[var(--muted)]">Best time</dt>
          <dd className="font-semibold">
            {seconds(profile.elapsedTime.bestMilliseconds)}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Median time</dt>
          <dd className="font-semibold">
            {seconds(profile.elapsedTime.medianMilliseconds)}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Average time</dt>
          <dd className="font-semibold">
            {seconds(profile.elapsedTime.meanMilliseconds)}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Best speed</dt>
          <dd className="font-semibold">
            {profile.speed.bestMetresPerSecond.toFixed(3)} m/s
          </dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Median speed</dt>
          <dd className="font-semibold">
            {profile.speed.medianMetresPerSecond.toFixed(3)} m/s
          </dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Time variation</dt>
          <dd className="font-semibold">
            σ {seconds(profile.elapsedTime.standardDeviationMilliseconds)}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Yellow star</dt>
          <dd className="font-semibold">{goldRate}</dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Blue star</dt>
          <dd className="font-semibold">{blueRate}</dd>
        </div>
      </dl>
      <p className="mt-4 text-xs text-[var(--muted)]">
        Data current through {currentThrough}. Historical imported evidence
        only; not live game state. Yellow is stored by the source as gold_star.
      </p>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer font-semibold">
          Distribution details
        </summary>
        <dl className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <dt className="text-[var(--muted)]">Trimmed mean time</dt>
            <dd>{seconds(profile.elapsedTime.trimmedMeanMilliseconds)}</dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">Interquartile time range</dt>
            <dd>
              {seconds(profile.elapsedTime.interquartileRangeMilliseconds)}
            </dd>
          </div>
        </dl>
        <p className="mt-2 text-xs text-[var(--muted)]">
          Lower time is faster. Variation describes observed spread, not a win
          probability.
        </p>
      </details>
    </article>
  );
}

function ArchiveEvidence({ state }: Readonly<{ state: SearchCorePageState }>) {
  if (state.archiveHistoryStatus === "not_connected") {
    return (
      <p className="mt-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm leading-6 text-[var(--muted)]">
        Immutable archived Race evidence is not configured for this environment.
        Aggregate racing statistics remain the primary analytical view.
      </p>
    );
  }
  if (state.archiveHistoryStatus === "missing") {
    return (
      <p className="mt-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm leading-6 text-[var(--muted)]">
        No sealed archived Race locator is available for this core. This is not
        treated as evidence of zero historical races.
      </p>
    );
  }
  if (state.archiveHistoryStatus === "unavailable") {
    return (
      <p
        className="mt-2 rounded-xl border border-[var(--warning)]/50 bg-[var(--surface)] p-4 text-sm leading-6 text-[var(--warning)]"
        role="alert"
      >
        Archived Race evidence could not be retrieved and verified. Archive
        coverage is unknown, not zero, and this is not evidence that the core
        has no historical races. The catalogue and separately accepted
        performance profiles remain available; review archive integrity before
        relying on archived rows.
      </p>
    );
  }
  return (
    <div className="mt-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
        <div>
          <dt className="text-[var(--muted)]">Verified rows</dt>
          <dd className="font-semibold">
            {state.archiveHistoryRowCount.toLocaleString("en-AU")}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Dataset versions</dt>
          <dd className="font-semibold">
            {state.archiveHistoryVersionCount.toLocaleString("en-AU")}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">R2 partitions read</dt>
          <dd className="font-semibold">
            {state.archiveHistoryPartitionCount.toLocaleString("en-AU")}
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
        Verified private immutable evidence was resolved through this
        Core&apos;s bounded archive locators. The complete Race archive was not
        scanned.
      </p>
    </div>
  );
}

const publishedCellCopy = {
  accepted: "Accepted analytical cell",
  missing_format: "Unavailable: format missing",
  unsupported_format: "Unavailable: unsupported format",
  unpublished_cell: "Unavailable: unpublished analytical cell",
} as const;

export function AcceptedApiHistory({
  state,
  filters,
}: Readonly<{
  state: AcceptedCoreHistoryRead;
  filters: EvidenceViewFilters;
}>) {
  if (state.acceptedHistoryStatus === "not_connected") {
    return (
      <p className="mt-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm leading-6 text-[var(--muted)]">
        Accepted API race history is not configured for this environment.
      </p>
    );
  }
  if (state.acceptedHistoryStatus === "missing") {
    return (
      <p className="mt-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm leading-6 text-[var(--muted)]">
        No row for this Core exists in the active accepted history generation.
        This is not treated as evidence of zero races.
      </p>
    );
  }
  if (state.acceptedHistoryStatus !== "connected") {
    const detail =
      state.acceptedHistoryStatus === "truncated"
        ? "The bounded Core history read exceeded 1,000 rows. Narrower pagination is required before rows can be shown."
        : state.acceptedHistoryStatus === "source_changed"
          ? "The accepted history generation changed during this read. Reload to use one point-in-time source."
          : "Accepted API race history could not be read and verified for this Core.";
    return (
      <p
        className="mt-2 rounded-xl border border-[var(--warning)]/50 bg-[var(--surface)] p-4 text-sm leading-6 text-[var(--warning)]"
        role="alert"
      >
        {detail} No history is substituted.
      </p>
    );
  }

  const matchingRows = state.acceptedHistoryRows.filter((row) => {
    const payload = row.payload;
    if (payload.sourceType !== "joined_core_race_history_result") {
      return filters.mode === "all" && filters.distance === null;
    }
    return (
      (filters.mode === "all" || payload.mode === filters.mode) &&
      (filters.distance === null || payload.distanceMetres === filters.distance)
    );
  });
  const shownRows = matchingRows.slice(0, 100);

  return (
    <div className="mt-2 space-y-3">
      {state.acceptedHistoryGeneration ? (
        <p className="text-xs leading-5 text-[var(--muted)]">
          Active generation {state.acceptedHistoryGeneration.generationId} ·
          observation set {state.acceptedHistoryGeneration.observationSetSha256}
          {" · "}
          published{" "}
          {new Date(state.acceptedHistoryGeneration.publishedAt).toLocaleString(
            "en-AU",
          )}
        </p>
      ) : null}
      <p className="text-sm text-[var(--muted)]" role="status">
        Showing {shownRows.length.toLocaleString("en-AU")} of{" "}
        {matchingRows.length.toLocaleString("en-AU")} matching rows
        {matchingRows.length > shownRows.length ? " (first 100 shown)" : ""}.
      </p>
      {matchingRows.length === 0 ? (
        <p className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm leading-6">
          No accepted stored row matches this exact mode and distance. Missing
          evidence remains unknown; no nearby distance is substituted.
        </p>
      ) : (
        <div className="grid gap-3">
          {shownRows.map((row) => {
            const payload = row.payload;
            return (
              <article
                className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"
                key={row.rowSha256}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <h4 className="font-semibold">Race {payload.sourceRaceId}</h4>
                  <span className="text-xs font-semibold">
                    {payload.sourceType === "joined_core_race_history_result"
                      ? publishedCellCopy[payload.publishedCellStatus]
                      : "Stored result; race context unavailable"}
                  </span>
                </div>
                {payload.sourceType === "joined_core_race_history_result" ? (
                  <dl className="mt-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-5">
                    <div>
                      <dt className="text-[var(--muted)]">Mode</dt>
                      <dd className="font-semibold">{label(payload.mode)}</dd>
                    </div>
                    <div>
                      <dt className="text-[var(--muted)]">Distance</dt>
                      <dd className="font-semibold">
                        {payload.distanceMetres.toLocaleString("en-AU")} m
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[var(--muted)]">Gates</dt>
                      <dd className="font-semibold">{payload.gateCount}</dd>
                    </div>
                    <div>
                      <dt className="text-[var(--muted)]">Format</dt>
                      <dd className="font-semibold">
                        {payload.sourceFormat ?? "Unavailable"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[var(--muted)]">Finish / time</dt>
                      <dd className="font-semibold">
                        {payload.finishPosition} ·{" "}
                        {seconds(payload.elapsedMilliseconds)}
                      </dd>
                    </div>
                  </dl>
                ) : (
                  <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
                    This compact accepted result retains elapsed time and
                    finish, but this row does not carry exact mode, distance,
                    gates or format. Those fields are not inferred.
                  </p>
                )}
                <p className="mt-3 break-all font-mono text-xs text-[var(--muted)]">
                  Row SHA-256 {row.rowSha256}
                </p>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function SearchCoreWorkspace({
  state,
  filters = { mode: "all", distance: null },
}: Readonly<{ state: SearchCorePageState; filters?: EvidenceViewFilters }>) {
  const connected = state.connectionStatus === "connected";
  const ownerApiCoverage =
    state.catalogueCoverage === "accepted_owner_api_snapshot";
  const unavailable = connected
    ? null
    : catalogueConnectionCopy[state.connectionStatus];
  const profiles = state.performanceProfiles.filter(
    (profile) =>
      (filters.mode === "all" || profile.mode === filters.mode) &&
      (filters.distance === null || profile.distance === filters.distance),
  );
  const joinedHistoryRows = state.acceptedHistoryRows.filter(
    (row) => row.payload.sourceType === "joined_core_race_history_result",
  );
  const distances = [
    ...new Set([
      ...state.performanceProfiles.map((profile) => profile.distance),
      ...joinedHistoryRows.map((row) =>
        row.payload.sourceType === "joined_core_race_history_result"
          ? row.payload.distanceMetres
          : 0,
      ),
    ]),
  ].sort((a, b) => a - b);
  if (filters.distance !== null && !distances.includes(filters.distance)) {
    distances.push(filters.distance);
    distances.sort((a, b) => a - b);
  }
  const resultLimitCopy = [
    `Search reached the ${OWNER_CORE_CATALOGUE_LIST_LIMIT.toLocaleString("en-AU")}-core result limit.`,
    "These are returned results, not a verified count of all matches.",
    "More cores may match. Narrow the name or search by exact Core ID.",
  ].join(" ");
  // Preserve compatibility with stored/test page-state snapshots created
  // before population identity became a separate accepted source.
  const populationIdentity = state.populationIdentity ?? null;
  const populationIdentityStatus =
    state.populationIdentityStatus ?? "not_connected";
  const visibleResultCount =
    state.results.length + (populationIdentity === null ? 0 : 1);

  return (
    <div className="space-y-8">
      <header className="max-w-4xl">
        <p className="text-sm font-semibold text-[var(--accent)]">
          Game-wide Core Details catalogue
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          Search Core
        </h1>
        <p className="mt-4 text-base leading-7 text-[var(--muted)]">
          Look up any known core by name or durable Core ID for marketplace due
          diligence. This is separate from Discovery, which plans test races for
          cores already in My Vault.
        </p>
      </header>

      <form
        action="/search-core"
        className="flex max-w-3xl flex-col gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5 sm:flex-row"
        method="get"
        role="search"
      >
        <label className="flex-1">
          <span className="text-sm font-semibold">Core name or Core ID</span>
          <input
            autoComplete="off"
            className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
            defaultValue={state.query ?? ""}
            maxLength={128}
            name="q"
            placeholder="Search the Core Details catalogue"
            type="search"
          />
        </label>
        <input name="mode" type="hidden" value={filters.mode} />
        {filters.distance === null ? null : (
          <input name="distance" type="hidden" value={filters.distance} />
        )}
        <div className="flex items-end">
          <button
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
            type="submit"
          >
            Search
          </button>
        </div>
      </form>

      {!connected ? (
        <section className="rounded-2xl border border-[var(--warning)]/50 bg-[var(--surface-raised)] p-6">
          <h2 className="text-lg font-semibold">{unavailable?.heading}</h2>
          <p className="mt-3 text-[var(--muted)]">{unavailable?.detail}</p>
        </section>
      ) : state.query === null ? (
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6">
          <h2 className="font-semibold">Search accepted Core sources</h2>
          <p className="mt-3 max-w-3xl leading-7 text-[var(--muted)]">
            Enter part of a core name or its durable Core ID. The accepted Core
            Details catalogue is used when published; otherwise results are
            limited to the current owner-scoped API snapshot. Neither source is
            a live marketplace listing.
          </p>
        </section>
      ) : (
        <section aria-labelledby="search-core-results">
          <h2 className="text-xl font-semibold" id="search-core-results">
            Search results
          </h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            {`${visibleResultCount.toLocaleString("en-AU")} core${visibleResultCount === 1 ? "" : "s"} shown`}
          </p>
          {ownerApiCoverage ? (
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
              Results cover only the accepted current owner API snapshot
              {state.catalogueApiSnapshot
                ? ` (${state.catalogueApiSnapshot.coreCount.toLocaleString("en-AU")} owner Cores, generation ${state.catalogueApiSnapshot.generationId})`
                : ""}
              . Game-wide catalogue coverage and registry-only Maiden state are
              unavailable.
            </p>
          ) : null}

          {state.results.length >= OWNER_CORE_CATALOGUE_LIST_LIMIT ? (
            <p
              className="mt-3 max-w-3xl text-sm leading-6 text-[var(--warning)]"
              role="status"
            >
              {resultLimitCopy}
            </p>
          ) : null}

          {populationIdentityStatus === "unavailable" ? (
            <p
              className="mt-4 rounded-2xl border border-[var(--warning)]/50 bg-[var(--surface-raised)] p-6 text-[var(--warning)]"
              role="alert"
            >
              Population Core identity could not be verified. No population
              result is substituted.
            </p>
          ) : null}

          {populationIdentity !== null ? (
            <article className="mt-4 rounded-2xl border border-[var(--accent)]/50 bg-[var(--surface-raised)] p-5">
              <p className="text-xs font-bold tracking-wider text-[var(--accent)] uppercase">
                Accepted population identity
              </p>
              <h3 className="mt-2 text-lg font-semibold">
                Core ID {populationIdentity.sourceCoreId}
              </h3>
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-[var(--muted)]">Population cohort</dt>
                  <dd className="font-semibold">
                    {populationIdentity.populationCoreCount.toLocaleString(
                      "en-AU",
                    )}{" "}
                    Core IDs
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">Evaluated</dt>
                  <dd className="font-semibold">
                    {new Date(populationIdentity.evaluatedAt).toLocaleString(
                      "en-AU",
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">Profile metadata</dt>
                  <dd className="font-semibold">Unavailable</dd>
                </div>
              </dl>
              <p className="mt-4 text-sm leading-6 text-[var(--muted)]">
                This exact Core ID is present in the accepted immutable
                population-history authority. Name, class, element, sex,
                F-number and current ownership are not stored in that authority
                and are not inferred.
              </p>
              <p className="mt-2 break-all font-mono text-xs text-[var(--muted)]">
                Generation {populationIdentity.generationId} · Core-set SHA-256{" "}
                {populationIdentity.coreSetSha256}
              </p>
            </article>
          ) : null}

          {state.results.length === 0 && populationIdentity === null ? (
            <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6">
              {ownerApiCoverage
                ? "No current owned API Core matches this search."
                : "No known Core Details match this search."}
            </div>
          ) : (
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              {state.results.map((core) => (
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
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                    <div>
                      <dt className="text-[var(--muted)]">Element</dt>
                      <dd className="font-semibold">{core.element}</dd>
                    </div>
                    <div>
                      <dt className="text-[var(--muted)]">Breed / class</dt>
                      <dd className="font-semibold">{core.coreClass}</dd>
                    </div>
                    <div>
                      <dt className="text-[var(--muted)]">Sex</dt>
                      <dd className="font-semibold">{label(core.sex)}</dd>
                    </div>
                    <div>
                      <dt className="text-[var(--muted)]">F-number</dt>
                      <dd className="font-semibold">F{core.fNumber}</dd>
                    </div>
                  </dl>
                  <Link
                    className="mt-5 inline-flex rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-semibold"
                    href={`/search-core?q=${encodeURIComponent(
                      state.query ?? core.sourceCoreId,
                    )}&coreId=${encodeURIComponent(core.sourceCoreId)}&mode=${filters.mode}${filters.distance === null ? "" : `&distance=${filters.distance}`}#selected-core`}
                    prefetch={false}
                  >
                    View core
                  </Link>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {state.selectedCore !== null ? (
        <section
          aria-labelledby="selected-core"
          className="rounded-2xl border border-[var(--accent)]/50 bg-[var(--surface-raised)] p-6"
        >
          <p className="text-xs font-bold tracking-wider text-[var(--accent)] uppercase">
            Core profile
          </p>
          <h2 className="mt-2 text-2xl font-semibold" id="selected-core">
            {state.selectedCore.displayName}
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Core ID {state.selectedCore.sourceCoreId}
          </p>
          <nav
            aria-label="Core profile sections"
            className="mt-4 flex flex-wrap gap-3 text-sm font-semibold"
          >
            <a
              className="rounded-lg border border-[var(--border)] px-3 py-2"
              href="#core-racing"
            >
              Race evidence
            </a>
            <a
              className="rounded-lg border border-[var(--border)] px-3 py-2"
              href="#core-api-history"
            >
              Accepted API history
            </a>
            <a
              className="rounded-lg border border-[var(--border)] px-3 py-2"
              href="#core-archive"
            >
              Archive coverage
            </a>
            {state.selectedCore.inMyVault ? (
              <Link
                className="rounded-lg border border-[var(--border)] px-3 py-2"
                href="/vault"
                prefetch={false}
              >
                My Vault
              </Link>
            ) : null}
          </nav>
          <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <dt className="text-[var(--muted)]">Element</dt>
              <dd className="font-semibold">{state.selectedCore.element}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Breed / class</dt>
              <dd className="font-semibold">{state.selectedCore.coreClass}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Sex</dt>
              <dd className="font-semibold">{label(state.selectedCore.sex)}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">F-number</dt>
              <dd className="font-semibold">F{state.selectedCore.fNumber}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Owner status</dt>
              <dd className="font-semibold">
                {state.selectedCore.inMyVault
                  ? "In My Vault"
                  : "Not in My Vault"}
              </dd>
            </div>
          </dl>
          <div className="mt-6 scroll-mt-6" id="core-racing">
            <h3 className="font-semibold">Racing statistics</h3>
            <form
              action="/search-core#core-racing"
              method="get"
              className="mt-3 flex flex-wrap items-end gap-3"
              aria-label="Core race evidence filters"
            >
              {state.query === null ? null : (
                <input name="q" type="hidden" value={state.query} />
              )}
              <input
                name="coreId"
                type="hidden"
                value={state.selectedCore.sourceCoreId}
              />
              <label className="text-sm font-semibold">
                Mode
                <select
                  className="mt-1 block rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2"
                  defaultValue={filters.mode}
                  name="mode"
                >
                  <option value="all">All modes</option>
                  {raceModes.map((mode) => (
                    <option key={mode} value={mode}>
                      {label(mode)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-semibold">
                Exact distance
                <select
                  className="mt-1 block rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2"
                  defaultValue={filters.distance ?? ""}
                  name="distance"
                >
                  <option value="">All distances</option>
                  {distances.map((distance) => (
                    <option key={distance} value={distance}>
                      {distance.toLocaleString("en-AU")} m
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
                type="submit"
              >
                Apply filters
              </button>
            </form>
            <p className="mt-3 text-xs text-[var(--muted)]">
              {state.performanceAuthority === "accepted_history_generation"
                ? "Accepted history generation published "
                : "Last imported "}
              {state.performanceLastImportedAt === null
                ? "not available"
                : new Date(state.performanceLastImportedAt).toLocaleString(
                    "en-AU",
                  )}
              . Each profile keeps its own source cutoff and sample. Modes and
              exact distances are never pooled.
            </p>
            {state.performanceAuthority === "accepted_history_generation" ? (
              <p className="mt-1 text-xs text-[var(--muted)]">
                Exact-mode/distance profiles are derived on this bounded Core
                read using the approved performance mathematics. Unsupported
                formats and unpublished analytical cells are excluded, and no
                missing star evidence is inferred.
              </p>
            ) : null}
            {state.performancePublication ? (
              <p className="mt-1 text-xs text-[var(--muted)]">
                Accepted race dataset{" "}
                {state.performancePublication.raceDatasetVersionId} · payload{" "}
                {state.performancePublication.payloadSha256.slice(0, 12)}…
              </p>
            ) : null}
            {state.performanceStatus !== "connected" ? (
              <p className="mt-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm leading-6 text-[var(--muted)]">
                Historical performance profiles are not configured for this
                environment.
              </p>
            ) : state.performanceProfiles.length === 0 ? (
              <p className="mt-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm leading-6 text-[var(--muted)]">
                No accepted exact-distance race profile is available for this
                core yet.
              </p>
            ) : profiles.length === 0 ? (
              <p
                className="mt-3 rounded-xl border border-[var(--border)] p-4 text-sm"
                role="status"
              >
                No accepted profile matches this mode and exact distance.
                Missing evidence is unknown; no nearby distance is substituted.
              </p>
            ) : (
              <div className="mt-3 grid gap-3">
                <p className="text-sm text-[var(--muted)]" role="status">
                  Showing {profiles.length} of{" "}
                  {state.performanceProfiles.length} exact-mode/distance
                  profiles
                </p>
                <CorePerformanceComparison
                  rows={corePerformanceComparisonRows(profiles)}
                />
                {profiles.map((profile) => (
                  <PerformanceProfile
                    key={`${profile.mode}:${profile.distance}`}
                    profile={profile}
                  />
                ))}
              </div>
            )}
          </div>
          <div className="mt-6 scroll-mt-6" id="core-api-history">
            <h3 className="font-semibold">Accepted API race history</h3>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              Owner-scoped rows are read by exact Core ID from the active
              persisted generation. Stored format and analytical publication
              status are separate: unavailable cells are never presented as
              validated methods.
            </p>
            <AcceptedApiHistory state={state} filters={filters} />
          </div>
          <div className="mt-6 scroll-mt-6" id="core-archive">
            <h3 className="font-semibold">Archived Race evidence</h3>
            <ArchiveEvidence state={state} />
          </div>
        </section>
      ) : null}
    </div>
  );
}
