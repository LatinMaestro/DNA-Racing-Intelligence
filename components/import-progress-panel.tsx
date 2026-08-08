import {
  importProgressStages,
  projectRecentImportProgress,
  type ImportProgressBatch,
  type ImportProgressStage,
  type ImportProgressStageState,
} from "@/domain/import-progress";

const sourceLabels: Record<ImportProgressBatch["sourceType"], string> = {
  race_merge: "Race Merge",
  core_details: "Core Details",
  current_vault: "Current Vault",
  current_arena: "Current Arena",
};

const stageLabels: Record<ImportProgressStage, string> = {
  received: "Received",
  validation: "Validated",
  activation: "Accepted",
  aggregate_refresh: "Aggregates",
  ready: "Ready",
};

const stageStateLabels: Record<ImportProgressStageState, string> = {
  complete: "Complete",
  current: "In progress",
  waiting: "Waiting",
  blocked: "Blocked",
  recovered: "Rolled back",
};

function timestamp(value: string | null): string {
  if (value === null) return "Not available";
  return value.replace("T", " ").replace(".000Z", " UTC");
}

function count(value: number): string {
  return value.toLocaleString("en-AU");
}

export function ImportProgressPanel({
  batches,
}: Readonly<{ batches: readonly ImportProgressBatch[] }>) {
  const progress = projectRecentImportProgress(batches);

  return (
    <section
      aria-labelledby="import-progress"
      className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold" id="import-progress">
            Update progress & completion
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
            Historical source processing, accepted-data readiness and recovery
            evidence remain separate. A received file never makes the website
            appear fresher before acceptance and aggregate publication.
          </p>
        </div>
        <span className="rounded-full border border-[var(--border)] px-3 py-1 text-xs font-semibold text-[var(--muted)]">
          Provider actions unavailable
        </span>
      </div>

      {progress.length === 0 ? (
        <p className="mt-5 leading-7 text-[var(--muted)]">
          No private update progress is available. Upload, confirmation,
          aggregate retry and rollback remain disabled until the approved
          owner-scoped providers are configured.
        </p>
      ) : (
        <div className="mt-5 space-y-4">
          {progress.map((item) => (
            <article
              className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5"
              key={item.key}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm text-[var(--muted)]">
                    {sourceLabels[item.sourceType]}
                  </p>
                  <h3 className="mt-1 font-semibold">{item.headline}</h3>
                </div>
                <span className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--muted)]">
                  {item.readiness.replaceAll("_", " ")}
                </span>
              </div>

              <ol
                aria-label={`${sourceLabels[item.sourceType]} update stages`}
                className="mt-4 grid gap-2 sm:grid-cols-5"
              >
                {importProgressStages.map((stage) => {
                  const stageState = item.steps.find(
                    (candidate) => candidate.stage === stage,
                  );
                  if (!stageState) {
                    throw new Error(`Missing progress stage ${stage}`);
                  }
                  return (
                    <li
                      className="rounded-lg border border-[var(--border)] p-3"
                      key={stage}
                    >
                      <p className="text-xs text-[var(--muted)]">
                        {stageLabels[stage]}
                      </p>
                      <p className="mt-1 text-sm font-medium">
                        {stageStateLabels[stageState.state]}
                      </p>
                    </li>
                  );
                })}
              </ol>

              <dl className="mt-4 grid gap-3 border-t border-[var(--border)] pt-4 text-sm sm:grid-cols-3 xl:grid-cols-6">
                <div>
                  <dt className="text-[var(--muted)]">Accepted</dt>
                  <dd className="mt-1 font-medium">
                    {count(item.acceptedRows)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">Quarantined</dt>
                  <dd className="mt-1 font-medium">
                    {count(item.rejectedRows)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">Warnings</dt>
                  <dd className="mt-1 font-medium">
                    {count(item.warningRows)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">Data current through</dt>
                  <dd className="mt-1 font-medium">
                    {timestamp(item.dataCurrentThrough)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">Last imported</dt>
                  <dd className="mt-1 font-medium">
                    {timestamp(item.lastImportedAt)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">Aggregate refresh</dt>
                  <dd className="mt-1 font-medium">
                    {timestamp(item.aggregateRefreshedAt)}
                  </dd>
                </div>
              </dl>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  className="cursor-not-allowed rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-semibold text-[var(--muted)]"
                  disabled
                  type="button"
                >
                  {item.aggregateRefreshPending
                    ? "Retry unavailable"
                    : "Aggregate retry not required"}
                </button>
                <button
                  className="cursor-not-allowed rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-semibold text-[var(--muted)]"
                  disabled
                  type="button"
                >
                  {item.rollbackAvailable
                    ? "Rollback unavailable"
                    : "No rollback action"}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
