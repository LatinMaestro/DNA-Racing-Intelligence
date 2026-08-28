import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { runDnaCurrentStateDiscoveryStep } from "@/lib/dna-open-lab-current-state-discovery-runner";
import type {
  DnaCurrentStateAcquisitionCycleCheckpoint,
  DnaCurrentStateAcquisitionCycleCheckpointRepository,
  StoredDnaCurrentStateAcquisitionCycleCheckpoint,
} from "@/lib/dna-open-lab-current-state-acquisition-runner";
import type { DnaOpenLabClientPool } from "@/lib/dna-open-lab-client-pool";
import {
  createDnaOpenLabR2CurrentStateEvidenceReader,
  createDnaOpenLabR2CurrentStateEvidenceSink,
  type DnaOpenLabR2CurrentStateEvidenceStoragePort,
} from "@/lib/dna-open-lab-r2-current-state-evidence";
import type {
  DnaActiveRace,
  DnaOpenLabClient,
  DnaOpenLabResponse,
  DnaSpliceArenaResult,
  DnaVaultCore,
} from "@/lib/dna-open-lab-v1-client";

type StoredObject = Readonly<{
  body: Uint8Array;
  contentType: string;
  checksumSha256: string;
  metadata: Readonly<Record<string, string>>;
}>;

class MemoryCheckpointRepository implements DnaCurrentStateAcquisitionCycleCheckpointRepository {
  readonly cycles = new Map<
    string,
    StoredDnaCurrentStateAcquisitionCycleCheckpoint
  >();

  async load(cycleId: string) {
    return this.cycles.get(cycleId) ?? null;
  }

  async save(input: {
    expectedRevision: string | null;
    checkpoint: DnaCurrentStateAcquisitionCycleCheckpoint;
  }) {
    const current = this.cycles.get(input.checkpoint.cycleId);
    if (current === undefined) {
      if (input.expectedRevision !== null) throw new Error("missing cycle");
      const stored = Object.freeze({
        revision: "1",
        checkpoint: input.checkpoint,
      });
      this.cycles.set(input.checkpoint.cycleId, stored);
      return stored;
    }
    if (input.expectedRevision !== current.revision) {
      throw new Error("revision conflict");
    }
    const stored = Object.freeze({
      revision: String(Number(current.revision) + 1),
      checkpoint: input.checkpoint,
    });
    this.cycles.set(input.checkpoint.cycleId, stored);
    return stored;
  }
}

class MemoryR2Storage implements DnaOpenLabR2CurrentStateEvidenceStoragePort {
  readonly objects = new Map<string, StoredObject>();

  async readBucketPrivacy() {
    return Object.freeze({
      publicAccessDisabled: true,
      r2DevDisabled: true,
      customDomainCount: 0,
    });
  }

  async putObjectIfAbsent(input: {
    bucketName: string;
    key: string;
    body: AsyncIterable<Uint8Array>;
    contentType: string;
    byteLength: number;
    checksumSha256: string;
    metadata: Readonly<Record<string, string>>;
  }) {
    if (this.objects.has(input.key)) {
      return Object.freeze({ status: "existing" as const });
    }
    const body = new Uint8Array(input.byteLength);
    let offset = 0;
    for await (const chunk of input.body) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    if (
      offset !== input.byteLength ||
      createHash("sha256").update(body).digest("hex") !== input.checksumSha256
    ) {
      throw new Error("synthetic evidence body mismatch");
    }
    this.objects.set(
      input.key,
      Object.freeze({
        body,
        contentType: input.contentType,
        checksumSha256: input.checksumSha256,
        metadata: input.metadata,
      }),
    );
    return Object.freeze({ status: "created" as const });
  }

  async headObject(input: { bucketName: string; key: string }) {
    const stored = this.objects.get(input.key);
    if (stored === undefined) {
      return Object.freeze({ status: "missing" as const });
    }
    return Object.freeze({
      status: "ready" as const,
      contentType: stored.contentType,
      byteLength: stored.body.byteLength,
      checksumSha256: stored.checksumSha256,
      metadata: stored.metadata,
    });
  }

  async getObject(input: { bucketName: string; key: string }) {
    const stored = this.objects.get(input.key);
    if (stored === undefined) {
      return Object.freeze({ status: "missing" as const });
    }
    return Object.freeze({
      status: "ready" as const,
      body: (async function* () {
        yield stored.body;
      })(),
    });
  }
}

const rootCycleId = "90000000-0000-4000-8000-000000000001";
const evaluatedAt = "2026-08-28T14:30:00.000Z";

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

function vaultCore(hid: number): DnaVaultCore {
  return Object.freeze({
    hid,
    name: `Core ${hid}`,
    type: "Genesis",
    element: "Fire",
    gender: hid % 2 === 0 ? "Female" : "Male",
    fno: 12,
  });
}

function activeRace(rid: string): DnaActiveRace {
  return Object.freeze({
    rid,
    status: "open",
    race_name: `Race ${rid}`,
    format: "DU",
    class: "G-6",
    cb: null,
    rgate: 12,
    hs_in: 3,
    fee_fixed: Object.freeze({ DEZ: 10 }),
    feeusd: 1,
    paytoken: "DEZ",
    start_time: "2026-08-28T15:00:00Z",
    end_time: null,
    version: 1,
    rvmode: "bike",
  });
}

function arena(page: number): DnaSpliceArenaResult {
  return Object.freeze({
    cores: Object.freeze([]),
    has_more: page === 1,
    limit: 20,
    page,
  });
}

function requestPool(calls: string[]): DnaOpenLabClientPool {
  const client = {
    vaultCoresFull: async () => {
      calls.push("vault.cores_full");
      return response([vaultCore(9), vaultCore(2)]);
    },
    racesActive: async () => {
      calls.push("races.active");
      return response([activeRace("race-b"), activeRace("race-a")]);
    },
    spliceArena: async (input: { page?: number }) => {
      const page = input.page ?? 1;
      calls.push(`splice.arena:${page}`);
      return response(arena(page));
    },
  } as unknown as DnaOpenLabClient;
  return {
    execute: async (input) => input.request(client, "key-1"),
    snapshot: () => ({
      independentRateBucketsEnabled: false,
      aggregateBudget: null,
      lanes: [],
    }),
  } as DnaOpenLabClientPool;
}

describe("DNA Open Lab dynamic current-state discovery runner", () => {
  it("resumes bootstrap and Arena continuations into one immutable final plan", async () => {
    const repository = new MemoryCheckpointRepository();
    const storage = new MemoryR2Storage();
    const calls: string[] = [];
    const persistEvidence = createDnaOpenLabR2CurrentStateEvidenceSink({
      ownerId: "owner@example.test",
      bucketName: "dna-racing-import-preview",
      storage,
    });
    const readEvidence = createDnaOpenLabR2CurrentStateEvidenceReader({
      ownerId: "owner@example.test",
      bucketName: "dna-racing-import-preview",
      storage,
    });
    const baseInput = {
      cycleId: rootCycleId,
      evaluatedAt,
      attemptedAt: evaluatedAt,
      vault: "owner-vault",
      spliceModes: ["bike" as const],
      checkpointRepository: repository,
      pool: requestPool(calls),
      persistEvidence,
      readEvidence,
      pauseLastGood: async () => undefined,
    };

    let result: Awaited<
      ReturnType<typeof runDnaCurrentStateDiscoveryStep>
    > | null = null;
    for (let index = 0; index < 8; index += 1) {
      result = await runDnaCurrentStateDiscoveryStep(baseInput);
      if (result.kind === "final_plan_ready") break;
    }

    expect(result).toMatchObject({
      kind: "final_plan_ready",
      discoveryRoundCount: 2,
      evidenceReceiptCount: 4,
      ownedCoreIds: [2, 9],
      activeRaceIds: ["race-a", "race-b"],
    });
    if (result?.kind !== "final_plan_ready") {
      throw new Error("synthetic discovery did not complete");
    }
    const final = result;
    expect(calls).toEqual([
      "vault.cores_full",
      "races.active",
      "splice.arena:1",
      "splice.arena:2",
    ]);
    expect(
      final.plan.bootstrap
        .filter((entry) => entry.endpoint === "splice.arena")
        .map((entry) => entry.payload),
    ).toEqual([
      { filter: { rvmode: "bike" }, page: 1 },
      { filter: { rvmode: "bike" }, page: 2 },
    ]);
    expect(
      final.plan.hydrate.filter(
        (entry) => entry.endpoint === "cores.info_bulk",
      ),
    ).toHaveLength(1);
    expect(
      final.plan.hydrate.find((entry) => entry.endpoint === "races.fills")
        ?.payload,
    ).toEqual({ rids: ["race-a", "race-b"] });
    expect(repository.cycles.size).toBe(2);
    expect(storage.objects.size).toBe(4);

    await expect(
      runDnaCurrentStateDiscoveryStep(baseInput),
    ).resolves.toMatchObject({ kind: "final_plan_ready" });
    expect(calls).toHaveLength(4);
    expect(storage.objects.size).toBe(4);
  });
});
