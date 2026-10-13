import Link from "next/link";

import type {
  HistoricalImportSource,
  SourceImportStatus,
} from "@/domain/import-workflow";
import type { DashboardFreshnessConnectionStatus } from "@/lib/dashboard-freshness-service";

type FreshnessStatusProps = {
  source: "Race" | "Vault" | "Arena" | "Core";
  status: SourceImportStatus | null;
  connectionStatus: DashboardFreshnessConnectionStatus;
};

const sourceWorkspaces = {
  Core: {
    href: "/core-intelligence?evidence=normal",
    label: "Explore Core performance",
  },
  Race: { href: "/search-core", label: "Search race history" },
  Arena: { href: "/breeding", label: "Review Arena-linked breeding" },
  Vault: { href: "/vault", label: "Open My Vault" },
} as const;

const expectedSourceTypes: Record<
  FreshnessStatusProps["source"],
  HistoricalImportSource
> = {
  Core: "core_details",
  Race: "race_merge",
  Arena: "current_arena",
  Vault: "current_vault",
};

function timestamp(value: string | null): string {
  if (value === null) return "Not available";
  return value.replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

function receiptDetail(
  connectionStatus: DashboardFreshnessConnectionStatus,
  status: SourceImportStatus | null,
): string {
  if (connectionStatus === "read_failed") {
    return "Private source receipt status is temporarily unavailable. Existing data is not assumed missing.";
  }
  if (connectionStatus !== "read_model_connected") {
    return "Dashboard timestamp receipt not connected.";
  }
  if (status === null || status.activeBatchId === null) {
    return "No active accepted source receipt is available.";
  }
  if (status.latestBatchStatus !== "accepted") {
    return `Serving the last accepted snapshot; latest update is ${status.latestBatchStatus.replaceAll("_", " ")}.`;
  }
  return "Owner-scoped accepted source receipt connected.";
}

export function FreshnessStatus({
  source,
  status,
  connectionStatus,
}: FreshnessStatusProps) {
  if (status !== null && status.sourceType !== expectedSourceTypes[source]) {
    throw new Error("Dashboard freshness source does not match its card.");
  }

  const workspace = sourceWorkspaces[source];
  const connectedStatus =
    connectionStatus === "read_model_connected" &&
    status !== null &&
    status.activeBatchId !== null
      ? status
      : null;
  const receiptConnected = connectedStatus !== null;
  const freshness = connectedStatus?.freshness ?? "unknown";
  const latestUpdate =
    connectionStatus === "read_model_connected" && status !== null
      ? status.latestBatchStatus.replaceAll("_", " ")
      : "Not available";

  return (
    <section
      aria-label={`${source} data freshness`}
      className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold tracking-wider text-[var(--accent)] uppercase">
            {source} snapshot
          </p>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {receiptDetail(connectionStatus, status)}
          </p>
        </div>
        <span className="rounded-full border border-[var(--border)] px-3 py-1 text-xs text-[var(--muted)]">
          {receiptConnected
            ? `Freshness ${freshness}`
            : "Freshness unknown here"}
        </span>
      </div>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
        <div>
          <dt className="text-[var(--muted)]">Data current through</dt>
          <dd className="mt-1 font-medium">
            {timestamp(connectedStatus?.dataCurrentThrough ?? null)}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Last imported</dt>
          <dd className="mt-1 font-medium">
            {timestamp(connectedStatus?.lastImportedAt ?? null)}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Freshness</dt>
          <dd className="mt-1 font-medium">{freshness}</dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Latest update</dt>
          <dd className="mt-1 font-medium">{latestUpdate}</dd>
        </div>
      </dl>
      <Link
        className="mt-4 inline-flex rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-semibold text-[var(--accent)] hover:bg-[var(--surface-raised)]"
        href={workspace.href}
      >
        {workspace.label}
      </Link>
    </section>
  );
}
