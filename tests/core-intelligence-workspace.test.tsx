import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CoreIntelligenceWorkspace } from "@/components/core-intelligence-workspace";
import { buildCorePerformanceProfiles } from "@/domain/core-performance";
import { refreshStarProfiles } from "@/domain/star-signals";

describe("Core Intelligence historical workspace", () => {
  it("renders an honest empty state without fabricated performance", () => {
    const html = renderToStaticMarkup(
      <CoreIntelligenceWorkspace lastImportedAt={null} profiles={[]} />,
    );

    expect(html).toContain("No validated performance profiles");
    expect(html).toContain("Last imported Not available");
    expect(html).toContain("Missing data is not treated as zero performance");
    expect(html).not.toContain("0.000 s");
    expect(html).not.toContain("0.000 m/s");
  });

  it("renders exact-distance evidence with star denominators and freshness", () => {
    const eventAt = "2026-07-20T00:00:00Z";
    const stars = refreshStarProfiles([
      {
        eventId: "synthetic-star-event",
        eventAt,
        mode: "bike",
        distance: 1_000,
        gateCount: 6,
        entries: [
          {
            coreId: "synthetic-core",
            goldStar: true,
            blueStar: false,
            starDataStatus: "complete",
          },
          {
            coreId: "synthetic-opponent",
            goldStar: false,
            blueStar: true,
            starDataStatus: "complete",
          },
        ],
      },
    ]).profiles;

    const profiles = buildCorePerformanceProfiles(
      [
        {
          eventId: "synthetic-performance-event",
          eventAt,
          coreId: "synthetic-core",
          mode: "bike",
          distance: 1_000,
          elapsedTimeMilliseconds: 50_000,
        },
      ],
      stars,
      new Date("2026-07-23T00:00:00Z"),
    );

    const html = renderToStaticMarkup(
      <CoreIntelligenceWorkspace
        lastImportedAt="2026-07-20T01:00:00Z"
        profiles={profiles}
      />,
    );

    expect(html).toContain("bike · 1,000 m");
    expect(html).toContain("Core synthetic-core");
    expect(html).toContain("Hypothesis Only");
    expect(html).toContain("50.000 s");
    expect(html).toContain("20.000 m/s");
    expect(html).toContain("Gold received / opportunities");
    expect(html).toContain("Blue received / opportunities");
    expect(html).toContain("1 / 1");
    expect(html).toContain("0 / 1");
    expect(html).toContain("Gold-eligible races");
    expect(html).toContain("Historical snapshot");
    expect(html).toContain("Experimental");
  });
});
