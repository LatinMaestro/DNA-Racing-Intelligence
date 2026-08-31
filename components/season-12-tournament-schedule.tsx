import {
  season12OfficialSchedule,
  season12OfficialScheduleAuthority,
  type Season12DistanceAuthority,
  type Season12Eligibility,
} from "@/domain/season-12-official-schedule";

function scheduleDate(value: string): string {
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function distances(value: Season12DistanceAuthority): string {
  if (value.kind === "all") return "All distances";
  if (value.kind === "unspecified") return "Not specified";
  return value.metres
    .map((distance) => `${distance.toLocaleString("en-AU")} m`)
    .join(" · ");
}

function eligibility(value: Season12Eligibility): string {
  if (value === "all") return "All";
  if (value === "spliced") return "Spliced";
  return "Not specified";
}

export function Season12TournamentSchedule() {
  return (
    <section aria-labelledby="season-12-schedule">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[var(--accent)]">
            Official owner-supplied calendar
          </p>
          <h2 className="mt-2 text-xl font-semibold" id="season-12-schedule">
            Season 12 schedule
          </h2>
        </div>
        <span className="rounded-full border border-[var(--border)] px-3 py-1 text-xs font-semibold text-[var(--muted)]">
          {season12OfficialScheduleAuthority.year}
        </span>
      </div>
      <p className="mt-3 max-w-4xl text-sm leading-6 text-[var(--muted)]">
        Dates, modes, distances and eligibility are transcribed from the
        official schedule. “Not specified” preserves fields the image did not
        specify; it is not a negative eligibility decision. Complete tournament
        rules still require their own accepted configuration.
      </p>

      <div className="mt-5 overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)]">
        <table className="min-w-full divide-y divide-[var(--border)] text-left text-sm">
          <thead className="bg-[var(--surface)] text-xs tracking-wide text-[var(--muted)] uppercase">
            <tr>
              <th className="px-4 py-3 font-semibold" scope="col">
                Date
              </th>
              <th className="px-4 py-3 font-semibold" scope="col">
                Event
              </th>
              <th className="px-4 py-3 font-semibold" scope="col">
                Mode
              </th>
              <th className="px-4 py-3 font-semibold" scope="col">
                Distances
              </th>
              <th className="px-4 py-3 font-semibold" scope="col">
                Eligible
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {season12OfficialSchedule.map((entry) => (
              <tr key={entry.date}>
                <td className="whitespace-nowrap px-4 py-3 font-semibold">
                  {entry.publishedDay} {scheduleDate(entry.date)}
                </td>
                <td className="whitespace-nowrap px-4 py-3">{entry.event}</td>
                <td className="whitespace-nowrap px-4 py-3 capitalize">
                  {entry.mode ?? "Not specified"}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  {distances(entry.distances)}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  {eligibility(entry.eligibility)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
