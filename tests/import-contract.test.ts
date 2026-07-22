import { describe, expect, it } from "vitest";
import {
  canonicalSourceColumn,
  manualObservationReconciliationKey,
  normalizeSha256,
  raceEconomicNaturalKey,
  raceEntryNaturalKey,
  validateImportManifest,
} from "@/domain/import-contract";

const checksum = "A".repeat(64);

describe("Phase 1 import contracts", () => {
  it("treats Bike-labelled bikeid as a Core Details legacy alias", () => {
    expect(canonicalSourceColumn("core_details", " BikeID ")).toBe("core_id");
    expect(canonicalSourceColumn("race_merge", "bikeid")).toBe("bikeid");
  });

  it("normalizes but strictly validates SHA-256 checksums", () => {
    expect(normalizeSha256(checksum)).toBe("a".repeat(64));
    expect(() => normalizeSha256("not-a-checksum")).toThrow(TypeError);
  });

  it("keeps source time coverage separate from import completion", () => {
    const manifest = validateImportManifest({
      batchId: "synthetic-batch-1",
      sourceType: "race_merge",
      sourceFilename: "synthetic-race-merge.csv",
      checksumSha256: checksum,
      uploadedAt: "2026-07-22T10:00:00Z",
      importCompletedAt: "2026-07-22T10:02:00Z",
      minimumAcceptedEventAt: "2026-07-19T00:00:00Z",
      maximumAcceptedEventAt: "2026-07-21T23:00:00Z",
      datasetCurrentThroughAfterImport: "2026-07-21T23:00:00Z",
      counts: {
        sourceRows: 10,
        acceptedRows: 9,
        rejectedRows: 1,
        warningRows: 2,
      },
      schemaVersion: "race-merge/v1",
      status: "accepted",
    });

    expect(manifest.datasetCurrentThroughAfterImport).toBe(
      "2026-07-21T23:00:00.000Z",
    );
    expect(manifest.importCompletedAt).toBe("2026-07-22T10:02:00.000Z");
  });

  it("allows non-race imports without event timestamps", () => {
    expect(
      validateImportManifest({
        batchId: "synthetic-core-batch",
        sourceType: "core_details",
        sourceFilename: "synthetic-core-details.csv",
        checksumSha256: checksum,
        uploadedAt: "2026-07-22T10:00:00Z",
        importCompletedAt: "2026-07-22T10:01:00Z",
        minimumAcceptedEventAt: null,
        maximumAcceptedEventAt: null,
        datasetCurrentThroughAfterImport: "2026-07-21T23:00:00Z",
        counts: {
          sourceRows: 2,
          acceptedRows: 2,
          rejectedRows: 0,
          warningRows: 0,
        },
        schemaVersion: "core-details/v1",
        status: "accepted",
      }),
    ).toMatchObject({
      datasetCurrentThroughAfterImport: "2026-07-21T23:00:00.000Z",
    });
  });

  it("rejects inconsistent row counts and incomplete accepted-event coverage", () => {
    expect(() =>
      validateImportManifest({
        batchId: "synthetic-batch-2",
        sourceType: "race_merge",
        sourceFilename: "synthetic.csv",
        checksumSha256: checksum,
        uploadedAt: "2026-07-22T10:00:00Z",
        importCompletedAt: null,
        minimumAcceptedEventAt: null,
        maximumAcceptedEventAt: null,
        datasetCurrentThroughAfterImport: null,
        counts: {
          sourceRows: 10,
          acceptedRows: 10,
          rejectedRows: 1,
          warningRows: 0,
        },
        schemaVersion: "race-merge/v1",
        status: "validating",
      }),
    ).toThrow(RangeError);
  });

  it("makes cumulative race and economic keys deterministic without collisions", () => {
    const first = raceEntryNaturalKey("event|12", "core:34");
    const repeated = raceEntryNaturalKey("event|12", "core:34");
    const otherCore = raceEntryNaturalKey("event|12", "core:35");

    expect(first).toBe(repeated);
    expect(first).not.toBe(otherCore);
    expect(raceEconomicNaturalKey(first, "entry_fee")).not.toBe(
      raceEconomicNaturalKey(first, "payout"),
    );
  });

  it("prefers authoritative observation matching when an event ID is known", () => {
    expect(
      manualObservationReconciliationKey({
        authoritativeEventId: "event-1",
        eventStartsAt: "2026-07-22T12:00:00Z",
        mode: "horse",
        distance: 1600,
        gateCount: 8,
        enteredCoreIds: ["core-b", "core-a"],
      }),
    ).toMatchObject({ authority: "authoritative_event_id" });
  });

  it("creates order-independent candidate keys that stay review-only", () => {
    const left = manualObservationReconciliationKey({
      eventStartsAt: "2026-07-22T12:00:00Z",
      mode: "horse",
      distance: 1600,
      gateCount: 8,
      enteredCoreIds: ["core-b", "core-a"],
    });
    const right = manualObservationReconciliationKey({
      eventStartsAt: "2026-07-22T12:00:00Z",
      mode: "horse",
      distance: 1600,
      gateCount: 8,
      enteredCoreIds: ["core-a", "core-b", "core-a"],
    });

    expect(left).toEqual(right);
    expect(left.authority).toBe("candidate_only");
  });
});
