import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CorePerformanceComparison } from "@/components/core-performance-comparison";
import {
  buildCorePerformanceProfiles,
  type CorePerformanceProfile,
} from "@/domain/core-performance";
import { refreshStarProfiles } from "@/domain/star-signals";
import {
  corePerformanceComparisonRows,
  visibleCoreComparisonRows,
} from "@/lib/core-performance-comparison";

function first<T>(items: readonly T[]): T {
  const item = items[0];
  if (item === undefined) throw new Error("Fixture requires one record");
  return item;
}

const eventAt = "2026-10-01T00:00:00Z";
function profile(
  coreId: string,
  mode: CorePerformanceProfile["mode"],
  distance: number,
  count: number,
  time: number,
) {
  return first(
    buildCorePerformanceProfiles(
      Array.from({ length: count }, (_, index) => ({
        coreId,
        mode,
        distance,
        eventId: `fixture-${coreId}-${index}`,
        eventAt,
        elapsedTimeMilliseconds: time + index,
      })),
      [],
      new Date("2026-10-17T00:00:00Z"),
    ),
  );
}

describe("accepted Core comparison presentation", () => {
  const profiles = [
    profile("slower", "bike", 1000, 10, 60000),
    profile("faster", "bike", 1000, 9, 50000),
    profile("longer", "bike", 1100, 2, 30000),
    profile("other-mode", "car", 1000, 12, 20000),
    profile("horse", "horse", 900, 1, 10000),
  ];
  it("sorts only within fixed mode/exact-distance groups without mutating evidence", () => {
    const before = JSON.stringify(profiles);
    const rows = corePerformanceComparisonRows(profiles);
    expect(
      visibleCoreComparisonRows(rows, { sort: "median" }).map(
        (row) => row.coreId,
      ),
    ).toEqual(["faster", "slower", "longer", "other-mode", "horse"]);
    expect(
      visibleCoreComparisonRows(rows, { sort: "sample" }).map(
        (row) => row.coreId,
      ),
    ).toEqual(["slower", "faster", "longer", "other-mode", "horse"]);
    expect(JSON.stringify(profiles)).toBe(before);
    expect(first(rows)).not.toHaveProperty("starProfile");
    expect(first(rows).elapsedTime).toEqual(first(profiles).elapsedTime);
    expect(first(rows).speed).toEqual(first(profiles).speed);
  });
  it("uses accepted 9/10 sample status without promoting confidence", () => {
    const rows = corePerformanceComparisonRows(profiles);
    expect(
      visibleCoreComparisonRows(rows, { sample: "minimally_analytical" }).map(
        (row) => row.coreId,
      ),
    ).toEqual(["slower", "other-mode"]);
    expect(
      visibleCoreComparisonRows(rows, { sample: "hypothesis_only" }),
    ).toHaveLength(3);
    const html = renderToStaticMarkup(
      <CorePerformanceComparison rows={rows} />,
    );
    expect(html).toContain("Hypothesis only");
    expect(html).toContain("not proof of quality");
    expect(html).toContain("stale");
    expect(html).toContain("experimental");
    expect(html).toContain("Yellow: unknown");
    expect(html).toContain("Blue: unknown");
    expect(html).not.toContain("Win probability");
    expect(html).toContain('role="region"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('scope="row"');
    expect(renderToStaticMarkup(<CorePerformanceComparison rows={[]} />)).toBe(
      "",
    );
  });
  it("preserves Gold ineligibility, zero opportunities, separate cutoffs and safely encoded exact-context links", () => {
    const stars = first(
      refreshStarProfiles([
        {
          eventId: "fixture-star",
          eventAt,
          mode: "horse",
          distance: 900,
          gateCount: 2,
          entries: [
            {
              coreId: "a&b",
              goldStar: false,
              blueStar: true,
              starDataStatus: "complete",
            },
            {
              coreId: "other",
              goldStar: false,
              blueStar: false,
              starDataStatus: "complete",
            },
          ],
        },
      ]).profiles,
    );
    const accepted = {
      ...profile("a&b", "horse", 900, 1, 49000),
      starProfile: stars,
    };
    const rows = corePerformanceComparisonRows([accepted]);
    expect(first(rows).yellow).toEqual({
      received: 0,
      opportunities: 0,
      eligible: 0,
      currentThrough: stars.dataCurrentThrough,
    });
    const html = renderToStaticMarkup(
      <CorePerformanceComparison rows={rows} />,
    );
    expect(html).toContain("Yellow 0 / 0 assigned opportunities");
    expect(html).toContain("0 eligible races (gates &gt; 3)");
    expect(html).toContain("Blue 1 / 1 assigned opportunities");
    expect(html).toContain("Star cutoff");
    expect(html).toContain("Data current through");
    expect(html).toContain("49.000 s");
    expect(html).toContain("18.367 m/s");
    expect(html).toContain(
      "q=a%26b&amp;coreId=a%26b&amp;mode=horse&amp;distance=900#selected-core",
    );
  });
});
