import Link from "next/link";

import type {
  ProLeagueCandidate,
  ProLeaguePreparation,
} from "@/domain/pro-league-preparation";
import {
  proLeagueAnnouncementRules,
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
    heading: "Vault or performance evidence not connected",
    detail:
      "The planner requires My Vault, persisted cross-mode Core Performance profiles and exact-distance benchmarks. It fails closed rather than showing a synthetic power ranking.",
  },
  read_model_connected: {
    heading: "My Vault and DNA Racing power evidence connected",
    detail:
      "Pro League uses the same underlying DNA Racing core performance. The shortlist therefore uses accepted Bike, Car and Horse evidence plus exact-distance winning/top-three benchmarks.",
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

function candidateSummary(core: ProLeagueCandidate): string {
  const winningModes =
    core.winningRangeModes.length === 0
      ? "none"
      : core.winningRangeModes.join(", ");
  const topThreeModes =
    core.topThreeOrBetterModes.length === 0
      ? "none"
      : core.topThreeOrBetterModes.join(", ");
  return `Winning-range modes: ${winningModes} · Top-three-or-better modes: ${topThreeModes}`;
}

function CandidateRow({
  core,
  rank,
}: Readonly<{ core: ProLeagueCandidate; rank: number }>) {
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
        distance(s) · {core.analyticalModes.length}/3 analytical modes
      </p>
      <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
        Evidence current through: {timestamp(core.dataCurrentThrough)} ·
        Freshness: {label(core.evidenceFreshness)}
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
              /8 females · {preparation.f15PlusCount}/5 F15+ ·{" "}
              {preparation.selectableUnderGenesisCaps} selectable under the
              working Genesis caps.
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
                  {item.multiModeStrongOwned} multi-mode strong
                </span>
              </div>
              <p className="mt-3 text-sm text-[var(--muted)]">
                {item.totalOwned} owned · {item.genesisOwned} Genesis ·{" "}
                {item.nonGenesisOwned} non-Genesis
              </p>
              <p className="mt-2 text-xs text-[var(--muted)]">
                {item.femaleOwned} female · {item.f15PlusOwned} F15+ · quality
                depth gap {item.powerDepthGap}
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
            merely compliant cores with the strongest all-round candidates.
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
              Ordered transparently by cross-mode winning-range breadth, then
              top-three breadth, distance breadth, analytical coverage and
              sample depth. This deliberately favours powerful all-rounders over
              one-dimensional specialists.
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
              gaps and, once compliant, to improve elite all-round upside. A
              weak core should not be retained simply because the roster needs
              25 names.
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
                F15+ gap: {preparation.breeding.f15PlusGap}. Confirmed offspring
                F-number is the parent sum, so an F15+ structural target
                requires a sum of at least{" "}
                {preparation.breeding.minimumParentFSumForF15}.
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
                Every element has structural and current multi-mode quality
                depth. Continue breeding only where the expected upside can
                improve the top 25.
              </p>
            ) : (
              <ul className="mt-3 space-y-3 text-sm leading-6 text-[var(--muted)]">
                {breedingTargets.map((target) => (
                  <li key={target.element}>
                    <strong className="text-[var(--foreground)]">
                      {target.element}:
                    </strong>{" "}
                    {label(target.breedingPriority)} · roster gap{" "}
                    {target.rosterFloorGap} · non-Genesis gap{" "}
                    {target.nonGenesisDepthGap} · multi-mode quality gap{" "}
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
              This is intentionally a discovery-heavy competition. Strong
              evidence in one mode is a reason to test promising missing modes,
              not a reason to assume them. Use lineage and adjacent-distance
              evidence to choose efficient probes and stop weak paths early.
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
            No cross-mode Discovery candidate is currently prioritised.
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
                  {core.analyticalModes.length}/3 analytical modes ·{" "}
                  {core.winningRangeDistances} winning-range distance(s) ·{" "}
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
        <div className="mt-4 rounded-2xl border border-[var(--warning)]/50 bg-[var(--surface-raised)] p-5">
          <p className="text-sm leading-6 text-[var(--muted)]">
            Top 3, Winner Take All and other `rpayout` formats are part of the
            Pro League selection objective. The source label is already retained
            in Race Merge history, but the bounded per-core format aggregate is
            not materialised yet. Until it is, format strength stays visibly
            pending instead of being approximated from unrelated data.
          </p>
          <p className="mt-3 text-xs font-semibold text-[var(--warning)]">
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
          Build the strongest possible 25-core roster from the existing Vault
          and breeding. Prefer cores that prove power across multiple modes,
          distances and race formats. No additional Genesis minting is part of
          this plan.
        </p>
      </header>

      <section className="rounded-2xl border border-[var(--warning)]/50 bg-[var(--surface-raised)] p-6">
        <h2 className="text-lg font-semibold">
          Rule and performance authority
        </h2>
        <p className="mt-3 max-w-4xl leading-7 text-[var(--muted)]">
          Source: {proLeagueAnnouncementRules.sourceLabel}, received{" "}
          {proLeagueAnnouncementRules.receivedAt}. Roster mechanics remain
          provisional where DNA has not clarified them. The owner has confirmed
          that Pro League uses the same underlying DNA Racing core stats and
          performance, so accepted DNA Racing history is valid power evidence.
        </p>
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6">
        <h2 className="text-lg font-semibold">{connection.heading}</h2>
        <p className="mt-3 max-w-4xl leading-7 text-[var(--muted)]">
          {connection.detail}
        </p>
      </section>

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
          The deterministic 25-core validator remains available for the later
          owner selection workflow. Structural compliance is necessary but does
          not make a core powerful: current placeholder audit status is{" "}
          {audit.readiness === "compliant" ? "compliant" : "not selected"}.
        </p>
      </section>
    </div>
  );
}
