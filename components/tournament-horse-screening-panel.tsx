import type { TournamentHorseScreeningState } from "@/lib/tournament-horse-screening-service";

const statusCopy = {
  identity_not_connected:
    "Owner identity must be verified before private Horse screening evidence can be read.",
  persistence_not_configured:
    "The private Horse screening snapshot repository is not configured.",
  snapshot_unavailable:
    "No accepted Horse 1v1 screening snapshot has been published. Missing evidence remains unavailable.",
} as const;

function percentage(value: number | null): string {
  return value === null
    ? "Unavailable"
    : new Intl.NumberFormat("en-AU", {
        style: "percent",
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }).format(value / 1_000_000);
}

function timestamp(value: string): string {
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

export function TournamentHorseScreeningPanel({
  state,
}: Readonly<{ state: TournamentHorseScreeningState }>) {
  const snapshot = state.snapshot;
  return (
    <section
      aria-labelledby="horse-one-v-one-screening"
      className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[var(--accent)]">
            Horse tournament evidence
          </p>
          <h2
            className="mt-2 text-xl font-semibold"
            id="horse-one-v-one-screening"
          >
            Independent 1v1 candidate screening
          </h2>
        </div>
        <span className="rounded-full border border-[var(--warning)]/60 px-3 py-1 text-xs font-semibold text-[var(--warning)]">
          Experimental · decision disabled
        </span>
      </div>

      {snapshot === null ? (
        <p className="mt-4 max-w-4xl leading-7 text-[var(--muted)]">
          {statusCopy[state.connectionStatus]}
        </p>
      ) : (
        <>
          <p className="mt-4 max-w-4xl text-sm leading-6 text-[var(--muted)]">
            Direct 1v1 probabilities use only accepted two-gate evidence. Wider
            exact-distance Horse races appear separately as format-transfer
            screening and never prove a 1v1 specialist. Fees, prizes and
            expected value remain unavailable.
          </p>
          <dl className="mt-4 grid gap-3 text-xs text-[var(--muted)] sm:grid-cols-2">
            <div>
              <dt>Evidence cutoff</dt>
              <dd className="mt-1 font-semibold text-[var(--foreground)]">
                {timestamp(snapshot.evidenceCutoff)} UTC
              </dd>
            </div>
            <div>
              <dt>Source snapshot</dt>
              <dd className="mt-1 break-all font-semibold text-[var(--foreground)]">
                {snapshot.sourceSnapshotVersion}
              </dd>
            </div>
          </dl>
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            {snapshot.candidates.map((candidate) => (
              <article
                className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"
                key={JSON.stringify([
                  candidate.coreId,
                  candidate.element,
                  candidate.distanceMetres,
                ])}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">{candidate.name}</h3>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      Core {candidate.coreId} · {candidate.element} ·{" "}
                      {candidate.distanceMetres.toLocaleString("en-AU")} m
                    </p>
                  </div>
                  <span className="text-xs font-semibold text-[var(--warning)]">
                    {candidate.formatTransferStatus === "direct"
                      ? "Direct 1v1 evidence"
                      : candidate.formatTransferStatus === "inference_only"
                        ? "Transfer inference only"
                        : "Evidence unavailable"}
                  </span>
                </div>
                <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-[var(--muted)]">Direct field P(win)</dt>
                    <dd className="mt-1 font-semibold">
                      {percentage(candidate.expectedFieldPWinMillionths)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[var(--muted)]">
                      Direct top-10% stress P(win)
                    </dt>
                    <dd className="mt-1 font-semibold">
                      {percentage(candidate.topTenPercentStressPWinMillionths)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[var(--muted)]">
                      Exact-distance transfer
                    </dt>
                    <dd className="mt-1 font-semibold">
                      {percentage(
                        candidate.projectedFieldOutperformanceMillionths,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[var(--muted)]">Evidence samples</dt>
                    <dd className="mt-1 font-semibold">
                      {candidate.candidateSampleCount} all-format ·{" "}
                      {candidate.candidateDirectOneVOneSampleCount} direct 1v1
                    </dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
