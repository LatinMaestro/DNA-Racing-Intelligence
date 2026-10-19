import { describe, expect, it, vi } from "vitest";
import type {
  MaidenAllocationBracketInput,
  MaidenAllocationCandidateInput,
} from "@/domain/maiden-vault-allocation";
import { encodeMaidenAllocationEvidenceSnapshot } from "@/lib/maiden-allocation-evidence-snapshot";
import { loadMaidenWorkspacePageState } from "@/lib/maiden-workspace-service";
import {
  createNeonMaidenAllocationRepository,
  neonMaidenAllocationRepositoryFromEnvironment,
} from "@/lib/neon-maiden-allocation-repository";
import type { NeonImportPersistenceClient } from "@/lib/neon-import-persistence-driver";

const databaseOwnerId = "11111111-1111-4111-8111-111111111111";
const authenticatedOwnerId = "user_synthetic_owner";
const sourceEvidenceSha256 = "a".repeat(64);
const now = new Date("2026-10-15T00:00:00.000Z");
const versions = {
  configurationVersion: "config-v3",
  candidateSnapshotVersion: "snapshot-v9",
  projectionVersion: "projection-v4",
} as const;
const bracket: MaidenAllocationBracketInput = {
  tournamentId: "synthetic-maiden",
  tournamentLabel: "Synthetic Maiden",
  bracketId: "synthetic-bracket",
  bracketLabel: "Synthetic Bracket",
  mode: "horse",
  ...versions,
  reviewCapacity: 1,
  availability: "upcoming",
  ruleStatus: "confirmed",
};
const candidate: MaidenAllocationCandidateInput = {
  candidateId: "synthetic-candidate",
  coreId: "synthetic-core",
  tournamentId: bracket.tournamentId,
  bracketId: bracket.bracketId,
  mode: bracket.mode,
  ...versions,
  projectionBasis: "time_led_chronological",
  projectedValueBasisPoints: 8_500,
  suitability: "review_candidate",
  lifecycleState: "eligible",
  evidenceConfidence: "moderate",
  timeEvidence: "competitive",
  historicalStarSupport: "supports",
  crossModeEvidenceComplete: true,
  dataCurrentThrough: "2026-10-14T00:00:00.000Z",
  lastImported: "2020-01-01T00:00:00.000Z",
  freshness: "stale",
};
const encoded = encodeMaidenAllocationEvidenceSnapshot({
  databaseOwnerId,
  sourceEvidenceSha256,
  materializedAt: now.toISOString(),
  evidence: {
    brackets: [bracket],
    candidates: [candidate],
    lastImportedAt: "2026-10-14T01:00:00.000Z",
  },
  now,
});
const stored = {
  source_evidence_sha256: sourceEvidenceSha256,
  snapshot_json: encoded.json,
  snapshot_sha256: encoded.sha256,
};
const isolation = {
  database_owner_id: databaseOwnerId,
  authenticated_owner_id: authenticatedOwnerId,
  row_security_enabled: true,
  force_row_security_enabled: true,
  source_row_security_enabled: true,
  source_force_row_security_enabled: true,
  session_user_name: "dna_app_runtime",
  current_user_name: "dna_app_runtime",
  runtime_is_superuser: false,
  runtime_bypasses_rls: false,
  runtime_can_create_roles: false,
  runtime_can_create_databases: false,
  runtime_is_neon_superuser_member: false,
  runtime_has_direct_table_access: false,
  runtime_has_direct_source_access: false,
  runtime_can_read_accepted_identity: true,
};

function harness(
  options: {
    isolation?: unknown[];
    rows?: unknown[];
    failOn?: string;
    closeFails?: boolean;
    rollbackFails?: boolean;
    clock?: Date;
  } = {},
) {
  const query = vi.fn<NeonImportPersistenceClient["query"]>(async (sql) => {
    if (options.failOn && sql.includes(options.failOn))
      throw Error("private provider detail");
    if (sql === "ROLLBACK" && options.rollbackFails)
      throw Error("private rollback detail");
    if (sql.includes("AS owner_scope"))
      return { rows: [{ owner_scope: databaseOwnerId }] };
    if (sql.includes("FROM dna.app_owner"))
      return { rows: options.isolation ?? [isolation] };
    if (sql.includes("FROM dna.read_maiden_allocation"))
      return { rows: options.rows ?? [stored] };
    return { rows: [] };
  });
  const close = vi.fn(async () => {
    if (options.closeFails) throw Error("private close detail");
  });
  const factory = vi.fn(async () => ({ client: { query }, close }));
  const repository = createNeonMaidenAllocationRepository({
    databaseUrl: "postgresql://synthetic.invalid/dna",
    databaseOwnerId,
    authenticatedOwnerId,
    runtimeRole: "dna_app_runtime",
    sessionFactory: factory,
    now: () => options.clock ?? now,
  });
  if (repository.status !== "ready") throw Error("test repository not ready");
  return { repository, query, close, factory };
}

const unavailable = "Maiden allocation evidence read unavailable.";

describe("compact Neon Maiden allocation evidence dependency", () => {
  it("composes only a complete server-side owner environment", () => {
    expect(
      neonMaidenAllocationRepositoryFromEnvironment({
        databaseUrl: undefined,
        databaseOwnerId,
        runtimeRole: "dna_app_runtime",
        authenticatedOwnerId,
      }),
    ).toEqual({ status: "not_configured" });

    expect(
      neonMaidenAllocationRepositoryFromEnvironment(
        {
          databaseUrl: "postgresql://synthetic.invalid/dna",
          databaseOwnerId,
          runtimeRole: "dna_app_runtime",
          authenticatedOwnerId,
        },
        async () => {
          throw new Error("must not connect while composing");
        },
      ).status,
    ).toBe("ready");
  });

  it("uses one bounded owner-scoped read and the unchanged approved allocator", async () => {
    const test = harness();
    await expect(
      loadMaidenWorkspacePageState({
        authenticatedOwnerId,
        configuredOwnerId: authenticatedOwnerId,
        repository: test.repository,
        now,
      }),
    ).resolves.toMatchObject({
      connectionStatus: "read_model_connected",
      lastImportedAt: "2026-10-14T01:00:00.000Z",
      sourceEvidenceSha256,
      snapshotSha256: encoded.sha256,
      materializedAt: now.toISOString(),
      allocation: {
        assignments: [{ candidateId: candidate.candidateId }],
        actionableRecommendationAllowed: false,
        maidenCommitmentAllowed: false,
        automaticEntryAllowed: false,
      },
    });
    expect(test.query.mock.calls[0]?.[0]).toBe(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    expect(test.query.mock.calls[1]?.[0]).toContain("statement_timeout");
    const reads = test.query.mock.calls.filter(([sql]) =>
      sql.includes("FROM dna.read_maiden_allocation"),
    );
    expect(reads).toHaveLength(1);
    expect(reads[0]?.[0]).toContain(
      "read_maiden_allocation_accepted_source_identity",
    );
    expect(reads[0]?.[1]).toEqual([databaseOwnerId]);
    expect(test.query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
    expect(test.close).toHaveBeenCalledOnce();
  });

  it("keeps a configured but unmaterialized read model explicitly empty", async () => {
    const test = harness({ rows: [] });
    await expect(
      loadMaidenWorkspacePageState({
        authenticatedOwnerId,
        configuredOwnerId: authenticatedOwnerId,
        repository: test.repository,
        now,
      }),
    ).resolves.toEqual({
      allocation: null,
      lastImportedAt: null,
      sourceEvidenceSha256: null,
      snapshotSha256: null,
      materializedAt: null,
      connectionStatus: "read_model_connected",
    });
    expect(test.query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
  });

  it("denies a different owner and invalid clock before persistence", async () => {
    const test = harness();
    await expect(
      test.repository.loadAllocationEvidenceByOwner("user_other"),
    ).rejects.toThrow(unavailable);
    expect(test.factory).not.toHaveBeenCalled();

    const invalid = harness({ clock: new Date("invalid") });
    await expect(
      invalid.repository.loadAllocationEvidenceByOwner(authenticatedOwnerId),
    ).rejects.toThrow(unavailable);
    expect(invalid.factory).not.toHaveBeenCalled();
  });

  it.each([
    { rows: [stored, stored] },
    { rows: [{ ...stored, source_evidence_sha256: "b".repeat(64) }] },
    { rows: [{ ...stored, snapshot_json: encoded.json + " " }] },
    { rows: [{ ...stored, snapshot_sha256: "b".repeat(64) }] },
    { rows: [{ ...stored, source_evidence_sha256: "invalid" }] },
    { rows: [{ snapshot_json: 1 }] },
  ])(
    "rejects corrupt, duplicate or source-mismatched rows %#",
    async (options) => {
      const test = harness(options);
      await expect(
        test.repository.loadAllocationEvidenceByOwner(authenticatedOwnerId),
      ).rejects.toThrow(unavailable);
      expect(test.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
      expect(test.close).toHaveBeenCalledOnce();
    },
  );

  it.each([
    { database_owner_id: "22222222-2222-4222-8222-222222222222" },
    { authenticated_owner_id: "other" },
    { row_security_enabled: false },
    { force_row_security_enabled: false },
    { source_row_security_enabled: false },
    { source_force_row_security_enabled: false },
    { session_user_name: "postgres" },
    { current_user_name: "postgres" },
    { runtime_is_superuser: true },
    { runtime_bypasses_rls: true },
    { runtime_can_create_roles: true },
    { runtime_can_create_databases: true },
    { runtime_is_neon_superuser_member: true },
    { runtime_has_direct_table_access: true },
    { runtime_has_direct_source_access: true },
    { runtime_can_read_accepted_identity: false },
    { runtime_is_superuser: "false" },
  ])(
    "denies invalid owner isolation before snapshot access %#",
    async (changes) => {
      const test = harness({ isolation: [{ ...isolation, ...changes }] });
      await expect(
        test.repository.loadAllocationEvidenceByOwner(authenticatedOwnerId),
      ).rejects.toThrow(unavailable);
      expect(
        test.query.mock.calls.some(([sql]) =>
          sql.includes("FROM dna.read_maiden_allocation"),
        ),
      ).toBe(false);
    },
  );

  it.each([
    "BEGIN",
    "set_config",
    "FROM dna.app_owner",
    "FROM dna.read_maiden_allocation",
    "COMMIT",
  ])("sanitizes %s errors, rolls back and closes", async (failOn) => {
    const test = harness({ failOn, rollbackFails: true });
    await expect(
      test.repository.loadAllocationEvidenceByOwner(authenticatedOwnerId),
    ).rejects.toThrow(unavailable);
    expect(test.close).toHaveBeenCalledOnce();
    if (failOn !== "BEGIN")
      expect(test.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
  });

  it("does not reveal connection or close failures", async () => {
    const closing = harness({ closeFails: true });
    await expect(
      closing.repository.loadAllocationEvidenceByOwner(authenticatedOwnerId),
    ).rejects.toThrow(unavailable);

    const connecting = harness();
    connecting.factory.mockRejectedValueOnce(
      Error("private connection detail"),
    );
    await expect(
      connecting.repository.loadAllocationEvidenceByOwner(authenticatedOwnerId),
    ).rejects.toThrow(unavailable);
  });

  it("re-derives stale evidence without changing the projected value", async () => {
    const test = harness({ clock: new Date("2026-11-15T00:00:00.000Z") });
    const result =
      await test.repository.loadAllocationEvidenceByOwner(authenticatedOwnerId);
    expect(result?.evidence.candidates[0]).toMatchObject({
      projectedValueBasisPoints: 8_500,
      freshness: "stale",
    });
  });
});
