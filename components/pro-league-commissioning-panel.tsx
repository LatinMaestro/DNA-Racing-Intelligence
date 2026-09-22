import type { ProLeagueDraftCommissioningState } from "@/lib/pro-league-draft-commissioning-service";

const unavailableCopy = {
  identity_not_connected: {
    heading: "Private recommendation not connected",
    detail: "Sign in as the authorised owner to view the Pro League plan.",
  },
  persistence_not_configured: {
    heading: "Pro League evidence not connected",
    detail:
      "The private owner data and exact-format evidence are required before a roster or mapping can be shown.",
  },
  active_generation_unavailable: {
    heading: "No active Pro League evidence generation",
    detail:
      "The last-good website data remains protected, but no current owner plan can be rendered.",
  },
} as const;

const distances = [1000, 1200, 1400, 1600, 1800, 2000, 2200] as const;

function coverage(primaryDistances: readonly number[], distance: number) {
  return primaryDistances.includes(distance) ? "✓" : "—";
}

function number(value: number): string {
  return value.toLocaleString("en-AU");
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
        <h1 className="text-2xl font-semibold">{copy.heading}</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
          {copy.detail}
        </p>
      </section>
    );
  }

  if (state.connectionStatus === "structural_pool_connected") {
    return (
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6">
        <h1 className="text-2xl font-semibold">Pro League plan not ready</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
          The owner Core list is connected, but exact-format elapsed-time
          evidence is not available for the final roster and race mapping.
        </p>
      </section>
    );
  }

  const plan = state.ownerPlan;
  if (plan === undefined) {
    return (
      <section className="rounded-2xl border border-[var(--warning)] bg-[var(--surface-raised)] p-6">
        <h1 className="text-2xl font-semibold">Final owner plan unavailable</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
          The finalised 25-Core owner plan could not be reconstructed from the
          active generation. No substitute roster is shown.
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-[var(--accent)]/50 bg-[var(--surface-raised)] p-6">
        <p className="text-sm font-semibold text-[var(--accent)]">
          Final owner Pro League plan
        </p>
        <h1 className="mt-2 text-3xl font-semibold">Roster & race mapping</h1>
        <p className="mt-3 max-w-4xl text-sm leading-6 text-[var(--muted)]">
          The finalised 25-Core roster is fixed as the team authority. Current
          same-Bike-race-type and exact-distance elapsed-time, consistency,
          sample and freshness evidence can refine race ordering inside the
          audited distance depth, but it cannot silently replace a roster
          member. Every race fills exactly half of the published gates from our
          Vault.
        </p>
      </section>

      <section
        aria-labelledby="pro-league-map-strategy"
        className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6"
      >
        <h2 className="text-xl font-semibold" id="pro-league-map-strategy">
          Map selection & deny preference
        </h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-[var(--border)] p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              Home pick
            </p>
            <p className="mt-2 text-xl font-semibold">
              {plan.mapStrategy.homePick}
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              Home deny
            </p>
            <p className="mt-2 text-xl font-semibold">
              {plan.mapStrategy.homeDeny}
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] p-4 sm:col-span-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              Away priority
            </p>
            <p className="mt-2 text-xl font-semibold">
              {plan.mapStrategy.awayPriority.join(" → ")}
            </p>
          </div>
        </div>
        <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
          {plan.mapStrategy.contingencyMap} remains the contingency map rather
          than a roster-selection driver.
        </p>
      </section>

      <section
        aria-labelledby="pro-league-roster"
        className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6"
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold" id="pro-league-roster">
              Roster recommendation
            </h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Finalised 25 Cores. Checkmarks show the primary distance family
              used when building full-gate depth.
            </p>
          </div>
          <p className="text-sm font-semibold">{plan.roster.length}/25 Cores</p>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-xs uppercase tracking-wide text-[var(--muted)]">
                <th className="px-3 py-3">Core</th>
                <th className="px-3 py-3">Element / F</th>
                {distances.map((distance) => (
                  <th className="px-3 py-3 text-center" key={distance}>
                    {distance}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {plan.roster.map((core) => (
                <tr
                  className="border-b border-[var(--border)]/70"
                  key={core.coreId}
                >
                  <td className="px-3 py-3 font-semibold">{core.displayName}</td>
                  <td className="px-3 py-3 text-[var(--muted)]">
                    {core.element} · F{core.fNumber}
                  </td>
                  {distances.map((distance) => (
                    <td className="px-3 py-3 text-center" key={distance}>
                      {coverage(core.primaryDistances, distance)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section
        aria-labelledby="pro-league-race-mapping"
        className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6"
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold" id="pro-league-race-mapping">
              Race mapping
            </h2>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              Win-first, not usage-balanced. Exact/strong evidence is preferred
              inside the audited distance depth; every last slot must remain
              defensible by the agreed distance family.
            </p>
          </div>
          <p className="text-sm font-semibold">
            {number(plan.assignedCoreEntries)}/
            {number(plan.requiredCoreEntries)} gate entries filled
          </p>
        </div>

        <div className="mt-4 space-y-3">
          {plan.maps.map((map) => (
            <details
              className="rounded-xl border border-[var(--border)]"
              key={map.mapId}
            >
              <summary className="cursor-pointer px-4 py-4 font-semibold">
                {map.name} · {number(map.assignedCoreEntries)}/
                {number(map.requiredCoreEntries)} gate entries
              </summary>
              <div className="overflow-x-auto border-t border-[var(--border)]">
                <table className="min-w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-xs uppercase tracking-wide text-[var(--muted)]">
                      <th className="px-3 py-3">Race</th>
                      <th className="px-3 py-3">Type</th>
                      <th className="px-3 py-3">Distance</th>
                      <th className="px-3 py-3">Our slots</th>
                      <th className="px-3 py-3">Mapped Cores</th>
                    </tr>
                  </thead>
                  <tbody>
                    {map.lines.map((line) => (
                      <tr
                        className="border-b border-[var(--border)]/70"
                        key={line.raceNumber}
                      >
                        <td className="px-3 py-3 font-semibold">
                          {line.raceNumber}
                          {line.first16 ? " ★" : ""}
                        </td>
                        <td className="px-3 py-3">{line.raceType}</td>
                        <td className="px-3 py-3">{line.distanceMetres}m</td>
                        <td className="px-3 py-3">
                          {line.coreNames.length}/{line.ourSlots}
                        </td>
                        <td className="px-3 py-3 text-[var(--muted)]">
                          {line.coreNames.join(", ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ))}
        </div>

        <p className="mt-4 text-xs leading-5 text-[var(--muted)]">
          ★ = first 16 priority. This page is advisory only and cannot submit a
          roster, choose/deny a map, enter a race or perform any game action.
        </p>
      </section>
    </div>
  );
}
