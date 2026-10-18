import { describe, expect, it, vi } from "vitest";

import type { ExactRaceProbabilityContext } from "@/domain/race-probability-baseline";
import type { DnaCoreRaceHistoryPublishedGeneration } from "@/lib/dna-core-race-history-generation";
import {
  dnaOpenLabRawEvidenceSha256,
  type CanonicalRaceDocumentMetadata,
  type DnaOpenLabEvidence,
} from "@/lib/dna-open-lab-v1-adapters";
import type { ActiveDnaCoreRaceHistoryGenerationRow } from "@/lib/neon-active-dna-core-race-history-generation";
import {
  createSelectedCoreOpenRaceAcceptedHistoryBoundary,
  type AcceptedHistoricalRaceContextPointer,
  type AcceptedHistoricalRaceContextSet,
} from "@/lib/selected-core-open-race-history-boundary";

const generationId = "a".repeat(64);
const observationSetSha256 = "b".repeat(64);
const contextIdentity = "c".repeat(64);
const context: ExactRaceProbabilityContext = {
  mode: "bike",
  distanceMeters: 1400,
  competition: "normal",
  format: "WTA",
  gateCount: 4,
  element: { status: "unknown", value: null },
};

const generation: DnaCoreRaceHistoryPublishedGeneration = {
  version: 1,
  generationId,
  materializedAt: "2026-10-16T00:00:00.000Z",
  cycleSetSha256: "d".repeat(64),
  observationSetSha256,
  payloadSha256: "e".repeat(64),
  inputCycleCount: 1,
  inputPageCount: 1,
  inputResultCount: 2,
  replayDuplicateCount: 0,
  raceDocumentCount: 2,
  entrantAuthorityOmissionCount: 0,
  entrantMismatchOmissionCount: 0,
  exactDistanceConfirmedCount: 2,
  acceptedPublishedCellCount: 2,
  missingFormatCount: 0,
  unsupportedFormatCount: 0,
  unpublishedCellCount: 0,
  observationCount: 2,
  state: "published",
  publishedAt: "2026-10-16T01:00:00.000Z",
};

function row(
  coreId: string,
  eventId: string,
  ordinal: number,
): ActiveDnaCoreRaceHistoryGenerationRow {
  const payload = {
    sourceType: "core_race_history_outcome" as const,
    payloadVersion: 1 as const,
    naturalKey: `core-result:${coreId}:${eventId}`,
    resultEvidenceSha256: "f".repeat(64),
    raceDocumentEvidenceSha256: "1".repeat(64),
    raceDocumentObservedAt: "2026-10-15T00:00:00.000Z",
    sourceCoreId: coreId,
    sourceRaceId: eventId,
    elapsedMilliseconds: 60_000 + ordinal,
    finishPosition: 1,
    goldStar: null,
    blueStar: null,
    starEvidenceStatus: "missing" as const,
  };
  return {
    generationId,
    ordinal,
    naturalKey: payload.naturalKey,
    rowSha256: dnaOpenLabRawEvidenceSha256(payload),
    payload,
  };
}

function document(
  eventId: string,
): DnaOpenLabEvidence<CanonicalRaceDocumentMetadata> {
  return {
    source: "dna_open_lab",
    sourceVersion: "v1",
    scope: "races",
    endpoint: "races.docs",
    entityKey: `race:${eventId}`,
    observedAt: "2026-10-15T00:00:00.000Z",
    rawEvidenceSha256: "1".repeat(64),
    canonical: {
      sourceType: "race_document",
      sourceRaceId: eventId,
      mode: "bike",
      distanceMetres: 1400,
      gateCount: 4,
      format: "WTA",
      startAt: "2026-10-14T00:00:00.000Z",
      entrantCoreIds: ["101", "102"],
    },
  };
}

function contextSet(
  change: Partial<AcceptedHistoricalRaceContextSet> = {},
): AcceptedHistoricalRaceContextSet {
  return {
    authenticatedOwnerId: "owner-1",
    historyGenerationVersion: generationId,
    observationSetSha256,
    historicalAggregateVersion: "aggregate-v5",
    evidenceCutoff: "2026-10-16T00:00:00.000Z",
    contextSourceIdentitySha256: contextIdentity,
    state: "accepted",
    requestedEventIds: ["event-1", "event-2"],
    contexts: ["event-1", "event-2"].map((eventId) => ({
      eventId,
      competition: "normal" as const,
      element: { status: "unknown" as const, value: null },
      evidenceSha256: "2".repeat(64),
    })),
    ...change,
  };
}

function harness(change: Partial<AcceptedHistoricalRaceContextSet> = {}) {
  const rows = [row("101", "event-1", 0), row("102", "event-2", 1)];
  const readActiveGeneration = vi.fn(async () => generation);
  const readActiveRows = vi.fn(async () => rows);
  const readSelectedCoreRows = vi.fn(async () => ({
    status: "ready" as const,
    rows,
  }));
  const readRaceDocuments = vi.fn(
    async (
      _ownerId: string,
      references: readonly {
        sourceRaceId: string;
        observedAt: string;
        rawEvidenceSha256: string;
      }[],
    ) => references.map(({ sourceRaceId }) => document(sourceRaceId)),
  );
  const loadAcceptedRaceContextsByOwner = vi.fn(async () => contextSet(change));
  const readAcceptedRaceContextPointerByOwner = vi.fn(
    async (): Promise<AcceptedHistoricalRaceContextPointer | null> => ({
      historyGenerationVersion: generationId,
      observationSetSha256,
      historicalAggregateVersion: "aggregate-v5",
      contextSourceIdentitySha256: contextIdentity,
    }),
  );
  const boundary = createSelectedCoreOpenRaceAcceptedHistoryBoundary({
    configuredOwnerId: "owner-1",
    maximumRaceDocuments: 20,
    repository: {
      readActiveGeneration,
      readActiveRows,
      readSelectedCoreRows,
    },
    raceAuthority: { readRaceDocuments },
    contextAuthority: {
      loadAcceptedRaceContextsByOwner,
      readAcceptedRaceContextPointerByOwner,
    },
  });
  const request = {
    historyGenerationVersion: generationId,
    historicalAggregateVersion: "aggregate-v5",
    evidenceCutoff: "2026-10-16T00:00:00.000Z",
    context,
    requestedCoreIds: ["101", "102"],
    maximumRows: 100,
  };
  return {
    boundary,
    request,
    readSelectedCoreRows,
    loadAcceptedRaceContextsByOwner,
    readAcceptedRaceContextPointerByOwner,
  };
}

describe("selected-Core accepted Open Race history boundary", () => {
  it("admits only fully classified exact-context rows and binds one source identity", async () => {
    const test = harness();
    const source = await test.boundary.loadExactContextHistoryByOwner(
      "owner-1",
      test.request,
    );
    expect(source).toMatchObject({
      authenticatedOwnerId: "owner-1",
      historyGenerationVersion: generationId,
      historicalAggregateVersion: "aggregate-v5",
      evidenceCutoff: test.request.evidenceCutoff,
      coverage: {
        state: "accepted",
        generationIntegrityVerified: true,
        exactContextVerified: true,
        completeForRequestedCores: true,
        truncated: false,
        totalMatchingRows: 2,
      },
      rows: [
        { coreId: "101", eventId: "event-1", context },
        { coreId: "102", eventId: "event-2", context },
      ],
    });
    expect(source?.sourceIdentitySha256).toMatch(/^[a-f0-9]{64}$/u);
    await expect(
      test.boundary.readAcceptedSourceIdentityByOwner("owner-1"),
    ).resolves.toBe(source?.sourceIdentitySha256);
    expect(test.loadAcceptedRaceContextsByOwner).toHaveBeenCalledWith(
      "owner-1",
      expect.objectContaining({
        requestedEventIds: ["event-1", "event-2"],
        observationSetSha256,
      }),
    );
  });

  it("filters classifications that do not match every exact context field", async () => {
    const changed = contextSet().contexts.map((value, index) =>
      index === 0 ? { ...value, competition: "esports" as const } : value,
    );
    const source = await harness({
      contexts: changed,
    }).boundary.loadExactContextHistoryByOwner("owner-1", harness().request);
    expect(source?.coverage).toMatchObject({
      state: "accepted",
      exactContextVerified: true,
      totalMatchingRows: 1,
    });
    expect(source?.rows.map(({ eventId }) => eventId)).toEqual(["event-2"]);
  });

  it("preserves explicitly accepted element-not-applicable context", async () => {
    const accepted = harness({
      contexts: contextSet().contexts.map((value) => ({
        ...value,
        element: { status: "not_applicable" as const, value: null },
      })),
    });
    const source = await accepted.boundary.loadExactContextHistoryByOwner(
      "owner-1",
      {
        ...accepted.request,
        context: {
          ...accepted.request.context,
          element: { status: "not_applicable", value: null },
        },
      },
    );
    expect(source?.coverage).toMatchObject({
      state: "accepted",
      exactContextVerified: true,
      totalMatchingRows: 2,
    });
  });

  it("preserves partial classification as incomplete instead of inventing context", async () => {
    const partial = contextSet();
    const source = await harness({
      state: "partial",
      contexts: partial.contexts.slice(0, 1),
    }).boundary.loadExactContextHistoryByOwner("owner-1", harness().request);
    expect(source?.coverage).toMatchObject({
      state: "partial",
      exactContextVerified: false,
      completeForRequestedCores: true,
    });
  });

  it("fails closed on other-owner access and context/source identity drift", async () => {
    const owner = harness();
    await expect(
      owner.boundary.loadExactContextHistoryByOwner("owner-2", owner.request),
    ).rejects.toThrow("composition is unavailable");
    expect(owner.readSelectedCoreRows).not.toHaveBeenCalled();

    const changed = harness({ historicalAggregateVersion: "aggregate-v6" });
    await expect(
      changed.boundary.loadExactContextHistoryByOwner(
        "owner-1",
        changed.request,
      ),
    ).rejects.toThrow("composition is unavailable");
  });

  it("returns null when generation or post-read classification authority is unavailable", async () => {
    const test = harness();
    await expect(
      test.boundary.loadExactContextHistoryByOwner("owner-1", {
        ...test.request,
        historyGenerationVersion: "9".repeat(64),
      }),
    ).resolves.toBeNull();

    test.readAcceptedRaceContextPointerByOwner.mockResolvedValueOnce(null);
    await expect(
      test.boundary.readAcceptedSourceIdentityByOwner("owner-1"),
    ).resolves.toBeNull();
  });
});
