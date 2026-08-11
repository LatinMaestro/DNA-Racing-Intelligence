import type { TournamentCandidateRankingResult } from "@/domain/tournament-candidate-ranking";
import type { TournamentWorkspaceConnectionStatus } from "@/lib/tournament-workspace-service";

type SaveAction = (formData: FormData) => Promise<void>;

export function TournamentConfigurationForm({
  brackets,
  connectionStatus,
  saveAction,
}: Readonly<{
  brackets: readonly TournamentCandidateRankingResult[];
  connectionStatus: TournamentWorkspaceConnectionStatus;
  saveAction: SaveAction;
}>) {
  const existing = brackets[0] ?? null;
  const disabled = connectionStatus !== "read_model_connected";

  return (
    <section
      aria-labelledby="tournament-configuration-editor"
      className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6"
    >
      <div className="max-w-4xl">
        <p className="text-sm font-semibold text-[var(--accent)]">
          Owner configuration
        </p>
        <h2
          className="mt-2 text-xl font-semibold"
          id="tournament-configuration-editor"
        >
          Add or update a Tournament split
        </h2>
        <p className="mt-3 leading-7 text-[var(--muted)]">
          This editor changes only the private Tournament configuration used by
          Tournament and Discovery. It does not create candidate evidence or
          submit a Tournament entry.
        </p>
      </div>

      <form action={saveAction} className="mt-6">
        <fieldset disabled={disabled}>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-sm font-medium">
              Tournament ID
              <input
                className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
                defaultValue={existing?.tournamentId ?? ""}
                maxLength={100}
                name="tournamentId"
                placeholder="spring-cup-2026"
                required
              />
            </label>
            <label className="text-sm font-medium">
              Tournament label
              <input
                className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
                defaultValue={existing?.tournamentLabel ?? ""}
                maxLength={160}
                name="tournamentLabel"
                placeholder="Spring Cup"
                required
              />
            </label>
            <label className="text-sm font-medium">
              Bracket ID
              <input
                className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
                defaultValue={existing?.bracketId ?? ""}
                maxLength={100}
                name="bracketId"
                placeholder="bike-a"
                required
              />
            </label>
            <label className="text-sm font-medium">
              Split label
              <input
                className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
                defaultValue={existing?.splitLabel ?? ""}
                maxLength={160}
                name="splitLabel"
                placeholder="Bike A"
                required
              />
            </label>
            <label className="text-sm font-medium">
              Mode
              <select
                className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
                defaultValue={existing?.mode ?? "bike"}
                name="mode"
              >
                <option value="bike">Bike</option>
                <option value="car">Car</option>
                <option value="horse">Horse</option>
              </select>
            </label>
            <label className="text-sm font-medium">
              Eligible distances (metres)
              <input
                className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
                defaultValue={
                  existing?.eligibleDistancesMetres.join(", ") ?? ""
                }
                maxLength={240}
                name="eligibleDistancesMetres"
                placeholder="1200, 1400, 1600"
                required
              />
            </label>
            <label className="text-sm font-medium">
              Discovery relevance
              <select
                className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
                defaultValue={existing?.discoveryRelevance ?? "eligible"}
                name="discoveryRelevance"
              >
                <option value="eligible">Eligible</option>
                <option value="priority">Priority</option>
              </select>
            </label>
            <label className="text-sm font-medium">
              Qualification metric label
              <input
                className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
                defaultValue={existing?.qualificationMetricLabel ?? ""}
                maxLength={160}
                name="qualificationMetricLabel"
                placeholder="Qualification points"
                required
              />
            </label>
            <label className="text-sm font-medium">
              Configuration version
              <input
                className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
                defaultValue={existing?.configurationVersion ?? ""}
                maxLength={100}
                name="configurationVersion"
                placeholder="config-1"
                required
              />
            </label>
            <label className="text-sm font-medium">
              Candidate snapshot version
              <input
                className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
                defaultValue={existing?.candidateSnapshotVersion ?? ""}
                maxLength={100}
                name="candidateSnapshotVersion"
                placeholder="snapshot-1"
                required
              />
            </label>
          </div>
          <button
            className="mt-6 rounded-lg border border-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent)] disabled:cursor-not-allowed disabled:border-[var(--border)] disabled:text-[var(--muted)]"
            type="submit"
          >
            Save configuration
          </button>
        </fieldset>
      </form>

      {disabled ? (
        <p className="mt-4 text-sm text-[var(--muted)]">
          Configuration editing stays disabled until the owner-scoped database
          read model is connected.
        </p>
      ) : null}
    </section>
  );
}
