import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SearchCoreWorkspace } from "@/components/search-core-workspace";
import { evidenceViewFilters } from "@/lib/evidence-view-filters";
import type { SearchCorePageState } from "@/lib/search-core-service";

const profile: SearchCorePageState["performanceProfiles"][number] = {
  coreId: "synthetic-a&b",
  mode: "horse",
  distance: 900,
  raceCount: 2,
  dataCurrentThrough: "2026-10-01T00:00:00.000Z",
  freshness: "stale",
  sampleStatus: "hypothesis_only",
  analyticalStatus: "experimental",
  elapsedTime: {
    bestMilliseconds: 49000,
    medianMilliseconds: 50000,
    meanMilliseconds: 50000,
    trimmedMeanMilliseconds: 50000,
    standardDeviationMilliseconds: 1000,
    interquartileRangeMilliseconds: 1000,
  },
  speed: { bestMetresPerSecond: 18.367, medianMetresPerSecond: 18 },
  starProfile: null,
};
const core: NonNullable<SearchCorePageState["selectedCore"]> = {
  sourceCoreId: profile.coreId,
  displayName: "Synthetic",
  coreClass: "Genesis",
  element: "Metal",
  fNumber: 1,
  sex: "male",
  inMyVault: false,
  meEligible: false,
  version: 0,
  updatedAt: null,
};
const state: SearchCorePageState = {
  connectionStatus: "connected",
  query: "Synthetic",
  results: [core],
  suggestions: [core],
  selectedCore: core,
  performanceStatus: "connected",
  performanceProfiles: [
    profile,
    {
      ...profile,
      mode: "bike",
      distance: 1000,
      elapsedTime: { ...profile.elapsedTime, medianMilliseconds: 77777 },
    },
  ],
  performanceLastImportedAt: "2026-10-02T00:00:00.000Z",
  performancePublication: {
    refreshId: "22222222-2222-4222-8222-222222222222",
    raceDatasetVersionId: "33333333-3333-4333-8333-333333333333",
    sourceVersionSetSha256: "b".repeat(64),
    payloadSha256: "c".repeat(64),
    profileCount: 2,
    refreshedAt: "2026-10-02T00:00:00.000Z",
    publishedAt: "2026-10-02T00:01:00.000Z",
  },
  acceptedHistoryStatus: "not_connected",
  acceptedHistoryGeneration: null,
  acceptedHistoryRows: [],
  archiveHistoryStatus: "unavailable",
  archiveHistoryVersionCount: 0,
  archiveHistoryPartitionCount: 0,
  archiveHistoryRowCount: 0,
};

describe("Core evidence navigation", () => {
  it("retains exact context, cutoff, uncertainty and archive failure independently", () => {
    const html = renderToStaticMarkup(
      <SearchCoreWorkspace
        state={state}
        filters={{ mode: "horse", distance: 900 }}
      />,
    );
    expect(html).toContain("Horse · 900 m");
    expect(html).toContain("50.000 s");
    expect(html).not.toContain("77.777 s");
    expect(html).toContain("Hypothesis only");
    expect(html).toContain("Stale");
    expect(html).toContain("Last imported");
    expect(html).toContain("Accepted race dataset");
    expect(html).toContain("33333333-3333-4333-8333-333333333333");
    expect(html).toContain("Distribution details");
    expect(html).toContain("Interquartile time range");
    expect(html).toContain("coverage is unknown, not zero");
    expect(html).toContain(
      "coreId=synthetic-a%26b&amp;mode=horse&amp;distance=900#selected-core",
    );
    expect(html).toContain('name="coreId" value="synthetic-a&amp;b"');
    expect(html).toContain('href="#core-racing"');
    expect(html).toContain('list="search-core-options"');
    expect(html).toContain('<datalist id="search-core-options">');
    expect(html).toContain(
      'label="Core ID synthetic-a&amp;b" value="Synthetic"',
    );
    expect(html).toContain('label="Synthetic" value="synthetic-a&amp;b"');
    expect(html).not.toContain("Win probability");
  });

  it("does not substitute a neighbouring distance or treat no match as poor performance", () => {
    const html = renderToStaticMarkup(
      <SearchCoreWorkspace
        state={state}
        filters={{ mode: "horse", distance: 1000 }}
      />,
    );
    expect(html).toContain("No accepted profile matches");
    expect(html).toContain("no nearby distance is substituted");
    expect(html).not.toContain("50.000 s");
    expect(html).not.toContain("77.777 s");
  });

  it("shows exact accepted API context while keeping unsupported cells unavailable", () => {
    const row = {
      generationId: "a".repeat(64),
      ordinal: 0,
      naturalKey: `core-result:${core.sourceCoreId}:bike:race-9`,
      rowSha256: "d".repeat(64),
      payload: {
        sourceType: "joined_core_race_history_result" as const,
        naturalKey: `core-result:${core.sourceCoreId}:bike:race-9`,
        resultEvidenceSha256: "e".repeat(64),
        raceDocumentEvidenceSha256: "f".repeat(64),
        raceDocumentObservedAt: "2026-09-01T00:00:00.000Z",
        sourceCoreId: core.sourceCoreId,
        sourceRaceId: "race-9",
        mode: "bike" as const,
        distanceMetres: 2_300,
        distanceAuthority: "result_and_race_document" as const,
        elapsedMilliseconds: 137_810,
        finishPosition: 4,
        eventAt: "2026-08-31T00:00:00.000Z",
        gateCount: 6,
        payoutMechanismSourceValue: null,
        sourceFormat: "normal",
        sourceRaceClass: null,
        goldStar: null,
        blueStar: null,
        starEvidenceStatus: "missing" as const,
        publishedCellStatus: "unsupported_format" as const,
        raceType: null,
        mapIds: [],
      },
    };
    const html = renderToStaticMarkup(
      <SearchCoreWorkspace
        state={{
          ...state,
          acceptedHistoryStatus: "connected",
          acceptedHistoryGeneration: {
            generationId: "a".repeat(64),
            observationSetSha256: "b".repeat(64),
            publishedAt: "2026-09-02T00:00:00.000Z",
            observationCount: 93_089,
          },
          acceptedHistoryRows: [row],
        }}
        filters={{ mode: "bike", distance: 2_300 }}
      />,
    );

    expect(html).toContain("Accepted API race history");
    expect(html).toContain("Bike");
    expect(html).toContain("2,300 m");
    expect(html).toContain("normal");
    expect(html).toContain("Unavailable: unsupported format");
    expect(html).toContain(`Row SHA-256 ${"d".repeat(64)}`);
    expect(html).not.toContain("Accepted analytical cell");
  });

  it.each([
    ["read_failed", "Core catalogue temporarily unavailable"],
    ["integrity_failed", "Core catalogue failed validation"],
  ] as const)("withholds all evidence for %s", (status, copy) => {
    const html = renderToStaticMarkup(
      <SearchCoreWorkspace
        state={{
          ...state,
          connectionStatus: status,
          results: [],
          selectedCore: null,
          performanceStatus: "not_connected",
          performanceProfiles: [],
          performanceLastImportedAt: null,
          archiveHistoryStatus: "not_connected",
          archiveHistoryVersionCount: 0,
          archiveHistoryPartitionCount: 0,
          archiveHistoryRowCount: 0,
        }}
      />,
    );

    expect(html).toContain(copy);
    expect(html).toContain("withheld");
    expect(html).not.toContain("Core racing evidence");
  });

  it("parses filters without rounding, accepting ambiguous arrays or unsafe numeric values", () => {
    expect(evidenceViewFilters({ mode: "car", distance: "1050" })).toEqual({
      mode: "car",
      distance: 1050,
    });
    for (const distance of [
      "900.1",
      "0",
      "-900",
      "9e2",
      "9007199254740992",
      ["900", "1000"],
    ]) {
      expect(
        evidenceViewFilters({ mode: ["bike", "horse"], distance }),
      ).toEqual({ mode: "all", distance: null });
    }
  });
});
