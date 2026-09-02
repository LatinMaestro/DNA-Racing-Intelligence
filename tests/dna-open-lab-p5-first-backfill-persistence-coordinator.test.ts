import { describe, expect, it, vi } from "vitest";

import { DNA_OPEN_LAB_CURRENT_P5_FIRST_BACKFILL_APPROVAL_PACKET } from "@/lib/dna-open-lab-p5-first-backfill-approval";
import { createDnaOpenLabP5FirstBackfillPersistenceCoordinator } from "@/lib/dna-open-lab-p5-first-backfill-persistence-coordinator";
import type { DnaOpenLabP5FirstBackfillEvidenceReceipt } from "@/lib/dna-open-lab-p5-first-backfill-r2-evidence";
import type {
  DnaOpenLabP5FirstBackfillDurableReceipt,
  DnaOpenLabP5FirstBackfillLedgerState,
} from "@/lib/neon-dna-open-lab-p5-first-backfill-ledger";

const firstReceipt: DnaOpenLabP5FirstBackfillDurableReceipt = Object.freeze({
  family: "finished_races",
  requestOrdinal: 1,
  observedAt: "2026-09-02T04:00:00.000Z",
  contentSha256: "a".repeat(64),
  byteLength: 100,
  evidenceObjectKey: "opaque/000001.json",
  omittedIdentityObservationCount: 0,
  quarantineBound: false,
});

function state(
  overrides: Partial<DnaOpenLabP5FirstBackfillLedgerState> = {},
): DnaOpenLabP5FirstBackfillLedgerState {
  return Object.freeze({
    revision: "2",
    status: "running",
    nextRequestOrdinal: 2,
    logicalRequestCount: 1,
    retainedR2Bytes: 100,
    omittedIdentityObservationCount: 0,
    completionSha256: null,
    ...overrides,
  });
}

function harness(input?: {
  initialState?: DnaOpenLabP5FirstBackfillLedgerState;
  priorReceipts?: readonly DnaOpenLabP5FirstBackfillDurableReceipt[];
  recordFailsOnce?: boolean;
}) {
  let current = input?.initialState ?? state();
  let failRecord = input?.recordFailsOnce ?? false;
  const prior = [...(input?.priorReceipts ?? [firstReceipt])];
  const written = new Map<number, DnaOpenLabP5FirstBackfillEvidenceReceipt>(
    prior.map((receipt) => [receipt.requestOrdinal, receipt]),
  );
  const ledger = {
    initialize: vi.fn(async () => current),
    load: vi.fn(async () => current),
    loadReceipts: vi.fn(
      async ({ afterRequestOrdinal }: { afterRequestOrdinal: number }) =>
        prior.filter((receipt) => receipt.requestOrdinal > afterRequestOrdinal),
    ),
    record: vi.fn(
      async ({
        receipt,
        omittedIdentityObservationCount,
      }: {
        receipt: DnaOpenLabP5FirstBackfillEvidenceReceipt;
        omittedIdentityObservationCount: 0 | 1;
      }) => {
        if (failRecord) {
          failRecord = false;
          throw new Error("synthetic Neon interruption");
        }
        current = state({
          revision: String(Number(current.revision) + 1),
          nextRequestOrdinal: current.nextRequestOrdinal + 1,
          logicalRequestCount: current.logicalRequestCount + 1,
          retainedR2Bytes: current.retainedR2Bytes + receipt.byteLength,
          omittedIdentityObservationCount:
            current.omittedIdentityObservationCount +
            omittedIdentityObservationCount,
        });
        return current;
      },
    ),
    complete: vi.fn(
      async ({ completionSha256 }: { completionSha256: string }) => {
        current = state({
          ...current,
          revision: String(Number(current.revision) + 1),
          status: "complete",
          completionSha256,
        });
        return current;
      },
    ),
  };
  const write = vi.fn(async (request: { requestOrdinal: number }) => {
    const existing = written.get(request.requestOrdinal);
    if (existing !== undefined) return existing;
    const receipt = Object.freeze({
      family: "finished_races" as const,
      requestOrdinal: request.requestOrdinal,
      observedAt: "2026-09-02T05:00:00.000Z",
      contentSha256: "b".repeat(64),
      byteLength: 120,
      evidenceObjectKey: "opaque/000002.json",
    });
    written.set(request.requestOrdinal, receipt);
    return receipt;
  });
  const read = vi.fn(async (requestOrdinal: number) => {
    const receipt = written.get(requestOrdinal);
    if (receipt === undefined) return null;
    return Object.freeze({
      family: receipt.family,
      requestOrdinal,
      endpoint: "races.finished",
      request: Object.freeze({ replay: requestOrdinal }),
      response: Object.freeze({
        result: Object.freeze([{ rid: requestOrdinal }]),
        httpStatus: 200,
        rateLimit: Object.freeze({
          limit: 150,
          remaining: 149,
          resetSeconds: 60,
          rateClass: "api_key" as const,
          retryAfterSeconds: null,
        }),
      }),
      observedAt: receipt.observedAt,
    });
  });
  const coordinator = createDnaOpenLabP5FirstBackfillPersistenceCoordinator({
    ownerId: "private-owner",
    bucketName: "private-preview",
    storage: {} as never,
    approvalPacket: DNA_OPEN_LAB_CURRENT_P5_FIRST_BACKFILL_APPROVAL_PACKET,
    ledger,
    evidenceWriterFactory: ({ priorReceipts }) => {
      expect(priorReceipts).toEqual(prior);
      return {
        write,
        read,
        usage: () => ({
          logicalRequestCount: written.size,
          retainedR2Bytes: [...written.values()].reduce(
            (total, receipt) => total + receipt.byteLength,
            0,
          ),
          logicalRequestLimit: 2,
          retainedR2BytesLimit: 1_151_071_826,
        }),
      };
    },
  });
  return { coordinator, ledger, write, read };
}

const request = Object.freeze({
  family: "finished_races" as const,
  endpoint: "races.finished",
  request: Object.freeze({ start: "2026-01-01", end: "2026-01-02" }),
  response: Object.freeze({
    result: Object.freeze([{ malformed_identity_observation: true }]),
    httpStatus: 200,
    rateLimit: Object.freeze({
      limit: 150,
      remaining: 149,
      resetSeconds: 60,
      rateClass: "api_key",
      retryAfterSeconds: null,
    }),
  }),
  observedAt: "2026-09-02T05:00:00Z",
  omittedIdentityObservationCount: 1 as const,
});

describe("DNA Open Lab P5 first-backfill persistence coordinator", () => {
  it("rehydrates the exact committed prefix and atomically advances it", async () => {
    const test = harness();
    await expect(test.coordinator.initialize()).resolves.toMatchObject({
      logicalRequestCount: 1,
      nextRequestOrdinal: 2,
    });
    await expect(test.coordinator.record(request)).resolves.toMatchObject({
      logicalRequestCount: 2,
      retainedR2Bytes: 220,
      omittedIdentityObservationCount: 1,
    });
    expect(test.write).toHaveBeenCalledWith(
      expect.objectContaining({ requestOrdinal: 2 }),
    );
    expect(test.ledger.record).toHaveBeenCalledWith(
      expect.objectContaining({ expectedRevision: "2" }),
    );
  });

  it("replays a committed response and stops at the next request ordinal", async () => {
    const test = harness();
    await test.coordinator.initialize();
    await expect(test.coordinator.replay(1)).resolves.toEqual(
      expect.objectContaining({
        status: "committed",
        document: expect.objectContaining({
          requestOrdinal: 1,
          endpoint: "races.finished",
          response: expect.objectContaining({ result: [{ rid: 1 }] }),
        }),
      }),
    );
    await expect(test.coordinator.replay(2)).resolves.toBeNull();
    expect(test.read).toHaveBeenCalledTimes(2);
  });

  it("exposes an R2-first interruption only as a pending Neon receipt", async () => {
    const test = harness({ recordFailsOnce: true });
    await test.coordinator.initialize();
    await expect(test.coordinator.record(request)).rejects.toThrow(
      "synthetic Neon interruption",
    );
    await expect(test.coordinator.replay(2)).resolves.toEqual(
      expect.objectContaining({
        status: "pending_neon_receipt",
        document: expect.objectContaining({ requestOrdinal: 2 }),
      }),
    );
  });

  it("replays the same immutable object after a Neon interruption", async () => {
    const test = harness({ recordFailsOnce: true });
    await test.coordinator.initialize();
    await expect(test.coordinator.record(request)).rejects.toThrow(
      "synthetic Neon interruption",
    );
    await expect(test.coordinator.record(request)).resolves.toMatchObject({
      logicalRequestCount: 2,
    });
    expect(test.write).toHaveBeenCalledTimes(2);
    expect(test.ledger.record).toHaveBeenCalledTimes(2);
  });

  it("completes with a deterministic checksum only at exact bounds", async () => {
    const test = harness();
    await test.coordinator.initialize();
    await test.coordinator.record(request);
    const completed = await test.coordinator.complete();
    expect(completed.status).toBe("complete");
    expect(completed.completionSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("fails closed when Neon and receipt authority disagree", async () => {
    const test = harness({ initialState: state({ retainedR2Bytes: 99 }) });
    await expect(test.coordinator.initialize()).rejects.toThrow(
      "Neon and immutable R2 receipt authority disagree",
    );
    expect(test.coordinator.snapshot()).toBeNull();
  });
});
