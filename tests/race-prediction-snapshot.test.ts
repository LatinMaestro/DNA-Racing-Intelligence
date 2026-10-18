import { describe, expect, it } from "vitest";

import {
  freezeRacePredictionSnapshot,
  type FreezeRacePredictionSnapshotInput,
} from "../domain/race-prediction-snapshot";

function input(
  overrides: Partial<FreezeRacePredictionSnapshotInput> = {},
): FreezeRacePredictionSnapshotInput {
  return {
    snapshotId: "prediction-event-101-v1",
    eventId: "event-101",
    predictedAt: "2026-10-17T04:59:00Z",
    eventStartsAt: "2026-10-17T05:00:00Z",
    evidenceCutoff: "2026-10-17T04:58:00Z",
    modelVersion: "empirical-pairwise-v1",
    context: {
      mode: "bike",
      distanceMeters: 1_000,
      competition: "normal",
      format: "1v1",
      gateCount: 2,
      element: { status: "known", value: "Fire" },
    },
    field: {
      fieldVersion: "field-event-101-v3",
      fieldCapturedAt: "2026-10-17T04:57:00Z",
      enteredCoreIds: ["core-a", "core-b"],
    },
    sources: {
      sessionVersion: "session-v3",
      eligibilityVersion: "eligibility-v2",
      raceImportVersion: "race-import-generation-12",
      vaultSnapshotVersion: "vault-v4",
      historicalAggregateVersion: "aggregate-generation-7",
      historyGenerationVersion: "history-generation-5",
      historySourceIdentitySha256: "a".repeat(64),
      lockVersion: "lock-version-3",
    },
    predictions: [
      {
        coreId: "core-a",
        target: "win",
        status: "available",
        probabilityMillionths: 600_000,
        evidenceStatus: "complete",
        calculationId: "pairwise-event-101-core-a-v1",
      },
      {
        coreId: "core-a",
        target: "place",
        status: "unavailable",
        probabilityMillionths: null,
        evidenceStatus: "insufficient",
        calculationId: null,
      },
      {
        coreId: "core-a",
        target: "yellow_star",
        status: "not_applicable",
        probabilityMillionths: null,
        evidenceStatus: "not_applicable",
        calculationId: null,
      },
    ],
    ...overrides,
  };
}

describe("frozen race prediction snapshot", () => {
  it("binds the complete pre-event field, model, sources and explicit target states", () => {
    expect(freezeRacePredictionSnapshot(input())).toMatchObject({
      snapshotId: "prediction-event-101-v1",
      eventId: "event-101",
      predictedAt: "2026-10-17T04:59:00.000Z",
      evidenceCutoff: "2026-10-17T04:58:00.000Z",
      modelVersion: "empirical-pairwise-v1",
      field: {
        fieldVersion: "field-event-101-v3",
        enteredCoreIds: ["core-a", "core-b"],
      },
      sources: {
        sessionVersion: "session-v3",
        eligibilityVersion: "eligibility-v2",
        raceImportVersion: "race-import-generation-12",
        vaultSnapshotVersion: "vault-v4",
        historicalAggregateVersion: "aggregate-generation-7",
        historyGenerationVersion: "history-generation-5",
        historySourceIdentitySha256: "a".repeat(64),
        lockVersion: "lock-version-3",
      },
      frozen: true,
      predictionMutationAllowed: false,
      sameEventEvidenceIncluded: false,
      observedOutcomeIncluded: false,
      fairExOddsIncluded: false,
      reconciliationStatus: "pending",
    });
  });

  it("rejects same-event timing leakage and post-start forecasts", () => {
    expect(() =>
      freezeRacePredictionSnapshot(
        input({ evidenceCutoff: "2026-10-17T04:59:01Z" }),
      ),
    ).toThrow("Evidence cutoff cannot follow prediction time");
    expect(() =>
      freezeRacePredictionSnapshot(
        input({ predictedAt: "2026-10-17T05:00:00Z" }),
      ),
    ).toThrow("must be frozen before the event starts");
  });

  it("requires an immutable accepted history source identity", () => {
    expect(() =>
      freezeRacePredictionSnapshot(
        input({
          sources: {
            ...input().sources,
            historySourceIdentitySha256: "invalid",
          },
        }),
      ),
    ).toThrow("lowercase SHA-256 digest");
  });

  it("requires a complete unique field captured before prediction", () => {
    expect(() =>
      freezeRacePredictionSnapshot(
        input({
          field: { ...input().field, enteredCoreIds: ["core-a"] },
        }),
      ),
    ).toThrow("complete entered field");
    expect(() =>
      freezeRacePredictionSnapshot(
        input({
          field: {
            ...input().field,
            enteredCoreIds: ["core-a", "core-a"],
          },
        }),
      ),
    ).toThrow("must be unique");
    expect(() =>
      freezeRacePredictionSnapshot(
        input({
          field: {
            ...input().field,
            fieldCapturedAt: "2026-10-17T04:59:01Z",
          },
        }),
      ),
    ).toThrow("Field capture cannot follow prediction time");
  });

  it("keeps missing targets unavailable and validates probability provenance", () => {
    expect(() =>
      freezeRacePredictionSnapshot(
        input({
          predictions: [
            {
              ...input().predictions[0]!,
              status: "unavailable",
              probabilityMillionths: 600_000,
              calculationId: null,
            },
          ],
        }),
      ),
    ).toThrow("Only available predictions may carry");
    expect(() =>
      freezeRacePredictionSnapshot(
        input({
          predictions: [
            {
              ...input().predictions[0]!,
              calculationId: null,
            },
          ],
        }),
      ),
    ).toThrow("Only available predictions may bind");
  });

  it("rejects duplicate targets, non-field Cores and post-prediction evidence", () => {
    expect(() =>
      freezeRacePredictionSnapshot(
        input({
          predictions: [input().predictions[0]!, input().predictions[0]!],
        }),
      ),
    ).toThrow("may appear only once");
    expect(() =>
      freezeRacePredictionSnapshot(
        input({
          predictions: [
            { ...input().predictions[0]!, coreId: "core-not-in-field" },
          ],
        }),
      ),
    ).toThrow("must belong to the frozen field");
    expect(() =>
      freezeRacePredictionSnapshot({
        ...input(),
        observedWinnerCoreId: "core-a",
      } as FreezeRacePredictionSnapshotInput),
    ).toThrow("cannot contain outcomes");
  });

  it("does not permit a Yellow-star forecast at three gates or fewer", () => {
    expect(() =>
      freezeRacePredictionSnapshot(
        input({
          predictions: [
            {
              coreId: "core-a",
              target: "yellow_star",
              status: "available",
              probabilityMillionths: 500_000,
              evidenceStatus: "complete",
              calculationId: "yellow-core-a-v1",
            },
          ],
        }),
      ),
    ).toThrow("not applicable at three gates or fewer");
  });
});
