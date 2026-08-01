import { describe, expect, it } from "vitest";
import {
  buildDataUpdatePreview,
  type StagedUpdateFile,
} from "@/domain/data-update-preview";

function staged(
  uploadId: string,
  overrides: Partial<StagedUpdateFile> = {},
): StagedUpdateFile {
  const checksumDigit = [...uploadId]
    .reduce((total, character) => total + character.charCodeAt(0), 0)
    .toString(16)
    .slice(-1);
  return {
    uploadId,
    sourceType: "race_merge",
    checksumSha256: checksumDigit.repeat(64),
    schemaVersion: "race-merge/v1",
    schemaSupported: true,
    sourceRows: 10,
    acceptedRows: 8,
    exactReplayRows: 1,
    exactDuplicateRows: 1,
    conflictingRows: 0,
    malformedRows: 0,
    warningRows: 2,
    minimumEventAt: "2026-07-01T00:00:00.000Z",
    maximumEventAt: "2026-07-02T00:00:00.000Z",
    ...overrides,
  };
}

describe("private data-update preview", () => {
  it("orders grouped Race Merge additions by event coverage", () => {
    const preview = buildDataUpdatePreview([
      staged("later", {
        minimumEventAt: "2026-07-03T00:00:00.000Z",
        maximumEventAt: "2026-07-04T00:00:00.000Z",
      }),
      staged("earlier"),
    ]);

    expect(preview.sources).toEqual([
      expect.objectContaining({
        sourceType: "race_merge",
        treatment: "append_history",
        orderedUploadIds: ["earlier", "later"],
        acceptedRows: 16,
        ignoredReplayRows: 2,
        ignoredDuplicateRows: 2,
        minimumEventAt: "2026-07-01T00:00:00.000Z",
        maximumEventAt: "2026-07-04T00:00:00.000Z",
        readiness: "ready",
      }),
    ]);
    expect(preview.confirmation).toEqual({
      allowed: true,
      requiresExplicitOwnerConfirmation: true,
      startsBackgroundProcessing: true,
    });
  });

  it("assigns durable-ID upsert and replacement-snapshot treatments", () => {
    const preview = buildDataUpdatePreview([
      staged("core", {
        sourceType: "core_details",
        schemaVersion: "core-details/v1",
        sourceRows: 3,
        acceptedRows: 3,
        exactReplayRows: 0,
        exactDuplicateRows: 0,
        warningRows: 0,
        minimumEventAt: null,
        maximumEventAt: null,
      }),
      staged("vault", {
        sourceType: "current_vault",
        schemaVersion: "current-vault/v1",
        sourceRows: 2,
        acceptedRows: 2,
        exactReplayRows: 0,
        exactDuplicateRows: 0,
        warningRows: 0,
        minimumEventAt: null,
        maximumEventAt: null,
      }),
      staged("arena", {
        sourceType: "current_arena",
        schemaVersion: "current-arena/v1",
        sourceRows: 4,
        acceptedRows: 4,
        exactReplayRows: 0,
        exactDuplicateRows: 0,
        warningRows: 0,
        minimumEventAt: null,
        maximumEventAt: null,
      }),
    ]);

    expect(
      preview.sources.map(({ sourceType, treatment }) => ({
        sourceType,
        treatment,
      })),
    ).toEqual([
      { sourceType: "core_details", treatment: "versioned_upsert" },
      { sourceType: "current_vault", treatment: "replacement_snapshot" },
      { sourceType: "current_arena", treatment: "replacement_snapshot" },
    ]);
  });

  it("blocks conflicts, malformed rows and unsupported schemas", () => {
    const preview = buildDataUpdatePreview([
      staged("blocked", {
        schemaSupported: false,
        acceptedRows: 7,
        exactReplayRows: 0,
        exactDuplicateRows: 0,
        conflictingRows: 1,
        malformedRows: 2,
      }),
    ]);

    expect(preview.sources[0]).toMatchObject({
      readiness: "blocked",
      blockers: ["unsupported_schema", "conflicting_rows", "malformed_rows"],
    });
    expect(preview.confirmation.allowed).toBe(false);
  });

  it("blocks multiple competing snapshot candidates", () => {
    const snapshot = {
      sourceType: "current_vault" as const,
      schemaVersion: "current-vault/v1",
      sourceRows: 1,
      acceptedRows: 1,
      exactReplayRows: 0,
      exactDuplicateRows: 0,
      warningRows: 0,
      minimumEventAt: null,
      maximumEventAt: null,
    };
    const preview = buildDataUpdatePreview([
      staged("vault-a", snapshot),
      staged("vault-b", snapshot),
    ]);

    expect(preview.sources[0]).toMatchObject({
      treatment: "replacement_snapshot",
      readiness: "blocked",
      blockers: ["multiple_snapshot_candidates"],
    });
  });

  it("rejects duplicate uploads and impossible classification totals", () => {
    expect(() =>
      buildDataUpdatePreview([
        staged("same", { checksumSha256: "a".repeat(64) }),
        staged("other", { checksumSha256: "a".repeat(64) }),
      ]),
    ).toThrow("Duplicate file checksums");

    expect(() =>
      buildDataUpdatePreview([staged("bad-count", { acceptedRows: 9 })]),
    ).toThrow("classifications must equal sourceRows");
  });

  it("rejects aggregate counts that exceed the safe-integer boundary", () => {
    const maximum = Number.MAX_SAFE_INTEGER;
    const oversized = {
      sourceRows: maximum,
      acceptedRows: maximum,
      exactReplayRows: 0,
      exactDuplicateRows: 0,
      conflictingRows: 0,
      malformedRows: 0,
      warningRows: 0,
    };

    expect(() =>
      buildDataUpdatePreview([
        staged("large-a", oversized),
        staged("large-b", oversized),
      ]),
    ).toThrow("sourceRows total must be a non-negative safe integer");
  });

  it("fails closed on missing Race Merge coverage and event coverage on snapshots", () => {
    expect(() =>
      buildDataUpdatePreview([
        staged("no-coverage", {
          minimumEventAt: null,
          maximumEventAt: null,
        }),
      ]),
    ).toThrow("Race Merge coverage is required");

    expect(() =>
      buildDataUpdatePreview([
        staged("snapshot-coverage", {
          sourceType: "current_arena",
          schemaVersion: "current-arena/v1",
        }),
      ]),
    ).toThrow("Event coverage is only valid");
  });
});
