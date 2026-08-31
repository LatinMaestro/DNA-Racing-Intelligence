import Link from "next/link";

import {
  buildCoreAnalysisEvidenceCoverage,
  type CoreEsportsPerformanceProfile,
} from "@/domain/core-esports-performance";
import type { CorePerformanceProfile } from "@/domain/core-performance";
import type { CoreIntelligenceConnectionStatus } from "@/lib/core-intelligence-workspace-service";

export const coreIntelligenceEvidenceViews = [
  "overview",
  "normal",
  "esports",
] as const;
export type CoreIntelligenceEvidenceView =
  (typeof coreIntelligenceEvidenceViews)[number];

const connectionCopy: Record<
  CoreIntelligenceConnectionStatus,
  Readonly<{ heading: string; detail: string }>
> = {
  identity_not_connected: {
    heading: "Owner identity not connected",
    detail:
      "Historical profiles remain unavailable until the signed-in owner is verified against the server-side allowlist.",
  },
  persistence_not_configured: {
    heading: "Core Intelligence storage not connected",
    detail:
      "Owner verification is available, but the compact private profile repository is not configured. No raw history is scanned on this page.",
  },
  read_model_connected: {
    heading: "Historical profile read model connected",
    detail:
      "Accepted owner-scoped aggregates are available. They remain historical experimental evidence, not the current game field or a recommendation.",
  },
};

const timestampFormatter = new Intl.DateTimeFormat("en-AU", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

function Timestamp({ value }: Readonly<{ value: string | null }>) {
  if (value === null) return <>Not available</>;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return <>Not available</>;
  return <time dateTime={value}>{timestampFormatter.format(parsed)} UTC</time>;
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

function EmptyEvidence({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6">
      {children}
    </div>
  );
}

function NormalEvidence({
  profiles,
}: {
  profiles: readonly CorePerformanceProfile[];
}) {
  if (profiles.length === 0) {
    return (
      <EmptyEvidence>
        <h3 className="font-semibold">No validated normal-racing profiles</h3>
        <p className="mt-3 max-w-3xl leading-7 text-[var(--muted)]">
          No race metric is displayed until elapsed time has been validated,
          normalized to milliseconds and materialized from accepted private
          evidence. Missing data is not treated as zero performance.
        </p>
      </EmptyEvidence>
    );
  }
  return (
    <div className="mt-4 grid gap-4 xl:grid-cols-2">
      {profiles.map((profile) => (
        <article
          className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5"
          key={JSON.stringify([profile.coreId, profile.mode, profile.distance])}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold tracking-wider text-[var(--accent)] uppercase">
                {profile.mode} · {profile.distance.toLocaleString("en-AU")} m
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
                Yellow received / opportunities
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
              Data current through{" "}
              <Timestamp value={profile.dataCurrentThrough} />
            </p>
            <p className="mt-1">
              Freshness {label(profile.freshness)} · Analytical status{" "}
              {label(profile.analyticalStatus)}
            </p>
            {profile.starProfile ? (
              <p className="mt-1">
                Yellow-eligible races (source Gold){" "}
                {profile.starProfile.goldEligibleRaceCount.toLocaleString(
                  "en-AU",
                )}
              </p>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}

function EsportsEvidence({
  profiles,
  connectionStatus,
}: {
  profiles: readonly CoreEsportsPerformanceProfile[];
  connectionStatus: "not_configured" | "connected";
}) {
  if (profiles.length === 0) {
    return (
      <EmptyEvidence>
        <h3 className="font-semibold">
          {connectionStatus === "connected"
            ? "No completed Esports races in the accepted generation"
            : "Esports history not commissioned yet"}
        </h3>
        <p className="mt-3 max-w-3xl leading-7 text-[var(--muted)]">
          DNA omits Pro League/Esports races from its normal public Core
          profile. Their absence here is therefore unavailable source coverage,
          never a zero-race claim. The private API history lane will publish
          only complete, deduplicated generations after the existing persistence
          approval gate.
        </p>
      </EmptyEvidence>
    );
  }
  return (
    <div className="mt-4 grid gap-4 xl:grid-cols-2">
      {profiles.map((profile) => (
        <article
          className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5"
          key={JSON.stringify([
            profile.sourceCoreId,
            profile.raceType,
            profile.distanceMetres,
          ])}
        >
          <p className="text-xs font-bold tracking-wider text-[var(--accent)] uppercase">
            Bike · {profile.raceType} ·{" "}
            {profile.distanceMetres.toLocaleString("en-AU")} m
          </p>
          <h3 className="mt-2 text-lg font-semibold">
            Core {profile.sourceCoreId}
          </h3>
          <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-[var(--muted)]">Completed starts</dt>
              <dd className="mt-1 font-semibold">
                {profile.raceCount.toLocaleString("en-AU")}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Known outcomes</dt>
              <dd className="mt-1 font-semibold">
                {profile.knownFinishCount.toLocaleString("en-AU")}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">
                {profile.resultRule === "top_three"
                  ? "Top-three results"
                  : profile.resultRule === "first_place"
                    ? "Wins"
                    : "Format successes"}
              </dt>
              <dd className="mt-1 font-semibold">
                {profile.resultRule === "unknown"
                  ? "Not classified"
                  : profile.successCount.toLocaleString("en-AU")}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Timed races</dt>
              <dd className="mt-1 font-semibold">
                {profile.timedRaceCount.toLocaleString("en-AU")}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Best time</dt>
              <dd className="mt-1 font-semibold">
                {profile.elapsedTime
                  ? seconds(profile.elapsedTime.bestMilliseconds)
                  : "Not exposed"}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Median time</dt>
              <dd className="mt-1 font-semibold">
                {profile.elapsedTime
                  ? seconds(profile.elapsedTime.medianMilliseconds)
                  : "Not exposed"}
              </dd>
            </div>
          </dl>
          <div className="mt-5 border-t border-[var(--border)] pt-4 text-sm text-[var(--muted)]">
            <p>
              Data current through{" "}
              <Timestamp value={profile.dataCurrentThrough} />
            </p>
            <p className="mt-1">
              Public DNA Core profile coverage: omitted · Freshness{" "}
              {label(profile.freshness)}
            </p>
          </div>
        </article>
      ))}
    </div>
  );
}

export function CoreIntelligenceWorkspace({
  profiles,
  lastImportedAt,
  connectionStatus,
  esportsProfiles = [],
  esportsLastSyncedAt = null,
  esportsConnectionStatus = "not_configured",
  selectedEvidenceView = "overview",
}: Readonly<{
  profiles: readonly CorePerformanceProfile[];
  lastImportedAt: string | null;
  connectionStatus: CoreIntelligenceConnectionStatus;
  esportsProfiles?: readonly CoreEsportsPerformanceProfile[];
  esportsLastSyncedAt?: string | null;
  esportsConnectionStatus?: "not_configured" | "connected";
  selectedEvidenceView?: CoreIntelligenceEvidenceView;
}>) {
  const connection = connectionCopy[connectionStatus];
  const coverage = buildCoreAnalysisEvidenceCoverage({
    normalProfiles: profiles,
    esportsProfiles,
  });
  return (
    <div className="space-y-8">
      <header className="max-w-4xl">
        <p className="text-sm font-semibold text-[var(--accent)]">
          Whole-Core evidence
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          Core Intelligence
        </h1>
        <p className="mt-4 text-base leading-7 text-[var(--muted)]">
          Normal racing and Pro League/Esports share the same underlying Core
          traits, so both contribute to whole-Core analysis. Their race counts,
          outcomes and exact-format evidence remain separately auditable.
        </p>
      </header>

      <section
        aria-labelledby="core-connection"
        className="rounded-2xl border border-[var(--warning)]/50 bg-[var(--surface-raised)] p-6"
      >
        <h2 className="text-lg font-semibold" id="core-connection">
          {connection.heading}
        </h2>
        <p className="mt-3 max-w-4xl leading-7 text-[var(--muted)]">
          {connection.detail}
        </p>
      </section>

      <nav aria-label="Core evidence views" className="flex flex-wrap gap-2">
        {coreIntelligenceEvidenceViews.map((view) => (
          <Link
            aria-current={selectedEvidenceView === view ? "page" : undefined}
            className={`rounded-full border px-4 py-2 text-sm font-semibold ${selectedEvidenceView === view ? "border-[var(--accent)] text-[var(--accent)]" : "border-[var(--border)] text-[var(--muted)]"}`}
            href={`/core-intelligence?evidence=${view}`}
            key={view}
          >
            {view === "overview"
              ? "All evidence"
              : view === "normal"
                ? "Normal racing"
                : "Esports"}
          </Link>
        ))}
      </nav>

      <section
        aria-labelledby="analytical-boundary"
        className="rounded-2xl border border-[var(--warning)]/50 bg-[var(--surface-raised)] p-6"
      >
        <h2 className="text-lg font-semibold" id="analytical-boundary">
          Experimental evidence boundary
        </h2>
        <p className="mt-3 max-w-4xl leading-7 text-[var(--muted)]">
          Esports is included in Core analysis but never silently pooled across
          unlike race formats, distances or opposition. Raw win and Top-3 rates
          remain descriptive; authoritative time, speed, consistency, sample,
          freshness and field quality stay primary.
        </p>
      </section>

      {selectedEvidenceView === "overview" ? (
        <section aria-labelledby="all-evidence-heading">
          <h2 className="text-xl font-semibold" id="all-evidence-heading">
            All analysed evidence
          </h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Normal last imported <Timestamp value={lastImportedAt} /> · Esports
            last synced <Timestamp value={esportsLastSyncedAt} />
          </p>
          {coverage.length === 0 ? (
            <EmptyEvidence>
              <h3 className="font-semibold">No commissioned Core evidence</h3>
              <p className="mt-3 max-w-3xl leading-7 text-[var(--muted)]">
                Neither missing normal history nor DNA&apos;s omitted Esports
                profile coverage is treated as zero performance.
              </p>
            </EmptyEvidence>
          ) : (
            <div className="mt-4 grid gap-4 xl:grid-cols-2">
              {coverage.map((item) => (
                <article
                  className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5"
                  key={item.sourceCoreId}
                >
                  <h3 className="text-lg font-semibold">
                    Core {item.sourceCoreId}
                  </h3>
                  <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
                    <div>
                      <dt className="text-[var(--muted)]">
                        All analysed races
                      </dt>
                      <dd className="mt-1 font-semibold">
                        {item.allAnalysedRaceCount.toLocaleString("en-AU")}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[var(--muted)]">Normal racing</dt>
                      <dd className="mt-1 font-semibold">
                        {item.normalRaceCount.toLocaleString("en-AU")}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[var(--muted)]">Esports</dt>
                      <dd className="mt-1 font-semibold">
                        {item.esportsRaceCount.toLocaleString("en-AU")}
                      </dd>
                    </div>
                  </dl>
                  <p className="mt-4 text-sm text-[var(--muted)]">
                    Evidence scope {label(item.intrinsicEvidenceScope)} · DNA
                    public Esports coverage omitted
                  </p>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : selectedEvidenceView === "normal" ? (
        <section aria-labelledby="normal-profile-heading">
          <h2 className="text-xl font-semibold" id="normal-profile-heading">
            Normal-racing exact-distance profiles
          </h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Historical snapshot · Last imported{" "}
            <Timestamp value={lastImportedAt} />
          </p>
          <NormalEvidence profiles={profiles} />
        </section>
      ) : (
        <section aria-labelledby="esports-profile-heading">
          <h2 className="text-xl font-semibold" id="esports-profile-heading">
            Esports exact-format profiles
          </h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Pro League/Esports completed races · Last synced{" "}
            <Timestamp value={esportsLastSyncedAt} />
          </p>
          <EsportsEvidence
            connectionStatus={esportsConnectionStatus}
            profiles={esportsProfiles}
          />
        </section>
      )}
    </div>
  );
}
