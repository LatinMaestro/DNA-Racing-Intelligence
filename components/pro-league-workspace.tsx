import Link from "next/link";

import type { ProLeaguePreparation } from "@/domain/pro-league-preparation";
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
      "Pro League Vault preparation remains unavailable until the signed-in owner matches the private server-side allowlist.",
  },
  persistence_not_configured: {
    heading: "Vault or Bike evidence not connected",
    detail:
      "The planner needs the owner-maintained My Vault registry plus persisted Core Performance profiles. It fails closed rather than showing a synthetic roster.",
  },
  read_model_connected: {
    heading: "My Vault preparation connected",
    detail:
      "Structural roster readiness comes from the owner-maintained Vault. DNA Racing Bike history is used only as prior evidence for testing and team review, not as measured Esports ability.",
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
    ({ breedingPriority }) => breedingPriority === "critical",
  );

  return (
    <>
      <section aria-labelledby="pro-vault-readiness">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold" id="pro-vault-readiness">
              Current Vault preparation
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
              ? "Pool floors available"
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
                  {item.bikePriorReady} Bike-ready
                </span>
              </div>
              <p className="mt-3 text-sm text-[var(--muted)]">
                {item.totalOwned} owned · {item.genesisOwned} Genesis ·{" "}
                {item.nonGenesisOwned} non-Genesis
              </p>
              <p className="mt-2 text-xs text-[var(--muted)]">
                {item.femaleOwned} female · {item.f15PlusOwned} F15+ · Bike
                prior gap {item.bikePriorDepthGap}
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
            Pool-level minimums are available. This does not yet mean a chosen
            25-core roster is competitively proven.
          </p>
        )}
      </section>

      <section aria-labelledby="pro-breeding">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold" id="pro-breeding">
              Breeding-first roster development
            </h2>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-[var(--muted)]">
              Additional Genesis minting is excluded. Breed only where it adds
              structural depth or quality: confirmed DNA breeding rules can
              target offspring element and F-number, while racing quality stays
              probabilistic and offspring sex is not known to be targetable.
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
            <h3 className="font-semibold">Global targets</h3>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-[var(--muted)]">
              <li>
                F15+ gap: {preparation.breeding.f15PlusGap}. An offspring is
                structurally F15+ when the confirmed parent F-number sum is at
                least {preparation.breeding.minimumParentFSumForF15}.
              </li>
              <li>
                Female gap: {preparation.breeding.femaleGap}. Do not choose a
                pairing on the assumption it can guarantee female offspring;
                manage this through actual outcomes and retention.
              </li>
              <li>
                Genesis mint: excluded. Bred non-Genesis depth increases roster
                flexibility under the provisional two-Genesis-per-element
                interpretation.
              </li>
            </ul>
          </article>
          <article className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5">
            <h3 className="font-semibold">Element breeding targets</h3>
            {breedingTargets.length === 0 ? (
              <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
                No element is structurally short. Continue breeding for elite
                upside and deeper quality rather than roster-count compliance.
              </p>
            ) : (
              <ul className="mt-3 space-y-3 text-sm leading-6 text-[var(--muted)]">
                {breedingTargets.map((target) => (
                  <li key={target.element}>
                    <strong className="text-[var(--foreground)]">
                      {target.element}:
                    </strong>{" "}
                    roster gap {target.rosterFloorGap}, non-Genesis depth gap{" "}
                    {target.nonGenesisDepthGap}. {target.breedingGuidance}
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
              Bike Discovery queue
            </h2>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-[var(--muted)]">
              DNA Racing Bike history is a prior only because DNA says Esports
              uses separate systems. Use it to decide what to test first, not to
              claim which cores are already strongest in Esports.
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
            No under-tested roster candidate is currently prioritised.
          </p>
        ) : (
          <ol className="mt-4 divide-y divide-[var(--border)] rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] px-5">
            {discovery.slice(0, 16).map((core, index) => (
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
                    {label(core.discoveryPriority)} · {core.element} ·{" "}
                    {core.coreClass} · F{core.fNumber}
                  </span>
                </div>
                <p className="mt-2 text-sm text-[var(--muted)]">
                  DNA Racing Bike prior: {core.bikeRaceCount} races ·{" "}
                  {core.analyticalBikeDistances} exact-distance analytical
                  sample(s).
                </p>
                <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                  {core.reasons.join(" ")}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-labelledby="pro-team-pools">
        <h2 className="text-xl font-semibold" id="pro-team-pools">
          Team-core candidate pools
        </h2>
        <p className="mt-2 max-w-4xl text-sm leading-6 text-[var(--muted)]">
          Ordered by evidence readiness, not claimed Esports performance. Once
          actual Esports evidence exists, this layer can be validated and
          replaced with Esports-specific selection evidence.
        </p>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {elements.map((element) => (
            <article
              className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5"
              key={element}
            >
              <h3 className="font-semibold">{element}</h3>
              <ol className="mt-3 space-y-3">
                {preparation.teamCandidatePools[element]
                  .slice(0, 7)
                  .map((core, index) => (
                    <li className="text-sm" key={core.coreId}>
                      <div className="flex justify-between gap-3">
                        <span className="font-semibold">
                          {index + 1}. {core.displayName}
                        </span>
                        <span className="text-xs text-[var(--muted)]">
                          {label(core.bikePriorStatus)}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        {core.coreClass} · {core.sex} · F{core.fNumber} ·{" "}
                        {core.bikeRaceCount} Bike races ·{" "}
                        {core.analyticalBikeDistances} analytical distances
                      </p>
                    </li>
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
          DNA Racing Bike evidence last imported: {timestamp(lastImportedAt)}.
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
          Provisional owner preparation
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          Pro League
        </h1>
        <p className="mt-4 text-base leading-7 text-[var(--muted)]">
          Build a 25-core Bike-focused roster from the existing Vault and
          breeding. No additional Genesis minting is part of this plan.
        </p>
      </header>

      <section className="rounded-2xl border border-[var(--warning)]/50 bg-[var(--surface-raised)] p-6">
        <h2 className="text-lg font-semibold">Provisional rule authority</h2>
        <p className="mt-3 max-w-4xl leading-7 text-[var(--muted)]">
          Source: {proLeagueAnnouncementRules.sourceLabel}, received{" "}
          {proLeagueAnnouncementRules.receivedAt}. The announcement publishes a
          25-core roster, five of each element, eight females and five F15+.
          “Maximum 2 gens per element” is currently treated as a working
          Genesis interpretation until DNA clarifies the shorthand.
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
          owner selection workflow. No empty selection is represented as a team
          recommendation: current placeholder audit status is{" "}
          {audit.readiness === "compliant" ? "compliant" : "not selected"}.
        </p>
      </section>
    </div>
  );
}
