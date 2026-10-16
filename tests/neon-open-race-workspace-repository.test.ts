import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { NeonImportPersistenceClient } from "@/lib/neon-import-persistence-driver";
import {
  createNeonOpenRaceWorkspaceRepository,
  neonOpenRaceWorkspaceRepositoryFromEnvironment,
} from "@/lib/neon-open-race-workspace-repository";
import {
  loadOpenRaceWorkspacePageState,
  type OpenRaceWorkspaceEvidence,
} from "@/lib/open-race-workspace-service";

const owner = "11111111-1111-4111-8111-111111111111";
const identity = "user_synthetic_owner";
const publishedAt = "2026-07-20T02:05:00.000Z";
const evidence: OpenRaceWorkspaceEvidence = {
  bindings: {
    sessionVersion: "session-v1",
    fieldVersion: "field-v1",
    eligibilityVersion: "eligibility-v1",
    historicalAggregateVersion: "aggregate-v4",
    raceImportVersion: "race-import-v7",
    vaultSnapshotVersion: "vault-v3",
    rankingVersion: null,
    lockVersion: null,
    observationVersion: null,
    comparisonVersion: null,
  },
  field: {
    requestId: "synthetic-request",
    capturedAt: "2026-07-20T02:00:00.000Z",
    dataCurrentThrough: "2026-07-20T00:00:00.000Z",
    lastImported: "2026-07-20T01:00:00.000Z",
    freshness: "current",
    mode: "horse",
    distanceMeters: 1_600,
    gateCount: 4,
    availableGates: 1,
    raceFormat: "Synthetic",
    entryFee: null,
    opponents: ["opponent-a", "opponent-b", "opponent-c"].map((coreId) => ({
      coreId,
      identityStatus: "confirmed" as const,
    })),
    restrictions: [],
  },
  eligibility: {
    evaluationId: "synthetic-eligibility",
    evaluatedAt: "2026-07-20T02:00:00.000Z",
    vaultDataCurrentThrough: "2026-07-20T00:00:00.000Z",
    freshness: "current",
    rules: {
      ruleSetId: "synthetic-rules",
      evidenceStatus: "confirmed",
      allowedClasses: null,
      allowedElements: null,
      minimumFNumber: null,
      maximumFNumber: null,
      maidenRequirement: "not_restricted",
    },
    cores: [
      {
        coreId: "owned-a",
        activeOwnership: "confirmed",
        availability: "available",
        coreClass: "Genesis",
        element: "Fire",
        fNumber: 1,
        maidenState: "not_eligible",
        attributeEvidence: "complete",
      },
    ],
  },
  ranking: null,
  lock: null,
  observation: null,
  comparison: null,
};

const rankedEvidence: OpenRaceWorkspaceEvidence = {
  ...evidence,
  bindings: { ...evidence.bindings, rankingVersion: "ranking-v1" },
  ranking: {
    rankingId: "ranking-v1",
    evaluatedAt: "2026-07-20T02:01:00.000Z",
    dataCurrentThrough: "2026-07-20T00:00:00.000Z",
    freshness: "current",
    fieldStage: "forming",
    mode: "horse",
    distanceMeters: 1_600,
    materialGapMs: 50,
    candidates: [
      {
        coreId: "owned-a",
        eligibilityStatus: "eligible",
        mode: "horse",
        distanceMeters: 1_600,
        profile: {
          optimisticTimeMs: 59_000,
          medianTimeMs: 60_000,
          conservativeTimeMs: 61_000,
          sampleCount: 12,
          sampleStatus: "minimally_analytical",
        },
        historicalStars: {
          goldReceived: 2,
          goldOpportunities: 10,
          blueReceived: 3,
          blueOpportunities: 12,
          evidenceStatus: "complete",
          rationale: ["Synthetic history."],
        },
      },
    ],
    opponents: evidence.field.opponents.map((opponent) => ({
      ...opponent,
      mode: "horse" as const,
      distanceMeters: 1_600,
      profile: {
        optimisticTimeMs: 59_500,
        medianTimeMs: 60_500,
        conservativeTimeMs: 61_500,
        sampleCount: 12,
        sampleStatus: "minimally_analytical" as const,
      },
    })),
  },
};

function row(
  overrides: Record<string, unknown> = {},
  snapshotEvidence: OpenRaceWorkspaceEvidence = evidence,
) {
  const snapshot = JSON.stringify({
    version: 1,
    databaseOwnerId: owner,
    publishedAt,
    evidence: snapshotEvidence,
  });
  return {
    request_id: snapshotEvidence.field.requestId,
    session_version: snapshotEvidence.bindings.sessionVersion,
    field_version: snapshotEvidence.bindings.fieldVersion,
    eligibility_version: snapshotEvidence.bindings.eligibilityVersion,
    race_import_version: snapshotEvidence.bindings.raceImportVersion,
    vault_snapshot_version: snapshotEvidence.bindings.vaultSnapshotVersion,
    historical_aggregate_version:
      snapshotEvidence.bindings.historicalAggregateVersion,
    mode: snapshotEvidence.field.mode,
    distance_meters: snapshotEvidence.field.distanceMeters,
    field_captured_at: snapshotEvidence.field.capturedAt,
    latest_accepted_race_import_at: "2026-07-20T01:00:00.000Z",
    latest_accepted_vault_import_at: "2026-07-20T01:00:00.000Z",
    published_at: publishedAt,
    snapshot_sha256: createHash("sha256").update(snapshot).digest("hex"),
    snapshot_json: snapshot,
    ...overrides,
  };
}

const isolation = {
  database_owner_id: owner,
  authenticated_owner_id: identity,
  row_security_enabled: true,
  force_row_security_enabled: true,
  session_user_name: "dna_app_runtime",
  current_user_name: "dna_app_runtime",
  runtime_is_superuser: false,
  runtime_bypasses_rls: false,
  runtime_can_create_roles: false,
  runtime_can_create_databases: false,
  runtime_is_neon_superuser_member: false,
  runtime_has_direct_table_access: false,
  runtime_can_read_sessions: true,
  runtime_can_publish_field_lock: true,
};

function harness(
  options: {
    rows?: unknown[];
    isolation?: unknown[];
    failOn?: string;
    closeFails?: boolean;
    rollbackFails?: boolean;
  } = {},
) {
  const query = vi.fn<NeonImportPersistenceClient["query"]>(async (sql) => {
    if (options.failOn && sql.includes(options.failOn))
      throw new Error("private provider detail");
    if (sql === "ROLLBACK" && options.rollbackFails)
      throw new Error("private rollback detail");
    if (sql.includes("AS owner_scope"))
      return { rows: [{ owner_scope: owner }] };
    if (sql.includes("FROM dna.app_owner"))
      return { rows: options.isolation ?? [isolation] };
    if (sql.includes("FROM dna.read_open_race_workspace_sessions"))
      return { rows: options.rows ?? [row()] };
    if (sql.includes("dna.publish_open_race_field_lock"))
      return { rows: [{ status: "published" }] };
    return { rows: [] };
  });
  const close = vi.fn(async () => {
    if (options.closeFails) throw new Error("private close detail");
  });
  const factory = vi.fn(async () => ({ client: { query }, close }));
  const repository = createNeonOpenRaceWorkspaceRepository({
    databaseUrl: "postgresql://synthetic.invalid/dna",
    databaseOwnerId: owner,
    authenticatedOwnerId: identity,
    runtimeRole: "dna_app_runtime",
    sessionFactory: factory,
  });
  if (repository.status !== "ready") throw new Error("repository not ready");
  return { repository, query, close, factory };
}

const unavailable = "Open Race workspace persistence unavailable.";

describe("compact Neon Open Race workspace dependency", () => {
  it("composes only a complete server-side owner environment", () => {
    expect(
      neonOpenRaceWorkspaceRepositoryFromEnvironment({
        databaseUrl: undefined,
        databaseOwnerId: owner,
        runtimeRole: "dna_app_runtime",
        authenticatedOwnerId: identity,
      }),
    ).toEqual({ status: "not_configured" });
    expect(
      neonOpenRaceWorkspaceRepositoryFromEnvironment(
        {
          databaseUrl: "postgresql://synthetic.invalid/dna",
          databaseOwnerId: owner,
          runtimeRole: "dna_app_runtime",
          authenticatedOwnerId: identity,
        },
        async () => {
          throw new Error("must not connect while composing");
        },
      ).status,
    ).toBe("ready");
  });

  it("loads one exact session through a bounded read-only owner transaction", async () => {
    const h = harness();
    await expect(
      loadOpenRaceWorkspacePageState({
        authenticatedOwnerId: identity,
        configuredOwnerId: identity,
        repository: h.repository,
        now: new Date("2026-07-23T00:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      connectionStatus: "read_model_connected",
      sessions: [
        {
          stage: "field_forming",
          mutationAllowed: false,
          liveGameConnection: false,
          field: { mode: "horse", distanceMeters: 1_600 },
        },
      ],
    });
    expect(h.query.mock.calls[0]?.[0]).toBe(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    const reads = h.query.mock.calls.filter(([sql]) =>
      sql.includes("FROM dna.read_open_race_workspace_sessions"),
    );
    expect(reads).toHaveLength(1);
    expect(reads[0]?.[1]).toEqual([owner, 24]);
    expect(h.query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
    expect(h.close).toHaveBeenCalledOnce();
  });

  it("publishes a server-derived field lock without accepting Stage A evidence from the browser", async () => {
    const h = harness({ rows: [row({}, rankedEvidence)] });
    await expect(
      h.repository.lockSessionByOwner?.(identity, {
        requestId: rankedEvidence.field.requestId,
        selectedOwnedCoreId: "owned-a",
        lockedAt: "2026-07-23T00:00:00.000Z",
        userConfirmedCommittedEntry: true,
        raceSetToRun: true,
      }),
    ).resolves.toEqual({ status: "published" });
    expect(h.query.mock.calls[0]?.[0]).toBe(
      "BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE",
    );
    const publication = h.query.mock.calls.find(([sql]) =>
      sql.includes("SELECT dna.publish_open_race_field_lock"),
    );
    expect(publication?.[1]?.slice(0, 5)).toEqual([
      owner,
      rankedEvidence.field.requestId,
      row({}, rankedEvidence).snapshot_sha256,
      rankedEvidence.bindings.sessionVersion,
      "2026-07-23T00:00:00.000Z",
    ]);
    const envelope = JSON.parse(String(publication?.[1]?.[6])) as {
      evidence: OpenRaceWorkspaceEvidence;
    };
    expect(envelope.evidence.field).toEqual(rankedEvidence.field);
    expect(envelope.evidence.eligibility).toEqual(rankedEvidence.eligibility);
    expect(envelope.evidence.ranking).toEqual(rankedEvidence.ranking);
    expect(envelope.evidence.lock).toMatchObject({
      requestId: rankedEvidence.field.requestId,
      selectedOwnedCoreId: "owned-a",
      userConfirmedCommittedEntry: true,
      raceSetToRun: true,
      availableGates: 0,
    });
    expect(envelope.evidence.observation).toBeNull();
    expect(envelope.evidence.comparison).toBeNull();
    expect(h.query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
  });

  it("denies another authenticated owner before opening persistence", async () => {
    const h = harness();
    await expect(
      h.repository.listSessionEvidenceByOwner("user_other"),
    ).rejects.toThrow(unavailable);
    expect(h.factory).not.toHaveBeenCalled();
  });

  it("returns an empty connected read model when no session is published", async () => {
    const h = harness({ rows: [] });
    await expect(
      h.repository.listSessionEvidenceByOwner(identity),
    ).resolves.toEqual({
      sessions: [],
      latestAcceptedRaceImportAt: null,
      latestAcceptedVaultImportAt: null,
      latestAcceptedRaceImportVersion: null,
      latestAcceptedVaultSnapshotVersion: null,
      latestPublishedHistoricalAggregateVersion: null,
    });
    expect(h.query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
  });

  it.each([
    { snapshot_sha256: "b".repeat(64) },
    { mode: "bike" },
    { distance_meters: 1_200 },
    { race_import_version: "race-import-v8" },
    { snapshot_json: 1 },
  ])("rejects corrupt or source-mismatched snapshots %#", async (overrides) => {
    const h = harness({ rows: [row(overrides)] });
    await expect(
      h.repository.listSessionEvidenceByOwner(identity),
    ).rejects.toThrow(unavailable);
    expect(h.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
    expect(h.close).toHaveBeenCalledOnce();
  });

  it.each([
    { row_security_enabled: false },
    { force_row_security_enabled: false },
    { runtime_is_superuser: true },
    { runtime_bypasses_rls: true },
    { runtime_has_direct_table_access: true },
    { runtime_can_read_sessions: false },
    { runtime_can_publish_field_lock: false },
  ])(
    "denies an unsafe runtime before snapshot access %#",
    async (overrides) => {
      const h = harness({ isolation: [{ ...isolation, ...overrides }] });
      await expect(
        h.repository.listSessionEvidenceByOwner(identity),
      ).rejects.toThrow(unavailable);
      expect(
        h.query.mock.calls.some(([sql]) =>
          sql.includes("FROM dna.read_open_race_workspace_sessions"),
        ),
      ).toBe(false);
    },
  );

  it.each([
    "BEGIN",
    "set_config",
    "FROM dna.app_owner",
    "FROM dna.read_open_race_workspace_sessions",
    "COMMIT",
  ])("sanitizes %s errors and closes the session", async (failOn) => {
    const h = harness({ failOn, rollbackFails: true });
    await expect(
      h.repository.listSessionEvidenceByOwner(identity),
    ).rejects.toThrow(unavailable);
    expect(h.close).toHaveBeenCalledOnce();
  });

  it("does not reveal connection or close errors", async () => {
    const closing = harness({ closeFails: true });
    await expect(
      closing.repository.listSessionEvidenceByOwner(identity),
    ).rejects.toThrow(unavailable);
    const connecting = harness();
    connecting.factory.mockRejectedValueOnce(
      new Error("private connection detail"),
    );
    await expect(
      connecting.repository.listSessionEvidenceByOwner(identity),
    ).rejects.toThrow(unavailable);
  });
});
