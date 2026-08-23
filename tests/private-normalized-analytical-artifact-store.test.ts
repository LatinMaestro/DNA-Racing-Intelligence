import { describe, expect, it } from "vitest";

import {
  requirePrivateNormalizedArtifactObjectId,
  validateNormalizedAnalyticalArtifactBegin,
  validateNormalizedAnalyticalArtifactEvidence,
} from "../lib/private-normalized-analytical-artifact-store";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

describe("private normalized analytical artifact contract", () => {
  it("accepts canonical bounded Race evidence", () => {
    expect(
      validateNormalizedAnalyticalArtifactEvidence({
        sourceFamily: "race_merge",
        artifactFormat: "parquet/v1",
        contentSha256: SHA_A,
        byteLength: 4096,
        sourceRowCount: 2,
        readyRowCount: 2,
        quarantinedRowCount: 0,
        warningRowCount: 1,
        naturalKeySetSha256: SHA_B,
        minimumEventAt: "2026-08-20T00:00:00.000Z",
        maximumEventAt: "2026-08-21T00:00:00.000Z",
      }),
    ).toEqual({
      sourceFamily: "race_merge",
      artifactFormat: "parquet/v1",
      contentSha256: SHA_A,
      byteLength: 4096,
      sourceRowCount: 2,
      readyRowCount: 2,
      quarantinedRowCount: 0,
      warningRowCount: 1,
      naturalKeySetSha256: SHA_B,
      minimumEventAt: "2026-08-20T00:00:00.000Z",
      maximumEventAt: "2026-08-21T00:00:00.000Z",
    });
  });

  it("requires reconciled row counts and bounded warnings", () => {
    const base = {
      sourceFamily: "core_details" as const,
      artifactFormat: "parquet/v1" as const,
      contentSha256: SHA_A,
      byteLength: 1024,
      sourceRowCount: 10,
      readyRowCount: 9,
      quarantinedRowCount: 1,
      warningRowCount: 2,
      naturalKeySetSha256: SHA_B,
      minimumEventAt: null,
      maximumEventAt: null,
    };
    expect(() =>
      validateNormalizedAnalyticalArtifactEvidence({
        ...base,
        readyRowCount: 8,
      }),
    ).toThrow("artifact row counts do not reconcile");
    expect(() =>
      validateNormalizedAnalyticalArtifactEvidence({
        ...base,
        warningRowCount: 11,
      }),
    ).toThrow("warningRowCount cannot exceed sourceRowCount");
  });

  it("keeps Race chronology explicit and non-Race bounds absent", () => {
    expect(() =>
      validateNormalizedAnalyticalArtifactEvidence({
        sourceFamily: "race_merge",
        artifactFormat: "parquet/v1",
        contentSha256: SHA_A,
        byteLength: 1024,
        sourceRowCount: 1,
        readyRowCount: 1,
        quarantinedRowCount: 0,
        warningRowCount: 0,
        naturalKeySetSha256: SHA_B,
        minimumEventAt: null,
        maximumEventAt: null,
      }),
    ).toThrow("ready Race artifact requires event-time bounds");

    expect(() =>
      validateNormalizedAnalyticalArtifactEvidence({
        sourceFamily: "current_arena",
        artifactFormat: "parquet/v1",
        contentSha256: SHA_A,
        byteLength: 1024,
        sourceRowCount: 1,
        readyRowCount: 1,
        quarantinedRowCount: 0,
        warningRowCount: 0,
        naturalKeySetSha256: SHA_B,
        minimumEventAt: "2026-08-20T00:00:00.000Z",
        maximumEventAt: "2026-08-20T00:00:00.000Z",
      }),
    ).toThrow("non-Race artifact cannot carry event-time bounds");
  });

  it("rejects public URLs as artifact object identities", () => {
    expect(
      requirePrivateNormalizedArtifactObjectId(
        "normalized/owner/abc/batch/def/part-000.parquet",
      ),
    ).toBe("normalized/owner/abc/batch/def/part-000.parquet");
    expect(() =>
      requirePrivateNormalizedArtifactObjectId(
        "https://example.invalid/public-artifact.parquet",
      ),
    ).toThrow("objectId must be a private opaque identifier");
  });

  it("validates owner, update-session and batch identity before provider work", () => {
    expect(
      validateNormalizedAnalyticalArtifactBegin({
        ownerId: "user_private_owner",
        updateSessionId: "preview-session:1",
        importBatchId: "44000000-0000-4000-8000-000000000101",
        sourceFamily: "current_arena",
        artifactFormat: "parquet/v1",
      }),
    ).toEqual({
      ownerId: "user_private_owner",
      updateSessionId: "preview-session:1",
      importBatchId: "44000000-0000-4000-8000-000000000101",
      sourceFamily: "current_arena",
      artifactFormat: "parquet/v1",
    });

    expect(() =>
      validateNormalizedAnalyticalArtifactBegin({
        ownerId: "user_private_owner",
        updateSessionId: "preview-session:1",
        importBatchId: "not-a-uuid",
        sourceFamily: "current_arena",
        artifactFormat: "parquet/v1",
      }),
    ).toThrow("importBatchId must be a UUID");
  });
});
