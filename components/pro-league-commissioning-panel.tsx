import type { ProLeagueDraftCommissioningState } from "@/lib/pro-league-draft-commissioning-service";

const unavailableCopy = {
  identity_not_connected: {
    heading: "Private recommendation not connected",
    detail:
      "Sign in as the authorised owner to read the private exact-format recommendation.",
  },
  persistence_not_configured: {
    heading: "Private recommendation storage not connected",
    detail:
      "The server requires both the owner Vault catalogue and the read-only active evidence repository. No partial recommendation is shown.",
  },
  active_generation_unavailable: {
    heading: "No verified active recommendation generation",
    detail:
      "The previous website view remains available, but an exact-format recommendation is hidden until a complete verified generation is active.",
  },
} as const;

function label(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
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

function sourceMetric(value: unknown): string {
  if (value === null || value === undefined) return "Unavailable";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  return "Available";
}

function fixedFees(values: Readonly<Record<string, number>>): string {
  const entries = Object.entries(values);
  return entries.length === 0
    ? "None reported"
    : entries.map(([asset, amount]) => `${amount} ${asset}`).join(", ");
}

function SummaryCard({
  label: cardLabel,
  value,
}: Readonly<{ label: string; value: string | number }>) {
  return (
    <div className="rounded-xl border border-[var(--border)] p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
        {cardLabel}
      </p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}

export function ProLeagueCommissioningPanel({
  state,
}: Readonly<{ state: ProLeagueDraftCommissioningState }>) {
  if (
    state.connectionStatus === "identity_not_connected" ||
    state.connectionStatus === "persistence_not_configured" ||
    state.connectionStatus === "active_generation_unavailable"
  ) {
    const copy = unavailableCopy[state.connectionStatus];
    return (
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6">
        <h2 className="text-lg font-semibold">{copy.heading}</h2>
        <p className="mt-3 max-w-4xl leading-7 text-[var(--muted)]">
          {copy.detail}
        </p>
      </section>
    );
  }

  const { evidence, roster } = state;
  if (evidence === null || roster === null) {
    throw new Error("Connected Pro League recommendation is incomplete.");
  }
  const selected = roster.draftRoster?.members.filter(
    ({ disposition }) => disposition === "rostered",
  );
  const coreName = new Map(
    roster.candidates.map(({ core }) => [core.coreId, core.displayName]),
  );
  const priorityGaps = roster.coverageGaps.filter(
    ({ discoveryPriority }) => discoveryPriority !== "maintain",
  );
  const raceOpportunities = state.raceOpportunities;

  return (
    <section
      aria-labelledby="pro-league-current-recommendation"
      className="space-y-6 rounded-2xl border border-[var(--accent)]/50 bg-[var(--surface-raised)] p-6"
    >
      <div>
        <p className="text-sm font-semibold text-[var(--accent)]">
          Verified private read model
        </p>
        <h2
          className="mt-2 text-2xl font-semibold"
          id="pro-league-current-recommendation"
        >
          Current exact-format recommendation
        </h2>
        <p className="mt-3 max-w-4xl leading-7 text-[var(--muted)]">
          Evidence is current through {timestamp(evidence.evidenceCutoffAt)} and
          was activated {timestamp(evidence.publishedAt)}. Rankings use the same
          Bike race type and exact distance; wins and Top 3 results remain
          supporting context only.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          label="Population profiles"
          value={evidence.populationProfileCount}
        />
        <SummaryCard
          label="Owned profiles"
          value={evidence.ownedProfileCount}
        />
        <SummaryCard
          label="Owned Cores without evidence"
          value={evidence.ownedCoreWithoutEvidenceCount}
        />
        <SummaryCard
          label="Recommended roster"
          value={selected?.length ?? "Unavailable"}
        />
      </div>

      {state.currentState === undefined ? null : state.currentState.status !==
        "connected" ? (
        <div className="rounded-xl border border-[var(--border)] p-5">
          <h3 className="font-semibold">Current API Core state unavailable</h3>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            The historical exact-format recommendation remains usable. Current
            power, odds, variance, stamina, assets, listing, owner and splicing
            observations stay hidden until one complete last-good API generation
            is available.
          </p>
        </div>
      ) : (
        <div>
          <h3 className="text-lg font-semibold">Current API dimensions</h3>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            Last observed {timestamp(state.currentState.latestObservedAt!)}.
            These point-in-time fields are presented separately and do not alter
            the historical performance ranking until predictive lift is
            validated.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-[var(--muted)]">
                <tr>
                  <th className="pb-2 pr-4">Core</th>
                  <th className="pb-2 pr-4">Bike power</th>
                  <th className="pb-2 pr-4">Adjusted odds</th>
                  <th className="pb-2 pr-4">Variance</th>
                  <th className="pb-2 pr-4">API races</th>
                  <th className="pb-2 pr-4">Stamina</th>
                  <th className="pb-2 pr-4">Listing</th>
                  <th className="pb-2">Assets</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {state.currentState.cores.map((core, index) => (
                  <tr key={`${core.displayName}/${String(index)}`}>
                    <td className="py-2 pr-4 font-medium">
                      {core.displayName}
                    </td>
                    <td className="py-2 pr-4">
                      {sourceMetric(core.bikePower.powerSourceValue)}
                    </td>
                    <td className="py-2 pr-4">
                      {sourceMetric(core.bikePower.adjustedOddsSourceValue)}
                    </td>
                    <td className="py-2 pr-4">
                      {sourceMetric(core.bikePower.varianceSourceValue)}
                    </td>
                    <td className="py-2 pr-4">{core.bikePower.raceCount}</td>
                    <td className="py-2 pr-4">
                      {core.stamina.current}/{core.stamina.maximum}
                    </td>
                    <td className="py-2 pr-4">
                      {core.listing.priceSourceValue === undefined
                        ? "Not listed"
                        : `${core.listing.priceSourceValue} ${
                            core.listing.paymentAssetSourceValue ?? ""
                          }`.trim()}
                    </td>
                    <td className="py-2">
                      {core.bikeSkinAttached || core.trailsAttached
                        ? "Attached"
                        : "None observed"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
            Racing statistics, owner state and splicing state are also verified
            for every listed roster Core. Wallet addresses and raw payloads are
            never rendered.
          </p>
        </div>
      )}

      {state.connectionStatus === "draft_unavailable" ||
      selected === undefined ? (
        <div className="rounded-xl border border-[var(--warning)]/50 p-5">
          <h3 className="font-semibold">A compliant draft is not available</h3>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            Search status: {label(roster.search.status)}. The verified evidence
            remains readable, but no roster or map assignment is presented as
            ready.
          </p>
        </div>
      ) : (
        <>
          <div>
            <h3 className="text-lg font-semibold">Recommended roster</h3>
            <ol className="mt-3 divide-y divide-[var(--border)]">
              {selected.map((member) => (
                <li className="py-3" key={member.position}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-semibold">
                      {member.position}. {member.core.displayName}
                    </p>
                    <span className="text-xs font-semibold text-[var(--accent)]">
                      {label(member.role)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    {member.core.element} · {member.core.coreClass} ·{" "}
                    {label(member.core.sex)} · F{member.core.fNumber}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                    {member.reason}
                  </p>
                </li>
              ))}
            </ol>
          </div>

          {state.lineup === null ? null : (
            <div>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold">Four-map assignment</h3>
                  <p className="mt-2 text-sm text-[var(--muted)]">
                    {state.lineup.totals.lineCount} race lines ·{" "}
                    {state.lineup.totals.provisionalLineCount} provisional ·{" "}
                    {state.lineup.totals.noExactEvidenceLineCount} without exact
                    evidence
                  </p>
                </div>
              </div>
              <div className="mt-4 space-y-3">
                {state.lineup.maps.map((map) => (
                  <details
                    className="rounded-xl border border-[var(--border)] p-4"
                    key={map.mapId}
                  >
                    <summary className="cursor-pointer font-semibold">
                      {map.name} · {map.lineCount} lines ·{" "}
                      {map.provisionalLineCount} provisional
                    </summary>
                    <div className="mt-4 overflow-x-auto">
                      <table className="w-full min-w-[720px] text-left text-sm">
                        <thead className="text-xs uppercase tracking-wide text-[var(--muted)]">
                          <tr>
                            <th className="pb-2 pr-4">Race</th>
                            <th className="pb-2 pr-4">Format</th>
                            <th className="pb-2 pr-4">Core</th>
                            <th className="pb-2">Evidence</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border)]">
                          {map.lines.map((line) => (
                            <tr key={line.raceNumber}>
                              <td className="py-2 pr-4">{line.raceNumber}</td>
                              <td className="py-2 pr-4">
                                {line.raceType} · {line.distanceMetres} m
                              </td>
                              <td className="py-2 pr-4">
                                {coreName.get(line.coreId) ?? "Unavailable"}
                              </td>
                              <td className="py-2">
                                {label(line.evidenceStatus)}
                                {line.provisional ? " · test before lock" : ""}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {priorityGaps.length > 0 ? (
        <div>
          <h3 className="text-lg font-semibold">Population coverage gaps</h3>
          <ul className="mt-3 space-y-3">
            {priorityGaps.map((gap) => (
              <li
                className="rounded-xl border border-[var(--warning)]/40 p-4"
                key={`${gap.raceType}/${gap.distanceMetres}`}
              >
                <p className="font-semibold">
                  {gap.raceType} · {gap.distanceMetres} m · {label(gap.status)}
                </p>
                <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
                  {gap.raceLineCount} published race lines ·{" "}
                  {label(gap.discoveryPriority)} Discovery priority.{" "}
                  {gap.guidance}
                </p>
                {gap.bestAvailableCoreIds.length > 0 ? (
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    Best owned:{" "}
                    {gap.bestAvailableCoreIds
                      .map((id) => coreName.get(id) ?? "Unavailable")
                      .join(", ")}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {raceOpportunities === undefined ? null : (
        <div>
          <h3 className="text-lg font-semibold">
            Open Bike race opportunities
          </h3>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            Read-only API snapshot scanned {raceOpportunities.scannedRaceCount}{" "}
            active race(s). Only Bike races still marked filling, at least 50%
            filled and with an open gate are shown. No entry or wallet action is
            available here.
          </p>
          {raceOpportunities.status !== "connected" ? (
            <p className="mt-3 rounded-xl border border-[var(--border)] p-4 text-sm text-[var(--muted)]">
              Current race opportunities are unavailable. The last-good roster,
              lineup and gap analysis remain visible.
            </p>
          ) : raceOpportunities.opportunities.length === 0 ? (
            <p className="mt-3 rounded-xl border border-[var(--border)] p-4 text-sm text-[var(--muted)]">
              No API-visible Bike race currently meets the fill and open-gate
              threshold in this snapshot.
            </p>
          ) : (
            <ul className="mt-3 space-y-3">
              {raceOpportunities.opportunities.map((race) => (
                <li
                  className="rounded-xl border border-[var(--border)] p-4"
                  key={race.sourceRaceId}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-semibold">{race.displayName}</p>
                    <span className="text-xs font-semibold text-[var(--accent)]">
                      {race.filledGateCount}/{race.gateCount} gates ·{" "}
                      {race.fillPercentage}%
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    {race.availableGateCount} open · {race.entrantCount}{" "}
                    entrant(s) · {race.entryFeeUsd} USD · {race.paymentAsset} ·
                    observed {timestamp(race.observedAt)}
                  </p>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    Scheduled{" "}
                    {race.startAt === null
                      ? "not reported"
                      : timestamp(race.startAt)}
                    {" · "}Source format {sourceMetric(race.formatSourceValue)}
                    {" · "}Source class{" "}
                    {sourceMetric(race.raceClassSourceValue)}
                    {" · "}Fixed fees {fixedFees(race.fixedFeesByAsset)}
                  </p>
                  <p className="mt-2 text-xs leading-5 text-[var(--warning)]">
                    API distance and Pro League race-type authority are
                    unavailable, so this race cannot yet be matched to the{" "}
                    {raceOpportunities.priorityGapCount} priority population
                    gap(s) or receive a Core recommendation. Verify those
                    details in DNA before manual entry. A direct race link is
                    also withheld until its route is authoritatively
                    established.
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {roster.operationalWarnings.length > 0 ? (
        <div>
          <h3 className="font-semibold">Operational warnings</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-[var(--muted)]">
            {roster.operationalWarnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
