import { describe, expect, it, vi } from "vitest";

import type { DnaOpenLabP5FirstBackfillLedgerState } from "@/lib/neon-dna-open-lab-p5-first-backfill-ledger";
import { loadProLeagueHistoryCoverageState } from "@/lib/pro-league-history-coverage-service";

const ownerId = "private_owner";

function complete(
  overrides: Partial<DnaOpenLabP5FirstBackfillLedgerState> = {},
): DnaOpenLabP5FirstBackfillLedgerState {
  return {
    revision: "17466",
    status: "complete",
    nextRequestOrdinal: 17_465,
    logicalRequestCount: 17_464,
    retainedR2Bytes: 874_370_990,
    omittedIdentityObservationCount: 1,
    completionSha256: "a".repeat(64),
    ...overrides,
  };
}

function repository(
  state: DnaOpenLabP5FirstBackfillLedgerState | null = complete(),
) {
  return { load: vi.fn(async () => state) };
}

describe("Pro League historical coverage service", () => {
  it("reports the exact completed private baseline without exposing its authority hash", async () => {
    const source = repository();
    const result = await loadProLeagueHistoryCoverageState({
      authenticatedOwnerId: ownerId,
      configuredOwnerId: ownerId,
      repository: source,
      now: new Date("2026-09-08T08:00:00.000Z"),
    });

    expect(source.load).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      connectionStatus: "connected",
      baselineStatus: "complete",
      dataCurrentThrough: "2026-09-02T00:11:55.961Z",
      sourceRecordUpperBound: 1_137_586,
      receiptCount: 17_464,
      finishedRaceReceiptCount: 17_369,
      retainedR2Bytes: 874_370_990,
      omittedIdentityObservationCount: 1,
      incrementalRefreshStatus: "not_connected",
      readOnly: true,
      refreshTriggered: false,
    });
    expect(result.versionFingerprint).toMatch(/^[a-f0-9]{12}$/u);
    expect(result.versionFingerprint).not.toContain("a".repeat(64));
  });

  it("reports partial checkpoint progress without claiming complete history", async () => {
    const result = await loadProLeagueHistoryCoverageState({
      authenticatedOwnerId: ownerId,
      configuredOwnerId: ownerId,
      repository: repository({
        ...complete(),
        status: "running",
        nextRequestOrdinal: 101,
        logicalRequestCount: 100,
        retainedR2Bytes: 5_000,
        omittedIdentityObservationCount: 0,
        completionSha256: null,
      }),
      now: new Date("2026-09-08T08:00:00.000Z"),
    });

    expect(result).toMatchObject({
      connectionStatus: "connected",
      baselineStatus: "in_progress",
      dataCurrentThrough: null,
      versionFingerprint: null,
      receiptCount: 100,
      finishedRaceReceiptCount: null,
      retainedR2Bytes: 5_000,
    });
  });

  it("reports a connected but not-started baseline when no ledger exists", async () => {
    await expect(
      loadProLeagueHistoryCoverageState({
        authenticatedOwnerId: ownerId,
        configuredOwnerId: ownerId,
        repository: repository(null),
      }),
    ).resolves.toMatchObject({
      connectionStatus: "connected",
      baselineStatus: "not_started",
      receiptCount: 0,
      readOnly: true,
      refreshTriggered: false,
    });
  });

  it("fails closed when completed totals drift from terminal authority", async () => {
    await expect(
      loadProLeagueHistoryCoverageState({
        authenticatedOwnerId: ownerId,
        configuredOwnerId: ownerId,
        repository: repository(complete({ logicalRequestCount: 17_463 })),
        now: new Date("2026-09-08T08:00:00.000Z"),
      }),
    ).rejects.toThrow("terminal authority");
  });

  it("denies another owner before reading persistence", async () => {
    const source = repository();
    await expect(
      loadProLeagueHistoryCoverageState({
        authenticatedOwnerId: "different_owner",
        configuredOwnerId: ownerId,
        repository: source,
      }),
    ).rejects.toThrow("access denied");
    expect(source.load).not.toHaveBeenCalled();
  });

  it("reports an unconfigured read without touching persistence", async () => {
    await expect(
      loadProLeagueHistoryCoverageState({
        authenticatedOwnerId: ownerId,
        configuredOwnerId: ownerId,
        repository: null,
      }),
    ).resolves.toMatchObject({
      connectionStatus: "persistence_not_configured",
      baselineStatus: "not_started",
      readOnly: true,
      refreshTriggered: false,
    });
  });
});
