"use client";

import Link from "next/link";
import { useId, useState } from "react";
import {
  visibleCoreComparisonRows,
  type CorePerformanceComparisonRow,
  type CoreComparisonSort,
  type CoreComparisonSample,
} from "@/lib/core-performance-comparison";

const timestampFormatter = new Intl.DateTimeFormat("en-AU", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});
function Timestamp({ value }: { value: string }) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? (
    <>Unknown</>
  ) : (
    <time dateTime={value}>{timestampFormatter.format(date)} UTC</time>
  );
}
function seconds(value: number) {
  return `${(value / 1000).toFixed(3)} s`;
}

export function CorePerformanceComparison({
  rows,
}: {
  rows: readonly CorePerformanceComparisonRow[];
}) {
  const id = useId();
  const [sort, setSort] = useState<CoreComparisonSort>("core");
  const [sample, setSample] = useState<CoreComparisonSample>("all");
  const visible = visibleCoreComparisonRows(rows, { sort, sample });
  if (rows.length === 0) return null;
  return (
    <details className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <summary className="cursor-pointer py-2 font-semibold">
        Compare accepted race evidence · {rows.length} profiles
      </summary>
      <p
        className="mt-3 text-sm leading-6 text-[var(--muted)]"
        id={`${id}-help`}
      >
        Normal racing only. Rows stay grouped by mode and exact distance;
        sorting never ranks different contexts against each other. Lower time is
        faster; higher speed is faster. These are descriptive experimental
        profiles, not race-selection rankings. Format and gate counts are not
        partitioned in this view.
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-4">
        <label className="text-sm font-semibold">
          Sort within each mode and distance
          <select
            className="mt-1 block w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-3"
            value={sort}
            onChange={(event) =>
              setSort(event.target.value as CoreComparisonSort)
            }
          >
            <option value="core">Core ID</option>
            <option value="sample">Most races</option>
            <option value="median">Fastest median time</option>
          </select>
        </label>
        <label className="text-sm font-semibold">
          Sample evidence
          <select
            className="mt-1 block w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-3"
            value={sample}
            onChange={(event) =>
              setSample(event.target.value as CoreComparisonSample)
            }
          >
            <option value="all">All samples</option>
            <option value="minimally_analytical">
              10+ race minimum reached
            </option>
            <option value="hypothesis_only">Hypothesis only</option>
          </select>
        </label>
      </div>
      <p className="mt-3 text-sm text-[var(--muted)]" role="status">
        Showing {visible.length} of {rows.length} returned profiles. Ten races
        is a minimum analytical sample, not proof of quality.
      </p>
      {visible.length === 0 ? (
        <p className="mt-4">
          No accepted profiles match this sample filter. Missing evidence is
          unknown, not poor performance.
        </p>
      ) : (
        <div
          className="mt-4 max-w-full overflow-x-auto rounded-lg border border-[var(--border)]"
          role="region"
          aria-label="Exact-context performance comparison"
          aria-describedby={`${id}-help`}
          tabIndex={0}
        >
          <table className="w-full text-left text-sm tabular-nums">
            <caption className="sr-only">
              Accepted normal-racing profiles grouped by mode and exact distance
            </caption>
            <thead className="bg-[var(--surface-raised)]">
              <tr>
                {[
                  "Core / context",
                  "Sample",
                  "Median time",
                  "Best time",
                  "Median speed",
                  "Time spread (σ)",
                  "Star diagnostics",
                  "Evidence cutoff",
                ].map((text) => (
                  <th
                    className="p-3 align-top whitespace-nowrap"
                    scope="col"
                    key={text}
                  >
                    {text}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr
                  className="border-t border-[var(--border)]"
                  key={JSON.stringify([row.coreId, row.mode, row.distance])}
                >
                  <th
                    className="sticky left-0 bg-[var(--surface)] p-3 text-left align-top font-normal"
                    scope="row"
                  >
                    <Link
                      className="font-semibold text-[var(--accent)] underline underline-offset-4"
                      prefetch={false}
                      href={`/search-core?q=${encodeURIComponent(row.coreId)}&coreId=${encodeURIComponent(row.coreId)}&mode=${row.mode}&distance=${row.distance}#selected-core`}
                    >
                      Core {row.coreId}
                    </Link>
                    <p className="mt-1 whitespace-nowrap capitalize">
                      {row.mode} · {row.distance.toLocaleString("en-AU")} m
                    </p>
                  </th>
                  <td className="p-3 align-top">
                    <p className="font-semibold">
                      {row.raceCount} {row.raceCount === 1 ? "race" : "races"}
                    </p>
                    <p
                      className={`mt-1 text-xs ${row.sampleStatus === "hypothesis_only" ? "text-[var(--warning)]" : "text-[var(--muted)]"}`}
                    >
                      {row.sampleStatus === "hypothesis_only"
                        ? "Hypothesis only"
                        : "10+ race minimum reached"}
                    </p>
                  </td>
                  <td className="p-3 align-top whitespace-nowrap">
                    {seconds(row.elapsedTime.medianMilliseconds)}
                  </td>
                  <td className="p-3 align-top whitespace-nowrap">
                    {seconds(row.elapsedTime.bestMilliseconds)}
                  </td>
                  <td className="p-3 align-top whitespace-nowrap">
                    {row.speed.medianMetresPerSecond.toFixed(3)} m/s
                  </td>
                  <td className="p-3 align-top whitespace-nowrap">
                    {seconds(row.elapsedTime.standardDeviationMilliseconds)}
                  </td>
                  <td className="min-w-56 p-3 align-top text-xs">
                    {row.yellow === null ? (
                      <p>Yellow: unknown</p>
                    ) : (
                      <>
                        <p>
                          Yellow {row.yellow.received} /{" "}
                          {row.yellow.opportunities} assigned opportunities
                        </p>
                        <p>
                          {row.yellow.eligible} eligible races (gates &gt; 3)
                        </p>
                        <p>
                          Star cutoff{" "}
                          <Timestamp value={row.yellow.currentThrough} />
                        </p>
                      </>
                    )}
                    {row.blue === null ? (
                      <p className="mt-2">Blue: unknown</p>
                    ) : (
                      <>
                        <p className="mt-2">
                          Blue {row.blue.received} / {row.blue.opportunities}{" "}
                          assigned opportunities
                        </p>
                        <p>
                          Star cutoff{" "}
                          <Timestamp value={row.blue.currentThrough} />
                        </p>
                      </>
                    )}
                  </td>
                  <td className="min-w-48 p-3 align-top text-xs">
                    <p>
                      Data current through{" "}
                      <Timestamp value={row.dataCurrentThrough} />
                    </p>
                    <p className="mt-2 capitalize">
                      {row.freshness} · {row.analyticalStatus}
                    </p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <details className="mt-4 text-sm text-[var(--muted)]">
        <summary className="cursor-pointer py-2 font-semibold">
          How to read this evidence
        </summary>
        <p className="mt-2 leading-6">
          Time spread is the observed population standard deviation in seconds,
          not a probability or guaranteed range. Yellow is the source gold_star
          top-three signal and excludes ineligible gates from opportunities.
          Blue is the first-place signal. A zero opportunity count means no
          measurable assignment rate. Stars are field-relative diagnostics; raw
          counts do not establish opponent quality or change selection ranks.
          Missing data is not zero. Last imported is shown separately by the
          surrounding workspace.
        </p>
      </details>
    </details>
  );
}
