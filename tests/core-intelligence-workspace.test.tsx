import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CoreIntelligenceWorkspace } from "@/components/core-intelligence-workspace";
import { buildCorePerformanceProfiles } from "@/domain/core-performance";
import { refreshStarProfiles } from "@/domain/star-signals";

describe("Core Intelligence historical workspace", () => {
  it("renders an honest empty state without fabricated performance", () => {
    const html = renderToStaticMarkup(
      <CoreIntelligenceWorkspace
        connectionStatus="persistence_not_configured"
        lastImportedAt={null}
        profiles={[]}
      />,
    );

    expect(html).toContain("Core Intelligence storage not connected");
    expect(html).toContain("No commissioned Core evidence");
    expect(html).toContain("Normal last imported");
    expect(html).toContain("Esports last synced");
    expect(html).toContain("omitted Esports profile coverage");
    expect(html).not.toContain("Historical snapshot coverage boundary");
    expect(html).not.toContain("Outstanding historical backfill");
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
        connectionStatus="read_model_connected"
        lastImportedAt="2026-07-20T01:00:00Z"
        profiles={profiles}
        selectedEvidenceView="normal"
      />,
    );

    expect(html).toContain("bike · 1,000 m");
    expect(html).toContain("Core synthetic-core");
    expect(html).toContain("Hypothesis Only");
    expect(html).toContain("50.000 s");
    expect(html).toContain("20.000 m/s");
    expect(html).toContain("Yellow received / opportunities");
    expect(html).toContain("Blue received / opportunities");
    expect(html).toContain("1 / 1");
    expect(html).toContain("0 / 1");
    expect(html).toContain("Yellow-eligible races (source Gold)");
    expect(html).toContain("Normal-racing exact-distance profiles");
    expect(html).toContain("Historical snapshot · Last imported");
    expect(html).not.toContain("Historical profile read model connected");
    expect(html).not.toContain("Experimental evidence boundary");
    expect(html).not.toContain("Historical snapshot coverage boundary");
    expect(html).toContain("Experimental");
    expect(html).toContain('dateTime="2026-07-20T01:00:00Z"');
    expect(html).toContain('dateTime="2026-07-20T00:00:00Z"');
  });


  it("filters accepted normal profiles by Bike, Car, Horse and exact distance", () => {
    const eventAt = "2026-07-20T00:00:00Z";
    const profiles = buildCorePerformanceProfiles(
      [
        {
          eventId: "bike-1000",
          eventAt,
          coreId: "bike-core",
          mode: "bike",
          distance: 1_000,
          elapsedTimeMilliseconds: 50_000,
        },
        {
          eventId: "bike-1600",
          eventAt,
          coreId: "bike-core",
          mode: "bike",
          distance: 1_600,
          elapsedTimeMilliseconds: 80_000,
        },
        {
          eventId: "car-1000",
          eventAt,
          coreId: "car-core",
          mode: "car",
          distance: 1_000,
          elapsedTimeMilliseconds: 30_000,
        },
        {
          eventId: "horse-1000",
          eventAt,
          coreId: "horse-core",
          mode: "horse",
          distance: 1_000,
          elapsedTimeMilliseconds: 60_000,
        },
      ],
      [],
      new Date("2026-07-23T00:00:00Z"),
    );
    const render = (mode: "all" | "bike" | "car" | "horse", distance: number | null) =>
      renderToStaticMarkup(
        <CoreIntelligenceWorkspace
          connectionStatus="read_model_connected"
          lastImportedAt="2026-07-20T01:00:00Z"
          profiles={profiles}
          selectedEvidenceView="normal"
          selectedMode={mode}
          selectedDistance={distance}
        />,
      );

    const bike = render("bike", 1_000);
    expect(bike).toContain("bike · 1,000 m");
    expect(bike).not.toContain("bike · 1,600 m");
    expect(bike).not.toContain("car · 1,000 m");
    expect(bike).not.toContain("horse · 1,000 m");
    expect(bike).toContain("Showing 1 of 4 exact-mode/distance profiles");
    expect(bike).toContain('aria-label="Filter normal racing profiles"');
    expect(bike).toContain('name="mode"');
    expect(bike).toContain('name="distance"');
    expect(bike).toContain('value="normal"');
    expect(bike).toContain("Historical snapshot · Last imported");

    const horse = render("horse", 1_000);
    expect(horse).toContain("horse · 1,000 m");
    expect(horse).not.toContain("bike · 1,000 m");

    const missing = render("horse", 1_600);
    expect(missing).toContain("No matching normal-racing profiles");
    expect(missing).not.toContain("No validated normal-racing profiles");

    const all = render("all", null);
    expect(all).toContain("Showing 4 of 4 exact-mode/distance profiles");
    expect(all).toContain("car · 1,000 m");
    expect(all).toContain("bike · 1,600 m");
  });

  it("renders a dedicated Esports tab without interpreting omitted DNA coverage as zero", () => {
    const html = renderToStaticMarkup(
      <CoreIntelligenceWorkspace
        connectionStatus="read_model_connected"
        esportsConnectionStatus="not_configured"
        esportsLastSyncedAt={null}
        esportsProfiles={[]}
        lastImportedAt="2026-07-20T01:00:00Z"
        profiles={[]}
        selectedEvidenceView="esports"
      />,
    );

    expect(html).toContain("Esports exact-format profiles");
    expect(html).toContain("Esports history not commissioned yet");
    expect(html).toContain("DNA omits Pro League/Esports races");
    expect(html).toContain("never a zero-race claim");
    expect(html).toContain("evidence=esports");
  });
});
