import Link from "next/link";

import type { Element } from "@/domain/game-rules";
import type { EsportsProLeaguePreparation } from "@/domain/esports-pro-league";
import type { EsportsPrepConnectionStatus } from "@/lib/esports-prep-workspace-service";

const connectionCopy: Record<
  EsportsPrepConnectionStatus,
  Readonly<{ heading: string; detail: string }>
> = {
  identity_not_connected: {
    heading: "Owner identity not connected",
    detail:
      "Pro League preparation stays unavailable until the signed-in owner matches the private server-side allowlist.",
  },
  persistence_not_configured: {
    heading: "Vault or Bike evidence not connected",
    detail:
      "The preparation model needs the owner-maintained Vault plus persisted Core Performance profiles. No synthetic roster is shown when those read models are unavailable.",
  },
  read_model_connected: {
    heading: "Owner Vault preparation evidence connected",
    detail:
      "Roster structure is calculated from the current owner-maintained Vault. DNA Racing Bike history is shown only as a prior for testing and triage because Esports is a separate system.",
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

function RequirementCard({
  heading,
  value,
  detail,
}: Readonly<{ heading: string; value: string; detail: string }>) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5">
      <p className="text-sm font-semibold text-[var(--muted)]">{heading}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{detail}</p>
    </div>
  );
}

function PreparationContent({
  preparation,
  lastImportedAt,
}: Readonly<{
  preparation: EsportsProLeaguePreparation;
  lastImportedAt: string | null;
}>) {
  const activeDiscovery = preparation.discoveryQueue.filter(
    ({ discoveryPriority }) => discoveryPriority !== "maintain",
  );
  const activeBreedingTargets = preparation.breedingPlan.elementTargets.filter(
    ({ breedingPriority }) => breedingPriority !== "maintain",
  );
  const elementOrder: readonly Element[] = ["Metal", "Fire", "Earth", "Water"];

  return (
    <>
      <section aria-labelledby="esports-requirements">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold" id="esports-requirements">
              Published roster requirements
            </h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Initial community announcement only. The working interpretation of
              “gens” is Genesis cores and remains explicitly provisional.
            </p>
          </div>
          <span className="rounded-full border border-[var(--warning)]/60 px-3 py-1 text-xs font-semibold text-[var(--warning)]">
            Ruleset {preparation.rulesetVersion}
          </span>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <RequirementCard
            detail="The announcement describes 25 cores per roster."
            heading="Roster"
            value="25 cores"
          />
          <RequirementCard
            detail="Minimum five Metal, Fire, Earth and Water. Five roster slots remain flexible after those floors."
            heading="Elements"
            value="5 × each"
          />
          <RequirementCard
            detail="Working interpretation: no more than two Genesis cores in each element group."
            heading="Genesis cap"
            value="2 / element"
          />
          <RequirementCard
            detail="At least eight females and at least five F15+ cores. These requirements may overlap."
            heading="Roster traits"
            value="8 ♀ · 5 F15+"
          />
        </div>
      </section>

      <section
        aria-labelledby="owner-esports-strategy"
        className="rounded-2xl border border-[var(--accent)]/40 bg-[var(--surface-raised)] p-6"
      >
        <h2 className="text-xl font-semibold" id="owner-esports-strategy">
          Owner strategy: breeding first
        </h2>
        <p className="mt-3 max-w-4xl leading-7 text-[var(--muted)]">
          The special Genesis mint is excluded from the preparation plan. The
          roster will be built from the existing Vault plus breeding, with
          breeding used to improve non-Genesis depth, element balance and F15+
          coverage while also pursuing strong Bike-parent evidence.
        </p>
        <p className="mt-3 text-sm text-[var(--warning)]">
          Offspring sex is not treated as targetable: no confirmed DNA rule says
          a pairing can deterministically produce a female.
        </p>
      </section>

      <section aria-labelledby="structural-readiness">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold" id="structural-readiness">
              Vault structural readiness
            </h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              {preparation.ownedCoreCount.toLocaleString("en-AU")} owned cores ·{" "}
              {preparation.femalePoolCount.toLocaleString("en-AU")} females ·{" "}
              {preparation.f15PlusPoolCount.toLocaleString("en-AU")} F15+ ·{" "}
              {preparation.selectableCoreCountUnderGenesisCaps.toLocaleString(
                "en-AU",
              )}{" "}
              selectable after the provisional Genesis caps.
            </p>
          </div>
          <span
            className={`rounded-full border px-3 py-1 text-xs font-semibold ${
              preparation.structuralPoolChecksPass
                ? "border-[var(--accent)]/50 text-[var(--accent)]"
                : "border-[var(--warning)]/60 text-[var(--warning)]"
            }`}
          >
            {preparation.structuralPoolChecksPass
              ? "Pool minimum checks pass"
              : "Development gaps remain"}
          </span>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {preparation.elementPools.map((pool) => (
            <article
              className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5"
              key={pool.element}
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-lg font-semibold">{pool.element}</h3>
                <span className="text-xs font-semibold text-[var(--warning)]">
                  {label(pool.breedingPriority)}
                </span>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <div>
                  <dt className="text-[var(--muted)]">Owned</dt>
                  <dd className="font-semibold">{pool.totalOwned}</dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">Non-Genesis</dt>
                  <dd className="font-semibold">{pool.nonGenesisOwned}</dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">Females</dt>
                  <dd className="font-semibold">{pool.femaleOwned}</dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">F15+</dt>
                  <dd className="font-semibold">{pool.f15PlusOwned}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-[var(--muted)]">
                    Bike prior ready at ≥1 exact distance
                  </dt>
                  <dd className="font-semibold">{pool.bikePriorReady}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
        {preparation.structuralPoolIssues.length === 0 ? (
          <p className="mt-4 text-sm text-[var(--muted)]">
            Necessary pool-level structural checks pass. This is not yet an
            exact 25-core roster validation or an Esports performance ranking.
          </p>
        ) : (
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-[var(--warning)]">
            {preparation.structuralPoolIssues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="esports-breeding-plan">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold" id="esports-breeding-plan">
              Breeding preparation
            </h2>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-[var(--muted)]">
              Deterministic roster traits are used only where the existing DNA
              breeding rules support them. Racing-quality projections remain
              probabilistic and DNA Racing Bike history is only prior evidence
              for the separate Esports system.
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
            <h3 className="font-semibold">Global roster targets</h3>
            <ul className="mt-3 space-y-3 text-sm leading-6 text-[var(--muted)]">
              <li>
                F15+ gap: {preparation.breedingPlan.f15PlusRequirementGap}. An
                F15+ target is deterministic when the two parent F-numbers sum
                to at least {preparation.breedingPlan.minimumParentFSumForF15Target}.
              </li>
              <li>
                Female gap: {preparation.breedingPlan.femaleRequirementGap}. Use
                retention and roster planning rather than claiming a pairing can
                guarantee offspring sex.
              </li>
              <li>
                Genesis mint: excluded. Bred non-Genesis depth is preferred for
                roster flexibility under the provisional Genesis caps.
              </li>
            </ul>
          </article>
          <article className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5">
            <h3 className="font-semibold">Element targets</h3>
            {activeBreedingTargets.length === 0 ? (
              <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
                No element is structurally short at pool level. Continue
                breeding for quality and deeper Bike-ready options rather than
                minting for roster compliance.
              </p>
            ) : (
              <ul className="mt-3 space-y-4 text-sm leading-6 text-[var(--muted)]">
                {activeBreedingTargets.map((target) => (
                  <li key={target.element}>
                    <strong className="text-[var(--foreground)]">
                      {target.element}:
                    </strong>{" "}
                    roster gap {target.rosterFloorGap}, non-Genesis depth gap{" "}
                    {target.nonGenesisDepthGap}, Bike-prior depth gap{" "}
                    {target.bikePriorDepthGap}.{" "}
                    {target.deterministicOffspringElementGuidance}
                  </li>
                ))}
              </ul>
            )}
          </article>
        </div>
      </section>

      <section aria-labelledby="esports-discovery-plan">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold" id="esports-discovery-plan">
              Discovery preparation
            </h2>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-[var(--muted)]">
              Current DNA Racing Bike history can identify which roster-relevant
              cores still need targeted testing. It must not be presented as an
              Esports strength score until actual Esports evidence validates the
              relationship.
            </p>
          </div>
          <Link
            className="text-sm font-semibold text-[var(--accent)] underline-offset-4 hover:underline"
            href="/discovery"
          >
            Open Discovery →
          </Link>
        </div>
        {activeDiscovery.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5 text-sm text-[var(--muted)]">
            No under-tested roster candidates are currently identified from the
            connected Bike prior.
          </div>
        ) : (
          <ol className="mt-4 divide-y divide-[var(--border)] rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] px-5">
            {activeDiscovery.slice(0, 16).map((candidate, index) => (
              <li className="py-4" key={candidate.coreId}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">
                      {index + 1}. {candidate.displayName}
                    </p>
                    <p className="mt-1 font-mono text-xs text-[var(--muted)]">
                      {candidate.coreId}
                    </p>
                  </div>
                  <span className="text-xs font-semibold text-[var(--warning)]">
                    {label(candidate.discoveryPriority)} priority ·{" "}
                    {candidate.element} · {candidate.coreClass} · F
                    {candidate.fNumber}
                  </span>
                </div>
                <p className="mt-2 text-sm text-[var(--muted)]">
                  DNA Racing Bike prior: {candidate.totalDnaRacingBikeRaces} races
                  across {candidate.bikeDistancesObserved} exact distances;{" "}
                  {candidate.minimallyAnalyticalBikeDistances} minimally
                  analytical.
                </p>
                <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                  {candidate.discoveryReasons.join(" ")}
                </p>
              </li>
            ))}
          </ol>
        )}
        {activeDiscovery.length > 16 ? (
          <p className="mt-3 text-xs text-[var(--muted)]">
            {activeDiscovery.length - 16} additional development candidates are
            retained in the preparation model.
          </p>
        ) : null}
      </section>

      <section aria-labelledby="esports-team-selection">
        <h2 className="text-xl font-semibold" id="esports-team-selection">
          Team-core selection pools
        </h2>
        <p className="mt-2 max-w-4xl text-sm leading-6 text-[var(--muted)]">
          These lists rank evidence readiness, not Esports ability. They help
          identify which owned cores already have enough DNA Racing Bike history
          to inspect first while preserving the published structural roster
          constraints.
        </p>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {elementOrder.map((element) => (
            <article
              className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5"
              key={element}
            >
              <h3 className="font-semibold">{element} candidate pool</h3>
              {preparation.teamCandidatePools[element].length === 0 ? (
                <p className="mt-3 text-sm text-[var(--muted)]">
                  No owned {element} cores.
                </p>
              ) : (
                <ol className="mt-3 space-y-3">
                  {preparation.teamCandidatePools[element]
                    .slice(0, 7)
                    .map((candidate, index) => (
                      <li className="text-sm" key={candidate.coreId}>
                        <div className="flex items-start justify-between gap-3">
                          <span className="font-semibold">
                            {index + 1}. {candidate.displayName}
                          </span>
                          <span className="text-xs text-[var(--muted)]">
                            {label(candidate.teamSelectionTier)}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          {candidate.coreClass} · {candidate.sex} · F
                          {candidate.fNumber} · Bike prior{" "}
                          {candidate.totalDnaRacingBikeRaces} races /{" "}
                          {candidate.minimallyAnalyticalBikeDistances} analytical
                          distances
                        </p>
                      </li>
                    ))}
                </ol>
              )}
            </article>
          ))}
        </div>
      </section>

      <section
        aria-labelledby="esports-evidence-boundary"
        className="rounded-2xl border border-[var(--warning)]/50 bg-[var(--surface-raised)] p-6"
      >
        <h2 className="text-xl font-semibold" id="esports-evidence-boundary">
          What we still do not know
        </h2>
        <p className="mt-3 text-sm text-[var(--muted)]">
          DNA Racing says Esports has separate systems. Until more rules or
          results are published, the website will fail closed rather than invent
          map mechanics or assume DNA Racing performance transfers directly.
        </p>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-6 text-[var(--muted)]">
          {preparation.unresolvedPublishedDetails.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-[var(--muted)]">
          DNA Racing Bike history last imported: {timestamp(lastImportedAt)}.
        </p>
      </section>
    </>
  );
}

export function EsportsPrepWorkspace({
  connectionStatus,
  preparation,
  lastImportedAt,
}: Readonly<{
  connectionStatus: EsportsPrepConnectionStatus;
  preparation: EsportsProLeaguePreparation | null;
  lastImportedAt: string | null;
}>) {
  const connection = connectionCopy[connectionStatus];
  return (
    <div className="space-y-8">
      <header className="max-w-4xl">
        <p className="text-sm font-semibold text-[var(--accent)]">
          Pro League preparation
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          Esports Prep
        </h1>
        <p className="mt-4 text-base leading-7 text-[var(--muted)]">
          Build a 25-core Bike-focused roster from the existing Vault and
          breeding. Track published structural requirements now, develop the
          right cores through targeted Discovery, and keep future Esports
          performance evidence separate from DNA Racing history.
        </p>
      </header>

      <section
        aria-labelledby="esports-connection"
        className="rounded-2xl border border-[var(--warning)]/50 bg-[var(--surface-raised)] p-6"
      >
        <h2 className="text-lg font-semibold" id="esports-connection">
          {connection.heading}
        </h2>
        <p className="mt-3 max-w-4xl leading-7 text-[var(--muted)]">
          {connection.detail}
        </p>
      </section>

      {preparation === null ? null : (
        <PreparationContent
          lastImportedAt={lastImportedAt}
          preparation={preparation}
        />
      )}
    </div>
  );
}
