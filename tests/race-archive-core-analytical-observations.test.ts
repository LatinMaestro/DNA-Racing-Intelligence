import { describe, expect, it } from "vitest";

import type { RaceArchiveCoreHistory } from "../lib/race-archive-core-history-service";
import { analyticalObservationsFromRaceArchiveCoreHistory } from "../lib/race-archive-core-analytical-observations";

function history(input?: {
  sourceCoreId?: string;
  rowCoreId?: string;
  naturalKey?: string;
  elapsedTimeSourceValue?: string;
}): RaceArchiveCoreHistory {
  const sourceCoreId = input?.sourceCoreId ?? "core-7";
  const rowCoreId = input?.rowCoreId ?? sourceCoreId;
  const sourceEventId = "event-21";
  return {
    sourceCoreId,
    locatorVersionCount: 1,
    selectedPartitionCount: 1,
    rows: [
      {
        datasetVersionId: "version-1",
        importBatchId: "batch-1",
        versionNumber: 1,
        partitionNumber: 0,
        sourceRowNumber: 4,
        naturalKey: input?.naturalKey ?? `${sourceEventId}:${rowCoreId}`,
        fingerprintSha256: "a".repeat(64),
        row: {
          status: "ready",
          sourceType: "race_merge",
          provenance: [],
          issues: [],
          record: {
            sourceType: "race_merge",
            sourceEventId,
            eventAt: "2026-08-20T01:02:03.000Z",
            sourceEventDatetime: "2026-08-20T01:02:03.000Z",
            mode: "bike",
            distance: 1000,
            sourceCoreId: rowCoreId,
            coreNameSourceValue: "Core Seven",
            gate: 2,
            gateCount: 8,
            goldStar: true,
            blueStar: false,
            goldStarEligible: true,
            goldStarSourceValue: "true",
            blueStarSourceValue: "false",
            starDataStatus: "complete",
            finishPosition: 1,
            elapsedTimeSourceValue: input?.elapsedTimeSourceValue ?? "61.250",
            sourceRaceClass: "A",
            sourceFormat: "Sprint",
            feeSourceValue: "0",
            prizeSourceValue: "0",
            assetSourceValue: "DEZ",
            payoutMechanismSourceValue: "Top 3",
            raceTagsSourceValue: "Synthetic",
            raceAsset: "DEZ",
            entryFeeAmount: "0",
            grossPayoutAmount: "0",
            economicDataStatus: "validated",
          },
        },
      },
    ],
  };
}

describe("Race archive Core analytical observations", () => {
  it("extracts exact aggregate inputs without a durable race_entry row", () => {
    expect(analyticalObservationsFromRaceArchiveCoreHistory(history())).toEqual({
      sourceCoreId: "core-7",
      locatorVersionCount: 1,
      selectedPartitionCount: 1,
      observations: [
        {
          datasetVersionId: "version-1",
          importBatchId: "batch-1",
          versionNumber: 1,
          partitionNumber: 0,
          sourceRowNumber: 4,
          naturalKey: "event-21:core-7",
          fingerprintSha256: "a".repeat(64),
          sourceEventId: "event-21",
          sourceCoreId: "core-7",
          eventAt: "2026-08-20T01:02:03.000Z",
          mode: "bike",
          distance: 1000,
          gateCount: 8,
          goldStarEligible: true,
          goldStar: true,
          blueStar: false,
          starDataStatus: "complete",
          finishPosition: 1,
          elapsedMilliseconds: 61_250,
          payoutMechanismSourceValue: "Top 3",
          sourceFormat: "Sprint",
          sourceRaceClass: "A",
        },
      ],
    });
  });

  it("matches the existing integer-millisecond conversion boundary", () => {
    expect(
      analyticalObservationsFromRaceArchiveCoreHistory(
        history({ elapsedTimeSourceValue: "61.2500" }),
      ).observations[0]?.elapsedMilliseconds,
    ).toBe(61_250);
    expect(() =>
      analyticalObservationsFromRaceArchiveCoreHistory(
        history({ elapsedTimeSourceValue: "61.2501" }),
      ),
    ).toThrow(/integer milliseconds/);
  });

  it("fails closed if archive identity changes before aggregate reconstruction", () => {
    expect(() =>
      analyticalObservationsFromRaceArchiveCoreHistory(
        history({ rowCoreId: "other-core" }),
      ),
    ).toThrow(/changed Core identity/);
    expect(() =>
      analyticalObservationsFromRaceArchiveCoreHistory(
        history({ naturalKey: "wrong:key" }),
      ),
    ).toThrow(/natural key is inconsistent/);
  });
});
