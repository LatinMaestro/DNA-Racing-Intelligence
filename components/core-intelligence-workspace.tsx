import type { CorePerformanceProfile } from "@/domain/core-performance";

function timestamp(value: string | null): string {
  if (value === null) return "Not available";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Not available";

  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(parsed);
}

function seconds(milliseconds: number): string {
  return `${(milliseconds / 1_000).toFixed(3)} s`;
}

function speed(metresPerSecond: number): string {
  return `${metresPerSecond.toFixed(3)} m/s`;
}

function label(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function CoreIntelligenceWorkspace({
  profiles,
  lastImportedAt,
}: Readonly<{
  profiles: readonly CorePerformanceProfile[];
  lastImportedAt: string | null;
}>) {
  return (
    <div className="space-y-8">
      <header className="max-w-4xl">
        <p className="text-sm font-semibold text-[var(--accent)]">
          Phase 2 historical profiles
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          Core Intelligence
        </h1>
        <p className="mt-4 text-base leading-7 text-[var(--muted)]">
          Bike, Car and Horse evidence remains separate at every exact distance.
          Profiles use accepted historical observations and never represent the
          current game field.
        </p>
      </header>

      <section
        aria-labelledby="analytical-boundary"
        className="rounded-2xl border border-[var(--warning)]/50 bg-[var(--surface-raised)] p-6"
      >
        <h2 className="text-lg font-semibold" id="analytical-boundary">
          Experimental evidence boundary
        </h2>
        <p className="mt-3 max-w-4xl leading-7 text-[var(--muted)]">
          Fewer than 10 races at one exact mode-distance combination is
          hypothesis-only. Ten races is minimally analytical, not proof of
          quality. Recommendations remain disabled until Gate C chronological
          holdout and calibration evidence passes.
        </p>
      </section>

      <section aria-labelledby="profile-heading">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold" id="profile-heading">
              Exact-distance profiles
            </h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Historical snapshot · Last imported {timestamp(lastImportedAt)}
            </p>
          </div>
          <span className="rounded-full border border-[var(--border)] px-3 py-1 text-xs font-semibold text-[var(--warning)]">
            Experimental
          </span>
        </div>

        {profiles.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6">
            <h3 className="font-semibold">No validated performance profiles</h3>
            <p className="mt-3 max-w-3xl leading-7 text-[var(--muted)]">
              No race metric is displayed until elapsed time has been validated,
              normalized to milliseconds and materialized from an accepted
              private import. Missing data is not treated as zero performance.
            </p>
          </div>
        ) : (
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            {profiles.map((profile) => (
              <article
                className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5"
                key={JSON.stringify([
                  profile.coreId,
                  profile.mode,
                  profile.distance,
                ])}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold tracking-wider text-[var(--accent)] uppercase">
                      {profile.mode} ·{" "}
                      {profile.distance.toLocaleString("en-AU")} m
                    </p>
                    <h3 className="mt-2 text-lg font-semibold">
                      Core {profile.coreId}
                    </h3>
                  </div>
                  <span className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--muted)]">
                    {label(profile.sampleStatus)}
                  </span>
                </div>

                <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-[var(--muted)]">Races</dt>
                    <dd className="mt-1 font-semibold">
                      {profile.raceCount.toLocaleString("en-AU")}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[var(--muted)]">Best time</dt>
                    <dd className="mt-1 font-semibold">
                      {seconds(profile.elapsedTime.bestMilliseconds)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[var(--muted)]">Median time</dt>
                    <dd className="mt-1 font-semibold">
                      {seconds(profile.elapsedTime.medianMilliseconds)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[var(--muted)]">Best speed</dt>
                    <dd className="mt-1 font-semibold">
                      {speed(profile.speed.bestMetresPerSecond)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[var(--muted)]">
                      Gold received / opportunities
                    </dt>
                    <dd className="mt-1 font-semibold">
                      {profile.starProfile
                        ? `${profile.starProfile.goldReceivedRate.numerator} / ${profile.starProfile.goldReceivedRate.denominator}`
                        : "Not available"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[var(--muted)]">
                      Blue received / opportunities
                    </dt>
                    <dd className="mt-1 font-semibold">
                      {profile.starProfile
                        ? `${profile.starProfile.blueReceivedRate.numerator} / ${profile.starProfile.blueReceivedRate.denominator}`
                        : "Not available"}
                    </dd>
                  </div>
                </dl>

                <div className="mt-5 border-t border-[var(--border)] pt-4 text-sm text-[var(--muted)]">
                  <p>
                    Data current through {timestamp(profile.dataCurrentThrough)}
                  </p>
                  <p className="mt-1">
                    Freshness {label(profile.freshness)} · Analytical status{" "}
                    {label(profile.analyticalStatus)}
                  </p>
                  {profile.starProfile ? (
                    <p className="mt-1">
                      Gold-eligible races{" "}
                      {profile.starProfile.goldEligibleRaceCount.toLocaleString(
                        "en-AU",
                      )}
                    </p>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
