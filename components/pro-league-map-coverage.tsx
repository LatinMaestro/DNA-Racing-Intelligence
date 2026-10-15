import type { ProLeagueOwnerMapMapping } from "@/domain/pro-league-owner-commissioning-plan";

export function ProLeagueMapCoverage({
  maps,
}: Readonly<{
  maps: readonly ProLeagueOwnerMapMapping[];
}>) {
  const segments = [
    ...new Map(
      maps.flatMap((map) =>
        map.lines.map(
          (line) =>
            [
              JSON.stringify([line.raceType, line.distanceMetres]),
              { raceType: line.raceType, distance: line.distanceMetres },
            ] as const,
        ),
      ),
    ).values(),
  ].sort(
    (a, b) => a.raceType.localeCompare(b.raceType) || a.distance - b.distance,
  );

  return (
    <section
      aria-labelledby="map-evidence-coverage"
      className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5"
    >
      <h2 id="map-evidence-coverage" className="text-xl font-semibold">
        Map evidence coverage
      </h2>
      <p className="mt-2 max-w-4xl text-sm leading-6 text-[var(--muted)]">
        Compare the existing Bike mappings by exact race type and distance. Each
        cell shows mapped gate entries / required entries, followed by entries
        backed by the plan&apos;s accepted evidence. Repeated starts are counted
        as entries, not independent historical samples. Coverage is not
        competitive strength, standings or a win probability.
      </p>
      {maps.length === 0 ? (
        <p className="mt-4 text-sm">No accepted map mappings available.</p>
      ) : (
        <div
          aria-label="Map coverage by race type and exact distance"
          role="region"
          tabIndex={0}
          className="mt-4 overflow-x-auto rounded-lg border border-[var(--border)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
        >
          <table className="min-w-full text-left text-sm">
            <caption className="sr-only">
              Bike mapping coverage. Dash means the segment does not occur on
              that map.
            </caption>
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="p-3" scope="col">
                  Race type · distance
                </th>
                {maps.map((map) => (
                  <th className="p-3" scope="col" key={map.mapId}>
                    <a
                      className="underline underline-offset-4"
                      href={`#mapping-${map.mapId}`}
                    >
                      {map.name}
                    </a>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {segments.map((segment) => (
                <tr
                  className="border-b border-[var(--border)]"
                  key={JSON.stringify(segment)}
                >
                  <th className="p-3 font-medium" scope="row">
                    {segment.raceType} ·{" "}
                    {segment.distance.toLocaleString("en-AU")} m
                  </th>
                  {maps.map((map) => {
                    const lines = map.lines.filter(
                      (line) =>
                        line.raceType === segment.raceType &&
                        line.distanceMetres === segment.distance,
                    );
                    const required = lines.reduce(
                      (sum, line) => sum + line.ourSlots,
                      0,
                    );
                    const assigned = lines.reduce(
                      (sum, line) => sum + line.coreNames.length,
                      0,
                    );
                    const backed = lines.reduce(
                      (sum, line) => sum + line.evidenceBackedCount,
                      0,
                    );
                    return (
                      <td className="p-3" key={map.mapId}>
                        {lines.length === 0 ? (
                          <span aria-label="Not on this map">—</span>
                        ) : (
                          <div
                            className={`rounded-lg border p-3 ${assigned < required || backed < assigned ? "border-[var(--warning)]/50" : "border-[var(--border)]"}`}
                          >
                            <p className="whitespace-nowrap font-semibold">
                              {assigned}/{required} mapped
                            </p>
                            <p className="mt-1 whitespace-nowrap text-xs text-[var(--muted)]">
                              {backed} evidence-backed
                            </p>
                            {assigned < required ? (
                              <p className="mt-1 text-xs text-[var(--warning)]">
                                Unfilled gates
                              </p>
                            ) : null}
                            {backed < assigned ? (
                              <p className="mt-1 text-xs text-[var(--warning)]">
                                Evidence gap
                              </p>
                            ) : null}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
