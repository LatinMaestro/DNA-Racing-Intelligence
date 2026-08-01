import type {
  HistoricalImportSource,
  ImportWorkspace,
  RecoveryQueueItem,
} from "@/domain/import-workflow";
import type { ImportWorkspaceConnectionStatus } from "@/lib/import-workspace-service";

const sourceLabels: Record<HistoricalImportSource, string> = {
  race_merge: "Race Merge",
  core_details: "Core Details",
  current_vault: "Current Vault",
  current_arena: "Current Arena",
};

const queueLabels: Record<RecoveryQueueItem["kind"], string> = {
  rollback_available: "Rollback available",
  identity_review: "Identity review",
  reconciliation_review: "Observation reconciliation",
  aggregate_pending: "Aggregate refresh pending",
};

const connectionCopy: Record<
  ImportWorkspaceConnectionStatus,
  Readonly<{ heading: string; detail: string; action: string }>
> = {
  identity_not_connected: {
    heading: "Owner identity not connected",
    detail:
      "Private source status and upload remain unavailable until the signed-in owner is verified against the server-side allowlist. Production remains fail-closed.",
    action: "Upload unavailable",
  },
  persistence_not_configured: {
    heading: "Private status storage not connected",
    detail:
      "Owner verification is available, but the Preview-only database repository is not configured. No private source file is hosted and the prior accepted dataset remains unchanged.",
    action: "Upload unavailable",
  },
  read_model_connected: {
    heading: "Historical status connected",
    detail:
      "Owner-scoped import status can be read from private persistence. Raw upload and background processing remain a separate gated implementation boundary.",
    action: "Upload workflow pending",
  },
};

const ownerUpdateSteps = [
  ["1", "Upload", "Add one or more current DNA Racing exports."],
  ["2", "Preview", "Review schemas, rows, overlaps, conflicts and coverage."],
  ["3", "Confirm", "Approve the displayed plan before active data changes."],
  ["4", "Process", "Import and refresh affected aggregates in the background."],
  ["5", "Complete", "Review results or use a reasoned recoverable rollback."],
] as const;

function timestamp(value: string | null): string {
  if (value === null) return "Not available";
  return value.replace("T", " ").replace(".000Z", " UTC");
}

function count(value: number | null): string {
  return value === null ? "—" : value.toLocaleString("en-AU");
}

export function ImportWorkspacePanel({
  workspace,
  connectionStatus,
}: Readonly<{
  workspace: ImportWorkspace;
  connectionStatus: ImportWorkspaceConnectionStatus;
}>) {
  const connection = connectionCopy[connectionStatus];

  return (
    <div className="space-y-8">
      <header className="max-w-4xl">
        <p className="text-sm font-semibold text-[var(--accent)]">
          Phase 1 import control
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          Imports & recovery
        </h1>
        <p className="mt-4 text-base leading-7 text-[var(--muted)]">
          Private, versioned historical imports with visible freshness,
          count-only validation summaries and reasoned rollback. Imported data
          is never described as live game state.
        </p>
      </header>

      <section
        aria-labelledby="hosting-boundary"
        className="rounded-2xl border border-[var(--warning)]/50 bg-[var(--surface-raised)] p-6"
      >
        <h2 className="text-lg font-semibold" id="hosting-boundary">
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
          {connection.action}
        </button>
      </section>

      <section
        aria-labelledby="update-flow"
        className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6"
      >
        <h2 className="text-lg font-semibold" id="update-flow">
          Owner update flow
        </h2>
        <ol className="mt-4 grid gap-3 md:grid-cols-5">
          {ownerUpdateSteps.map(([step, label, detail]) => (
            <li
              className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"
              key={step}
            >
              <span className="text-xs font-semibold text-[var(--accent)]">
                Step {step}
              </span>
              <h3 className="mt-2 font-semibold">{label}</h3>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                {detail}
              </p>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-sm leading-6 text-[var(--muted)]">
          Race Merge files append in chronological order. Core Details updates
          durable IDs and lineage. Current Vault and Current Arena each replace
          the active snapshot while retaining prior accepted versions. The
          authenticated preview may show exact source values when needed for
          owner review.
        </p>
      </section>

      <section aria-labelledby="source-freshness">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold" id="source-freshness">
              Historical source status
            </h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Data current-through and last-imported timestamps remain separate.
            </p>
          </div>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {workspace.sources.map((source) => (
            <article
              className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5"
              key={source.sourceType}
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-semibold">
                  {sourceLabels[source.sourceType]}
                </h3>
                <span className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--muted)]">
                  {source.freshness}
                </span>
              </div>
              <dl className="mt-5 space-y-3 text-sm">
                <div>
                  <dt className="text-[var(--muted)]">Latest attempt</dt>
                  <dd className="mt-1 font-medium">
                    {source.latestBatchStatus.replaceAll("_", " ")}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">Data current through</dt>
                  <dd className="mt-1 font-medium">
                    {timestamp(source.dataCurrentThrough)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">Last imported</dt>
                  <dd className="mt-1 font-medium">
                    {timestamp(source.lastImportedAt)}
                  </dd>
                </div>
                <div className="grid grid-cols-3 gap-2 border-t border-[var(--border)] pt-3">
                  <div>
                    <dt className="text-[var(--muted)]">Accepted</dt>
                    <dd className="mt-1 font-medium">
                      {count(source.acceptedRows)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[var(--muted)]">Rejected</dt>
                    <dd className="mt-1 font-medium">
                      {count(source.rejectedRows)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[var(--muted)]">Warnings</dt>
                    <dd className="mt-1 font-medium">
                      {count(source.warningRows)}
                    </dd>
                  </div>
                </div>
              </dl>
            </article>
          ))}
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <section
          aria-labelledby="recent-imports"
          className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6"
        >
          <h2 className="text-lg font-semibold" id="recent-imports">
            Recent batches
          </h2>
          {workspace.recentBatches.length === 0 ? (
            <p className="mt-4 leading-7 text-[var(--muted)]">
              No private import has been accepted. Filenames, raw rows and
              source values will never appear in routine summaries.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-[var(--border)]">
              {workspace.recentBatches.map((batch) => (
                <li className="py-4" key={batch.batchId}>
                  <div className="flex justify-between gap-4">
                    <span className="font-medium">
                      {sourceLabels[batch.sourceType]}
                    </span>
                    <span className="text-sm text-[var(--muted)]">
                      {batch.status.replaceAll("_", " ")}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-[var(--muted)]">
                    {batch.acceptedRows.toLocaleString("en-AU")} accepted ·{" "}
                    {batch.rejectedRows.toLocaleString("en-AU")} rejected ·{" "}
                    {batch.warningRows.toLocaleString("en-AU")} warnings
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section
          aria-labelledby="recovery-queue"
          className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6"
        >
          <h2 className="text-lg font-semibold" id="recovery-queue">
            Recovery & review queue
          </h2>
          {workspace.recoveryQueue.length === 0 ? (
            <p className="mt-4 leading-7 text-[var(--muted)]">
              Nothing is queued. Rollback always requires a recorded reason;
              identity and observation candidates require explicit review.
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {workspace.recoveryQueue.map((item) => (
                <li
                  className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"
                  key={item.key}
                >
                  <div className="flex justify-between gap-4">
                    <span className="font-medium">
                      {queueLabels[item.kind]}
                    </span>
                    <span className="text-sm text-[var(--muted)]">
                      {item.count.toLocaleString("en-AU")}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-[var(--muted)]">
                    {sourceLabels[item.sourceType]}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
