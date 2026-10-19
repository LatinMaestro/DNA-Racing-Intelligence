import type { PrivateProductionReadiness } from "@/domain/private-production-readiness";
import type { ReadinessWorkspaceConnectionStatus } from "@/lib/readiness-workspace-service";
import type { TournamentHorseScreeningState } from "@/lib/tournament-horse-screening-service";

const connectionCopy: Record<
  ReadinessWorkspaceConnectionStatus,
  Readonly<{ heading: string; detail: string }>
> = {
  identity_not_connected: {
    heading: "Owner identity not connected",
    detail:
      "Readiness evidence remains unavailable until the signed-in owner is verified against the server-side allowlist.",
  },
  persistence_not_configured: {
    heading: "Readiness evidence not connected",
    detail:
      "Owner verification is available, but the compact exact-head assessment repository is not configured.",
  },
  assessment_read_failed: {
    heading: "Readiness assessment read failed",
    detail:
      "The owner-scoped readiness assessment could not be read. No cached, stale or inferred replacement is treated as accepted, and every commissioning gate remains withheld.",
  },
  assessment_integrity_failed: {
    heading: "Readiness assessment integrity failed",
    detail:
      "The persisted assessment failed exact-head, version, chronology or freshness checks. Its gates remain withheld, and missing evidence is never converted into a pass.",
  },
  read_model_connected: {
    heading: "Readiness evidence connected",
    detail:
      "This workspace reports evidence and blockers only. It cannot enable a provider, domain, public route or Production.",
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

const moduleBoundaryLabels = {
  vaultPerformance: {
    heading: "Vault Performance",
    boundaries: {
      readModel: "Compact summary read",
      economicEvidenceWrites: "Economic evidence writes",
    },
  },
  openRace: {
    heading: "Open Race",
    boundaries: {
      readModel: "Session read model",
      fieldLock: "Field-lock publication",
      postLockObservation: "Post-lock observation",
    },
  },
  lifecycle: {
    heading: "Lifecycle",
    boundaries: {
      readModel: "Ranking read model",
      economicEvidenceWrites: "Economic evidence writes",
    },
  },
} as const;

const boundaryStateCopy = {
  not_verified: "Not verified",
  fixture_verified: "Fixture verified",
  connected_verified: "Connected verified",
  failed: "Failed",
} as const;

const horseScreeningStatusCopy = {
  identity_not_connected: {
    label: "Identity not connected",
    detail:
      "Owner identity must be verified before private Horse screening publication evidence can be checked.",
  },
  persistence_not_configured: {
    label: "Persistence not configured",
    detail:
      "The compact private Horse screening snapshot repository is not configured.",
  },
  snapshot_unavailable: {
    label: "Not published",
    detail:
      "No accepted Horse screening snapshot is active. Missing evidence remains unavailable.",
  },
  snapshot_read_failed: {
    label: "Read failed",
    detail:
      "The active Horse screening snapshot could not be read. No cached or inferred replacement is accepted.",
  },
  snapshot_invalid: {
    label: "Integrity failed",
    detail:
      "The active Horse screening snapshot failed integrity checks. Rankings remain withheld until a valid last-good snapshot is published.",
  },
  snapshot_connected: {
    label: "Connected",
    detail:
      "A compact owner-scoped Horse screening snapshot passed publication integrity checks.",
  },
} as const;

export function ReadinessWorkspace({
  assessmentId,
  assessedAt,
  assessmentVersion,
  exactHeadSha,
  evidenceCurrentThrough,
  evidenceFreshness,
  readiness,
  connectionStatus,
  horseScreeningState,
}: Readonly<{
  assessmentId: string | null;
  assessedAt: string | null;
  assessmentVersion: string | null;
  exactHeadSha: string | null;
  evidenceCurrentThrough: string | null;
  evidenceFreshness: "current" | "ageing" | "stale" | null;
  readiness: PrivateProductionReadiness | null;
  connectionStatus: ReadinessWorkspaceConnectionStatus;
  horseScreeningState: TournamentHorseScreeningState;
}>) {
  const connection = connectionCopy[connectionStatus];
  const horseScreeningStatus =
    horseScreeningStatusCopy[horseScreeningState.connectionStatus];

  return (
    <div className="space-y-8">
      <header className="max-w-4xl">
        <p className="text-sm font-semibold text-[var(--accent)]">
          Phase 9 evidence review
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          Readiness
        </h1>
        <p className="mt-4 text-base leading-7 text-[var(--muted)]">
          Consolidate exact-head CI, protected imports, recovery, capacity,
          security, accessibility, migration and analytical gates without
          converting missing evidence into a pass.
        </p>
      </header>

      <section
        aria-labelledby="readiness-connection"
        className="rounded-2xl border border-[var(--warning)]/50 bg-[var(--surface-raised)] p-6"
      >
        <h2 className="text-lg font-semibold" id="readiness-connection">
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
          Production activation unavailable
        </button>
      </section>

      <section
        aria-labelledby="readiness-horse-screening"
        className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2
              className="text-xl font-semibold"
              id="readiness-horse-screening"
            >
              Horse screening publication
            </h2>
            <p className="mt-3 max-w-4xl leading-7 text-[var(--muted)]">
              {horseScreeningStatus.detail}
            </p>
          </div>
          <span className="rounded-full border border-[var(--warning)]/60 px-3 py-1 text-xs font-semibold text-[var(--warning)]">
            {horseScreeningStatus.label}
          </span>
        </div>
        {horseScreeningState.snapshot === null ? null : (
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
            <div>
              <dt className="text-[var(--muted)]">Candidates</dt>
              <dd className="mt-1 font-semibold">
                {horseScreeningState.snapshot.candidates.length.toLocaleString(
                  "en-AU",
                )}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Evidence current through</dt>
              <dd className="mt-1 font-semibold">
                {horseScreeningState.snapshot.evidenceCutoff}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Published</dt>
              <dd className="mt-1 font-semibold">
                {horseScreeningState.snapshot.publishedAt}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Model / source version</dt>
              <dd className="mt-1 break-all font-semibold">
                {horseScreeningState.snapshot.modelVersion} ·{" "}
                {horseScreeningState.snapshot.sourceSnapshotVersion}
              </dd>
            </div>
          </dl>
        )}
      </section>

      <section aria-labelledby="readiness-checks">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold" id="readiness-checks">
              Exact-head evidence
            </h2>
            <p className="mt-2 font-mono text-xs text-[var(--muted)]">
              {assessmentId === null
                ? "No accepted assessment"
                : `${assessmentId} · ${assessmentVersion} · ${exactHeadSha}`}
            </p>
            {evidenceCurrentThrough === null ? null : (
              <p className="mt-2 text-xs text-[var(--muted)]">
                Evidence current through {evidenceCurrentThrough} ·{" "}
                {label(evidenceFreshness ?? "unknown")} · Assessed{" "}
                {assessedAt ?? "Not available"}
              </p>
            )}
          </div>
          <span className="rounded-full border border-[var(--border)] px-3 py-1 text-xs font-semibold text-[var(--warning)]">
            {readiness === null ? "Not assessed" : label(readiness.status)}
          </span>
        </div>

        {readiness === null ? (
          <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6">
            <h3 className="font-semibold">No accepted readiness evidence</h3>
            <p className="mt-3 max-w-3xl leading-7 text-[var(--muted)]">
              Missing evidence remains review-required. Production stays
              disabled and fail-closed.
            </p>
          </div>
        ) : (
          <ul className="mt-4 grid gap-4 xl:grid-cols-2">
            {readiness.checks.map((check) => (
              <li
                className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5"
                key={check.code}
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-semibold">{label(check.code)}</h3>
                  <span className="text-xs font-semibold text-[var(--warning)]">
                    {label(check.status)}
                  </span>
                </div>
                <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
                  {check.detail}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {readiness === null ? null : (
        <section aria-labelledby="readiness-module-boundaries">
          <h2
            className="text-xl font-semibold"
            id="readiness-module-boundaries"
          >
            Commissioning module boundaries
          </h2>
          <p className="mt-2 max-w-4xl leading-7 text-[var(--muted)]">
            Fixture verification records code and CI evidence. Only bounded
            connected owner-data acceptance can mark a boundary connected.
          </p>
          <ul className="mt-4 grid gap-4 xl:grid-cols-3">
            {Object.entries(moduleBoundaryLabels).map(
              ([moduleCode, module]) => {
                const states =
                  readiness.moduleBoundaries[
                    moduleCode as keyof typeof readiness.moduleBoundaries
                  ];
                return (
                  <li
                    className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5"
                    key={moduleCode}
                  >
                    <h3 className="font-semibold">{module.heading}</h3>
                    <dl className="mt-3 space-y-3">
                      {Object.entries(module.boundaries).map(
                        ([boundaryCode, boundaryLabel]) => {
                          const state = states[
                            boundaryCode as keyof typeof states
                          ] as keyof typeof boundaryStateCopy;
                          return (
                            <div
                              className="flex items-start justify-between gap-3 text-sm"
                              key={boundaryCode}
                            >
                              <dt className="text-[var(--muted)]">
                                {boundaryLabel}
                              </dt>
                              <dd className="text-right font-semibold text-[var(--warning)]">
                                {boundaryStateCopy[state]}
                              </dd>
                            </div>
                          );
                        },
                      )}
                    </dl>
                  </li>
                );
              },
            )}
          </ul>
        </section>
      )}
    </div>
  );
}
