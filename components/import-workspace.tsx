import type {
  HistoricalImportSource,
  ImportWorkspace,
  RecoveryQueueItem,
} from "@/domain/import-workflow";

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

function timestamp(value: string | null): string {
  if (value === null) return "Not available";
  return value.replace("T", " ").replace(".000Z", " UTC");
}

function count(value: number | null): string {
  return value === null ? "—" : value.toLocaleString("en-AU");
}

export function ImportWorkspacePanel({
  workspace,
}: Readonly<{ workspace: ImportWorkspace }>) {
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
          Private upload not connected
        </h2>
        <p className="mt-3 max-w-4xl leading-7 text-[var(--muted)]">
          The repository workflow is ready, but no private source file is
          hosted. Upload remains disabled until the owner configures the
          approved Preview-only identity, database and private object-storage
          services. Production remains fail-closed.
        </p>
        <button
          className="mt-5 cursor-not-allowed rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-semibold text-[var(--muted)]"
          disabled
          type="button"
        >
          Upload unavailable
        </button>
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
