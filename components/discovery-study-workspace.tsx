import type {
  DiscoveryDistanceRecommendation,
  DiscoveryModeDistanceConfiguration,
  DiscoveryRecommendationType,
} from "@/domain/discovery-study";
import { currentBikeDiscoveryDistanceConfiguration } from "@/domain/discovery-study";
import { probeModes, type ProbeMode } from "@/domain/discovery-probe-plan";

export type DiscoveryStudyCandidateRow = Readonly<{
  coreName: string;
  coreId: string;
  gender: string | null;
  mode: ProbeMode;
  discoverySquadMember: boolean;
  modeRaceStarts: number | null;
  normalFreeObservations: number | null;
  distanceRecommendations: readonly DiscoveryDistanceRecommendation[];
  decision: string;
  sampleCompletionState: "not_started" | "in_progress" | "complete" | "unknown";
  coreStatus: string;
}>;

export type DiscoveryStudyDistanceRow = Readonly<{
  priority: number | null;
  coreName: string;
  coreId: string;
  gender: string | null;
  mode: ProbeMode;
  discoverySquadMember: boolean;
  distanceMetres: number;
  recommendationType: DiscoveryRecommendationType;
  evidenceBasis: readonly string[];
  existingNormalFreeObservations: number | null;
  additionalObservationsNeeded: number | null;
  competitiveStarts: number | null;
  competitiveWinPercentage: number | null;
  competitivePodiumPercentage: number | null;
  competitiveFinishMeasure: number | null;
  normalFreeMedianSpeedMetresPerSecond: number | null;
  normalFreeBestSpeedMetresPerSecond: number | null;
  speedDispersionMetresPerSecond: number | null;
  speedCoefficientOfVariation: number | null;
  parentExactDistanceObservations: number | null;
  familyDistanceSignal: string;
  testingReason: string;
  testStatus: string;
  ownerNotes: string;
  postTestDecision: string;
  coreStatus: string;
}>;

export type DiscoveryStudyView = Readonly<{
  targetSampleSize: number;
  historyStatus: "complete" | "incomplete" | "unavailable";
  historyExplanation: string;
  modeConfigurations: readonly DiscoveryModeDistanceConfiguration[];
  candidates: readonly DiscoveryStudyCandidateRow[];
  distanceRows: readonly DiscoveryStudyDistanceRow[];
}>;

export type DiscoveryStudyFilters = Readonly<{
  mode: ProbeMode;
  squad: "all" | "member" | "not_member";
  recommendation: "all" | "preferred" | "exploratory_fallback";
  distanceMetres: number | null;
  evidenceBasis: string | null;
  completion: "all" | "not_started" | "in_progress" | "complete" | "unknown";
  coreStatus: string | null;
}>;

function value(value: string | number | null, suffix = ""): string {
  if (value === null) return "Unknown";
  return typeof value === "number"
    ? `${value.toLocaleString("en-AU")}${suffix}`
    : value;
}

function percentage(input: number | null): string {
  return input === null ? "Unknown" : `${input.toFixed(1)}%`;
}

function speed(input: number | null): string {
  return input === null ? "Unknown" : `${input.toFixed(3)} m/s`;
}

function recommendationLabel(
  recommendationType: DiscoveryRecommendationType,
): string {
  if (recommendationType === "preferred") return "TEST";
  if (recommendationType === "exploratory_fallback") return "SCREEN";
  if (recommendationType === "unknown") return "UNKNOWN";
  return "";
}

export function DiscoveryStudyWorkspace({
  study,
  filters,
}: Readonly<{
  study: DiscoveryStudyView | null;
  filters: DiscoveryStudyFilters;
}>) {
  const configuration =
    study?.modeConfigurations.find(({ mode }) => mode === filters.mode) ??
    (filters.mode === "bike"
      ? currentBikeDiscoveryDistanceConfiguration
      : undefined);
  const candidates =
    study?.candidates.filter(
      (candidate) =>
        candidate.mode === filters.mode &&
        (filters.squad === "all" ||
          candidate.discoverySquadMember === (filters.squad === "member")) &&
        (filters.completion === "all" ||
          candidate.sampleCompletionState === filters.completion) &&
        (filters.coreStatus === null ||
          candidate.coreStatus === filters.coreStatus) &&
        (filters.recommendation === "all" ||
          candidate.distanceRecommendations.some(
            ({ recommendationType }) =>
              recommendationType === filters.recommendation,
          )),
    ) ?? [];
  const rows =
    study?.distanceRows.filter(
      (row) =>
        row.mode === filters.mode &&
        (filters.squad === "all" ||
          row.discoverySquadMember === (filters.squad === "member")) &&
        (filters.recommendation === "all" ||
          row.recommendationType === filters.recommendation) &&
        (filters.distanceMetres === null ||
          row.distanceMetres === filters.distanceMetres) &&
        (filters.evidenceBasis === null ||
          row.evidenceBasis.includes(filters.evidenceBasis)) &&
        (filters.completion === "all" ||
          row.testStatus === filters.completion) &&
        (filters.coreStatus === null || row.coreStatus === filters.coreStatus),
    ) ?? [];

  return (
    <section aria-labelledby="normal-free-discovery" className="space-y-5">
      <div>
        <p className="text-sm font-semibold text-[var(--accent)]">
          Mode-aware owner study
        </p>
        <h2 className="mt-1 text-xl font-semibold" id="normal-free-discovery">
          Normal-Free speed Discovery
        </h2>
        <p className="mt-2 max-w-5xl text-sm leading-6 text-[var(--muted)]">
          Normal-Free means the race name contains the standalone word Free.
          Entry price alone never qualifies. Speed, repeatability and dispersion
          remain separate from competitive, tournament, esports and lineage
          evidence. The owner test target is {study?.targetSampleSize ?? 20}
          usable observations per Core, mode and exact distance; it does not
          replace the existing ten-race analytical confidence boundary.
        </p>
      </div>

      <form className="grid gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm">
          <span className="block text-[var(--muted)]">Racing mode</span>
          <select
            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2"
            defaultValue={filters.mode}
            name="mode"
          >
            {probeModes.map((mode) => (
              <option key={mode} value={mode}>
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-[var(--muted)]">Discovery squad</span>
          <select
            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2"
            defaultValue={filters.squad}
            name="squad"
          >
            <option value="all">All candidates</option>
            <option value="member">Squad members</option>
            <option value="not_member">Not in squad</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-[var(--muted)]">Recommendation</span>
          <select
            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2"
            defaultValue={filters.recommendation}
            name="recommendation"
          >
            <option value="all">TEST and SCREEN</option>
            <option value="preferred">TEST only</option>
            <option value="exploratory_fallback">SCREEN only</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-[var(--muted)]">Exact distance</span>
          <select
            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2"
            defaultValue={filters.distanceMetres?.toString() ?? "all"}
            name="distance"
          >
            <option value="all">All valid distances</option>
            {configuration?.supportedDistancesMetres.map((distanceMetres) => (
              <option key={distanceMetres} value={distanceMetres}>
                {distanceMetres.toLocaleString("en-AU")} m
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-[var(--muted)]">Evidence basis</span>
          <select
            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2"
            defaultValue={filters.evidenceBasis ?? "all"}
            name="evidence"
          >
            <option value="all">All evidence</option>
            <option value="own_competitive">Own competitive</option>
            <option value="normal_free_speed">Normal-Free speed</option>
            <option value="parent_exact_distance">Parent exact-distance</option>
            <option value="other_mode_appropriate">
              Other transparent evidence
            </option>
            <option value="none">No supporting evidence</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-[var(--muted)]">Sample completion</span>
          <select
            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2"
            defaultValue={filters.completion}
            name="completion"
          >
            <option value="all">All states</option>
            <option value="not_started">Not started</option>
            <option value="in_progress">In progress</option>
            <option value="complete">Complete</option>
            <option value="unknown">Unknown</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-[var(--muted)]">Core status</span>
          <select
            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2"
            defaultValue={filters.coreStatus ?? "all"}
            name="status"
          >
            <option value="all">All statuses</option>
            {[
              ...new Set(
                study?.candidates.map(({ coreStatus }) => coreStatus) ?? [],
              ),
            ]
              .sort()
              .map((coreStatus) => (
                <option key={coreStatus} value={coreStatus}>
                  {coreStatus}
                </option>
              ))}
          </select>
        </label>
        <button
          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white lg:col-span-4"
          type="submit"
        >
          Apply filters
        </button>
      </form>

      {study === null || study.historyStatus !== "complete" ? (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5">
          <h3 className="font-semibold">Normal-Free history not publishable</h3>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-[var(--muted)]">
            {study?.historyExplanation ??
              "The current read model has no authoritative race-name plus finished-time history. Existing evidence remains unknown rather than being inferred from zero entry price or legacy rows."}
          </p>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-2xl border border-[var(--border)]">
        <table className="min-w-full divide-y divide-[var(--border)] text-left text-sm">
          <caption className="bg-[var(--surface-raised)] p-4 text-left font-semibold">
            Candidate matrix · {filters.mode}
          </caption>
          <thead className="bg-[var(--surface-raised)] text-[var(--muted)]">
            <tr>
              <th className="p-3">Core</th>
              <th className="p-3">HID</th>
              <th className="p-3">Gender</th>
              <th className="p-3">Squad</th>
              <th className="p-3">Mode starts</th>
              <th className="p-3">Normal-Free</th>
              {configuration?.supportedDistancesMetres.map((distanceMetres) => (
                <th className="p-3" key={distanceMetres}>
                  {distanceMetres.toLocaleString("en-AU")} m
                </th>
              ))}
              <th className="p-3">Selected</th>
              <th className="p-3">Decision</th>
              <th className="p-3">Completion</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {candidates.length === 0 ? (
              <tr>
                <td className="p-4 text-[var(--muted)]" colSpan={12}>
                  No complete, authority-backed candidate rows match these
                  filters.
                </td>
              </tr>
            ) : (
              candidates.map((candidate) => (
                <tr key={`${candidate.coreId}:${candidate.mode}`}>
                  <td className="p-3 font-semibold">{candidate.coreName}</td>
                  <td className="p-3">{candidate.coreId}</td>
                  <td className="p-3">{value(candidate.gender)}</td>
                  <td className="p-3">
                    {candidate.discoverySquadMember ? "Yes" : "No"}
                  </td>
                  <td className="p-3">{value(candidate.modeRaceStarts)}</td>
                  <td className="p-3">
                    {value(candidate.normalFreeObservations)}
                  </td>
                  {configuration?.supportedDistancesMetres.map(
                    (distanceMetres) => {
                      const recommendation =
                        candidate.distanceRecommendations.find(
                          (item) => item.distanceMetres === distanceMetres,
                        );
                      const label = recommendation
                        ? recommendationLabel(recommendation.recommendationType)
                        : "UNKNOWN";
                      return (
                        <td className="p-3 font-semibold" key={distanceMetres}>
                          <span
                            className={
                              label === "TEST"
                                ? "text-emerald-400"
                                : label === "SCREEN"
                                  ? "text-amber-400"
                                  : "text-[var(--muted)]"
                            }
                          >
                            {label}
                          </span>
                        </td>
                      );
                    },
                  )}
                  <td className="p-3">
                    {
                      candidate.distanceRecommendations.filter(
                        ({ displayLabel }) =>
                          ["TEST", "SCREEN"].includes(displayLabel),
                      ).length
                    }
                  </td>
                  <td className="p-3">{candidate.decision}</td>
                  <td className="p-3">{candidate.sampleCompletionState}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {configuration?.supportedDistancesMetres.map((distanceMetres) => {
        if (
          filters.distanceMetres !== null &&
          filters.distanceMetres !== distanceMetres
        ) {
          return null;
        }
        const distanceRows = rows.filter(
          (row) => row.distanceMetres === distanceMetres,
        );
        return (
          <details
            className="rounded-2xl border border-[var(--border)]"
            key={distanceMetres}
          >
            <summary className="cursor-pointer bg-[var(--surface-raised)] p-4 font-semibold">
              {distanceMetres.toLocaleString("en-AU")} m testing table ·{" "}
              {distanceRows.length.toLocaleString("en-AU")} candidates
            </summary>
            <div className="overflow-x-auto">
              <table className="min-w-[2200px] divide-y divide-[var(--border)] text-left text-xs">
                <thead className="text-[var(--muted)]">
                  <tr>
                    {[
                      "Priority",
                      "Core",
                      "HID",
                      "Gender",
                      "Mode",
                      "Squad",
                      "Type",
                      "Evidence",
                      "Free count",
                      "Needed",
                      "Comp starts",
                      "Win %",
                      "Podium %",
                      "Finish",
                      "Median speed",
                      "Best speed",
                      "Dispersion",
                      "CV",
                      "Parent n",
                      "Family signal",
                      "Reason",
                      "Status",
                      "Owner notes",
                      "Post-test",
                    ].map((heading) => (
                      <th className="p-3" key={heading}>
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {distanceRows.map((row) => (
                    <tr key={`${row.coreId}:${row.mode}:${row.distanceMetres}`}>
                      <td className="p-3">{value(row.priority)}</td>
                      <td className="p-3 font-semibold">{row.coreName}</td>
                      <td className="p-3">{row.coreId}</td>
                      <td className="p-3">{value(row.gender)}</td>
                      <td className="p-3">{row.mode}</td>
                      <td className="p-3">
                        {row.discoverySquadMember ? "Yes" : "No"}
                      </td>
                      <td className="p-3 font-semibold">
                        {recommendationLabel(row.recommendationType)}
                      </td>
                      <td className="p-3">{row.evidenceBasis.join(", ")}</td>
                      <td className="p-3">
                        {value(row.existingNormalFreeObservations)}
                      </td>
                      <td className="p-3">
                        {value(row.additionalObservationsNeeded)}
                      </td>
                      <td className="p-3">{value(row.competitiveStarts)}</td>
                      <td className="p-3">
                        {percentage(row.competitiveWinPercentage)}
                      </td>
                      <td className="p-3">
                        {percentage(row.competitivePodiumPercentage)}
                      </td>
                      <td className="p-3">
                        {value(row.competitiveFinishMeasure)}
                      </td>
                      <td className="p-3">
                        {speed(row.normalFreeMedianSpeedMetresPerSecond)}
                      </td>
                      <td className="p-3">
                        {speed(row.normalFreeBestSpeedMetresPerSecond)}
                      </td>
                      <td className="p-3">
                        {speed(row.speedDispersionMetresPerSecond)}
                      </td>
                      <td className="p-3">
                        {row.speedCoefficientOfVariation === null
                          ? "Unknown"
                          : row.speedCoefficientOfVariation.toFixed(3)}
                      </td>
                      <td className="p-3">
                        {value(row.parentExactDistanceObservations)}
                      </td>
                      <td className="p-3">{row.familyDistanceSignal}</td>
                      <td className="p-3">{row.testingReason}</td>
                      <td className="p-3">{row.testStatus}</td>
                      <td className="p-3">{row.ownerNotes}</td>
                      <td className="p-3">{row.postTestDecision}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        );
      })}
    </section>
  );
}
