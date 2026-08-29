import Link from "next/link";

import type {
  ProLeagueCandidate,
  ProLeaguePreparation,
} from "@/domain/pro-league-preparation";
import { proLeagueTrialOperationsAuthority } from "@/domain/pro-league-competition";
import { proLeagueMapAuthority, proLeagueMaps } from "@/domain/pro-league-maps";
import {
  proLeagueCurrentRules,
  proLeagueTrialObservedRosterRules,
  type ProLeagueRosterAudit,
} from "@/domain/pro-league-roster";
import type { ProLeaguePreparationConnectionStatus } from "@/lib/pro-league-preparation-service";

const elements = ["Metal", "Fire", "Earth", "Water"] as const;

const connectionCopy: Record<
  ProLeaguePreparationConnectionStatus,
  Readonly<{ heading: string; detail: string }>
> = {
  identity_not_connected: {
    heading: "Owner identity not connected",
    detail:
      "Pro League preparation remains unavailable until the signed-in owner matches the private server-side allowlist.",
  },
  persistence_not_configured: {
    heading: "Vault, performance or format evidence not connected",
    detail:
      "The planner requires My Vault, persisted Bike Core Performance profiles, exact-distance benchmarks and bounded Bike payout-format profiles. It fails closed rather than showing a partial synthetic ranking.",
  },
  read_model_connected: {
    heading: "My Vault and DNA Racing power evidence connected",
    detail:
      "Pro League uses accepted Bike-only evidence, exact-distance winning/top-three benchmarks and descriptive Bike payout-format context.",
  },
};

function label(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
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

function rate(numerator: number, denominator: number): string {
  if (denominator <= 0) return "Not available";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function candidateSummary(core: ProLeagueCandidate): string {
  return `Bike analytical evidence: ${core.analyticalModes.includes("bike") ? "yes" : "no"}`;
}

function CandidateRow({
  core,
  rank,
}: Readonly<{ core: ProLeagueCandidate; rank: number }>) {
  const supportedFormats = core.payoutFormatProfiles.filter(
    ({ sampleStatus, freshness }) =>
      sampleStatus === "minimally_supported" &&
      (freshness === "current" || freshness === "ageing"),
  );
  return (
    <li className="py-4">
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <p className="font-semibold">
            {rank}. {core.displayName}
          </p>
          <p className="mt-1 font-mono text-xs text-[var(--muted)]">
            {core.coreId}
          </p>
        </div>
        <span className="text-xs font-semibold text-[var(--warning)]">
          {label(core.powerTier)}
        </span>
      </div>
      <p className="mt-2 text-sm text-[var(--muted)]">
        {core.element} · {core.coreClass} · {core.sex} · F{core.fNumber} ·{" "}
        {core.totalRaceCount} accepted races
      </p>
      <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
        {candidateSummary(core)} · {core.winningRangeDistances} winning-range
        distance(s) · {core.topThreeOrBetterDistances} top-three-or-better
        distance(s)
      </p>
      <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
        Evidence current through: {timestamp(core.dataCurrentThrough)} ·
        Freshness: {label(core.evidenceFreshness)}
      </p>
      <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
        Supported payout-format contexts: {core.supportedPayoutFormatCount}
        {supportedFormats.length > 0
          ? ` · ${supportedFormats
              .map(
                (profile) =>
                  `${profile.payoutFormatLabel} (${profile.mode}, ${profile.raceCount} races, ${rate(profile.winCount, profile.raceCount)} wins, ${rate(profile.topThreeCount, profile.raceCount)} Top 3)`,
              )
              .join(" · ")}`
          : " · none current with at least 10 races"}
      </p>
    </li>
  );
}

function Preparation({
  preparation,
  lastImportedAt,
}: Readonly<{
  preparation: ProLeaguePreparation;
  lastImportedAt: string | null;
}>) {
  const discovery = preparation.discoveryQueue.filter(
    ({ discoveryPriority }) => discoveryPriority !== "maintain",
  );
  const breedingTargets = preparation.elements.filter(
    ({ breedingPriority }) => breedingPriority !== "maintain",
  );

  return (
    <>
      <section aria-labelledby="pro-vault-readiness">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold" id="pro-vault-readiness">
              Roster pool readiness
            </h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              {preparation.ownedCoreCount} owned · {preparation.femaleCount}
              /8 females · {preparation.f15PlusCount}/2 above F15 ·{" "}
              {preparation.selectableUnderGenesisCaps} selectable under the
              current element and Genesis ceilings.
            </p>
          </div>
          <span className="rounded-full border border-[var(--warning)]/50 px-3 py-1 text-xs font-semibold text-[var(--warning)]">
            {preparation.structuralPoolReady
              ? "Structural pool available"
              : "Structural gaps remain"}
          </span>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {preparation.elements.map((item) => (
            <article
              className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5"
              key={item.element}
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-semibold">{item.element}</h3>
                <span className="text-xs text-[var(--muted)]">
                  {item.bikeStrongOwned} Bike-strong
                </span>
              </div>
              <p className="mt-3 text-sm text-[var(--muted)]">
                {item.totalOwned} owned · {item.genesisOwned} Genesis ·{" "}
                {item.nonGenesisOwned} non-Genesis
              </p>
              <p className="mt-2 text-xs text-[var(--muted)]">
                {item.femaleOwned} female · {item.f15PlusOwned} above F15 ·
                quality depth gap {item.powerDepthGap}
              </p>
            </article>
          ))}
        </div>
        {preparation.structuralIssues.length > 0 ? (
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-[var(--warning)]">
            {preparation.structuralIssues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-[var(--muted)]">
            Structural minimums are available. The next objective is replacing
            merely compliant cores with the strongest Bike candidates.
          </p>
        )}
      </section>

      <section aria-labelledby="pro-power-pool">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold" id="pro-power-pool">
              Overall power shortlist
            </h2>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-[var(--muted)]">
              Ordered transparently by Bike winning-range distance breadth, then
              Bike top-three breadth, analytical coverage and sample depth. Car
              and Horse results do not affect this shortlist.
            </p>
          </div>
          <span className="rounded-full border border-[var(--border)] px-3 py-1 text-xs font-semibold text-[var(--muted)]">
            Shared DNA Racing performance
          </span>
        </div>
        <ol className="mt-4 divide-y divide-[var(--border)] rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] px-5">
          {preparation.overallPowerPool.slice(0, 20).map((core, index) => (
            <CandidateRow core={core} key={core.coreId} rank={index + 1} />
          ))}
        </ol>
      </section>

      <section aria-labelledby="pro-breeding">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold" id="pro-breeding">
              Breeding for roster quality
            </h2>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-[var(--muted)]">
              No additional Genesis minting. Breed to close genuine structural
              gaps and, once compliant, to improve elite Bike upside. A weak
              Core should not be retained simply to fill the 25-Core ceiling.
            </p>
          </div>
          <Link
            className="text-sm font-semibold text-[var(--accent)] underline-offset-4 hover:underline"
            href="/breeding"
          >
            Open Breeding →
          </Link>
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <article className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5">
            <h3 className="font-semibold">Global breeding targets</h3>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-[var(--muted)]">
              <li>
                Above-F15 gap: {preparation.breeding.aboveF15Gap}. Confirmed
                offspring F-number is the parent sum, so an above-F15 structural
                target requires a sum of at least{" "}
                {preparation.breeding.minimumParentFSumForAboveF15}.
              </li>
              <li>
                Female gap: {preparation.breeding.femaleGap}. Offspring sex is
                not treated as deterministically targetable; manage the minimum
                through actual outcomes and retention.
              </li>
              <li>
                Quality objective:{" "}
                {label(preparation.breeding.qualityObjective)}. Keep the
                existing elite-upside breeding ranking visible even where roster
                counts are already sufficient.
              </li>
            </ul>
          </article>
          <article className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5">
            <h3 className="font-semibold">Element priorities</h3>
            {breedingTargets.length === 0 ? (
              <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
                Every element has structural and current Bike quality depth.
                Continue breeding only where the expected upside can improve the
                strongest compliant roster nucleus.
              </p>
            ) : (
              <ul className="mt-3 space-y-3 text-sm leading-6 text-[var(--muted)]">
                {breedingTargets.map((target) => (
                  <li key={target.element}>
                    <strong className="text-[var(--foreground)]">
                      {target.element}:
                    </strong>{" "}
                    {label(target.breedingPriority)} · Bike quality gap{" "}
                    {target.powerDepthGap}. {target.breedingGuidance}
                  </li>
                ))}
              </ul>
            )}
          </article>
        </div>
      </section>

      <section aria-labelledby="pro-discovery">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold" id="pro-discovery">
              Pro League Discovery queue
            </h2>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-[var(--muted)]">
              Use Bike evidence only. Apply lineage and adjacent-distance Bike
              evidence to choose efficient probes and stop weak paths early; Car
              and Horse Discovery remains outside Pro League.
            </p>
          </div>
          <Link
            className="text-sm font-semibold text-[var(--accent)] underline-offset-4 hover:underline"
            href="/discovery"
          >
            Open Discovery →
          </Link>
        </div>
        {discovery.length === 0 ? (
          <p className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5 text-sm text-[var(--muted)]">
            No Bike Discovery candidate is currently prioritised.
          </p>
        ) : (
          <ol className="mt-4 divide-y divide-[var(--border)] rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] px-5">
            {discovery.slice(0, 20).map((core, index) => (
              <li className="py-4" key={core.coreId}>
                <div className="flex flex-wrap justify-between gap-3">
                  <div>
                    <p className="font-semibold">
                      {index + 1}. {core.displayName}
                    </p>
                    <p className="mt-1 font-mono text-xs text-[var(--muted)]">
                      {core.coreId}
                    </p>
                  </div>
                  <span className="text-xs font-semibold text-[var(--warning)]">
                    {label(core.discoveryPriority)} · {label(core.powerTier)}
                  </span>
                </div>
                <p className="mt-2 text-sm text-[var(--muted)]">
                  Bike analytical evidence{" "}
                  {core.analyticalModes.includes("bike")
                    ? "available"
                    : "missing"}{" "}
                  · {core.winningRangeDistances} winning-range distance(s) ·{" "}
                  {core.topThreeOrBetterDistances} top-three-or-better
                  distance(s)
                </p>
                <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                  {core.reasons.join(" ")}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-labelledby="pro-format-evidence">
        <h2 className="text-xl font-semibold" id="pro-format-evidence">
          Race-format versatility
        </h2>
        <div className="mt-4 rounded-2xl border border-[var(--line)] bg-[var(--surface-raised)] p-5">
          <p className="text-sm leading-6 text-[var(--muted)]">
            Top 3, Winner Take All and other `rpayout` formats are part of the
            Pro League review. Each candidate now shows accepted race, win and
            Top-3 context when a profile has at least 10 races and is current or
            ageing. Smaller or stale profiles remain hypothesis-only. These
            rates do not represent money, do not replace `rformat`, do not blend
            times across distances and do not claim that format causes intrinsic
            performance.
          </p>
          <p className="mt-3 text-xs font-semibold text-[var(--success)]">
            {label(preparation.formatEvidenceStatus)}
          </p>
        </div>
      </section>

      <section aria-labelledby="pro-team-pools">
        <h2 className="text-xl font-semibold" id="pro-team-pools">
          Element team-core pools
        </h2>
        <p className="mt-2 max-w-4xl text-sm leading-6 text-[var(--muted)]">
          These use the same transparent overall-power order inside each
          element. Structural constraints are tie-breakers, not a substitute for
          power.
        </p>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {elements.map((element) => (
            <article
              className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5"
              key={element}
            >
              <h3 className="font-semibold">{element}</h3>
              <ol className="mt-3 divide-y divide-[var(--border)]">
                {preparation.teamCandidatePools[element]
                  .slice(0, 8)
                  .map((core, index) => (
                    <CandidateRow
                      core={core}
                      key={core.coreId}
                      rank={index + 1}
                    />
                  ))}
              </ol>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-[var(--warning)]/50 bg-[var(--surface-raised)] p-6">
        <h2 className="text-lg font-semibold">Unknowns kept unconfigured</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-[var(--muted)]">
          {preparation.unresolvedRules.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-[var(--muted)]">
          DNA Racing performance evidence last imported:{" "}
          {timestamp(lastImportedAt)}.
        </p>
      </section>
    </>
  );
}

function MapAuthority() {
  return (
    <section aria-labelledby="pro-map-authority">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold" id="pro-map-authority">
            Published map race lines
          </h2>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-[var(--muted)]">
            Four maps are currently published. Each contains a fixed sequence of
            42 Bike races. Every race gate is split equally between the two
            competing Vaults. A mapping can target only one race line or every
            line on that map with the same race type and exact distance.
          </p>
        </div>
        <span className="rounded-full border border-[var(--border)] px-3 py-1 text-xs font-semibold text-[var(--muted)]">
          Advisory mapping only
        </span>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {proLeagueMaps.map((map) => {
          const raceTypes = [
            ...new Set(map.races.map(({ raceType }) => raceType)),
          ];
          const distances = [
            ...new Set(map.races.map(({ distanceMetres }) => distanceMetres)),
          ].sort((left, right) => left - right);
          return (
            <article
              className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5"
              key={map.mapId}
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--accent)]">
                Map {map.mapNumber}
              </p>
              <h3 className="mt-1 text-lg font-semibold">{map.name}</h3>
              <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
                {map.races.length} fixed races · {raceTypes.length} race type
                {raceTypes.length === 1 ? "" : "s"} · {distances[0]}–
                {distances.at(-1)} metres
              </p>
              <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                Equal gate split: each Vault supplies half of every field.
              </p>
              <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                {raceTypes.join(" · ")}
              </p>
            </article>
          );
        })}
      </div>
      <p className="mt-4 text-sm leading-6 text-[var(--muted)]">
        Match authority: best of {proLeagueMapAuthority.matchFormat.bestOfMaps}{" "}
        maps; first to {proLeagueMapAuthority.matchFormat.firstToRacePoints}{" "}
        race points wins a map and must win by{" "}
        {proLeagueMapAuthority.matchFormat.winByRacePoints}. The home Vault
        picks map 1 and denies one map; the away Vault then picks map 2. The
        match record must identify how map 3 is resolved. The website recommends
        only; the owner still acts manually on DNA Esports.
      </p>
    </section>
  );
}

function MatchupAuthority() {
  return (
    <section aria-labelledby="pro-matchup-intelligence">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold" id="pro-matchup-intelligence">
            Opposition and matchup intelligence
          </h2>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-[var(--muted)]">
            Pro League is a head-to-head Bike contest between two Vaults. The
            planner compares our roster with the opposition for every exact race
            type and distance, recommends mapped Cores from the registered 12–25
            Core roster and ranks the choices available to our home or away
            role.
          </p>
        </div>
        <span className="rounded-full border border-[var(--border)] px-3 py-1 text-xs font-semibold text-[var(--muted)]">
          Two Vaults · 50/50 gates
        </span>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <article className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5">
          <h3 className="font-semibold">Home and away map roles</h3>
          <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
            When home, rank the first pick and the map to deny. When away, rank
            map 2 from the choices left by the home action. Prepare a separate
            contingency for the recorded third-map policy.
          </p>
        </article>
        <article className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5">
          <h3 className="font-semibold">Opposition-aware mapping</h3>
          <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
            Compare the likely opposing Core with our eligible rostered Cores on
            the exact Bike format and distance. Missing opposition evidence
            remains unknown and is never counted as an advantage.
          </p>
        </article>
        <article className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5">
          <h3 className="font-semibold">Season-long roster discipline</h3>
          <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
            Preserve the annual{" "}
            {proLeagueCurrentRules.maximumSubstitutionsPerYear}-substitution
            budget. “Best in our Vault” is not the same as strong: weak
            best-available Cores are marked for testing or breeding and are not
            recommended for roster lock merely to fill a gap.
          </p>
        </article>
      </div>
      <div className="mt-4 rounded-2xl border border-[var(--warning)]/50 bg-[var(--surface-raised)] p-5">
        <h3 className="font-semibold">Coverage-gap output</h3>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
          The connected analysis will list weak and unproven Bike distances and
          race formats, how often they occur across the published maps, our best
          evidenced option, whether that option is still weak, and the next
          efficient Discovery or breeding objective. If a weak Core is required
          temporarily for structural compliance, it is labelled provisional and
          placed on the replacement-priority list.
        </p>
      </div>
    </section>
  );
}

function TrialOperationsAuthority() {
  const trial = proLeagueTrialOperationsAuthority;
  return (
    <section aria-labelledby="pro-trial-operations">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold" id="pro-trial-operations">
            Trial operations now modelled
          </h2>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-[var(--muted)]">
            These observations explain the live practice workflow. Trial-only
            exceptions remain labelled and cannot silently become proper-season
            rules.
          </p>
        </div>
        <span className="rounded-full border border-[var(--warning)]/50 px-3 py-1 text-xs font-semibold text-[var(--muted)]">
          Trial authority · {trial.observedAt}
        </span>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <article className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5">
          <h3 className="font-semibold">Reusable four-map setup</h3>
          <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
            Configure every published map once. Saved assignments carry across
            matches and may be changed before lock; the lineup version locked to
            a match remains historical evidence.
          </p>
        </article>
        <article className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5">
          <h3 className="font-semibold">Staged match selection</h3>
          <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
            Home picks map 1 and denies one; away picks map 2. The third map
            must retain the actual match policy because trial pages disagree on
            whether the denied map can return to the random pool.
          </p>
        </article>
        <article className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5">
          <h3 className="font-semibold">Early finish and separate scores</h3>
          <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
            A map stops at 16 or more with a two-point lead; a match stops at
            two map wins. Core results, race points, map scores, match results
            and league points remain separate.
          </p>
        </article>
      </div>
      <p className="mt-4 text-sm leading-6 text-[var(--muted)]">
        Current trial standings display {trial.standings.winPoints}/
        {trial.standings.drawPoints}/{trial.standings.lossPoints} points for a
        win/draw/loss. No ageing, unlimited pre-lock roster changes, practice
        payouts and missed-pick fallbacks are trial observations only.
      </p>
    </section>
  );
}

export function ProLeagueWorkspace({
  audit,
  connectionStatus,
  preparation,
  lastImportedAt,
}: Readonly<{
  audit: ProLeagueRosterAudit;
  connectionStatus: ProLeaguePreparationConnectionStatus;
  preparation: ProLeaguePreparation | null;
  lastImportedAt: string | null;
}>) {
  const connection = connectionCopy[connectionStatus];
  return (
    <div className="space-y-8">
      <header className="max-w-4xl">
        <p className="text-sm font-semibold text-[var(--accent)]">
          Dedicated Pro League preparation
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          Pro League
        </h1>
        <p className="mt-4 text-base leading-7 text-[var(--muted)]">
          Build the strongest compliant 12–25 Core roster from the existing
          Vault and breeding, analyse the opposition, prepare the correct home
          or away map action and map rostered Cores to the published race lines.
          Prefer Cores that prove power for the exact race type and distance
          required. No additional Genesis minting is part of this plan.
        </p>
      </header>

      <section className="rounded-2xl border border-[var(--warning)]/50 bg-[var(--surface-raised)] p-6">
        <h2 className="text-lg font-semibold">
          Rule and performance authority
        </h2>
        <p className="mt-3 max-w-4xl leading-7 text-[var(--muted)]">
          Source: {proLeagueCurrentRules.sourceLabel}, received{" "}
          {proLeagueCurrentRules.receivedAt}. Current roster limits and the
          public four-map catalogue are configured; additional maps and
          initial-roster substitution counting remain unresolved. The live trial
          displays a{" "}
          {proLeagueTrialObservedRosterRules.femaleMinimum.percentage}
          %-rounded-up female rule, but it does not replace the current
          owner-confirmed minimum-eight validator without final authority. Pro
          League uses the same underlying DNA Racing Core performance, so
          accepted Bike history remains valid evidence where the API exposes it.
        </p>
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6">
        <h2 className="text-lg font-semibold">{connection.heading}</h2>
        <p className="mt-3 max-w-4xl leading-7 text-[var(--muted)]">
          {connection.detail}
        </p>
      </section>

      <MapAuthority />

      <MatchupAuthority />

      <TrialOperationsAuthority />

      {preparation === null ? null : (
        <Preparation
          lastImportedAt={lastImportedAt}
          preparation={preparation}
        />
      )}

      <section aria-labelledby="selected-roster-audit">
        <h2 className="text-xl font-semibold" id="selected-roster-audit">
          Exact selected-roster validation
        </h2>
        <p className="mt-2 max-w-4xl text-sm leading-6 text-[var(--muted)]">
          The deterministic 12–25 Core validator remains available for the owner
          selection workflow. Structural compliance is necessary but does not
          make a Core powerful: current placeholder audit status is{" "}
          {audit.readiness === "compliant" ? "compliant" : "not selected"}.
        </p>
      </section>
    </div>
  );
}
