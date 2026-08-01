import type {
  VaultPerformanceAssetTotal,
  VaultPerformanceSummary,
} from "@/domain/vault-performance-summary";
import type { VaultPerformanceConnectionStatus } from "@/lib/vault-performance-workspace-service";

const connectionCopy: Record<
  VaultPerformanceConnectionStatus,
  Readonly<{ heading: string; detail: string }>
> = {
  identity_not_connected: {
    heading: "Owner identity not connected",
    detail:
      "Economic evidence remains unavailable until the signed-in owner is verified against the server-side allowlist.",
  },
  persistence_not_configured: {
    heading: "Vault Performance storage not connected",
    detail:
      "Owner verification is available, but the compact private summary repository is not configured. No ledger rows are scanned on this page.",
  },
  read_model_connected: {
    heading: "Historical economic summary connected",
    detail:
      "Accepted owner-scoped aggregates are available in their original assets. They are historical recorded activity, not a live wallet balance.",
  },
};

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

function label(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function AssetCard({ total }: Readonly<{ total: VaultPerformanceAssetTotal }>) {
  const rows = [
    ["Open racing net", total.openRacingNet],
    ["Qualification net", total.qualificationNet],
    ["Tournament recorded net", total.tournamentRecordedNet],
    ["Breeding net", total.breedingNet],
    ["Recorded operating cashflow", total.totalRecordedOperatingCashflow],
    ["Non-operating movement", total.nonOperatingMovement],
  ] as const;

  return (
    <article className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold tracking-wider text-[var(--accent)] uppercase">
            {label(total.assetKind)}
          </p>
          <h3 className="mt-2 text-xl font-semibold">{total.assetCode}</h3>
        </div>
        <span className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--muted)]">
          {total.includedTransactionCount.toLocaleString("en-AU")} included
        </span>
      </div>
      <dl className="mt-5 grid gap-4 sm:grid-cols-2">
        {rows.map(([rowLabel, value]) => (
          <div key={rowLabel}>
            <dt className="text-sm text-[var(--muted)]">{rowLabel}</dt>
            <dd className="mt-1 font-mono text-sm font-semibold">
              {value} {total.assetCode}
            </dd>
          </div>
        ))}
        <div>
          <dt className="text-sm text-[var(--muted)]">
            Realised core trading result
          </dt>
          <dd className="mt-1 font-mono text-sm font-semibold">
            {total.realisedCoreTradingResult === null
              ? "Not available"
              : `${total.realisedCoreTradingResult} ${total.assetCode}`}
          </dd>
        </div>
      </dl>
    </article>
  );
}

export function VaultPerformanceWorkspace({
  summary,
  connectionStatus,
}: Readonly<{
  summary: VaultPerformanceSummary | null;
  connectionStatus: VaultPerformanceConnectionStatus;
}>) {
  const connection = connectionCopy[connectionStatus];
  const totals =
    summary === null ? [] : [...summary.cashCryptoTotals, ...summary.bgcTotals];
  const summaryCounts =
    summary === null
      ? []
      : ([
          ["Included", summary.includedTransactionCount],
          ["Excluded", summary.excludedTransactionCount],
          ["Unclassified", summary.unclassifiedTransactionCount],
          ["Reconciliation review", summary.unresolvedReconciliationCount],
        ] as const);

  return (
    <div className="space-y-8">
      <header className="max-w-4xl">
        <p className="text-sm font-semibold text-[var(--accent)]">
          Phase 2A recorded economics
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          Vault Performance
        </h1>
        <p className="mt-4 text-base leading-7 text-[var(--muted)]">
          Exact historical activity remains separated by original asset. BGC is
          game credit, transfers are non-operating and no unsupported
          cross-asset or lifetime-profit total is shown.
        </p>
      </header>

      <section
        aria-labelledby="performance-connection"
        className="rounded-2xl border border-[var(--warning)]/50 bg-[var(--surface-raised)] p-6"
      >
        <h2 className="text-lg font-semibold" id="performance-connection">
          {connection.heading}
        </h2>
        <p className="mt-3 max-w-4xl leading-7 text-[var(--muted)]">
          {connection.detail}
        </p>
      </section>

      {summary === null ? (
        <section
          aria-labelledby="no-performance-report"
          className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6"
        >
          <h2 className="text-lg font-semibold" id="no-performance-report">
            No accepted economic summary
          </h2>
          <p className="mt-3 max-w-4xl leading-7 text-[var(--muted)]">
            Missing economic evidence is unavailable, not a zero balance, zero
            profit or complete lifetime history.
          </p>
        </section>
      ) : (
        <>
          <section aria-labelledby="performance-coverage">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold" id="performance-coverage">
                  Recorded-period coverage
                </h2>
                <p className="mt-2 text-sm text-[var(--muted)]">
                  {timestamp(summary.periodStart)} to{" "}
                  {timestamp(summary.periodEnd)} · Data current through{" "}
                  {timestamp(summary.dataCurrentThrough)} · Last imported{" "}
                  {timestamp(summary.lastImported)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full border border-[var(--border)] px-3 py-1 text-xs font-semibold text-[var(--warning)]">
                  Coverage: {label(summary.status)}
                </span>
                <span className="rounded-full border border-[var(--border)] px-3 py-1 text-xs font-semibold text-[var(--muted)]">
                  Freshness: {label(summary.freshnessState)}
                </span>
              </div>
            </div>
            <dl className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {summaryCounts.map(([itemLabel, value]) => (
                <div
                  className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5"
                  key={itemLabel}
                >
                  <dt className="text-sm text-[var(--muted)]">{itemLabel}</dt>
                  <dd className="mt-2 text-2xl font-semibold tabular-nums">
                    {value.toLocaleString("en-AU")}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          <section aria-labelledby="asset-totals">
            <h2 className="text-xl font-semibold" id="asset-totals">
              Original-asset totals
            </h2>
            {totals.length === 0 ? (
              <p className="mt-4 leading-7 text-[var(--muted)]">
                No included economic activity exists for this recorded period.
              </p>
            ) : (
              <div className="mt-4 grid gap-4 xl:grid-cols-2">
                {totals.map((total) => (
                  <AssetCard key={total.assetCode} total={total} />
                ))}
              </div>
            )}
          </section>

          <section
            aria-labelledby="performance-warnings"
            className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6"
          >
            <h2 className="text-lg font-semibold" id="performance-warnings">
              Completeness and review
            </h2>
            {summary.warnings.length === 0 ? (
              <p className="mt-3 leading-7 text-[var(--muted)]">
                The stated recorded period is complete under the current
                contract. This is not a complete lifetime-profit claim.
              </p>
            ) : (
              <ul className="mt-4 list-disc space-y-2 pl-5 text-[var(--muted)]">
                {summary.warnings.map((warning) => (
                  <li key={warning}>{label(warning)}</li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
