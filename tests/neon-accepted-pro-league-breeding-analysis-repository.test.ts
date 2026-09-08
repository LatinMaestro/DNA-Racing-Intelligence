import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { BreedingPairRankingInput } from "@/domain/breeding-pair-ranking";
import {
  createNeonAcceptedProLeagueBreedingAnalysisRepository,
  neonAcceptedProLeagueBreedingAnalysisSourceFromEnvironment,
} from "@/lib/neon-accepted-pro-league-breeding-analysis-repository";
import type {
  NeonImportPersistenceClient,
  NeonImportPersistenceSessionFactory,
} from "@/lib/neon-import-persistence-driver";
import {
  acceptedProLeagueBreedingAnalysisCanonicalJson,
  acceptedProLeagueBreedingAnalysisSha256,
  type AcceptedProLeagueBreedingAnalysis,
  type AcceptedProLeagueBreedingAnalysisSnapshot,
} from "@/lib/pro-league-breeding-ranking-publication-service";

const databaseOwnerId = "86000000-0000-4000-8000-000000000001";
const ownerId = "private_owner";
const runtimeRole = "dna_app_runtime";

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function ranking(): BreedingPairRankingInput {
  return {
    rankingId: "bike-1000",
    rankingLabel: "Bike 1,000 m accepted research",
    rulesetVersion: "rules-v1",
    candidateSnapshotVersion: "candidates-v1",
    projectionVersion: "projection-v1",
    arenaSnapshotVersion: null,
    evaluatedAt: "2026-09-08T01:30:00.000Z",
    dataCurrentThrough: "2026-09-08T00:15:00.000Z",
    lastImported: "2026-09-08T00:30:00.000Z",
    freshness: "current",
    arenaDataCurrentThrough: null,
    arenaLastImported: null,
    arenaFreshness: "unknown",
    eliteWeightBasisPoints: 5_000,
    vaultFitWeightBasisPoints: 5_000,
    candidates: [
      {
        pairId: "private-pair-1",
        parents: [
          {
            coreId: "private-parent-a",
            ownership: "owned",
            coreClass: "Genesis",
            element: "Metal",
            fNumber: 3,
          },
          {
            coreId: "private-parent-b",
            ownership: "owned",
            coreClass: "Morphed",
            element: "Earth",
            fNumber: 8,
          },
        ],
        source: "owned_owned",
        mode: "Bike",
        exactDistanceM: 1_000,
        rulesetVersion: "rules-v1",
        candidateSnapshotVersion: "candidates-v1",
        projectionVersion: "projection-v1",
        arenaSnapshotVersion: null,
        ruleStatus: "eligible",
        familyStatus: "eligible",
        sexCompatibilityStatus: "compatible",
        cycleStatus: "available",
        spliceCapacityStatus: "available",
        availabilityStatus: "confirmed",
        arenaListingExpiresAt: null,
        evidenceConfidence: "high",
        distributionStatus: "supported",
        chronologicalValidationStatus: "supported",
        usesStarFeatures: false,
        starLiftStatus: "not_evaluated",
        exceptionalUpsideBasisPoints: 2_000,
        strongerOrExceptionalBasisPoints: 5_000,
        vaultFitBasisPoints: 6_000,
      },
    ],
  };
}

function analysis(): AcceptedProLeagueBreedingAnalysis {
  return {
    analysisId: "accepted-analysis-v1",
    acceptanceStatus: "accepted",
    completionStatus: "complete",
    acceptedAt: "2026-09-08T02:00:00.000Z",
    rosterEvidenceCutoffAt: "2026-09-08T01:00:00.000Z",
    latestAcceptedPerformanceImportAt: "2026-09-08T00:30:00.000Z",
    latestAcceptedArenaImportAt: null,
    proLeagueRaceTypeEvidence: "unavailable",
    expectedRankingCount: 1,
    expectedCandidateCount: 1,
    rankings: [ranking()],
  };
}

function snapshot(): AcceptedProLeagueBreedingAnalysisSnapshot {
  const value = analysis();
  return {
    ...value,
    contentSha256: acceptedProLeagueBreedingAnalysisSha256(value),
  };
}

function isolation(overrides: Record<string, unknown> = {}) {
  return {
    authenticated_owner_id: ownerId,
    rls_enabled: true,
    force_rls_enabled: true,
    runtime_can_access_table: false,
    runtime_can_record: true,
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

function storedRow(overrides: Record<string, unknown> = {}) {
  const value = analysis();
  const canonicalPayload =
    acceptedProLeagueBreedingAnalysisCanonicalJson(value);
  return {
    analysis_id: value.analysisId,
    accepted_at: value.acceptedAt,
    roster_evidence_cutoff_at: value.rosterEvidenceCutoffAt,
    latest_performance_import_at: value.latestAcceptedPerformanceImportAt,
    latest_arena_import_at: value.latestAcceptedArenaImportAt,
    ranking_count: value.expectedRankingCount,
    candidate_count: value.expectedCandidateCount,
    canonical_byte_count: Buffer.byteLength(canonicalPayload, "utf8"),
    content_sha256: hash(canonicalPayload),
    canonical_payload: canonicalPayload,
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
  const repository = createNeonAcceptedProLeagueBreedingAnalysisRepository({
    databaseUrl: "postgresql://private.example/dna",
    databaseOwnerId,
    ownerId,
    runtimeRole,
    sessionFactory:
      sessionFactory as unknown as NeonImportPersistenceSessionFactory,
  });
  return { events, query, repository };
}

describe("Neon accepted Pro League breeding analysis repository", () => {
  it("fails closed without complete environment configuration", () => {
    expect(
      neonAcceptedProLeagueBreedingAnalysisSourceFromEnvironment({
        databaseUrl: "postgresql://private.example/dna",
      }),
    ).toEqual({ status: "not_configured" });
  });

  it("exposes only the immutable owner-scoped read method", () => {
    const source = neonAcceptedProLeagueBreedingAnalysisSourceFromEnvironment({
      databaseUrl: "postgresql://private.example/dna",
      databaseOwnerId,
      ownerId,
      runtimeRole,
    });
    expect(source.status).toBe("ready");
    expect(Object.keys(source).sort()).toEqual([
      "loadAcceptedAnalysisByOwner",
      "status",
    ]);
    expect(Object.isFrozen(source)).toBe(true);
  });

  it("records one canonical snapshot in a serializable transaction", async () => {
    const value = snapshot();
    const canonicalPayload =
      acceptedProLeagueBreedingAnalysisCanonicalJson(analysis());
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [
        {
          disposition: "recorded",
          analysis_id: value.analysisId,
          ranking_count: 1,
          candidate_count: 1,
          canonical_byte_count: Buffer.byteLength(canonicalPayload, "utf8"),
          content_sha256: value.contentSha256,
        },
      ],
    ]);

    await expect(
      test.repository.recordAcceptedAnalysis(ownerId, value),
    ).resolves.toBe("recorded");
    expect(test.events[0]).toBe(
      "BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE",
    );
    expect(test.query.mock.calls[3]?.[1]).toEqual([
      databaseOwnerId,
      value.analysisId,
      value.acceptedAt,
      value.rosterEvidenceCutoffAt,
      value.latestAcceptedPerformanceImportAt,
      null,
      1,
      1,
      value.contentSha256,
      canonicalPayload,
    ]);
    expect(test.events.slice(-2)).toEqual(["COMMIT", "close"]);
  });

  it("rejects cross-owner recording before opening a database session", async () => {
    const test = harness([]);
    await expect(
      test.repository.recordAcceptedAnalysis("different_owner", snapshot()),
    ).rejects.toThrow("owner scope denied");
    expect(test.events).toEqual([]);
  });

  it("reads and verifies one exact immutable snapshot", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [storedRow()],
    ]);
    await expect(
      test.repository.loadAcceptedAnalysisByOwner(
        ownerId,
        "accepted-analysis-v1",
      ),
    ).resolves.toEqual({ status: "ready", snapshot: snapshot() });
    expect(test.events[0]).toBe(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
  });

  it("returns not found without replacing it with partial state", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [],
    ]);
    await expect(
      test.repository.loadAcceptedAnalysisByOwner(ownerId, "missing-analysis"),
    ).resolves.toEqual({ status: "not_found" });
  });

  it("rolls back when the stored payload digest drifts", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [storedRow({ content_sha256: "f".repeat(64) })],
    ]);
    await expect(
      test.repository.loadAcceptedAnalysisByOwner(
        ownerId,
        "accepted-analysis-v1",
      ),
    ).rejects.toThrow("digest drifted");
    expect(test.events.slice(-2)).toEqual(["ROLLBACK", "close"]);
  });
});
