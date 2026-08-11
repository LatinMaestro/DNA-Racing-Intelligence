import Link from "next/link";

import type { CorePerformanceProfile } from "@/domain/core-performance";
import type { SearchCorePageState } from "@/lib/search-core-service";

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
          <dt className="text-[var(--muted)]">Gold star</dt>
          <dd className="font-semibold">{goldRate}</dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Blue star</dt>
          <dd className="font-semibold">{blueRate}</dd>
        </div>
      </dl>
      <p className="mt-4 text-xs text-[var(--muted)]">
        Data current through {currentThrough}. Historical imported evidence only;
        not live game state.
      </p>
    </article>
  );
}

export function SearchCoreWorkspace({
  state,
}: Readonly<{ state: SearchCorePageState }>) {
  const connected = state.connectionStatus === "connected";

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
          <h2 className="text-lg font-semibold">
            Core catalogue not connected
          </h2>
          <p className="mt-3 text-[var(--muted)]">
            {state.connectionStatus === "identity_not_connected"
              ? "The signed-in identity is not connected to the private owner allowlist."
              : "The private Core Details database runtime is not configured for this environment."}
          </p>
        </section>
      ) : state.query === null ? (
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6">
          <h2 className="font-semibold">Search the game catalogue</h2>
          <p className="mt-3 max-w-3xl leading-7 text-[var(--muted)]">
            Enter part of a core name or its durable Core ID. Results are drawn
            from the latest accepted Core Details snapshot and are not live
            marketplace listings.
          </p>
        </section>
      ) : (
        <section aria-labelledby="search-core-results">
          <h2 className="text-xl font-semibold" id="search-core-results">
            Search results
          </h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            {state.results.length.toLocaleString("en-AU")} matching core
            {state.results.length === 1 ? "" : "s"}
          </p>

          {state.results.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6">
              No known Core Details match this search.
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
                    )}&coreId=${encodeURIComponent(core.sourceCoreId)}`}
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
          <div className="mt-6">
            <h3 className="font-semibold">Racing statistics</h3>
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
            ) : (
              <div className="mt-3 grid gap-3">
                {state.performanceProfiles.map((profile) => (
                  <PerformanceProfile
                    key={`${profile.mode}:${profile.distance}`}
                    profile={profile}
                  />
                ))}
              </div>
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}
