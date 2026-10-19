import Link from "next/link";

import { OpenRaceMutationForm } from "@/components/open-race-mutation-form";
import type {
  OpenRaceWorkspaceConnectionStatus,
  OpenRaceWorkspaceSession,
} from "@/lib/open-race-workspace-service";
import type {
  OpenRacePredictionPageState,
  OpenRaceSessionPredictionEvidence,
} from "@/lib/open-race-prediction-page-service";

const connectionCopy: Record<
  OpenRaceWorkspaceConnectionStatus,
  Readonly<{ heading: string; detail: string }>
> = {
  identity_not_connected: {
    heading: "Owner identity not connected",
    detail:
      "Open Race evidence remains unavailable until the signed-in owner is verified against the server-side allowlist.",
  },
  persistence_not_configured: {
    heading: "Open Race workspace not connected",
    detail:
      "Owner verification is available, but private field capture and compact historical evidence are not configured. No live game data or raw race history is read on this page.",
  },
  read_failed: {
    heading: "Open Race evidence temporarily unavailable",
    detail:
      "The private owner-scoped Open Race session read could not be completed. Stage A rankings, locked fields and Stage B observations are withheld; no stale or inferred replacements are shown.",
  },
  integrity_failed: {
    heading: "Open Race evidence failed validation",
    detail:
      "Saved Open Race sessions failed accepted-source, freshness or field-lock validation. All sessions remain withheld until the accepted evidence is repaired.",
  },
  read_model_connected: {
    heading: "Open Race review evidence connected",
    detail:
      "Stage A uses manually captured field parameters and imported historical evidence. Stage B observations remain diagnostic only.",
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

function probability(value: number | null): string {
  return value === null ? "Unavailable" : (value / 10_000).toFixed(2) + "%";
}

function predictionTarget(value: string): string {
  if (value === "yellow_star") return "Yellow star (source: gold_star)";
  if (value === "blue_star") return "Blue star";
  return label(value);
}

function unavailablePredictionReason(
  evidence: OpenRaceSessionPredictionEvidence | undefined,
  connectionStatus: OpenRacePredictionPageState["connectionStatus"],
): string {
  if (connectionStatus === "identity_not_connected") {
    return "Owner identity is not connected.";
  }
  if (connectionStatus === "persistence_not_configured") {
    return "Private prediction persistence is not configured.";
  }
  if (connectionStatus === "workspace_unavailable") {
    return "The Open Race session is unavailable; frozen evidence cannot be verified.";
  }
  if (connectionStatus === "read_failed") {
    return "The owner-scoped frozen-prediction or accepted-result read failed. Both are withheld.";
  }
  if (connectionStatus === "integrity_failed") {
    return "The frozen prediction or accepted-result evidence failed validation. All predictions and reconciliations are withheld.";
  }
  if (evidence?.reason === "FIELD_NOT_LOCKED") {
    return "Predictions are frozen only after the complete field is locked.";
  }
  if (evidence?.reason === "EVENT_IDENTITY_UNAVAILABLE") {
    return "The authoritative event identity is unavailable.";
  }
  return "No frozen prediction exists for this exact field and source version.";
}

function CoreHistoryLink({
  coreId,
  children,
}: Readonly<{ coreId: string; children: string }>) {
  const encodedCoreId = encodeURIComponent(coreId);
  return (
    <Link
      aria-label={`View Core ${coreId} history`}
      className="font-semibold text-[var(--accent)] hover:underline"
      href={`/search-core?q=${encodedCoreId}&coreId=${encodedCoreId}`}
    >
      {children}
    </Link>
  );
}

function SessionCard({
  session,
  predictionConnectionStatus,
  predictionEvidence,
}: Readonly<{
  session: OpenRaceWorkspaceSession;
  predictionConnectionStatus: OpenRacePredictionPageState["connectionStatus"];
  predictionEvidence: OpenRaceSessionPredictionEvidence | undefined;
}>) {
  return (
    <article className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold tracking-wider text-[var(--accent)] uppercase">
            {label(session.field.mode)} ·{" "}
            {session.field.distanceMeters.toLocaleString("en-AU")} m
          </p>
          <h3 className="mt-2 text-lg font-semibold">
            Request {session.field.requestId}
          </h3>
        </div>
        <span className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--warning)]">
          {label(session.stage)}
        </span>
      </div>

      <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
        <div>
          <dt className="text-[var(--muted)]">Field</dt>
          <dd className="mt-1 font-semibold">
            {session.field.gateCount} gates · {session.field.raceFormat}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Data current through</dt>
          <dd className="mt-1 font-semibold">
            {timestamp(session.field.dataCurrentThrough)}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Last imported</dt>
          <dd className="mt-1 font-semibold">
            {timestamp(session.field.lastImported)}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Historical freshness</dt>
          <dd className="mt-1 font-semibold">
            {label(session.field.freshness)}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Probability context</dt>
          <dd className="mt-1 font-semibold">
            {session.field.probabilityContext === null
              ? "Unavailable — exact-context estimates withheld"
              : `${label(session.field.probabilityContext.competition)} · ${
                  session.field.probabilityContext.element.status === "known"
                    ? `Element ${session.field.probabilityContext.element.value}`
                    : `Element ${label(session.field.probabilityContext.element.status)}`
                }`}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Game event identity</dt>
          <dd className="mt-1 font-semibold">
            {session.field.eventIdentity.status === "confirmed"
              ? session.field.eventIdentity.eventId
              : "Unavailable — prediction reconciliation withheld"}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Scheduled event time</dt>
          <dd className="mt-1 font-semibold">
            {session.field.eventStartsAt ??
              "Unavailable — prediction freeze withheld"}
          </dd>
        </div>
      </dl>

      <p className="mt-3 text-xs text-[var(--muted)]">
        Session {session.bindings.sessionVersion} · Field{" "}
        {session.bindings.fieldVersion} · Eligibility{" "}
        {session.bindings.eligibilityVersion} · Historical aggregates{" "}
        {session.bindings.historicalAggregateVersion} · Race import{" "}
        {session.bindings.raceImportVersion} · Vault snapshot{" "}
        {session.bindings.vaultSnapshotVersion}
      </p>

      {session.ranking === null ? (
        <p className="mt-5 text-sm leading-6 text-[var(--muted)]">
          The manually captured field has no accepted pre-entry ranking yet.
          Missing evidence is unavailable, not evidence that every owned core is
          unsuitable.
        </p>
      ) : (
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <h4 className="font-semibold">Frozen pre-entry review</h4>
            <p className="mt-2 text-sm text-[var(--muted)]">
              {session.ranking.provisionalRecommendedCoreId === null
                ? "No resolved provisional review leader"
                : `Provisional review leader: Core ${session.ranking.provisionalRecommendedCoreId}`}
              {" · "}
              {session.ranking.avoidSignal
                ? "Avoid signal present"
                : "No supported avoid signal"}
            </p>
            <ol className="mt-3 space-y-2 text-sm">
              {session.ranking.rankedCandidates.map((candidate) => (
                <li
                  className="flex justify-between gap-3"
                  key={candidate.coreId}
                >
                  <CoreHistoryLink coreId={candidate.coreId}>
                    {`${candidate.rank}. Core ${candidate.coreId}`}
                  </CoreHistoryLink>
                  <span className="font-mono text-[var(--muted)]">
                    {candidate.medianTimeMs.toLocaleString("en-AU")} ms
                  </span>
                </li>
              ))}
            </ol>
          </section>
          <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <h4 className="font-semibold">Post-lock observation</h4>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              {session.observation === null
                ? "No optional Gold/Blue observation has been recorded."
                : `Selected core signal: ${label(session.observation.selectedCoreSignal)}.`}{" "}
              Observations never change the committed core or prove a completed
              race outcome.
            </p>
            {session.lock === null ? null : (
              <p className="mt-2 text-xs text-[var(--muted)]">
                <CoreHistoryLink coreId={session.lock.selectedOwnedCoreId}>
                  {`Committed core ${session.lock.selectedOwnedCoreId}`}
                </CoreHistoryLink>{" "}
                · Frozen ranking {session.lock.preEntryRankingId} · Switching
                disabled
              </p>
            )}
            {session.observation === null ? null : (
              <div className="mt-3 text-xs text-[var(--warning)]">
                <p>
                  Gold{" "}
                  {session.observation.goldApplicable
                    ? "applicable"
                    : "not applicable at this gate count"}
                  {" · "}
                  {label(session.observation.reconciliationStatus)}
                </p>
                {session.observation.issues.length === 0 ? null : (
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {session.observation.issues.map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {session.comparison === null ? null : (
              <p className="mt-3 text-xs text-[var(--muted)]">
                Diagnostic comparison{" "}
                {label(session.comparison.diagnosticStatus)}. Frozen pre-entry
                ranking unchanged; no replacement recommendation.
              </p>
            )}
          </section>
        </div>
      )}

      <section className="mt-5 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <h4 className="font-semibold">Frozen probability and star evidence</h4>
        {predictionEvidence?.status !== "available" ? (
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            {unavailablePredictionReason(
              predictionEvidence,
              predictionConnectionStatus,
            )}{" "}
            Missing evidence remains unavailable and is not estimated by the
            page.
          </p>
        ) : (
          <div className="mt-3 space-y-4">
            {predictionEvidence.items.map(
              ({ snapshot, latestReconciliation }) => (
                <article
                  className="rounded-lg border border-[var(--border)] p-3"
                  key={snapshot.snapshotId}
                >
                  <div className="flex flex-wrap justify-between gap-2 text-sm">
                    <p className="font-semibold">
                      Model {snapshot.modelVersion}
                    </p>
                    <p className="text-[var(--muted)]">
                      Frozen {timestamp(snapshot.predictedAt)}
                    </p>
                  </div>
                  <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
                    {snapshot.predictions.map((prediction) => (
                      <div key={prediction.coreId + ":" + prediction.target}>
                        <dt className="text-[var(--muted)]">
                          {predictionTarget(prediction.target)}
                        </dt>
                        <dd className="mt-1 font-semibold">
                          {prediction.status === "available"
                            ? probability(prediction.probabilityMillionths)
                            : label(prediction.status)}
                        </dd>
                        <dd className="text-xs text-[var(--muted)]">
                          Core {prediction.coreId} · Evidence{" "}
                          {label(prediction.evidenceStatus)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <p className="mt-3 text-xs text-[var(--muted)]">
                    {latestReconciliation === null
                      ? "Accepted result pending; frozen values remain unchanged."
                      : "Accepted result " +
                        label(latestReconciliation.recordStatus) +
                        " · revision " +
                        latestReconciliation.revision +
                        " · outcome " +
                        label(latestReconciliation.outcomeStatus) +
                        " · stars " +
                        label(latestReconciliation.starDataStatus) +
                        "."}
                  </p>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    Model and source versions are evidence only. No automatic
                    promotion, race entry or game action is allowed.
                  </p>
                </article>
              ),
            )}
          </div>
        )}
      </section>

      {session.stage === "provisional_selection" && session.ranking !== null ? (
        <OpenRaceMutationForm operation="lock">
          <h4 className="font-semibold">Confirm committed field lock</h4>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            This records evidence only. It does not enter a race, switch a Core,
            connect a wallet or perform any game action.
          </p>
          <input
            name="requestId"
            type="hidden"
            value={session.field.requestId}
          />
          <label className="mt-4 block text-sm font-semibold">
            Already committed owned Core
            <select
              className="mt-2 block w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2"
              name="selectedOwnedCoreId"
              required
            >
              {session.ranking.rankedCandidates.map((candidate) => (
                <option key={candidate.coreId} value={candidate.coreId}>
                  Core {candidate.coreId}
                </option>
              ))}
            </select>
          </label>
          <label className="mt-4 flex items-start gap-3 text-sm">
            <input
              className="mt-1"
              name="userConfirmedCommittedEntry"
              required
              type="checkbox"
              value="confirmed"
            />
            <span>
              I confirm this Core was already committed outside this website.
            </span>
          </label>
          <label className="mt-3 flex items-start gap-3 text-sm">
            <input
              className="mt-1"
              name="raceSetToRun"
              required
              type="checkbox"
              value="confirmed"
            />
            <span>
              I confirm every gate is filled and the race is set to run.
            </span>
          </label>
        </OpenRaceMutationForm>
      ) : null}

      {session.stage === "locked_observation" && session.lock !== null ? (
        <OpenRaceMutationForm operation="observation">
          <h4 className="font-semibold">Record revealed stars</h4>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            Record the optional pre-run Gold and Blue display only after the
            field lock. This diagnostic cannot change the frozen ranking, switch
            a Core or report a race outcome.
          </p>
          <input
            name="requestId"
            type="hidden"
            value={session.field.requestId}
          />
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-semibold">
              Gold
              {session.lock.gateCount <= 3 ? (
                <>
                  <input name="gold" type="hidden" value="not_applicable" />
                  <span className="mt-2 block rounded-lg border border-[var(--border)] px-3 py-2 font-normal text-[var(--muted)]">
                    Not applicable at this gate count
                  </span>
                </>
              ) : (
                <select
                  className="mt-2 block w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2"
                  name="gold"
                  required
                >
                  <option value="not_observed">Not observed</option>
                  <option value="not_assigned">Not assigned</option>
                  {session.lock.enteredCoreIds.map((coreId) => (
                    <option key={coreId} value={`core:${coreId}`}>
                      Core {coreId}
                    </option>
                  ))}
                </select>
              )}
            </label>
            <label className="block text-sm font-semibold">
              Blue
              <select
                className="mt-2 block w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2"
                name="blue"
                required
              >
                <option value="not_observed">Not observed</option>
                <option value="not_assigned">Not assigned</option>
                {session.lock.enteredCoreIds.map((coreId) => (
                  <option key={coreId} value={`core:${coreId}`}>
                    Core {coreId}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-4 text-sm">
            <p className="font-semibold">Game event identity</p>
            {session.lock.eventIdentity.status === "confirmed" ? (
              <>
                <input
                  name="gameEventId"
                  type="hidden"
                  value={session.lock.eventIdentity.eventId}
                />
                <p className="mt-2 rounded-lg border border-[var(--border)] px-3 py-2">
                  {session.lock.eventIdentity.eventId}
                </p>
              </>
            ) : (
              <p className="mt-2 rounded-lg border border-[var(--border)] px-3 py-2 text-[var(--muted)]">
                Unavailable — prediction reconciliation withheld
              </p>
            )}
          </div>
          <label className="mt-4 block text-sm font-semibold">
            Observation note (optional)
            <textarea
              className="mt-2 block w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2"
              maxLength={500}
              name="note"
              rows={2}
            />
          </label>
          <label className="mt-4 flex items-start gap-3 text-sm">
            <input
              className="mt-1"
              name="starsRevealedAfterLock"
              required
              type="checkbox"
              value="confirmed"
            />
            <span>I confirm these stars were revealed after field lock.</span>
          </label>
        </OpenRaceMutationForm>
      ) : null}
    </article>
  );
}

export function OpenRaceWorkspace({
  sessions,
  connectionStatus,
  predictionConnectionStatus = "persistence_not_configured",
  predictionEvidence = [],
}: Readonly<{
  sessions: readonly OpenRaceWorkspaceSession[];
  connectionStatus: OpenRaceWorkspaceConnectionStatus;
  predictionConnectionStatus?: OpenRacePredictionPageState["connectionStatus"];
  predictionEvidence?: readonly OpenRaceSessionPredictionEvidence[];
}>) {
  const connection = connectionCopy[connectionStatus];

  return (
    <div className="space-y-8">
      <header className="max-w-4xl">
        <p className="text-sm font-semibold text-[var(--accent)]">
          Phase 8 staged race review
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          Open Race
        </h1>
        <p className="mt-4 text-base leading-7 text-[var(--muted)]">
          Rank confirmed eligible owned cores from manually entered current
          field parameters and imported history. Current-race Gold and Blue are
          unavailable during Stage A and cannot influence pre-entry selection.
        </p>
      </header>

      <section
        aria-labelledby="open-race-connection"
        className="rounded-2xl border border-[var(--warning)]/50 bg-[var(--surface-raised)] p-6"
      >
        <h2 className="text-lg font-semibold" id="open-race-connection">
          {connection.heading}
        </h2>
        <p className="mt-3 max-w-4xl leading-7 text-[var(--muted)]">
          {connection.detail}
        </p>
        <p className="mt-4 text-sm text-[var(--muted)]">
          Accepted provisional sessions expose field-lock confirmation below.
          Stage A source publication and post-lock observations remain separate
          trusted steps.
        </p>
      </section>

      <section aria-labelledby="open-race-sessions">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold" id="open-race-sessions">
              Experimental staged reviews
            </h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Manual current field · Imported historical snapshot · No live game
              connection
            </p>
          </div>
          <span className="rounded-full border border-[var(--border)] px-3 py-1 text-xs font-semibold text-[var(--warning)]">
            Gate C not passed
          </span>
        </div>

        {sessions.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6">
            <h3 className="font-semibold">
              {connectionStatus === "read_failed" ||
              connectionStatus === "integrity_failed"
                ? "Open Race evidence withheld"
                : "No accepted Open Race session"}
            </h3>
            <p className="mt-3 max-w-3xl leading-7 text-[var(--muted)]">
              {connectionStatus === "read_failed" ||
              connectionStatus === "integrity_failed"
                ? "The owner-scoped session read failed or its saved evidence was invalid. No Stage A recommendation, frozen result or Stage B observation is displayed."
                : "No ranking, avoid advice, current-field star inference or entry action is available until a complete owner-scoped field and historical evidence set is accepted."}
            </p>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            {sessions.map((session) => (
              <SessionCard
                key={session.field.requestId}
                predictionConnectionStatus={predictionConnectionStatus}
                predictionEvidence={predictionEvidence.find(
                  ({ requestId }) => requestId === session.field.requestId,
                )}
                session={session}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
