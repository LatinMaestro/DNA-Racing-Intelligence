import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  runNextDnaFinishedRaceBackfillStep,
  type DnaFinishedRaceBackfillCheckpoint,
  type DnaFinishedRaceBackfillCheckpointRepository,
  type DnaFinishedRaceIdentityConflictQuarantine,
  type DnaFinishedRaceIdentityOmissionAuthority,
  type DnaFinishedRaceWindowPublication,
  type DnaFinishedRaceWindowPublicationReceipt,
  type StoredDnaFinishedRaceBackfillCheckpoint,
} from "../lib/dna-open-lab-finished-race-backfill";
import { type DnaFinishedRaceWindow } from "../lib/dna-open-lab-finished-race-window-crawler";
import type {
  DnaOpenLabClient,
  DnaOpenLabResponse,
  DnaRaceDocument,
  DnaRaceIdentifier,
} from "../lib/dna-open-lab-v1-client";
import { createDnaOpenLabRequestBudget } from "../lib/dna-open-lab-request-budget";

function rateLimit() {
  return Object.freeze({
    limit: 30,
    remaining: 29,
    resetSeconds: 30,
    rateClass: "api_key",
    retryAfterSeconds: null,
  });
}

function response<T>(result: T): DnaOpenLabResponse<T> {
  return Object.freeze({ result, httpStatus: 200, rateLimit: rateLimit() });
}

class MemoryCheckpointRepository implements DnaFinishedRaceBackfillCheckpointRepository {
  stored: StoredDnaFinishedRaceBackfillCheckpoint | null = null;
  saveCount = 0;
  failOnSaveCount: number | null = null;
  lastPublication: Parameters<
    DnaFinishedRaceBackfillCheckpointRepository["save"]
  >[0]["publication"] = undefined;

  async load(): Promise<StoredDnaFinishedRaceBackfillCheckpoint | null> {
    return this.stored;
  }

  async save(input: {
    expectedRevision: string | null;
    checkpoint: DnaFinishedRaceBackfillCheckpoint;
    publication?: Parameters<
      DnaFinishedRaceBackfillCheckpointRepository["save"]
    >[0]["publication"];
  }): Promise<StoredDnaFinishedRaceBackfillCheckpoint> {
    this.saveCount += 1;
    if (this.failOnSaveCount === this.saveCount) {
      throw new Error("synthetic checkpoint save failure");
    }
    if (input.expectedRevision === null) {
      if (this.stored !== null)
        throw new Error("synthetic checkpoint already exists");
    } else if (this.stored?.revision !== input.expectedRevision) {
      throw new Error("synthetic checkpoint revision conflict");
    }
    this.lastPublication = input.publication;
    this.stored = Object.freeze({
      revision: `r${this.saveCount}`,
      checkpoint: input.checkpoint,
    });
    return this.stored;
  }
}

class IdempotentPublisher {
  readonly publications = new Map<string, DnaFinishedRaceWindowPublication>();
  callCount = 0;
  receiptOverride:
    | ((
        publication: DnaFinishedRaceWindowPublication,
      ) => DnaFinishedRaceWindowPublicationReceipt)
    | null = null;

  publish = async (
    publication: DnaFinishedRaceWindowPublication,
  ): Promise<DnaFinishedRaceWindowPublicationReceipt> => {
    this.callCount += 1;
    const existing = this.publications.get(publication.windowKey);
    if (
      existing !== undefined &&
      existing.contentSha256 !== publication.contentSha256
    ) {
      throw new Error("synthetic publication conflict");
    }
    this.publications.set(publication.windowKey, publication);
    if (this.receiptOverride !== null) return this.receiptOverride(publication);
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

class IdentityConflictQuarantine {
  readonly calls: Parameters<DnaFinishedRaceIdentityConflictQuarantine>[0][] =
    [];

  quarantine: DnaFinishedRaceIdentityConflictQuarantine = async (input) => {
    this.calls.push(input);
    const evidenceLocatorSha256 = createHash("sha256")
      .update(
        `${input.window.startTime}|${input.window.endTime}|${input.sourceObservationOrdinal}|${input.rawEvidenceSha256}`,
        "utf8",
      )
      .digest("hex");
    return Object.freeze({
      evidenceLocatorSha256,
      rawEvidenceSha256: input.rawEvidenceSha256,
      objectKey: `dna-open-lab/v1/${"a".repeat(64)}/races/quarantine/unresolved-identity/${evidenceLocatorSha256}.json`,
      bodySha256: "b".repeat(64),
      byteLength: 256,
    });
  };
}

function clientWith(input: {
  finished: (window: DnaFinishedRaceWindow) => readonly DnaRaceDocument[];
  docs?: (raceIds: readonly DnaRaceIdentifier[]) => readonly DnaRaceDocument[];
}): {
  client: Pick<DnaOpenLabClient, "racesFinished" | "raceDocs">;
  finishedCalls: DnaFinishedRaceWindow[];
  docCalls: DnaRaceIdentifier[][];
} {
  const finishedCalls: DnaFinishedRaceWindow[] = [];
  const docCalls: DnaRaceIdentifier[][] = [];
  return {
    client: {
      racesFinished: async (finishedInput = {}) => {
        const { startTime, endTime } = finishedInput;
        const window = Object.freeze({
          startTime: startTime ?? "",
          endTime: endTime ?? "",
        });
        finishedCalls.push(window);
        return response(input.finished(window));
      },
      raceDocs: async (raceIds) => {
        docCalls.push([...raceIds]);
        return response(
          input.docs?.(raceIds) ??
            raceIds.map((rid) => ({ rid, hydrated: true })),
        );
      },
    },
    finishedCalls,
    docCalls,
  };
}

function saturated(): readonly DnaRaceDocument[] {
  return Array.from({ length: 200 }, (_, index) => ({ rid: index + 1 }));
}

async function run(input: {
  repository: MemoryCheckpointRepository;
  publisher: IdempotentPublisher;
  client: Pick<DnaOpenLabClient, "racesFinished" | "raceDocs">;
  startTime?: string;
  endTime?: string;
  minimumWindowMilliseconds?: number;
  identityConflictQuarantine?: IdentityConflictQuarantine;
  identityOmissionAuthority?: DnaFinishedRaceIdentityOmissionAuthority;
}) {
  const identityConflictQuarantine =
    input.identityConflictQuarantine ?? new IdentityConflictQuarantine();
  return runNextDnaFinishedRaceBackfillStep({
    startTime: input.startTime ?? "2026-08-01T00:00:00Z",
    endTime: input.endTime ?? "2026-08-01T00:01:00Z",
    client: input.client,
    requestBudget: createDnaOpenLabRequestBudget(),
    checkpointRepository: input.repository,
    publisher: input.publisher.publish,
    identityConflictQuarantine: identityConflictQuarantine.quarantine,
    observedAt: "2026-08-27T09:00:00Z",
    ...(input.identityOmissionAuthority === undefined
      ? {}
      : { identityOmissionAuthority: input.identityOmissionAuthority }),
    ...(input.minimumWindowMilliseconds === undefined
      ? {}
      : { minimumWindowMilliseconds: input.minimumWindowMilliseconds }),
  });
}

describe("DNA Open Lab finished-race backfill", () => {
  it("immutably quarantines unidentified observations and denies window publication", async () => {
    const repository = new MemoryCheckpointRepository();
    const publisher = new IdempotentPublisher();
    const identityConflictQuarantine = new IdentityConflictQuarantine();
    const unidentified = { rid: null, timing: { elapsed: 12.3 } };
    const source = clientWith({
      finished: () =>
        [{ rid: 7 }, unidentified] as unknown as readonly DnaRaceDocument[],
    });

    await expect(
      run({
        repository,
        publisher,
        client: source.client,
        identityConflictQuarantine,
      }),
    ).rejects.toMatchObject({ kind: "unresolved_source_identity" });

    expect(identityConflictQuarantine.calls).toEqual([
      expect.objectContaining({
        sourceObservationOrdinal: 2,
        observation: unidentified,
        rawEvidenceSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    ]);
    expect(source.docCalls).toHaveLength(0);
    expect(publisher.callCount).toBe(0);
    expect(repository.stored?.checkpoint).toMatchObject({
      completedWindowCount: 0,
      successfulFinishedRaceRequestCount: 0,
      publishedWindowDocumentCount: 0,
    });
    expect(repository.stored?.checkpoint.pendingWindows).toHaveLength(1);
  });

  it("binds an authorized de minimis quarantine receipt and advances without inventing identity", async () => {
    const repository = new MemoryCheckpointRepository();
    const publisher = new IdempotentPublisher();
    const identityConflictQuarantine = new IdentityConflictQuarantine();
    const unidentified = { rid: null, timing: { elapsed: 12.3 } };
    const source = clientWith({
      finished: () =>
        [{ rid: 7 }, unidentified] as unknown as readonly DnaRaceDocument[],
    });

    const result = await run({
      repository,
      publisher,
      client: source.client,
      identityConflictQuarantine,
      identityOmissionAuthority: {
        measurementEvidenceSha256: "c".repeat(64),
        maximumObservationCount: 1,
      },
    });

    expect(result.kind).toBe("published");
    expect(source.docCalls).toEqual([[7]]);
    const published = [...publisher.publications.values()][0];
    expect(published?.discoveredRaces).toEqual([{ rid: 7 }]);
    expect(published?.identityConflictQuarantineReceipts).toEqual([
      expect.objectContaining({
        rawEvidenceSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    ]);
    expect(repository.stored?.checkpoint).toMatchObject({
      completedWindowCount: 1,
      publishedWindowDocumentCount: 1,
      omittedIdentityObservationCount: 1,
      identityOmissionAuthority: {
        measurementEvidenceSha256: "c".repeat(64),
        maximumObservationCount: 1,
      },
    });
  });

  it("quarantines every conflict but denies publication when the measured omission bound would be exceeded", async () => {
    const repository = new MemoryCheckpointRepository();
    const publisher = new IdempotentPublisher();
    const identityConflictQuarantine = new IdentityConflictQuarantine();
    const source = clientWith({
      finished: () =>
        [
          { rid: 7 },
          { rid: null, elapsed: 12.3 },
          { elapsed: 12.4 },
        ] as unknown as readonly DnaRaceDocument[],
    });

    await expect(
      run({
        repository,
        publisher,
        client: source.client,
        identityConflictQuarantine,
        identityOmissionAuthority: {
          measurementEvidenceSha256: "c".repeat(64),
          maximumObservationCount: 1,
        },
      }),
    ).rejects.toMatchObject({ kind: "unresolved_source_identity" });

    expect(identityConflictQuarantine.calls).toHaveLength(2);
    expect(source.docCalls).toHaveLength(0);
    expect(publisher.callCount).toBe(0);
    expect(repository.stored?.checkpoint).toMatchObject({
      completedWindowCount: 0,
      omittedIdentityObservationCount: 0,
    });
  });

  it("rejects omission authority above the hard owner limit before API work", async () => {
    const repository = new MemoryCheckpointRepository();
    const publisher = new IdempotentPublisher();
    const source = clientWith({ finished: () => [] });

    await expect(
      run({
        repository,
        publisher,
        client: source.client,
        identityOmissionAuthority: {
          measurementEvidenceSha256: "c".repeat(64),
          maximumObservationCount: 26,
        },
      }),
    ).rejects.toMatchObject({ kind: "invalid_configuration" });

    expect(source.finishedCalls).toHaveLength(0);
    expect(repository.saveCount).toBe(0);
  });

  it("rejects measurement-evidence drift on restart before API work", async () => {
    const repository = new MemoryCheckpointRepository();
    const publisher = new IdempotentPublisher();
    const source = clientWith({ finished: () => [] });
    const firstAuthority = {
      measurementEvidenceSha256: "c".repeat(64),
      maximumObservationCount: 1,
    } as const;

    await run({
      repository,
      publisher,
      client: source.client,
      identityOmissionAuthority: firstAuthority,
    });
    const secondSource = clientWith({ finished: () => [] });
    await expect(
      run({
        repository,
        publisher,
        client: secondSource.client,
        identityOmissionAuthority: {
          ...firstAuthority,
          measurementEvidenceSha256: "d".repeat(64),
        },
      }),
    ).rejects.toMatchObject({ kind: "invalid_configuration" });

    expect(secondSource.finishedCalls).toHaveLength(0);
  });

  it("publishes one bounded window, checkpoints exact progress, then becomes complete", async () => {
    const repository = new MemoryCheckpointRepository();
    const publisher = new IdempotentPublisher();
    const source = clientWith({
      finished: () =>
        Array.from({ length: 25 }, (_, index) => ({ rid: index + 1 })),
      docs: (raceIds) =>
        [...raceIds].reverse().map((rid) => ({ rid, full: true })),
    });

    const first = await run({
      repository,
      publisher,
      client: source.client,
    });

    expect(first.kind).toBe("published");
    if (first.kind !== "published") throw new Error("expected publication");
    expect(source.finishedCalls).toHaveLength(1);
    expect(source.docCalls.map((batch) => batch.length)).toEqual([20, 5]);
    expect(publisher.callCount).toBe(1);
    expect(publisher.publications.size).toBe(1);
    expect(repository.lastPublication).toEqual({
      window: first.window,
      receipt: first.publicationReceipt,
    });
    expect(first.stored.checkpoint).toMatchObject({
      pendingWindows: [],
      completedWindowCount: 1,
      splitCount: 0,
      successfulFinishedRaceRequestCount: 1,
      raceDocumentRequestCount: 2,
      publishedWindowDocumentCount: 25,
    });

    const second = await run({
      repository,
      publisher,
      client: source.client,
    });
    expect(second.kind).toBe("complete");
    expect(source.finishedCalls).toHaveLength(1);
    expect(source.docCalls).toHaveLength(2);
    expect(publisher.callCount).toBe(1);
  });

  it("persists a saturated-window split before processing either child", async () => {
    const repository = new MemoryCheckpointRepository();
    const publisher = new IdempotentPublisher();
    const source = clientWith({ finished: () => saturated() });

    const result = await run({
      repository,
      publisher,
      client: source.client,
      startTime: "2026-08-01T00:00:00Z",
      endTime: "2026-08-01T00:00:10Z",
    });

    expect(result.kind).toBe("split");
    if (result.kind !== "split") throw new Error("expected split result");
    expect(result.childWindows).toEqual([
      {
        startTime: "2026-08-01T00:00:00.000Z",
        endTime: "2026-08-01T00:00:05.000Z",
      },
      {
        startTime: "2026-08-01T00:00:05.000Z",
        endTime: "2026-08-01T00:00:10.000Z",
      },
    ]);
    expect(result.stored.checkpoint).toMatchObject({
      completedWindowCount: 0,
      splitCount: 1,
      successfulFinishedRaceRequestCount: 1,
      raceDocumentRequestCount: 0,
      publishedWindowDocumentCount: 0,
    });
    expect(result.stored.checkpoint.pendingWindows).toEqual(
      result.childWindows,
    );
    expect(source.docCalls).toHaveLength(0);
    expect(publisher.callCount).toBe(0);
  });

  it("resumes from the first pending child instead of restarting the root range", async () => {
    const repository = new MemoryCheckpointRepository();
    const publisher = new IdempotentPublisher();
    const rootStart = "2026-08-01T00:00:00.000Z";
    const midpoint = "2026-08-01T00:00:05.000Z";
    const rootEnd = "2026-08-01T00:00:10.000Z";
    const source = clientWith({
      finished: (window) => {
        if (window.startTime === rootStart && window.endTime === rootEnd) {
          return saturated();
        }
        if (window.startTime === rootStart && window.endTime === midpoint) {
          return [{ rid: 10 }];
        }
        if (window.startTime === midpoint && window.endTime === rootEnd) {
          return [{ rid: 20 }];
        }
        throw new Error(`unexpected synthetic window ${window.startTime}`);
      },
    });

    await run({
      repository,
      publisher,
      client: source.client,
      startTime: rootStart,
      endTime: rootEnd,
    });
    const left = await run({
      repository,
      publisher,
      client: source.client,
      startTime: rootStart,
      endTime: rootEnd,
    });
    const right = await run({
      repository,
      publisher,
      client: source.client,
      startTime: rootStart,
      endTime: rootEnd,
    });

    expect(left.kind).toBe("published");
    expect(right.kind).toBe("published");
    expect(source.finishedCalls).toEqual([
      { startTime: rootStart, endTime: rootEnd },
      { startTime: rootStart, endTime: midpoint },
      { startTime: midpoint, endTime: rootEnd },
    ]);
    expect(right.stored.checkpoint).toMatchObject({
      pendingWindows: [],
      completedWindowCount: 2,
      splitCount: 1,
      successfulFinishedRaceRequestCount: 3,
      raceDocumentRequestCount: 2,
      publishedWindowDocumentCount: 2,
    });
  });

  it("replays the same idempotent publication after a crash before checkpoint advancement", async () => {
    const repository = new MemoryCheckpointRepository();
    repository.failOnSaveCount = 2;
    const publisher = new IdempotentPublisher();
    const source = clientWith({ finished: () => [{ rid: 7 }] });

    await expect(
      run({ repository, publisher, client: source.client }),
    ).rejects.toThrow("synthetic checkpoint save failure");
    expect(repository.stored?.checkpoint.pendingWindows).toHaveLength(1);
    expect(publisher.callCount).toBe(1);
    expect(publisher.publications.size).toBe(1);

    repository.failOnSaveCount = null;
    const replay = await run({
      repository,
      publisher,
      client: source.client,
    });

    expect(replay.kind).toBe("published");
    expect(publisher.callCount).toBe(2);
    expect(publisher.publications.size).toBe(1);
    expect(replay.stored.checkpoint.pendingWindows).toHaveLength(0);
  });

  it("does not advance the checkpoint when the publisher receipt mismatches", async () => {
    const repository = new MemoryCheckpointRepository();
    const publisher = new IdempotentPublisher();
    publisher.receiptOverride = (publication) =>
      Object.freeze({
        windowKey: publication.windowKey,
        contentSha256: "0".repeat(64),
        documentCount: publication.hydratedDocuments.length,
        manifestObjectKey: `dna-open-lab/v1/${"a".repeat(64)}/races/finished-windows/${publication.windowKey}.json`,
        manifestBodySha256: "b".repeat(64),
        manifestByteLength: 256,
      });
    const source = clientWith({ finished: () => [{ rid: 1 }] });

    await expect(
      run({ repository, publisher, client: source.client }),
    ).rejects.toMatchObject({
      name: "DnaFinishedRaceBackfillError",
      kind: "publication_mismatch",
    });
    expect(repository.stored?.checkpoint.pendingWindows).toHaveLength(1);
    expect(repository.stored?.checkpoint.completedWindowCount).toBe(0);
  });

  it("fails closed on duplicate finished-race ids before hydration or publication", async () => {
    const repository = new MemoryCheckpointRepository();
    const publisher = new IdempotentPublisher();
    const source = clientWith({
      finished: () => [{ rid: 4 }, { rid: 4 }],
    });

    await expect(
      run({ repository, publisher, client: source.client }),
    ).rejects.toMatchObject({
      name: "DnaFinishedRaceBackfillError",
      kind: "duplicate_race",
    });
    expect(source.docCalls).toHaveLength(0);
    expect(publisher.callCount).toBe(0);
    expect(repository.stored?.checkpoint.pendingWindows).toHaveLength(1);
  });

  it("publishes explicit empty-window evidence without calling race docs", async () => {
    const repository = new MemoryCheckpointRepository();
    const publisher = new IdempotentPublisher();
    const source = clientWith({ finished: () => [] });

    const result = await run({
      repository,
      publisher,
      client: source.client,
    });

    expect(result.kind).toBe("published");
    expect(source.docCalls).toHaveLength(0);
    expect(publisher.callCount).toBe(1);
    const publication = [...publisher.publications.values()][0];
    expect(publication?.discoveredRaces).toEqual([]);
    expect(publication?.hydratedDocuments).toEqual([]);
    expect(result.stored.checkpoint.publishedWindowDocumentCount).toBe(0);
  });

  it("fails before API work if persisted checkpoint authority is inconsistent", async () => {
    const repository = new MemoryCheckpointRepository();
    repository.stored = Object.freeze({
      revision: "seed",
      checkpoint: {
        version: 1 as const,
        rootWindow: {
          startTime: "2026-08-01T00:00:00Z",
          endTime: "2026-08-01T00:01:00Z",
        },
        pendingWindows: [
          {
            startTime: "2026-07-31T23:59:00Z",
            endTime: "2026-08-01T00:00:30Z",
          },
        ],
        minimumWindowMilliseconds: 1,
        completedWindowCount: 0,
        splitCount: 0,
        successfulFinishedRaceRequestCount: 0,
        raceDocumentRequestCount: 0,
        publishedWindowDocumentCount: 0,
        identityOmissionAuthority: null,
        omittedIdentityObservationCount: 0,
      },
    });
    const publisher = new IdempotentPublisher();
    const source = clientWith({ finished: () => [] });

    await expect(
      run({ repository, publisher, client: source.client }),
    ).rejects.toMatchObject({
      name: "DnaFinishedRaceBackfillError",
      kind: "invalid_checkpoint",
    });
    expect(source.finishedCalls).toHaveLength(0);
    expect(source.docCalls).toHaveLength(0);
    expect(publisher.callCount).toBe(0);
  });

  it("fails closed when a minimum-width window remains saturated", async () => {
    const repository = new MemoryCheckpointRepository();
    const publisher = new IdempotentPublisher();
    const source = clientWith({ finished: () => saturated() });

    await expect(
      run({
        repository,
        publisher,
        client: source.client,
        startTime: "2026-08-01T00:00:00.000Z",
        endTime: "2026-08-01T00:00:00.001Z",
        minimumWindowMilliseconds: 1,
      }),
    ).rejects.toMatchObject({
      name: "DnaFinishedRaceBackfillError",
      kind: "unprovable_saturation",
    });
    expect(publisher.callCount).toBe(0);
  });
});
