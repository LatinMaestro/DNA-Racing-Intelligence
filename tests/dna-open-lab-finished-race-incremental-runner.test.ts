import { describe, expect, it, vi } from "vitest";

import {
  assertDnaFinishedRaceIncrementalCycleTransition,
  validateDnaFinishedRaceIncrementalCycle,
  type DnaFinishedRaceIncrementalCycle,
  type DnaFinishedRaceIncrementalCycleRepository,
  type StoredDnaFinishedRaceIncrementalCycle,
} from "@/lib/dna-open-lab-finished-race-incremental-cycle";
import {
  classifyDnaFinishedRaceIncrementalFailure,
  runDnaFinishedRaceIncrementalStep,
} from "@/lib/dna-open-lab-finished-race-incremental-runner";
import type {
  DnaFinishedRaceWindowPublication,
  DnaFinishedRaceWindowPublicationReceipt,
} from "@/lib/dna-open-lab-finished-race-backfill";
import { createDnaOpenLabRequestBudget } from "@/lib/dna-open-lab-request-budget";
import { DnaRaceDocumentHydrationError } from "@/lib/dna-open-lab-race-document-hydrator";
import { DnaOpenLabR2RaceEvidenceProviderError } from "@/lib/dna-open-lab-r2-race-evidence";
import {
  DnaOpenLabApiError,
  type DnaOpenLabResponse,
  type DnaRaceDocument,
} from "@/lib/dna-open-lab-v1-client";

const cutoffAt = "2026-09-02T00:11:55.961Z";
const upperBoundAt = "2026-09-03T00:11:55.961Z";

function response<T>(result: T): DnaOpenLabResponse<T> {
  return Object.freeze({
    result,
    httpStatus: 200,
    rateLimit: Object.freeze({
      limit: 150,
      remaining: 149,
      resetSeconds: 60,
      rateClass: "api_key",
      retryAfterSeconds: null,
    }),
  });
}

class MemoryCycleRepository implements DnaFinishedRaceIncrementalCycleRepository {
  readonly attempts = new Map<string, StoredDnaFinishedRaceIncrementalCycle>();
  readonly publications: unknown[] = [];

  private key(cycleId: string, attemptNumber: number) {
    return `${cycleId}:${attemptNumber}`;
  }

  async load(input: { cycleId: string; attemptNumber: number }) {
    return (
      this.attempts.get(this.key(input.cycleId, input.attemptNumber)) ?? null
    );
  }

  async loadLatestComplete() {
    return (
      [...this.attempts.values()]
        .filter((stored) => stored.cycle.status === "complete")
        .sort((left, right) =>
          right.cycle.upperBoundAt.localeCompare(left.cycle.upperBoundAt),
        )[0] ?? null
    );
  }

  async save(input: {
    expectedRevision: string | null;
    cycle: DnaFinishedRaceIncrementalCycle;
  }) {
    const cycle = validateDnaFinishedRaceIncrementalCycle(input.cycle);
    const key = this.key(cycle.cycleId, cycle.attemptNumber);
    const previous = this.attempts.get(key) ?? null;
    if (input.expectedRevision === null) {
      if (previous !== null) throw new Error("synthetic create conflict");
    } else {
      if (previous?.revision !== input.expectedRevision) {
        throw new Error("synthetic revision conflict");
      }
      assertDnaFinishedRaceIncrementalCycleTransition(previous.cycle, cycle);
    }
    const stored = Object.freeze({
      revision: String(Number(previous?.revision ?? "0") + 1),
      cycle,
    });
    this.attempts.set(key, stored);
    return stored;
  }

  async saveProgress(
    input: Parameters<
      DnaFinishedRaceIncrementalCycleRepository["saveProgress"]
    >[0],
  ) {
    if (input.publication !== undefined)
      this.publications.push(input.publication);
    return this.save({
      expectedRevision: input.expectedRevision,
      cycle: input.cycle,
    });
  }
}

function publisher(
  publications: DnaFinishedRaceWindowPublication[],
): (
  publication: DnaFinishedRaceWindowPublication,
) => Promise<DnaFinishedRaceWindowPublicationReceipt> {
  return async (publication) => {
    publications.push(publication);
    return Object.freeze({
      windowKey: publication.windowKey,
      contentSha256: publication.contentSha256,
      documentCount: publication.hydratedDocuments.length,
      manifestObjectKey: `dna-open-lab/v1/${"a".repeat(64)}/races/finished-windows/${publication.windowKey}.json`,
      manifestBodySha256: "b".repeat(64),
      manifestByteLength: 256,
    });
  };
}

function fixture(
  finished: () => Promise<DnaOpenLabResponse<readonly DnaRaceDocument[]>>,
) {
  const publications: DnaFinishedRaceWindowPublication[] = [];
  const pauseLastGood = vi.fn(async () => undefined);
  const racesFinished = vi.fn(finished);
  const raceDocs = vi.fn(async (raceIds: readonly (string | number)[]) =>
    response(raceIds.map((rid) => ({ rid, rvmode: "bike" as const }))),
  );
  return {
    repository: new MemoryCycleRepository(),
    publications,
    pauseLastGood,
    racesFinished,
    raceDocs,
    input: {
      upperBoundAt,
      attemptedAt: "2026-09-03T00:12:00.000Z",
      requestBudget: createDnaOpenLabRequestBudget(),
      client: { racesFinished, raceDocs },
      publisher: publisher(publications),
      identityConflictQuarantine: vi.fn(),
      pauseLastGood,
    },
  };
}

describe("DNA finished-race incremental runner", () => {
  it("distinguishes invalid DNA documents from unavailable R2 evidence", () => {
    expect(
      classifyDnaFinishedRaceIncrementalFailure(
        new DnaRaceDocumentHydrationError({
          kind: "missing_document",
          message: "private detail",
        }),
      ),
    ).toEqual({ reason: "invalid_response", retryAfterSeconds: null });
    expect(
      classifyDnaFinishedRaceIncrementalFailure(
        new DnaOpenLabR2RaceEvidenceProviderError("privacy_unavailable"),
      ),
    ).toEqual({ reason: "operator_hold", retryAfterSeconds: null });
  });

  it("collects one immutable window, then completes without publishing a generation", async () => {
    const test = fixture(async () => response([{ rid: 17 }]));

    const first = await runDnaFinishedRaceIncrementalStep({
      ...test.input,
      repository: test.repository,
    });
    expect(first).toMatchObject({
      kind: "collecting",
      step: { kind: "published" },
      stored: {
        cycle: {
          lowerBoundAt: cutoffAt,
          upperBoundAt,
          status: "running",
          checkpoint: {
            completedWindowCount: 1,
            publishedWindowDocumentCount: 1,
            pendingWindows: [],
          },
        },
      },
    });
    expect(test.repository.publications).toHaveLength(1);
    expect(test.publications).toHaveLength(1);

    const second = await runDnaFinishedRaceIncrementalStep({
      ...test.input,
      attemptedAt: "2026-09-03T00:13:00.000Z",
      repository: test.repository,
    });
    expect(second).toMatchObject({
      kind: "collection_complete",
      stored: { cycle: { status: "complete" } },
    });
    expect(test.racesFinished).toHaveBeenCalledTimes(1);
    expect(test.raceDocs).toHaveBeenCalledTimes(1);
    expect(test.pauseLastGood).not.toHaveBeenCalled();

    const replay = await runDnaFinishedRaceIncrementalStep({
      ...test.input,
      attemptedAt: "2026-09-03T00:14:00.000Z",
      repository: test.repository,
    });
    expect(replay).toEqual(second);
    expect(test.racesFinished).toHaveBeenCalledTimes(1);
  });

  it("persists Retry-After, serves last-good, and resumes the same checkpoint", async () => {
    let call = 0;
    const test = fixture(async () => {
      call += 1;
      if (call === 1) {
        throw new DnaOpenLabApiError({
          kind: "rate_limited",
          message: "synthetic 429",
          httpStatus: 429,
          rateLimit: {
            limit: 150,
            remaining: 0,
            resetSeconds: 60,
            rateClass: "api_key",
            retryAfterSeconds: 60,
          },
        });
      }
      return response([]);
    });

    const paused = await runDnaFinishedRaceIncrementalStep({
      ...test.input,
      repository: test.repository,
    });
    expect(paused).toMatchObject({
      kind: "paused",
      reason: "rate_limited",
      retryAt: "2026-09-03T00:13:00.000Z",
      stored: {
        cycle: {
          status: "paused",
          checkpoint: { completedWindowCount: 0 },
        },
      },
    });
    expect(test.pauseLastGood).toHaveBeenCalledWith({
      reason: "rate_limited",
      attemptedAt: "2026-09-03T00:12:00.000Z",
      retryAfterSeconds: 60,
    });

    const blocked = await runDnaFinishedRaceIncrementalStep({
      ...test.input,
      attemptedAt: "2026-09-03T00:12:30.000Z",
      repository: test.repository,
    });
    expect(blocked.kind).toBe("paused");
    expect(test.racesFinished).toHaveBeenCalledTimes(1);

    const resumed = await runDnaFinishedRaceIncrementalStep({
      ...test.input,
      attemptedAt: "2026-09-03T00:13:00.000Z",
      requestBudget: createDnaOpenLabRequestBudget(),
      repository: test.repository,
    });
    expect(resumed).toMatchObject({
      kind: "collecting",
      step: { kind: "published" },
      stored: { cycle: { status: "running" } },
    });
    expect(test.racesFinished).toHaveBeenCalledTimes(2);
  });

  it("durably splits a saturated window without hydrating or publishing it", async () => {
    const test = fixture(async () =>
      response(Array.from({ length: 200 }, (_, index) => ({ rid: index + 1 }))),
    );

    const result = await runDnaFinishedRaceIncrementalStep({
      ...test.input,
      repository: test.repository,
    });
    expect(result).toMatchObject({
      kind: "collecting",
      step: { kind: "split" },
      stored: {
        cycle: {
          checkpoint: {
            splitCount: 1,
            successfulFinishedRaceRequestCount: 1,
            pendingWindows: [
              { startTime: cutoffAt },
              { endTime: upperBoundAt },
            ],
          },
        },
      },
    });
    expect(test.raceDocs).not.toHaveBeenCalled();
    expect(test.publications).toHaveLength(0);
  });
});
