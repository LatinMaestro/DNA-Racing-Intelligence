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

function timestamp(value: string): string {
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
          No eligible pairs in this ranking.
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
                Exceptional {percentage(pair.exceptionalUpsideBasisPoints)} ·
                Stronger or exceptional{" "}
                {percentage(pair.strongerOrExceptionalBasisPoints)} · Vault fit{" "}
                {percentage(pair.vaultFitBasisPoints)} ·{" "}
                {label(pair.evidenceConfidence)} confidence
              </p>
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
}: Readonly<{
  rankings: readonly BreedingPairRankingResult[];
  connectionStatus: BreedingWorkspaceConnectionStatus;
}>) {
  const connection = connectionCopy[connectionStatus];

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
                    Ranking {ranking.rankingId}
                  </h3>
                  <p className="mt-2 text-sm text-[var(--muted)]">
                    Evaluated {timestamp(ranking.evaluatedAt)} · Data current
                    through {timestamp(ranking.dataCurrentThrough)} · Last
                    imported {timestamp(ranking.lastImported)} ·{" "}
                    {label(ranking.freshness)}
                  </p>
                </div>
                <div className="grid gap-4 xl:grid-cols-3">
                  <RankingList
                    description="Exceptional-outcome probability only; Vault fit cannot suppress this order."
                    heading="Elite upside"
                    pairs={ranking.eliteUpsideRanking}
                  />
                  <RankingList
                    description="Missing-role fit only; elite upside remains independently visible."
                    heading="Vault gap"
                    pairs={ranking.vaultGapRanking}
                  />
                  <RankingList
                    description="Explicit configured weights combine broader quality and Vault fit."
                    heading="Balanced"
                    pairs={ranking.balancedRanking}
                  />
                </div>
                {ranking.heldPairs.length > 0 ? (
                  <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5">
                    <h3 className="font-semibold">Held pairs</h3>
                    <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-[var(--muted)]">
                      {ranking.heldPairs.map((pair) => (
                        <li key={pair.pairId}>
                          {pair.pairId}: {pair.reasons.join(" ")}
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
    </div>
  );
}
