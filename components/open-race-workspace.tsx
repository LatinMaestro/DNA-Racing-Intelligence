import type {
  OpenRaceWorkspaceConnectionStatus,
  OpenRaceWorkspaceSession,
} from "@/lib/open-race-workspace-service";

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

function SessionCard({
  session,
}: Readonly<{ session: OpenRaceWorkspaceSession }>) {
  return (
    <article className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold tracking-wider text-[var(--accent)] uppercase">
            {session.field.mode} ·{" "}
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
      </dl>

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
                ? "No resolved provisional leader"
                : `Provisional leader: Core ${session.ranking.provisionalRecommendedCoreId}`}
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
                  <span>
                    {candidate.rank}. Core {candidate.coreId}
                  </span>
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
          </section>
        </div>
      )}
    </article>
  );
}

export function OpenRaceWorkspace({
  sessions,
  connectionStatus,
}: Readonly<{
  sessions: readonly OpenRaceWorkspaceSession[];
  connectionStatus: OpenRaceWorkspaceConnectionStatus;
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
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            className="cursor-not-allowed rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-semibold text-[var(--muted)]"
            disabled
            type="button"
          >
            Stage A capture unavailable
          </button>
          <button
            className="cursor-not-allowed rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-semibold text-[var(--muted)]"
            disabled
            type="button"
          >
            Stage B observation unavailable
          </button>
        </div>
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
            <h3 className="font-semibold">No accepted Open Race session</h3>
            <p className="mt-3 max-w-3xl leading-7 text-[var(--muted)]">
              No ranking, avoid advice, current-field star inference or entry
              action is available until a complete owner-scoped field and
              historical evidence set is accepted.
            </p>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            {sessions.map((session) => (
              <SessionCard key={session.field.requestId} session={session} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
