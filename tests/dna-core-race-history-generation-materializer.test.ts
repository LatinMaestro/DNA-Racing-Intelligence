import { describe, expect, it, vi } from "vitest";

import {
  applyDnaCoreRaceHistoryPageReceipt,
  completeDnaCoreRaceHistoryAcquisitionCycle,
  createDnaCoreRaceHistoryAcquisitionCycle,
  createDnaCoreRaceHistoryCoreCheckpoint,
  createDnaCoreRaceHistoryPageReceipt,
  type DnaCoreRaceHistoryAcquisitionRepository,
} from "@/lib/dna-core-race-history-acquisition-cycle";
import { adaptDnaCoreRaceHistoryPage } from "@/lib/dna-core-race-history-adapter";
import {
  materializeAndPublishLatestDnaCoreRaceHistory,
  DNA_CORE_RACE_HISTORY_RACE_DOCUMENT_BATCH_SIZE,
} from "@/lib/dna-core-race-history-generation-materializer";
import type {
  DnaCoreRaceHistoryGenerationMetadata,
  DnaCoreRaceHistoryGenerationRepository,
  DnaCoreRaceHistoryGenerationStageRow,
  DnaCoreRaceHistoryPublishedGeneration,
} from "@/lib/dna-core-race-history-generation";
import type { DnaCoreRaceHistoryMaterializationPage } from "@/lib/dna-core-race-history-materialization";
import { adaptDnaRaceDocument } from "@/lib/dna-open-lab-v1-adapters";
import type { DnaCoreRaceHistoryRow } from "@/lib/dna-core-race-history-client";
import type { DnaRaceDocument } from "@/lib/dna-open-lab-v1-client";

const SHA = "a".repeat(64);
const OWNER = "owner@example.test";

function sourceRow(raceId: string): DnaCoreRaceHistoryRow {
  return Object.freeze({
    hid: 42,
    rid: raceId,
    rvmode: "bike",
    cb: 12,
    time: 65.125,
    pos: 2,
    start_time: "2026-09-15T06:00:00.000Z",
  });
}

function raceDocument(raceId: string) {
  return adaptDnaRaceDocument({
    raw: Object.freeze({
      rid: raceId,
      rvmode: "bike",
      cb: 12,
      hids: [42, 51],
      start_time: "2026-09-15T06:00:00.000Z",
      rgate: 12,
      hs_in: 2,
      payout: "Winner Take All",
    }) as DnaRaceDocument,
    observedAt: "2026-09-15T06:20:00.000Z",
    endpoint: "races.docs",
  });
}

function completedAuthority(raceIds: readonly string[]) {
  const running = createDnaCoreRaceHistoryAcquisitionCycle({
    previousCompletedCycleId: null,
    currentStateGenerationId: "10000000-0000-4000-8000-000000000001",
    evaluatedAt: "2026-09-15T06:00:00.000Z",
    coreIds: [42],
  });
  const accepted = adaptDnaCoreRaceHistoryPage({
    requestedCoreId: 42,
    rows: raceIds.map(sourceRow),
    observedAt: "2026-09-15T06:10:00.000Z",
  }).accepted;
  const firstReceipt = createDnaCoreRaceHistoryPageReceipt({
    cycleId: running.cycleId,
    attemptNumber: 1,
    coreId: 42,
    pageNumber: 1,
    observedAt: "2026-09-15T06:10:00.000Z",
    sourceRowCount: raceIds.length,
    acceptedResultCount: raceIds.length,
    quarantineCount: 0,
    replayDuplicateCount: 0,
    pageObjectKey: "private/pages/1.json",
    pageBodySha256: SHA,
    pageByteLength: 100,
    quarantineObjectKey: null,
    quarantineBodySha256: null,
    quarantineByteLength: null,
  });
  let checkpoint = applyDnaCoreRaceHistoryPageReceipt({
    checkpoint: createDnaCoreRaceHistoryCoreCheckpoint({
      cycle: running,
      coreId: 42,
    }),
    receipt: firstReceipt,
  });
  const terminalReceipt = createDnaCoreRaceHistoryPageReceipt({
    cycleId: running.cycleId,
    attemptNumber: 1,
    coreId: 42,
    pageNumber: 2,
    observedAt: "2026-09-15T06:11:00.000Z",
    sourceRowCount: 0,
    acceptedResultCount: 0,
    quarantineCount: 0,
    replayDuplicateCount: 0,
    pageObjectKey: "private/pages/2.json",
    pageBodySha256: SHA,
    pageByteLength: 100,
    quarantineObjectKey: null,
    quarantineBodySha256: null,
    quarantineByteLength: null,
  });
  checkpoint = applyDnaCoreRaceHistoryPageReceipt({
    checkpoint,
    receipt: terminalReceipt,
  });
  const complete = completeDnaCoreRaceHistoryAcquisitionCycle({
    cycle: running,
    checkpoints: [checkpoint],
    completedAt: "2026-09-15T06:12:00.000Z",
  });
  const pages = new Map<number, DnaCoreRaceHistoryMaterializationPage>([
    [
      1,
      Object.freeze({
        ownerId: OWNER,
        cycleId: complete.cycleId,
        attemptNumber: 1,
        coreId: 42,
        pageNumber: 1,
        sourceRowCount: raceIds.length,
        terminal: false,
        results: accepted,
      }),
    ],
    [
      2,
      Object.freeze({
        ownerId: OWNER,
        cycleId: complete.cycleId,
        attemptNumber: 1,
        coreId: 42,
        pageNumber: 2,
        sourceRowCount: 0,
        terminal: true,
        results: Object.freeze([]),
      }),
    ],
  ]);
  const repository = {
    loadLatestComplete: vi.fn(async () => ({ revision: "1", cycle: complete })),
    loadCores: vi.fn(async () => [{ revision: "2", checkpoint }]),
  } as unknown as DnaCoreRaceHistoryAcquisitionRepository;
  return { complete, pages, repository };
}

function generationRepository() {
  let metadata: DnaCoreRaceHistoryGenerationMetadata | null = null;
  let published: DnaCoreRaceHistoryPublishedGeneration | null = null;
  const rows: Array<{ ordinal: number; rowSha256: string }> = [];
  const repository: DnaCoreRaceHistoryGenerationRepository = {
    begin: vi.fn(async (_ownerId, input) => {
      metadata = input.generation;
      return "staging" as const;
    }),
    stageRows: vi.fn(
      async (
        _ownerId: string,
        input: Readonly<{
          workerId: string;
          generationId: string;
          startOrdinal: number;
          rows: readonly DnaCoreRaceHistoryGenerationStageRow[];
        }>,
      ) => {
        const accepted = input.rows.map(({ ordinal, rowSha256 }) => ({
          ordinal,
          rowSha256,
        }));
        rows.push(...accepted);
        return accepted;
      },
    ),
    publish: vi.fn(async (_ownerId, input) => {
      if (metadata === null) throw new Error("missing metadata");
      published = Object.freeze({
        ...metadata,
        state: "published" as const,
        publishedAt: input.publishedAt,
      });
      return published;
    }),
    load: vi.fn(async () => published),
  };
  return { repository, rows };
}

function request(raceIds: readonly string[]) {
  const authority = completedAuthority(raceIds);
  const generation = generationRepository();
  const readMaterializationPage = vi.fn(
    async ({ pageNumber }) => authority.pages.get(pageNumber) ?? null,
  );
  const loadRaceDocuments = vi.fn(async (ids: readonly string[]) =>
    ids.map(raceDocument),
  );
  return {
    authority,
    generation,
    readMaterializationPage,
    loadRaceDocuments,
    input: {
      ownerId: OWNER,
      workerId: "preview-core-result-materializer",
      materializedAt: "2026-09-15T06:30:00.000Z",
      publishedAt: "2026-09-15T06:31:00.000Z",
      acquisitionRepository: authority.repository,
      evidenceStore: { readMaterializationPage },
      loadRaceDocuments,
      generationRepository: generation.repository,
      retainedEvidenceReadBudget: {
        maximumClassBOperations: 8,
        paidUsageAllowed: false as const,
      },
    },
  };
}

describe("DNA Core result retained-evidence generation materializer", () => {
  it("publishes one complete joined generation from the latest completed cycle", async () => {
    const test = request(["race-1", "race-2"]);

    const result = await materializeAndPublishLatestDnaCoreRaceHistory(
      test.input,
    );

    expect(result).toMatchObject({
      kind: "published",
      generation: {
        observationCount: 2,
        exactDistanceConfirmedCount: 2,
        inputCycleCount: 1,
        inputPageCount: 2,
      },
    });
    expect(test.readMaterializationPage).toHaveBeenCalledTimes(2);
    expect(test.loadRaceDocuments).toHaveBeenCalledWith(["race-1", "race-2"]);
    expect(test.generation.rows).toHaveLength(2);
  });

  it("hydrates race authority in endpoint-safe batches", async () => {
    const raceIds = Array.from(
      { length: 26 },
      (_, index) => `race-${String(index + 1).padStart(2, "0")}`,
    );
    const test = request(raceIds);

    const result = await materializeAndPublishLatestDnaCoreRaceHistory(
      test.input,
    );

    expect(result.kind).toBe("published");
    expect(test.loadRaceDocuments).toHaveBeenCalledTimes(2);
    expect(test.loadRaceDocuments.mock.calls[0]?.[0]).toHaveLength(
      DNA_CORE_RACE_HISTORY_RACE_DOCUMENT_BATCH_SIZE,
    );
    expect(test.loadRaceDocuments.mock.calls[1]?.[0]).toHaveLength(1);
  });

  it("fails closed before hydration or publication when retained coverage is missing", async () => {
    const test = request(["race-1"]);
    test.authority.pages.delete(2);

    await expect(
      materializeAndPublishLatestDnaCoreRaceHistory(test.input),
    ).rejects.toThrow("retained page is unavailable");
    expect(test.loadRaceDocuments).not.toHaveBeenCalled();
    expect(test.generation.repository.begin).not.toHaveBeenCalled();
  });

  it("rejects owner or cursor drift before hydrating race authority", async () => {
    const test = request(["race-1"]);
    const first = test.authority.pages.get(1);
    if (first === undefined) throw new Error("missing synthetic page");
    test.authority.pages.set(1, Object.freeze({ ...first, ownerId: "other" }));

    await expect(
      materializeAndPublishLatestDnaCoreRaceHistory(test.input),
    ).rejects.toThrow("retained page identity or terminal state drifted");
    expect(test.loadRaceDocuments).not.toHaveBeenCalled();
    expect(test.generation.repository.begin).not.toHaveBeenCalled();
  });

  it("fails before R2 replay when the free read budget is closed", async () => {
    const test = request(["race-1"]);

    await expect(
      materializeAndPublishLatestDnaCoreRaceHistory({
        ...test.input,
        retainedEvidenceReadBudget: {
          maximumClassBOperations: 7,
          paidUsageAllowed: false,
        },
      }),
    ).rejects.toThrow("retained-evidence read budget is closed");
    expect(test.readMaterializationPage).not.toHaveBeenCalled();
    expect(test.loadRaceDocuments).not.toHaveBeenCalled();
    expect(test.generation.repository.begin).not.toHaveBeenCalled();
  });

  it("does not invent authority when no completed cycle exists", async () => {
    const test = request(["race-1"]);
    vi.mocked(
      test.authority.repository.loadLatestComplete,
    ).mockResolvedValueOnce(null);

    await expect(
      materializeAndPublishLatestDnaCoreRaceHistory(test.input),
    ).resolves.toEqual({
      kind: "authority_unavailable",
      reason: "no_complete_cycle",
    });
    expect(test.authority.repository.loadCores).not.toHaveBeenCalled();
    expect(test.generation.repository.begin).not.toHaveBeenCalled();
  });
});
