import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  DNA_OPEN_LAB_P5_FIRST_BACKFILL_MEASUREMENT_INVOCATION_AUTHORITY,
  invokeDnaOpenLabP5FirstBackfillMeasurement,
} from "@/lib/dna-open-lab-p5-first-backfill-measurement-invocation";
import type { DnaOpenLabP5FirstBackfillMeasurementInput } from "@/lib/dna-open-lab-p5-first-backfill-measurement";

const codeHeadSha = "a".repeat(40);
const privateRecoveryRef = "private-recovery-run-do-not-emit";
const privatePriceRef = "private-price-authority-do-not-emit";
const privateFamilyRefs = [
  "private-finished-ref-do-not-emit",
  "private-race-activity-ref-do-not-emit",
  "private-token-ref-do-not-emit",
  "private-vault-ref-do-not-emit",
  "private-core-ref-do-not-emit",
  "private-arena-ref-do-not-emit",
] as const;

const measurement = (): DnaOpenLabP5FirstBackfillMeasurementInput => ({
  exactMainCommit: codeHeadSha,
  acquisitionPlanChecksum: "b".repeat(64),
  measuredAt: "2026-09-01T04:00:00.000Z",
  authorityCutoffAt: "2026-09-01T03:59:59.999Z",
  repositoryRef: "refs/heads/main",
  worktreeClean: true,
  executionMode: "non_persistent_complete_inventory",
  persistentOwnerDataWriteCount: 0,
  temporaryProviderResidueCount: 0,
  rawPayloadIncludedInEvidence: false,
  secretMaterialIncludedInEvidence: false,
  connectedRecoverySuite: {
    status: "passed",
    exactMainCommit: codeHeadSha,
    runRef: privateRecoveryRef,
  },
  neon: { limitBytes: 536_870_912, baselineBytes: 10_000_000 },
  pricing: {
    authorityRef: privatePriceRef,
    effectiveAt: "2026-08-07T00:00:00.000Z",
    bytesPerBillableGb: 1_000_000_000,
    storageMicroUsdPerGbMonth: 15_000,
    classAMicroUsdPerMillion: 4_500_000,
    classBMicroUsdPerMillion: 360_000,
    dnaApiCostMicroUsdUpperBound: 0,
    neonCostMicroUsdUpperBound: 0,
  },
  families: [
    ["finished_races", "available_paginated_history_at_cutoff", 100, 120],
    ["race_activity", "current_state_only", 10, 10],
    ["token_prices", "current_state_only", 3, 3],
    ["vault_identity", "bounded_recent_state_only", 25, 25],
    ["core_current_state", "current_state_only", 25, 25],
    ["splice_arena", "current_state_only", 30, 35],
  ].map(([family, authorityClass, observed, upper], index) => ({
    family:
      family as DnaOpenLabP5FirstBackfillMeasurementInput["families"][number]["family"],
    authorityClass:
      authorityClass as DnaOpenLabP5FirstBackfillMeasurementInput["families"][number]["authorityClass"],
    observedAt: "2026-09-01T03:59:59.999Z",
    terminalInventoryObserved: true,
    observedSourceRecordCount: observed as number,
    sourceRecordUpperBound: upper as number,
    observedApiRequestCount: 1,
    apiRequestUpperBound: 2,
    retainedR2BytesUpperBound: 1_000_000,
    classAOperationsUpperBound: 2,
    classBOperationsUpperBound: 4,
    neonIncrementalBytesUpperBound: 1_000_000,
    evidenceRef: privateFamilyRefs[index]!,
  })),
});

describe("DNA Open Lab P5 first-backfill measurement invocation", () => {
  it("emits one bounded aggregate-only hash-addressed record", async () => {
    const emitEvidence = vi.fn<(canonicalJson: string) => Promise<void>>(
      async () => undefined,
    );
    const evidence = await invokeDnaOpenLabP5FirstBackfillMeasurement({
      authority:
        DNA_OPEN_LAB_P5_FIRST_BACKFILL_MEASUREMENT_INVOCATION_AUTHORITY,
      expectedCodeHeadSha: codeHeadSha,
      measurement: measurement(),
      emitEvidence,
    });

    expect(evidence).toMatchObject({
      schemaVersion: 1,
      evidenceKind: "dna_open_lab_p5_first_backfill_measurement",
      exactMainCommit: codeHeadSha,
      persistentOwnerDataWriteCount: 0,
      temporaryProviderResidueCount: 0,
      ownerApprovalRecorded: false,
      firstPersistentPrivatePreviewBackfillAllowed: false,
      productionChangesAllowed: false,
    });
    expect(evidence.families).toHaveLength(6);
    expect(evidence.evidenceSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(emitEvidence).toHaveBeenCalledOnce();
    const emitted = emitEvidence.mock.calls[0]?.[0] ?? "";
    expect(Buffer.byteLength(emitted, "utf8")).toBeLessThanOrEqual(32_768);
    expect(JSON.parse(emitted)).toEqual(evidence);
    const { evidenceSha256, ...evidenceWithoutChecksum } = evidence;
    expect(evidenceSha256).toBe(
      createHash("sha256")
        .update(JSON.stringify(evidenceWithoutChecksum), "utf8")
        .digest("hex"),
    );
    for (const forbidden of [
      privateRecoveryRef,
      privatePriceRef,
      ...privateFamilyRefs,
    ]) {
      expect(emitted).not.toContain(forbidden);
    }
  });

  it("fails before emission on wrong authority, stale head or unsafe input", async () => {
    const emitEvidence = vi.fn<(canonicalJson: string) => Promise<void>>(
      async () => undefined,
    );
    await expect(
      invokeDnaOpenLabP5FirstBackfillMeasurement({
        authority:
          "wrong" as typeof DNA_OPEN_LAB_P5_FIRST_BACKFILL_MEASUREMENT_INVOCATION_AUTHORITY,
        expectedCodeHeadSha: codeHeadSha,
        measurement: measurement(),
        emitEvidence,
      }),
    ).rejects.toThrow("measurement invocation failed");
    await expect(
      invokeDnaOpenLabP5FirstBackfillMeasurement({
        authority:
          DNA_OPEN_LAB_P5_FIRST_BACKFILL_MEASUREMENT_INVOCATION_AUTHORITY,
        expectedCodeHeadSha: "c".repeat(40),
        measurement: measurement(),
        emitEvidence,
      }),
    ).rejects.toThrow("measurement invocation failed");
    await expect(
      invokeDnaOpenLabP5FirstBackfillMeasurement({
        authority:
          DNA_OPEN_LAB_P5_FIRST_BACKFILL_MEASUREMENT_INVOCATION_AUTHORITY,
        expectedCodeHeadSha: codeHeadSha,
        measurement: { ...measurement(), persistentOwnerDataWriteCount: 1 },
        emitEvidence,
      }),
    ).rejects.toThrow("measurement invocation failed");
    expect(emitEvidence).not.toHaveBeenCalled();
  });

  it("redacts emitter failures", async () => {
    const emitEvidence = vi.fn<(canonicalJson: string) => Promise<void>>(
      async () => {
        throw new Error(privateRecoveryRef);
      },
    );
    await expect(
      invokeDnaOpenLabP5FirstBackfillMeasurement({
        authority:
          DNA_OPEN_LAB_P5_FIRST_BACKFILL_MEASUREMENT_INVOCATION_AUTHORITY,
        expectedCodeHeadSha: codeHeadSha,
        measurement: measurement(),
        emitEvidence,
      }),
    ).rejects.toThrow(
      "DNA Open Lab P5 first backfill measurement invocation failed.",
    );
  });
});
