import { LifecycleEconomicForms } from "@/components/lifecycle-economic-forms";
import type { LifecycleActionRankingResult } from "@/domain/lifecycle-action-ranking";
import type { LifecycleWorkspaceConnectionStatus } from "@/lib/lifecycle-workspace-service";

const connectionCopy: Record<
  LifecycleWorkspaceConnectionStatus,
  Readonly<{ heading: string; detail: string }>
> = {
  identity_not_connected: {
    heading: "Owner identity not connected",
    detail:
      "Lifecycle evidence remains unavailable until the signed-in owner is verified against the server-side allowlist.",
  },
  persistence_not_configured: {
    heading: "Lifecycle read model not connected",
    detail:
      "Owner verification is available, but the compact private action repository is not configured. No raw history is scanned on this page.",
  },
  read_model_connected: {
    heading: "Historical lifecycle evidence connected",
    detail:
      "Action order is an experimental review aid. Sale, burn, game, wallet and ledger mutations remain disabled.",
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
  return `${(basisPoints / 100).toLocaleString("en-AU", { maximumFractionDigits: 2 })}%`;
}

export function LifecycleWorkspace({
  ranking,
  connectionStatus,
}: Readonly<{
  ranking: LifecycleActionRankingResult | null;
  connectionStatus: LifecycleWorkspaceConnectionStatus;
}>) {
  const connection = connectionCopy[connectionStatus];
  return (
    <div className="space-y-8">
      <header className="max-w-4xl">
        <p className="text-sm font-semibold text-[var(--accent)]">
          Phase 7 strategic review
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          Lifecycle
        </h1>
        <p className="mt-4 text-base leading-7 text-[var(--muted)]">
          Compare racing, Discovery, Maiden reserve, breeding, hold, sale and
          burn evidence without erasing unresolved value. Genesis cores and
          no-star evidence alone can never produce a burn review.
        </p>
      </header>

      <section
        aria-labelledby="lifecycle-connection"
        className="rounded-2xl border border-[var(--warning)]/50 bg-[var(--surface-raised)] p-6"
      >
        <h2 className="text-lg font-semibold" id="lifecycle-connection">
          {connection.heading}
        </h2>
        <p className="mt-3 max-w-4xl leading-7 text-[var(--muted)]">
          {connection.detail}
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            className="cursor-not-allowed rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-semibold text-[var(--muted)]"
            disabled
            type="button"
          >
            Sale unavailable
          </button>
          <button
            className="cursor-not-allowed rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-semibold text-[var(--muted)]"
            disabled
            type="button"
          >
            Burn unavailable
          </button>
        </div>
      </section>

      <section aria-labelledby="lifecycle-actions">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold" id="lifecycle-actions">
              Experimental action review
            </h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Data current through{" "}
              {timestamp(ranking?.dataCurrentThrough ?? null)} · Last imported{" "}
              {timestamp(ranking?.lastImported ?? null)} ·{" "}
              {ranking === null
                ? "Freshness unavailable"
                : label(ranking.freshness)}
            </p>
            {ranking === null ? null : (
              <p className="mt-1 text-xs text-[var(--muted)]">
                Configuration {ranking.configurationVersion} · Candidates{" "}
                {ranking.candidateSnapshotVersion} · Racing{" "}
                {ranking.racingSnapshotVersion} · Discovery{" "}
                {ranking.discoverySnapshotVersion} · Maiden{" "}
                {ranking.maidenSnapshotVersion} · Breeding{" "}
                {ranking.breedingSnapshotVersion} · Lineage{" "}
                {ranking.lineageSnapshotVersion} · Market{" "}
                {ranking.marketSnapshotVersion}
              </p>
            )}
          </div>
          <span className="rounded-full border border-[var(--border)] px-3 py-1 text-xs font-semibold text-[var(--warning)]">
            No final recommendation
          </span>
        </div>

        {ranking === null || ranking.cores.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6">
            <h3 className="font-semibold">No accepted lifecycle evidence</h3>
            <p className="mt-3 max-w-3xl leading-7 text-[var(--muted)]">
              Missing evidence is unavailable. It does not mean a core has no
              racing, Maiden, lineage, breeding or market value.
            </p>
          </div>
        ) : (
          <ul className="mt-4 grid gap-4 xl:grid-cols-2">
            {ranking.cores.map((core) => (
              <li
                className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5"
                key={core.coreId}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <h3 className="text-lg font-semibold">
                    Core {core.coreId} · {core.coreClass}
                  </h3>
                  <span className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--muted)]">
                    {label(core.leadingAction)}
                  </span>
                </div>
                {core.rankedActions.length === 0 ? (
                  <p className="mt-4 text-sm text-[var(--muted)]">
                    All actions are held pending evidence review.
                  </p>
                ) : (
                  <ol className="mt-4 space-y-3">
                    {core.rankedActions.map((action) => (
                      <li
                        className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"
                        key={action.action}
                      >
                        <div className="flex justify-between gap-3">
                          <p className="font-semibold">
                            {action.rank}. {label(action.action)}
                          </p>
                          <span className="text-sm">
                            {percentage(action.scoreBasisPoints)}
                          </span>
                        </div>
                        <p className="mt-2 text-sm text-[var(--muted)]">
                          {action.evidenceReasons.join(" ")}
                        </p>
                        {action.strategicReviewOnly ? (
                          <p className="mt-2 text-xs text-[var(--warning)]">
                            Strategic review only; not an instruction.
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                )}
                {[...core.reviewReasons, ...core.accountingWarnings].length >
                0 ? (
                  <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-[var(--warning)]">
                    {[...core.reviewReasons, ...core.accountingWarnings].map(
                      (reason) => (
                        <li key={reason}>{reason}</li>
                      ),
                    )}
                  </ul>
                ) : null}
                {core.heldActions.length > 0 ? (
                  <p className="mt-4 text-xs text-[var(--muted)]">
                    Held actions:{" "}
                    {core.heldActions
                      .map(({ action }) => label(action))
                      .join(", ")}
                    .
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <LifecycleEconomicForms
        status={
          connectionStatus === "identity_not_connected"
            ? "identity_not_connected"
            : "persistence_not_configured"
        }
      />
    </div>
  );
}
