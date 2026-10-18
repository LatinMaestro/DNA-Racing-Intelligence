import { describe, expect, it, vi } from "vitest";

import type { DnaCoreRaceHistoryPublishedGeneration } from "@/lib/dna-core-race-history-generation";
import {
  dnaOpenLabRawEvidenceSha256,
  type CanonicalRaceDocumentMetadata,
  type DnaOpenLabEvidence,
} from "@/lib/dna-open-lab-v1-adapters";
import type { ActiveDnaCoreRaceHistoryGenerationRow } from "@/lib/neon-active-dna-core-race-history-generation";
import { readSelectedCoreHistoryRaceSource } from "@/lib/selected-core-history-race-source";

const generationId = "a".repeat(64);
const generation: DnaCoreRaceHistoryPublishedGeneration = {
  version: 1,
  generationId,
  materializedAt: "2026-10-16T00:00:00.000Z",
  cycleSetSha256: "b".repeat(64),
  observationSetSha256: "c".repeat(64),
  payloadSha256: "d".repeat(64),
  inputCycleCount: 1,
  inputPageCount: 1,
  inputResultCount: 100,
  replayDuplicateCount: 0,
  raceDocumentCount: 100,
  entrantAuthorityOmissionCount: 0,
  entrantMismatchOmissionCount: 0,
  exactDistanceConfirmedCount: 100,
  acceptedPublishedCellCount: 100,
  missingFormatCount: 0,
  unsupportedFormatCount: 0,
  unpublishedCellCount: 0,
  observationCount: 100,
  state: "published",
  publishedAt: "2026-10-16T01:00:00.000Z",
};

function row(
  eventId = "event-1",
  coreId = "101",
): ActiveDnaCoreRaceHistoryGenerationRow {
  const payload = {
    sourceType: "core_race_history_outcome" as const,
    payloadVersion: 1 as const,
    naturalKey: `core-result:${coreId}:${eventId}`,
    resultEvidenceSha256: "e".repeat(64),
    raceDocumentEvidenceSha256: "f".repeat(64),
    raceDocumentObservedAt: "2026-10-15T00:00:00.000Z",
    sourceCoreId: coreId,
    sourceRaceId: eventId,
    elapsedMilliseconds: 60_000,
    finishPosition: 1,
    goldStar: null,
    blueStar: null,
    starEvidenceStatus: "missing" as const,
  };
  return {
    generationId,
    ordinal: 0,
    naturalKey: payload.naturalKey,
    rowSha256: dnaOpenLabRawEvidenceSha256(payload),
    payload,
  };
}

function document(
  eventId = "event-1",
  mode: "bike" | "car" | "horse" = "bike",
): DnaOpenLabEvidence<CanonicalRaceDocumentMetadata> {
  return {
    source: "dna_open_lab",
    sourceVersion: "v1",
    scope: "races",
    endpoint: "races.docs",
    entityKey: `race:${eventId}`,
    observedAt: "2026-10-15T00:00:00.000Z",
    rawEvidenceSha256: "f".repeat(64),
    canonical: {
      sourceType: "race_document",
      sourceRaceId: eventId,
      mode,
      distanceMetres: 1400,
      gateCount: 4,
      format: "WTA",
      startAt: "2026-10-14T00:00:00.000Z",
      entrantCoreIds: ["101", "102"],
    },
  };
}

function harness(rows = [row()], documents = [document()]) {
  const readActiveGeneration = vi.fn(
    async (): Promise<DnaCoreRaceHistoryPublishedGeneration | null> =>
      generation,
  );
  const readSelectedCoreRows = vi.fn(async () => ({
    status: "ready" as "ready" | "source_changed" | "truncated",
    rows,
  }));
  const readRaceDocuments = vi.fn(
    async (
      _ownerId: string,
      _references: readonly {
        sourceRaceId: string;
        observedAt: string;
        rawEvidenceSha256: string;
      }[],
    ) => {
      void _ownerId;
      void _references;
      return documents;
    },
  );
  const input = {
    authenticatedOwnerId: "owner-1",
    configuredOwnerId: "owner-1",
    selection: {
      generationId,
      observationSetSha256: generation.observationSetSha256,
      coreIds: ["101", "102"],
      maximumRows: 100,
    },
    evidenceCutoff: "2026-10-16T00:00:00.000Z",
    maximumRaceDocuments: 100,
    repository: { readActiveGeneration, readSelectedCoreRows },
    raceAuthority: { readRaceDocuments },
  };
  return {
    input,
    readActiveGeneration,
    readSelectedCoreRows,
    readRaceDocuments,
  };
}

describe("bounded selected-Core canonical Race join", () => {
  it.each(["bike", "car", "horse"] as const)(
    "retains exact observable %s facts while withholding unclassified context",
    async (mode) => {
      const test = harness([row()], [document("event-1", mode)]);
      const result = await readSelectedCoreHistoryRaceSource(test.input);
      expect(result).toMatchObject({
        status: "ready",
        generationId,
        observationSetSha256: generation.observationSetSha256,
        evidenceCutoff: test.input.evidenceCutoff,
        analyticalUseAllowed: false,
        exactContextVerified: false,
        observations: [
          {
            mode,
            coreId: "101",
            eventId: "event-1",
            elapsedTimeMilliseconds: 60_000,
            distanceMeters: 1400,
            gateCount: 4,
            format: "WTA",
            competition: "unknown",
            element: { status: "unknown", value: null },
          },
        ],
      });
      expect(test.readActiveGeneration).toHaveBeenCalledTimes(2);
    },
  );

  it("withholds missing published history before selecting rows or opening objects", async () => {
    const test = harness();
    test.readActiveGeneration.mockResolvedValueOnce(null);
    expect(await readSelectedCoreHistoryRaceSource(test.input)).toMatchObject({
      status: "source_unavailable",
      observations: [],
      generationId: null,
      analyticalUseAllowed: false,
      exactContextVerified: false,
    });
    expect(test.readSelectedCoreRows).not.toHaveBeenCalled();
    expect(test.readRaceDocuments).not.toHaveBeenCalled();
  });

  it("deduplicates one immutable Race document for two Core outcomes", async () => {
    const test = harness([row(), row("event-1", "102")]);
    const result = await readSelectedCoreHistoryRaceSource(test.input);
    expect(result.observations).toHaveLength(2);
    expect(test.readRaceDocuments.mock.calls[0]).toEqual([
      "owner-1",
      [
        {
          sourceRaceId: "event-1",
          observedAt: "2026-10-15T00:00:00.000Z",
          rawEvidenceSha256: "f".repeat(64),
        },
      ],
    ]);
  });

  it("filters equal and later events out of pre-cutoff observations", async () => {
    for (const startAt of [
      "2026-10-16T00:00:00.000Z",
      "2026-10-17T00:00:00.000Z",
    ]) {
      const doc = document();
      const test = harness(
        [row()],
        [{ ...doc, canonical: { ...doc.canonical, startAt } }],
      );
      expect(
        (await readSelectedCoreHistoryRaceSource(test.input)).observations,
      ).toEqual([]);
    }
  });

  it("denies other owners before reading either store", async () => {
    const test = harness();
    await expect(
      readSelectedCoreHistoryRaceSource({
        ...test.input,
        authenticatedOwnerId: "other-owner",
      }),
    ).rejects.toThrow("evidence is unavailable");
    expect(test.readActiveGeneration).not.toHaveBeenCalled();
    expect(test.readRaceDocuments).not.toHaveBeenCalled();
  });

  it.each([0, 10001, 1.5])(
    "rejects invalid document budget %s before IO",
    async (maximumRaceDocuments) => {
      const test = harness();
      await expect(
        readSelectedCoreHistoryRaceSource({
          ...test.input,
          maximumRaceDocuments,
        }),
      ).rejects.toThrow();
      expect(test.readActiveGeneration).not.toHaveBeenCalled();
    },
  );

  it("checks the unique document budget before private object reads", async () => {
    const test = harness([row(), row("event-2")]);
    expect(
      await readSelectedCoreHistoryRaceSource({
        ...test.input,
        maximumRaceDocuments: 1,
      }),
    ).toMatchObject({ status: "document_budget_exceeded", observations: [] });
    expect(test.readRaceDocuments).not.toHaveBeenCalled();
  });

  it.each(["truncated", "source_changed"] as const)(
    "does not read Race documents after %s result evidence",
    async (status) => {
      const test = harness();
      test.readSelectedCoreRows.mockResolvedValueOnce({ status, rows: [] });
      expect(await readSelectedCoreHistoryRaceSource(test.input)).toMatchObject(
        { status, observations: [] },
      );
      expect(test.readRaceDocuments).not.toHaveBeenCalled();
    },
  );

  it("withholds all observations if the generation changes during document retrieval", async () => {
    const test = harness();
    test.readActiveGeneration
      .mockResolvedValueOnce(generation)
      .mockResolvedValueOnce({
        ...generation,
        observationSetSha256: "e".repeat(64),
      });
    expect(await readSelectedCoreHistoryRaceSource(test.input)).toMatchObject({
      status: "source_changed",
      observations: [],
    });
  });

  it.each(["hash", "time", "identity", "missing", "duplicate"] as const)(
    "rejects %s document evidence without partial output",
    async (change) => {
      const doc = document();
      const docs =
        change === "missing"
          ? []
          : change === "duplicate"
            ? [doc, doc]
            : [
                change === "hash"
                  ? { ...doc, rawEvidenceSha256: "e".repeat(64) }
                  : change === "time"
                    ? { ...doc, observedAt: "2026-10-14T00:00:00.000Z" }
                    : {
                        ...doc,
                        canonical: {
                          ...doc.canonical,
                          sourceRaceId: "other-event",
                        },
                      },
              ];
      await expect(
        readSelectedCoreHistoryRaceSource(harness([row()], docs).input),
      ).rejects.toThrow("evidence is unavailable");
    },
  );

  it.each([
    "membership",
    "distance",
    "mode",
    "gates",
    "format",
    "timestamp",
  ] as const)(
    "withholds malformed %s instead of inventing context",
    async (change) => {
      const doc = document();
      let canonical: CanonicalRaceDocumentMetadata = {
        ...doc.canonical,
        ...(change === "membership" ? { entrantCoreIds: ["unrelated"] } : {}),
        ...(change === "distance" ? { distanceMetres: 0 } : {}),
        ...(change === "gates" ? { gateCount: 0 } : {}),
        ...(change === "format" ? { format: null } : {}),
        ...(change === "timestamp" ? { startAt: null } : {}),
      };
      if (change === "mode") {
        const { mode, ...remaining } = canonical;
        void mode;
        canonical = remaining;
      }
      await expect(
        readSelectedCoreHistoryRaceSource(
          harness([row()], [{ ...doc, canonical }]).input,
        ),
      ).rejects.toThrow("evidence is unavailable");
    },
  );

  it("reads more than one batch sequentially with at most twenty references", async () => {
    const rows = Array.from({ length: 21 }, (_, index) => ({
      ...row(`event-${index}`),
      ordinal: index,
    }));
    const test = harness(rows);
    let active = 0;
    let maximumActive = 0;
    test.readRaceDocuments.mockImplementation(async (_owner, references) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
      return references.map(({ sourceRaceId }) => document(sourceRaceId));
    });
    expect(
      (await readSelectedCoreHistoryRaceSource(test.input)).observations,
    ).toHaveLength(21);
    expect(
      test.readRaceDocuments.mock.calls.map((call) => call[1].length),
    ).toEqual([20, 1]);
    expect(maximumActive).toBe(1);
  });

  it("rejects conflicting document receipts for one Race before object reads", async () => {
    const other = row("event-1", "102");
    const payload = {
      ...other.payload,
      raceDocumentEvidenceSha256: "e".repeat(64),
    };
    const test = harness([
      row(),
      { ...other, payload, rowSha256: dnaOpenLabRawEvidenceSha256(payload) },
    ]);
    await expect(readSelectedCoreHistoryRaceSource(test.input)).rejects.toThrow(
      "evidence is unavailable",
    );
    expect(test.readRaceDocuments).not.toHaveBeenCalled();
  });

  it("returns a generic error when a private store fails", async () => {
    const test = harness();
    test.readRaceDocuments.mockRejectedValueOnce(
      new Error("private-provider-host: secret"),
    );
    await expect(readSelectedCoreHistoryRaceSource(test.input)).rejects.toThrow(
      /^Selected Core canonical Race evidence is unavailable\.$/,
    );
  });
});
