import { describe, expect, it } from "vitest";
import {
  emptyDatasetAcceptanceState,
  planDatasetAcceptance,
  redactAcceptanceSummary,
  rollbackActiveDatasetVersion,
  type AcceptanceBatch,
  type DatasetAcceptanceState,
} from "@/domain/dataset-acceptance";

const digest = (character: string) => character.repeat(64);

function batch(overrides: Partial<AcceptanceBatch> = {}): AcceptanceBatch {
  return {
    sourceType: "race_merge",
    batchId: "batch-1",
    checksumSha256: digest("a"),
    activatedAt: "2026-07-23T00:03:00.000Z",
    importCompletedAt: "2026-07-23T00:02:00.000Z",
    dataCurrentThrough: "2026-07-22T23:00:00.000Z",
    aggregateRefreshedAt: "2026-07-23T00:04:00.000Z",
    records: [
      { naturalKey: "race-entry-1", fingerprintSha256: digest("1") },
      { naturalKey: "race-entry-2", fingerprintSha256: digest("2") },
    ],
    ...overrides,
  };
}

function accept(
  state = emptyDatasetAcceptanceState("race_merge"),
  input = batch(),
): DatasetAcceptanceState {
  return planDatasetAcceptance(state, input).nextState;
}

describe("Phase 1 transactional dataset acceptance", () => {
  it("activates an immutable first version with separate freshness clocks", () => {
    const original = emptyDatasetAcceptanceState("race_merge");
    const input = batch();
    const plan = planDatasetAcceptance(original, input);

    expect(plan).toMatchObject({
      status: "accepted",
      previousActiveVersionNumber: null,
      activatedVersionNumber: 1,
      summary: {
        sourceRows: 2,
        acceptedRows: 2,
        newRecords: 2,
        changedRecords: 0,
        exactDuplicateRows: 0,
        quarantinedRows: 0,
      },
    });
    expect(plan.nextState.versions[0]).toMatchObject({
      status: "active",
      importCompletedAt: input.importCompletedAt,
      dataCurrentThrough: input.dataCurrentThrough,
      aggregateRefreshedAt: input.aggregateRefreshedAt,
    });
    expect(original).toEqual(emptyDatasetAcceptanceState("race_merge"));
  });

  it("treats an accepted checksum as an idempotent no-op", () => {
    const state = accept();
    const plan = planDatasetAcceptance(
      state,
      batch({ batchId: "different-attempt-with-same-bytes" }),
    );

    expect(plan).toMatchObject({
      status: "idempotent",
      activatedVersionNumber: null,
      summary: {
        issueCodes: ["BATCH_CHECKSUM_ALREADY_ACCEPTED"],
      },
    });
    expect(plan.nextState).toEqual(state);
  });

  it("deduplicates exact repeated rows and retains batch provenance", () => {
    const state = accept();
    const plan = planDatasetAcceptance(
      state,
      batch({
        batchId: "batch-2",
        checksumSha256: digest("b"),
        activatedAt: "2026-07-23T01:03:00.000Z",
        importCompletedAt: "2026-07-23T01:02:00.000Z",
        dataCurrentThrough: "2026-07-23T00:00:00.000Z",
        aggregateRefreshedAt: null,
      }),
    );

    expect(plan.summary).toMatchObject({
      acceptedRows: 2,
      newRecords: 0,
      exactDuplicateRows: 2,
      quarantinedRows: 0,
    });
    expect(plan.nextState.versions[1]?.records).toHaveLength(2);
    expect(
      plan.nextState.versions[1]?.records[0]?.contributingBatchIds,
    ).toEqual(["batch-1", "batch-2"]);
  });

  it("preserves cumulative history when a later file omits older rows", () => {
    const state = accept();
    const plan = planDatasetAcceptance(
      state,
      batch({
        batchId: "batch-2",
        checksumSha256: digest("b"),
        activatedAt: "2026-07-23T01:03:00.000Z",
        importCompletedAt: "2026-07-23T01:02:00.000Z",
        dataCurrentThrough: "2026-07-23T00:00:00.000Z",
        aggregateRefreshedAt: null,
        records: [
          { naturalKey: "race-entry-3", fingerprintSha256: digest("3") },
        ],
      }),
    );

    expect(
      plan.nextState.versions[1]?.records.map(({ naturalKey }) => naturalKey),
    ).toEqual(["race-entry-1", "race-entry-2", "race-entry-3"]);
  });

  it("quarantines a cross-batch conflict without overwriting accepted history", () => {
    const state = accept();
    const plan = planDatasetAcceptance(
      state,
      batch({
        batchId: "batch-2",
        checksumSha256: digest("b"),
        activatedAt: "2026-07-23T01:03:00.000Z",
        importCompletedAt: "2026-07-23T01:02:00.000Z",
        dataCurrentThrough: "2026-07-23T00:00:00.000Z",
        aggregateRefreshedAt: null,
        records: [
          { naturalKey: "race-entry-1", fingerprintSha256: digest("9") },
          { naturalKey: "race-entry-3", fingerprintSha256: digest("3") },
        ],
      }),
    );

    expect(plan.summary).toMatchObject({
      acceptedRows: 1,
      newRecords: 1,
      quarantinedRows: 1,
      issueCodes: ["FINGERPRINT_CONFLICT"],
    });
    expect(
      plan.nextState.versions[1]?.records.find(
        ({ naturalKey }) => naturalKey === "race-entry-1",
      )?.fingerprintSha256,
    ).toBe(digest("1"));
  });

  it("quarantines the batch when no row can be accepted", () => {
    const plan = planDatasetAcceptance(
      emptyDatasetAcceptanceState("race_merge"),
      batch({
        records: [
          { naturalKey: "private-key", fingerprintSha256: digest("1") },
          { naturalKey: "private-key", fingerprintSha256: digest("2") },
        ],
      }),
    );

    expect(plan.summary).toMatchObject({
      status: "quarantined",
      acceptedRows: 0,
      newRecords: 0,
      quarantinedRows: 2,
      issueCodes: ["INTRA_BATCH_FINGERPRINT_CONFLICT", "NO_ACCEPTABLE_ROWS"],
    });
    expect(plan.activatedVersionNumber).toBeNull();
    expect(plan.nextState.versions).toEqual([]);
  });

  it("quarantines freshness regression without publishing a next state", () => {
    const state = accept();
    const snapshot = structuredClone(state);

    const plan = planDatasetAcceptance(
      state,
      batch({
        batchId: "stale-batch",
        checksumSha256: digest("b"),
        dataCurrentThrough: "2026-07-22T22:59:59.000Z",
      }),
    );

    expect(plan).toMatchObject({
      status: "quarantined",
      activatedVersionNumber: null,
      summary: { issueCodes: ["STALE_DATA_CURRENT_THROUGH"] },
    });
    expect(plan.nextState).toEqual(state);
    expect(state).toEqual(snapshot);
  });

  it("carries forward known current-through when a cumulative batch omits it", () => {
    const state = accept();
    const plan = planDatasetAcceptance(
      state,
      batch({
        batchId: "batch-2",
        checksumSha256: digest("b"),
        activatedAt: "2026-07-23T01:03:00.000Z",
        importCompletedAt: "2026-07-23T01:02:00.000Z",
        dataCurrentThrough: null,
        aggregateRefreshedAt: null,
        records: [],
      }),
    );

    expect(plan.nextState.versions[1]?.dataCurrentThrough).toBe(
      "2026-07-22T23:00:00.000Z",
    );
  });

  it("rolls back the active version and restores the prior record snapshot", () => {
    const versionOne = accept();
    const versionTwo = accept(
      versionOne,
      batch({
        batchId: "batch-2",
        checksumSha256: digest("b"),
        activatedAt: "2026-07-23T01:03:00.000Z",
        importCompletedAt: "2026-07-23T01:02:00.000Z",
        dataCurrentThrough: "2026-07-23T00:00:00.000Z",
        aggregateRefreshedAt: null,
        records: [
          { naturalKey: "race-entry-3", fingerprintSha256: digest("3") },
        ],
      }),
    );
    const rolledBack = rollbackActiveDatasetVersion(versionTwo, {
      versionNumber: 2,
      rolledBackAt: "2026-07-23T01:10:00.000Z",
      reason: "synthetic verification rollback",
    });

    expect(rolledBack.activeVersionNumber).toBe(1);
    expect(rolledBack.versions.map(({ status }) => status)).toEqual([
      "active",
      "rolled_back",
    ]);
    expect(rolledBack.versions[0]?.records).toHaveLength(2);
    expect(versionTwo.versions.map(({ status }) => status)).toEqual([
      "inactive",
      "active",
    ]);
  });

  it("replaces an active snapshot while retaining historical versions", () => {
    const state = emptyDatasetAcceptanceState("current_arena");
    const versionOne = planDatasetAcceptance(
      state,
      batch({
        sourceType: "current_arena",
        records: [
          { naturalKey: "listing-1", fingerprintSha256: digest("4") },
          { naturalKey: "listing-2", fingerprintSha256: digest("5") },
        ],
      }),
    ).nextState;
    const plan = planDatasetAcceptance(
      versionOne,
      batch({
        sourceType: "current_arena",
        batchId: "arena-batch-2",
        checksumSha256: digest("b"),
        activatedAt: "2026-07-23T01:03:00.000Z",
        importCompletedAt: "2026-07-23T01:02:00.000Z",
        dataCurrentThrough: "2026-07-23T00:00:00.000Z",
        aggregateRefreshedAt: null,
        records: [{ naturalKey: "listing-1", fingerprintSha256: digest("6") }],
      }),
    );

    expect(plan.nextState).toMatchObject({
      sourceType: "current_arena",
      activeVersionNumber: 2,
    });
    expect(plan.summary).toMatchObject({ newRecords: 0, changedRecords: 1 });
    expect(plan.nextState.versions[0]?.records).toHaveLength(2);
    expect(plan.nextState.versions[1]?.records).toEqual([
      expect.objectContaining({
        naturalKey: "listing-1",
        fingerprintSha256: digest("6"),
      }),
    ]);
  });

  it("returns a count-only routine summary without record identities", () => {
    const privateKey = "owner-private-record-key";
    const privateFingerprint = digest("7");
    const plan = planDatasetAcceptance(
      emptyDatasetAcceptanceState("race_merge"),
      batch({
        records: [
          { naturalKey: privateKey, fingerprintSha256: privateFingerprint },
        ],
      }),
    );
    const serialized = JSON.stringify(redactAcceptanceSummary(plan));

    expect(serialized).not.toContain(privateKey);
    expect(serialized).not.toContain(privateFingerprint);
    expect(redactAcceptanceSummary(plan)).toMatchObject({
      status: "accepted",
      sourceRows: 1,
      acceptedRows: 1,
      newRecords: 1,
      changedRecords: 0,
    });
  });
});
