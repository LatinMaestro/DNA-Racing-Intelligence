import { describe, expect, it } from "vitest";

import type { DnaOpenLabP5FirstBackfillFamilyObservation } from "@/lib/dna-open-lab-p5-first-backfill-family-adapter";
import {
  DNA_OPEN_LAB_P5_FIRST_BACKFILL_PROJECTION_POLICY,
  projectDnaOpenLabP5FirstBackfillFamilyUpperBounds,
} from "@/lib/dna-open-lab-p5-first-backfill-projection-policy";

function observation(
  overrides: Partial<DnaOpenLabP5FirstBackfillFamilyObservation> = {},
): DnaOpenLabP5FirstBackfillFamilyObservation {
  return {
    family: "finished_races",
    authorityClass: "available_paginated_history_at_cutoff",
    authorityCutoffAt: "2026-09-01T00:00:00.000Z",
    observedSourceRecordCount: 200,
    observedApiRequestCount: 10,
    observedResponseBytes: 100_000,
    maximumObservedResponseBytes: 10_000,
    terminalUnitCount: 10,
    splitCount: 0,
    endpointObservations: [],
    aggregateEvidenceSha256: "a".repeat(64),
    ...overrides,
  };
}

describe("DNA Open Lab P5 first-backfill projection policy", () => {
  it("projects replay-safe R2 operations and a physical compact-Neon peak", () => {
    expect(
      projectDnaOpenLabP5FirstBackfillFamilyUpperBounds(observation()),
    ).toEqual({
      sourceRecordUpperBound: 200,
      apiRequestUpperBound: 20,
      retainedR2BytesUpperBound: 263_840,
      classAOperationsUpperBound: 22,
      classBOperationsUpperBound: 60,
      neonIncrementalBytesUpperBound: 1_976_256,
    });
  });

  it("keeps empty current-state families substantive without inventing rows", () => {
    expect(
      projectDnaOpenLabP5FirstBackfillFamilyUpperBounds(
        observation({
          family: "race_activity",
          authorityClass: "current_state_only",
          observedSourceRecordCount: 0,
          observedApiRequestCount: 1,
          observedResponseBytes: 2,
          maximumObservedResponseBytes: 2,
        }),
      ),
    ).toEqual({
      sourceRecordUpperBound: 0,
      apiRequestUpperBound: 2,
      retainedR2BytesUpperBound: 16_386,
      classAOperationsUpperBound: 4,
      classBOperationsUpperBound: 6,
      neonIncrementalBytesUpperBound: 1_081_356,
    });
  });

  it("uses the source-record floor when JSON bytes would understate rows", () => {
    const projected = projectDnaOpenLabP5FirstBackfillFamilyUpperBounds(
      observation({
        observedSourceRecordCount: 1_000,
        observedApiRequestCount: 1,
        observedResponseBytes: 1,
        maximumObservedResponseBytes: 1,
      }),
    );

    expect(projected.neonIncrementalBytesUpperBound).toBe(3_129_344);
  });

  it("publishes fixed non-price authority and fails closed on unsafe input", () => {
    expect(DNA_OPEN_LAB_P5_FIRST_BACKFILL_PROJECTION_POLICY).toMatchObject({
      version: 1,
      r2StandardOnly: true,
      r2MaximumEvidenceObjectBytes: 8 * 1024 * 1024,
      apiRequestAttemptsPerLogicalRequest: 2,
      r2PutAttemptsPerLogicalRequest: 2,
      r2ClassBOperationsPerLogicalRequest: 6,
      neonPhysicalBytesPerObservedResponseByte: 6,
    });
    expect(() =>
      projectDnaOpenLabP5FirstBackfillFamilyUpperBounds(
        observation({ observedApiRequestCount: 0 }),
      ),
    ).toThrow("observedApiRequestCount must be positive");
    expect(() =>
      projectDnaOpenLabP5FirstBackfillFamilyUpperBounds(
        observation({
          observedResponseBytes: 0,
          maximumObservedResponseBytes: 0,
        }),
      ),
    ).toThrow("observedResponseBytes must be positive");
    expect(() =>
      projectDnaOpenLabP5FirstBackfillFamilyUpperBounds(
        observation({ observedResponseBytes: Number.MAX_SAFE_INTEGER }),
      ),
    ).toThrow("safe integer range");
    expect(() =>
      projectDnaOpenLabP5FirstBackfillFamilyUpperBounds(
        observation({
          observedResponseBytes: 8 * 1024 * 1024,
          maximumObservedResponseBytes: 8 * 1024 * 1024,
        }),
      ),
    ).toThrow("R2 evidence object capacity would be exceeded");
  });
});
