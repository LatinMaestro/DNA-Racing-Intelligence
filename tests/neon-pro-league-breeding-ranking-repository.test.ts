import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { BreedingPairRankingInput } from "@/domain/breeding-pair-ranking";
import type {
  NeonImportPersistenceClient,
  NeonImportPersistenceSessionFactory,
} from "@/lib/neon-import-persistence-driver";
import {
  createNeonProLeagueBreedingRankingRepository,
  neonProLeagueBreedingRankingReadRepositoryFromEnvironment,
} from "@/lib/neon-pro-league-breeding-ranking-repository";

const databaseOwnerId = "85000000-0000-4000-8000-000000000001";
const generationId = "85000000-0000-4000-8000-000000000101";
const ownerId = "private_owner";
const runtimeRole = "dna_app_runtime";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isolation(overrides: Record<string, unknown> = {}) {
  return {
    authenticated_owner_id: ownerId,
    all_rls_enabled: true,
    all_force_rls_enabled: true,
    runtime_can_access_tables: false,
    runtime_can_publish: true,
    runtime_can_assert_authority: true,
    runtime_can_read: true,
    session_user_name: runtimeRole,
    current_user_name: runtimeRole,
    runtime_is_superuser: false,
    runtime_bypasses_rls: false,
    runtime_can_create_roles: false,
    runtime_can_create_databases: false,
    runtime_is_neon_superuser_member: false,
    ...overrides,
  };
}

function harness(rows: readonly (readonly unknown[])[]) {
  const events: string[] = [];
  let index = 0;
  const query = vi.fn(
    async (statement: string, values?: readonly unknown[]) => {
      const normalized = statement.replace(/\s+/gu, " ").trim();
      events.push(
        values ? `${normalized}|${JSON.stringify(values)}` : normalized,
      );
      if (
        normalized.startsWith("BEGIN TRANSACTION") ||
        normalized === "COMMIT" ||
        normalized === "ROLLBACK"
      ) {
        return { rows: [] };
      }
      return { rows: rows[index++] ?? [] };
    },
  );
  const client: NeonImportPersistenceClient = { query };
  const close = vi.fn(async () => {
    events.push("close");
  });
  const sessionFactory = vi.fn(async () => ({ client, close }));
  const repository = createNeonProLeagueBreedingRankingRepository({
    databaseUrl: "postgresql://private.example/dna",
    databaseOwnerId,
    ownerId,
    runtimeRole,
    sessionFactory:
      sessionFactory as unknown as NeonImportPersistenceSessionFactory,
  });
  return { close, events, query, repository };
}

function minimalRanking(): BreedingPairRankingInput {
  return {
    rankingId: "ranking-1",
    rankingLabel: "Exact-distance research",
    rulesetVersion: "rules-v1",
    candidateSnapshotVersion: "candidates-v1",
    projectionVersion: "projection-v1",
    arenaSnapshotVersion: null,
    evaluatedAt: "2026-09-07T01:30:00.000Z",
    dataCurrentThrough: "2026-09-07T00:15:00.000Z",
    lastImported: "2026-09-07T00:30:00.000Z",
    freshness: "current",
    arenaDataCurrentThrough: null,
    arenaLastImported: null,
    arenaFreshness: "unknown",
    eliteWeightBasisPoints: 5_000,
    vaultFitWeightBasisPoints: 5_000,
    candidates: [],
  };
}

function canonicalRanking(): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(minimalRanking()).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  );
}

describe("Neon Pro League breeding ranking repository", () => {
  it("fails closed without complete environment configuration", () => {
    expect(
      neonProLeagueBreedingRankingReadRepositoryFromEnvironment({
        databaseUrl: "postgresql://private.example/dna",
      }),
    ).toEqual({ status: "not_configured" });
  });

  it("exposes only the owner-scoped read method to website callers", () => {
    const repository =
      neonProLeagueBreedingRankingReadRepositoryFromEnvironment({
        databaseUrl: "postgresql://private.example/dna",
        databaseOwnerId,
        ownerId,
        runtimeRole,
      });
    expect(repository.status).toBe("ready");
    expect(Object.keys(repository).sort()).toEqual([
      "loadRankingEvidenceByOwner",
      "status",
    ]);
    expect(Object.isFrozen(repository)).toBe(true);
  });

  it("publishes one bounded canonical generation in a serializable transaction", async () => {
    const canonical = canonicalRanking();
    const rowSha = sha256(canonical);
    const payloadSha = sha256(`0:${rowSha}\n`);
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [],
      [
        {
          disposition: "published",
          generation_id: generationId,
          ranking_count: 1,
          candidate_count: 0,
          canonical_byte_count: Buffer.byteLength(canonical),
          payload_sha256: payloadSha,
        },
      ],
    ]);

    await expect(
      test.repository.publish(ownerId, {
        generationId,
        workerId: "breeding-worker",
        rosterEvidenceCutoffAt: "2026-09-07T01:00:00.000Z",
        latestAcceptedPerformanceImportAt: "2026-09-07T00:30:00.000Z",
        latestAcceptedArenaImportAt: null,
        publishedAt: "2026-09-07T02:00:00.000Z",
        rankings: [minimalRanking()],
      }),
    ).resolves.toBe("published");
    expect(test.events[0]).toBe(
      "BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE",
    );
    expect(test.query.mock.calls[3]?.[1]).toEqual([
      databaseOwnerId,
      "2026-09-07T01:00:00.000Z",
      "2026-09-07T00:30:00.000Z",
      null,
    ]);
    expect(test.query.mock.calls[4]?.[1]).toEqual([
      databaseOwnerId,
      generationId,
      "breeding-worker",
      "2026-09-07T01:00:00.000Z",
      "2026-09-07T00:30:00.000Z",
      null,
      1,
      0,
      payloadSha,
      JSON.stringify([
        {
          rankingId: "ranking-1",
          canonicalPayload: canonical,
          rowSha256: rowSha,
        },
      ]),
      "2026-09-07T02:00:00.000Z",
    ]);
    expect(test.events.slice(-2)).toEqual(["COMMIT", "close"]);
  });

  it("rolls back before publication when current authority changed", async () => {
    const test = harness([[{ owner_scope: databaseOwnerId }], [isolation()]]);
    test.query.mockImplementationOnce(async (statement: string) => {
      test.events.push(statement.replace(/\s+/gu, " ").trim());
      return { rows: [] };
    });
    test.query.mockImplementationOnce(async (statement: string) => {
      test.events.push(statement.replace(/\s+/gu, " ").trim());
      return { rows: [{ owner_scope: databaseOwnerId }] };
    });
    test.query.mockImplementationOnce(async (statement: string) => {
      test.events.push(statement.replace(/\s+/gu, " ").trim());
      return { rows: [isolation()] };
    });
    test.query.mockImplementationOnce(async (statement: string) => {
      test.events.push(statement.replace(/\s+/gu, " ").trim());
      throw new Error(
        "current Pro League breeding publication authority changed",
      );
    });
    test.query.mockImplementationOnce(async (statement: string) => {
      test.events.push(statement.replace(/\s+/gu, " ").trim());
      return { rows: [] };
    });

    await expect(
      test.repository.publish(ownerId, {
        generationId,
        workerId: "breeding-worker",
        rosterEvidenceCutoffAt: "2026-09-07T01:00:00.000Z",
        latestAcceptedPerformanceImportAt: "2026-09-07T00:30:00.000Z",
        latestAcceptedArenaImportAt: null,
        publishedAt: "2026-09-07T02:00:00.000Z",
        rankings: [minimalRanking()],
      }),
    ).rejects.toThrow("authority changed");
    expect(
      test.events.some((event) =>
        event.startsWith(
          "SELECT * FROM dna.publish_pro_league_breeding_ranking_generation",
        ),
      ),
    ).toBe(false);
    expect(test.events.slice(-2)).toEqual(["ROLLBACK", "close"]);
  });

  it("rejects ranking authority that does not match the generation", async () => {
    const test = harness([]);
    await expect(
      test.repository.publish(ownerId, {
        generationId,
        workerId: "breeding-worker",
        rosterEvidenceCutoffAt: "2026-09-07T01:00:00.000Z",
        latestAcceptedPerformanceImportAt: "2026-09-07T00:45:00.000Z",
        latestAcceptedArenaImportAt: null,
        publishedAt: "2026-09-07T02:00:00.000Z",
        rankings: [minimalRanking()],
      }),
    ).rejects.toThrow("authority does not match");
    expect(test.events).toEqual([]);
  });

  it("rejects generation authority later than publication", async () => {
    const test = harness([]);
    await expect(
      test.repository.publish(ownerId, {
        generationId,
        workerId: "breeding-worker",
        rosterEvidenceCutoffAt: "2026-09-07T03:00:00.000Z",
        latestAcceptedPerformanceImportAt: "2026-09-07T00:30:00.000Z",
        latestAcceptedArenaImportAt: null,
        publishedAt: "2026-09-07T02:00:00.000Z",
        rankings: [minimalRanking()],
      }),
    ).rejects.toThrow("cannot postdate publication");
    expect(test.events).toEqual([]);
  });

  it("reads and verifies the exact active generation", async () => {
    const canonical = canonicalRanking();
    const rowSha = sha256(canonical);
    const payloadSha = sha256(`0:${rowSha}\n`);
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [
        {
          generation_id: generationId,
          roster_evidence_cutoff_at: "2026-09-07T01:00:00.000Z",
          latest_performance_import_at: "2026-09-07T00:30:00.000Z",
          latest_arena_import_at: null,
          ranking_count: 1,
          candidate_count: 0,
          canonical_byte_count: Buffer.byteLength(canonical),
          payload_sha256: payloadSha,
          published_at: "2026-09-07T02:00:00.000Z",
          rows: [
            {
              ordinal: 0,
              rankingId: "ranking-1",
              rowSha256: rowSha,
              canonicalPayload: canonical,
            },
          ],
        },
      ],
    ]);

    await expect(
      test.repository.loadRankingEvidenceByOwner(ownerId),
    ).resolves.toEqual({
      rankings: [minimalRanking()],
      latestAcceptedPerformanceImportAt: "2026-09-07T00:30:00.000Z",
      latestAcceptedArenaImportAt: null,
    });
    expect(test.events[0]).toBe(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
  });

  it("returns an explicit empty source when no generation is active", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [],
    ]);
    await expect(
      test.repository.loadRankingEvidenceByOwner(ownerId),
    ).resolves.toEqual({
      rankings: [],
      latestAcceptedPerformanceImportAt: null,
      latestAcceptedArenaImportAt: null,
    });
  });

  it("rolls back when the stored digest drifts", async () => {
    const canonical = canonicalRanking();
    const rowSha = sha256(canonical);
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [
        {
          generation_id: generationId,
          roster_evidence_cutoff_at: "2026-09-07T01:00:00.000Z",
          latest_performance_import_at: "2026-09-07T00:30:00.000Z",
          latest_arena_import_at: null,
          ranking_count: 1,
          candidate_count: 0,
          canonical_byte_count: Buffer.byteLength(canonical),
          payload_sha256: "f".repeat(64),
          published_at: "2026-09-07T02:00:00.000Z",
          rows: [
            {
              ordinal: 0,
              rankingId: "ranking-1",
              rowSha256: rowSha,
              canonicalPayload: canonical,
            },
          ],
        },
      ],
    ]);
    await expect(
      test.repository.loadRankingEvidenceByOwner(ownerId),
    ).rejects.toThrow("digest drifted");
    expect(test.events.slice(-2)).toEqual(["ROLLBACK", "close"]);
  });
});
