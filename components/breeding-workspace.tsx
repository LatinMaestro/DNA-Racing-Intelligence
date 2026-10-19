import Link from "next/link";
import {
  BreedingEconomicForms,
  type BreedingEconomicWriteStatus,
} from "@/components/breeding-economic-forms";
import { raceModes } from "@/domain/core-performance";
import type { EvidenceViewFilters } from "@/lib/evidence-view-filters";
import type { BreedingPairRankingResult } from "@/domain/breeding-pair-ranking";
import type { BreedingWorkspaceConnectionStatus } from "@/lib/breeding-workspace-service";

const connectionCopy: Record<
  BreedingWorkspaceConnectionStatus,
  Readonly<{ heading: string; detail: string }>
> = {
  identity_not_connected: {
    heading: "Owner identity not connected",
    detail:
      "Breeding evidence remains unavailable until the signed-in owner is verified against the server-side allowlist.",
  },
  persistence_not_configured: {
    heading: "Breeding read model not connected",
    detail:
      "Owner verification is available, but the compact private ranking repository is not configured. No raw history is scanned on this page.",
  },
  read_failed: {
    heading: "Breeding evidence temporarily unavailable",
    detail:
      "The owner-scoped breeding read could not be completed. All pair rankings are withheld until the repository is available; no cached or inferred replacements are shown.",
  },
  integrity_failed: {
    heading: "Breeding evidence failed validation",
    detail:
      "Saved breeding evidence failed validation. All pair rankings remain unavailable until the accepted snapshot is repaired; no partial results are shown.",
  },
  read_model_connected: {
    heading: "Historical breeding evidence connected",
    detail:
      "Separate experimental rankings are available from accepted evidence. They do not authorise a pairing or breeding transaction.",
  },
};

function label(value: string): string {
  return value
    .split("_")
    .map((part) => {
      const normalized = part.toLowerCase();
      return normalized.charAt(0).toUpperCase() + normalized.slice(1);
    })
    .join(" ");
}

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

function percentage(basisPoints: number): string {
  return `${(basisPoints / 100).toLocaleString("en-AU", {
    maximumFractionDigits: 2,
  })}%`;
}

type RankedPair = BreedingPairRankingResult["eliteUpsideRanking"][number];

function RankingList({
  heading,
  description,
  pairs,
}: Readonly<{
  heading: string;
  description: string;
  pairs: readonly RankedPair[];
}>) {
  return (
    <section
      aria-label={heading}
      className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5"
    >
      <h3 className="text-lg font-semibold">{heading}</h3>
      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
        {description}
      </p>
      {pairs.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--muted)]">
          No accepted pairs match these filters.
        </p>
      ) : (
        <ol className="mt-4 divide-y divide-[var(--border)]">
          {pairs.map((pair) => (
            <li className="py-4" key={pair.pairId}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">
                    {pair.rank}. Pair {pair.pairId}
                  </p>
                  <p className="mt-1 font-mono text-xs text-[var(--muted)]">
                    {pair.parentCoreIds.join(" + ")}
                  </p>
                </div>
                <span className="text-xs font-semibold text-[var(--warning)]">
                  {pair.mode} · {pair.exactDistanceM.toLocaleString("en-AU")} m
                </span>
              </div>
              <p className="mt-3 text-sm text-[var(--muted)]">
                Experimental exceptional estimate{" "}
                {percentage(pair.exceptionalUpsideBasisPoints)} · Experimental
                stronger or exceptional estimate{" "}
                {percentage(pair.strongerOrExceptionalBasisPoints)} · Vault fit{" "}
                {percentage(pair.vaultFitBasisPoints)} ·{" "}
                {label(pair.evidenceConfidence)} confidence
              </p>
              <p className="mt-2 text-sm text-[var(--muted)]">
                Predicted confirmed rules: {pair.predictedOffspringClass} ·{" "}
                {pair.predictedOffspringElement} · F
                {pair.predictedOffspringFNumber.toLocaleString("en-AU")} ·{" "}
                {label(pair.source)}
              </p>
              {pair.arenaListingExpiresAt === null ? null : (
                <p className="mt-2 text-xs text-[var(--warning)]">
                  Imported Arena listing expiry{" "}
                  {timestamp(pair.arenaListingExpiresAt)}
                </p>
              )}
              <details className="mt-3 rounded-lg border border-[var(--border)] p-3 text-sm">
                <summary className="cursor-pointer font-semibold">
                  Compare parents and evidence
                </summary>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {pair.parentCoreIds.map((coreId, index) => (
                    <div
                      className="min-w-0 rounded-lg bg-[var(--surface)] p-3"
                      key={coreId}
                    >
                      <p className="text-xs text-[var(--muted)]">
                        Parent {index + 1}
                      </p>
                      <p className="mt-1 break-all font-semibold">{coreId}</p>
                      <Link
                        className="mt-2 inline-flex rounded-lg border border-[var(--border)] px-3 py-2 font-semibold"
                        href={`/search-core?coreId=${encodeURIComponent(coreId)}&mode=${pair.mode.toLowerCase()}&distance=${pair.exactDistanceM}#selected-core`}
                        prefetch={false}
                      >
                        View race evidence
                      </Link>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
                  These are accepted historical pair estimates, not a new
                  prediction or confirmation of current breeding availability.
                  Current official pair validation and itemised costs are not
                  supplied by this ranking.
                </p>
              </details>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function BreedingWorkspace({
  rankings,
  connectionStatus,
  filters = { mode: "all", distance: null },
  selectedParents = ["", ""],
  economicWriteStatus,
}: Readonly<{
  rankings: readonly BreedingPairRankingResult[];
  connectionStatus: BreedingWorkspaceConnectionStatus;
  filters?: EvidenceViewFilters;
  selectedParents?: readonly [string, string];
  economicWriteStatus?: BreedingEconomicWriteStatus;
}>) {
  const connection = connectionCopy[connectionStatus];
  const allPairs = rankings.flatMap((ranking) => [
    ...ranking.eliteUpsideRanking,
    ...ranking.vaultGapRanking,
    ...ranking.balancedRanking,
  ]);
  const parents = [
    ...new Set(allPairs.flatMap((pair) => pair.parentCoreIds)),
  ].sort();
  const distances = [
    ...new Set(allPairs.map((pair) => pair.exactDistanceM)),
  ].sort((a, b) => a - b);
  const matches = (pair: RankedPair) =>
    (filters.mode === "all" || pair.mode.toLowerCase() === filters.mode) &&
    (filters.distance === null || pair.exactDistanceM === filters.distance) &&
    selectedParents.every(
      (id) => id === "" || pair.parentCoreIds.includes(id),
    ) &&
    !(selectedParents[0] !== "" && selectedParents[0] === selectedParents[1]);

  return (
    <div className="space-y-8">
      <header className="max-w-4xl">
        <p className="text-sm font-semibold text-[var(--accent)]">
          Phase 6 pairing review
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          Breeding
        </h1>
        <p className="mt-4 text-base leading-7 text-[var(--muted)]">
          Elite-upside, Vault-gap and balanced objectives remain separate so
          Vault saturation cannot hide rare high-upside evidence. Arena
          availability is historical imported evidence, not live state.
        </p>
      </header>

      <section
        aria-labelledby="breeding-connection"
        className="rounded-2xl border border-[var(--warning)]/50 bg-[var(--surface-raised)] p-6"
      >
        <h2 className="text-lg font-semibold" id="breeding-connection">
          {connection.heading}
        </h2>
        <p className="mt-3 max-w-4xl leading-7 text-[var(--muted)]">
          {connection.detail}
        </p>
        <button
          className="mt-5 cursor-not-allowed rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-semibold text-[var(--muted)]"
          disabled
          type="button"
        >
          Breeding execution unavailable
        </button>
      </section>

      <section aria-labelledby="breeding-rankings">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold" id="breeding-rankings">
              Experimental pair rankings
            </h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Confirmed family restrictions and supported outcome distributions
              remain prerequisites.
            </p>
          </div>
          <span className="rounded-full border border-[var(--border)] px-3 py-1 text-xs font-semibold text-[var(--warning)]">
            Gate E not passed
          </span>
        </div>

        {rankings.length === 0 ? null : (
          <form
            action="/breeding#breeding-rankings"
            method="get"
            className="mt-4 grid gap-3 rounded-xl border border-[var(--border)] p-4 sm:grid-cols-2 lg:grid-cols-5"
            aria-label="Find an accepted pair"
          >
            <label className="min-w-0 text-sm font-semibold">
              Mode
              <select
                className="mt-1 block w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2"
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
            <label className="min-w-0 text-sm font-semibold">
              Exact distance
              <select
                className="mt-1 block w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2"
                defaultValue={filters.distance ?? ""}
                name="distance"
              >
                <option value="">All distances</option>
                {filters.distance !== null &&
                !distances.includes(filters.distance) ? (
                  <option value={filters.distance}>
                    {filters.distance.toLocaleString("en-AU")} m
                  </option>
                ) : null}
                {distances.map((distance) => (
                  <option key={distance} value={distance}>
                    {distance.toLocaleString("en-AU")} m
                  </option>
                ))}
              </select>
            </label>
            {selectedParents.map((selected, index) => (
              <label className="min-w-0 text-sm font-semibold" key={index}>
                Parent {index + 1}
                <select
                  className="mt-1 block w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2"
                  defaultValue={selected}
                  name={`parent${index + 1}`}
                >
                  <option value="">Any parent</option>
                  {selected !== "" && !parents.includes(selected) ? (
                    <option value={selected}>{selected}</option>
                  ) : null}
                  {parents.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <div className="flex items-end">
              <button
                className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
                type="submit"
              >
                Find accepted pairs
              </button>
            </div>
            <p className="text-xs text-[var(--muted)] sm:col-span-2 lg:col-span-5">
              Filters narrow the accepted snapshot and preserve each
              objective&apos;s original rank. They do not generate predictions
              for unassessed pairs. Held pairs remain visible below.
            </p>
          </form>
        )}

        {rankings.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6">
            <h3 className="font-semibold">No accepted breeding rankings</h3>
            <p className="mt-3 max-w-3xl leading-7 text-[var(--muted)]">
              Missing ranking evidence is unavailable. It does not mean every
              pair is eligible, available or low value.
            </p>
          </div>
        ) : (
          <div className="mt-4 space-y-8">
            {rankings.map((ranking) => (
              <article className="space-y-5" key={ranking.rankingId}>
                <div>
                  <h3 className="text-lg font-semibold">
                    {ranking.rankingLabel}
                  </h3>
                  <p className="mt-2 text-sm text-[var(--muted)]">
                    Evaluated {timestamp(ranking.evaluatedAt)} · Data current
                    through {timestamp(ranking.dataCurrentThrough)} · Last
                    imported {timestamp(ranking.lastImported)} ·{" "}
                    {label(ranking.freshness)}
                  </p>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    Arena current through{" "}
                    {timestamp(ranking.arenaDataCurrentThrough)} · Arena last
                    imported {timestamp(ranking.arenaLastImported)} ·{" "}
                    {label(ranking.arenaFreshness)}
                  </p>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    Rules {ranking.rulesetVersion} · Candidates{" "}
                    {ranking.candidateSnapshotVersion} · Projection{" "}
                    {ranking.projectionVersion} · Arena snapshot{" "}
                    {ranking.arenaSnapshotVersion ?? "Not used"}
                  </p>
                </div>
                <div className="grid gap-4 xl:grid-cols-3">
                  <RankingList
                    description="Exceptional-outcome probability only; Vault fit cannot suppress this order."
                    heading="Elite upside"
                    pairs={ranking.eliteUpsideRanking.filter(matches)}
                  />
                  <RankingList
                    description="Missing-role fit only; elite upside remains independently visible."
                    heading="Vault gap"
                    pairs={ranking.vaultGapRanking.filter(matches)}
                  />
                  <RankingList
                    description="Explicit configured weights combine broader quality and Vault fit."
                    heading="Balanced"
                    pairs={ranking.balancedRanking.filter(matches)}
                  />
                </div>
                {ranking.heldPairs.length > 0 ? (
                  <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5">
                    <h3 className="font-semibold">Held pairs</h3>
                    <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-[var(--muted)]">
                      {ranking.heldPairs.map((pair) => (
                        <li key={pair.pairId}>
                          {pair.pairId} ({pair.parentCoreIds.join(" + ")}):{" "}
                          {pair.reasons.join(" ")}
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>

      <BreedingEconomicForms
        status={
          economicWriteStatus ??
          (connectionStatus === "identity_not_connected"
            ? "identity_not_connected"
            : "persistence_not_configured")
        }
      />
    </div>
  );
}
