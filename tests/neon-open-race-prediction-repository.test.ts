import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { freezeRacePredictionSnapshot } from "@/domain/race-prediction-snapshot";
import { applyRacePredictionReconciliation } from "@/domain/race-prediction-reconciliation";
import type { NeonImportPersistenceClient } from "@/lib/neon-import-persistence-driver";
import {
  createNeonOpenRacePredictionRepository,
  neonOpenRacePredictionRepositoryFromEnvironment,
} from "@/lib/neon-open-race-prediction-repository";

const owner = "11111111-1111-4111-8111-111111111111";
const identity = "user_synthetic_owner";
const publishedAt = "2026-10-17T05:01:00.000Z";

function snapshot() {
  return freezeRacePredictionSnapshot({
    snapshotId: "prediction-event-1-v1",
    eventId: "event-1",
    predictedAt: "2026-10-17T05:00:00.000Z",
    eventStartsAt: "2026-10-17T06:00:00.000Z",
    evidenceCutoff: "2026-10-17T03:00:00.000Z",
    modelVersion: "model-v1",
    context: {
      mode: "horse",
      distanceMeters: 1_600,
      competition: "normal",
      format: "4-gate",
      gateCount: 4,
      element: { status: "unknown", value: null },
    },
    field: {
      fieldVersion: "field-v1",
      fieldCapturedAt: "2026-10-17T04:00:00.000Z",
      enteredCoreIds: ["owned-1", "opponent-1", "opponent-2", "opponent-3"],
    },
    sources: {
      sessionVersion: "session-locked-v1",
      eligibilityVersion: "eligibility-v1",
      raceImportVersion: "race-v1",
      vaultSnapshotVersion: "vault-v1",
      historicalAggregateVersion: "aggregate-v1",
      historyGenerationVersion: "history-v1",
      historySourceIdentitySha256: "a".repeat(64),
      lockVersion: "lock-v1",
    },
    predictions: ["win", "place", "blue_star", "yellow_star"].map((target) => ({
      coreId: "owned-1",
      target: target as "win" | "place" | "blue_star" | "yellow_star",
      status: "unavailable" as const,
      probabilityMillionths: null,
      evidenceStatus: "insufficient" as const,
      calculationId: null,
    })),
  });
}

function row(overrides: Record<string, unknown> = {}) {
  const value = snapshot();
  const json = JSON.stringify({
    version: 1,
    databaseOwnerId: owner,
    requestId: "request-1",
    publishedAt,
    snapshot: value,
  });
  return {
    snapshot_id: value.snapshotId,
    request_id: "request-1",
    event_id: value.eventId,
    predicted_at: value.predictedAt,
    published_at: publishedAt,
    snapshot_sha256: createHash("sha256").update(json).digest("hex"),
    snapshot_json: json,
    ...overrides,
  };
}

function reconciliation() {
  return applyRacePredictionReconciliation({
    reconciliationId: "reconciliation-event-1",
    snapshot: snapshot(),
    acceptedResult: {
      eventId: "event-1",
      sourceEvidenceId: "accepted-event-1-v1",
      sourceVersion: "race-import-v2",
      acceptedAt: "2026-10-17T06:03:00.000Z",
      eventCompletedAt: "2026-10-17T06:02:00.000Z",
      outcomeStatus: "complete",
      starDataStatus: "complete",
      entries: [
        {
          coreId: "owned-1",
          finishPosition: 1,
          goldStar: true,
          blueStar: true,
        },
        {
          coreId: "opponent-1",
          finishPosition: 2,
          goldStar: false,
          blueStar: false,
        },
        {
          coreId: "opponent-2",
          finishPosition: 3,
          goldStar: false,
          blueStar: false,
        },
        {
          coreId: "opponent-3",
          finishPosition: 4,
          goldStar: false,
          blueStar: false,
        },
      ],
    },
    revision: 0,
    correctsSourceEvidenceId: null,
    previous: null,
  }).reconciliation;
}

const reconciliationPublishedAt = "2026-10-17T06:04:00.000Z";

function reconciliationRow(overrides: Record<string, unknown> = {}) {
  const value = reconciliation();
  const json = JSON.stringify({
    version: 1,
    databaseOwnerId: owner,
    publishedAt: reconciliationPublishedAt,
    reconciliation: value,
  });
  return {
    reconciliation_id: value.reconciliationId,
    revision: value.revision,
    snapshot_id: value.snapshotId,
    event_id: value.eventId,
    source_evidence_id: value.sourceEvidenceId,
    accepted_at: value.acceptedAt,
    published_at: reconciliationPublishedAt,
    reconciliation_sha256: createHash("sha256").update(json).digest("hex"),
    reconciliation_json: json,
    ...overrides,
  };
}

const isolation = {
  database_owner_id: owner,
  authenticated_owner_id: identity,
  row_security_enabled: true,
  force_row_security_enabled: true,
  reconciliation_row_security_enabled: true,
  reconciliation_force_row_security_enabled: true,
  session_user_name: "dna_app_runtime",
  current_user_name: "dna_app_runtime",
  runtime_is_superuser: false,
  runtime_bypasses_rls: false,
  runtime_can_create_roles: false,
  runtime_can_create_databases: false,
  runtime_is_neon_superuser_member: false,
  runtime_has_direct_table_access: false,
  runtime_has_direct_reconciliation_access: false,
  runtime_can_read: true,
  runtime_can_publish: true,
  runtime_can_read_reconciliations: true,
  runtime_can_publish_reconciliations: true,
};

function harness(
  options: {
    rows?: unknown[];
    reconciliationRows?: unknown[];
    isolation?: unknown[];
    publicationStatus?: string;
    reconciliationPublicationStatus?: string;
    failOn?: string;
  } = {},
) {
  const query = vi.fn<NeonImportPersistenceClient["query"]>(async (sql) => {
    if (options.failOn && sql.includes(options.failOn))
      throw new Error("private provider detail");
    if (sql.includes("AS owner_scope"))
      return { rows: [{ owner_scope: owner }] };
    if (sql.includes("FROM dna.app_owner"))
      return { rows: options.isolation ?? [isolation] };
    if (sql.includes("FROM dna.read_open_race_prediction_snapshots"))
      return { rows: options.rows ?? [row()] };
    if (sql.includes("FROM dna.read_open_race_prediction_reconciliations"))
      return { rows: options.reconciliationRows ?? [reconciliationRow()] };
    if (sql.includes("dna.publish_open_race_prediction_snapshot")) {
      return { rows: [{ status: options.publicationStatus ?? "published" }] };
    }
    if (sql.includes("dna.publish_open_race_prediction_reconciliation")) {
      return {
        rows: [
          { status: options.reconciliationPublicationStatus ?? "published" },
        ],
      };
    }
    return { rows: [] };
  });
  const close = vi.fn(async () => undefined);
  const factory = vi.fn(async () => ({ client: { query }, close }));
  const repository = createNeonOpenRacePredictionRepository({
    databaseUrl: "postgresql://synthetic.invalid/dna",
    databaseOwnerId: owner,
    authenticatedOwnerId: identity,
    runtimeRole: "dna_app_runtime",
    sessionFactory: factory,
  });
  return { repository, query, close, factory };
}

const unavailable = "Open Race prediction persistence unavailable.";

describe("private Neon Open Race prediction persistence", () => {
  it("composes only a complete server-side owner environment", () => {
    expect(
      neonOpenRacePredictionRepositoryFromEnvironment({
        databaseUrl: undefined,
        databaseOwnerId: owner,
        runtimeRole: "dna_app_runtime",
        authenticatedOwnerId: identity,
      }),
    ).toEqual({ status: "not_configured" });
    expect(
      neonOpenRacePredictionRepositoryFromEnvironment(
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

  it("publishes an immutable owner-bound envelope in a serializable transaction", async () => {
    const h = harness();
    await expect(
      h.repository.publishSnapshotByOwner(identity, {
        requestId: "request-1",
        expectedWorkspaceSha256: "b".repeat(64),
        publishedAt,
        snapshot: snapshot(),
      }),
    ).resolves.toEqual({ status: "published" });
    expect(h.query.mock.calls[0]?.[0]).toBe(
      "BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE",
    );
    const publication = h.query.mock.calls.find(([sql]) =>
      sql.includes("SELECT dna.publish_open_race_prediction_snapshot"),
    );
    expect(publication?.[1]?.slice(0, 3)).toEqual([
      owner,
      "request-1",
      "b".repeat(64),
    ]);
    const envelope = JSON.parse(String(publication?.[1]?.[4])) as {
      databaseOwnerId: string;
      snapshot: ReturnType<typeof snapshot>;
    };
    expect(envelope.databaseOwnerId).toBe(owner);
    expect(envelope.snapshot.sources).toMatchObject({
      sessionVersion: "session-locked-v1",
      eligibilityVersion: "eligibility-v1",
      vaultSnapshotVersion: "vault-v1",
      lockVersion: "lock-v1",
    });
    expect(h.query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
  });

  it("loads and verifies bounded immutable snapshots", async () => {
    const h = harness();
    await expect(h.repository.listSnapshotsByOwner(identity)).resolves.toEqual([
      snapshot(),
    ]);
    expect(h.query.mock.calls[0]?.[0]).toBe(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    const read = h.query.mock.calls.find(([sql]) =>
      sql.includes("FROM dna.read_open_race_prediction_snapshots"),
    );
    expect(read?.[1]).toEqual([owner, 24]);
  });

  it("appends an owner-bound reconciliation without changing its frozen snapshot", async () => {
    const h = harness();
    await expect(
      h.repository.publishReconciliationByOwner(identity, {
        expectedSnapshotSha256: "c".repeat(64),
        publishedAt: reconciliationPublishedAt,
        reconciliation: reconciliation(),
      }),
    ).resolves.toEqual({ status: "published" });
    expect(h.query.mock.calls[0]?.[0]).toBe(
      "BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE",
    );
    const publication = h.query.mock.calls.find(([sql]) =>
      sql.includes("SELECT dna.publish_open_race_prediction_reconciliation"),
    );
    expect(publication?.[1]?.slice(0, 3)).toEqual([
      owner,
      "c".repeat(64),
      expect.stringMatching(/^[a-f0-9]{64}$/),
    ]);
    const envelope = JSON.parse(String(publication?.[1]?.[3])) as {
      databaseOwnerId: string;
      reconciliation: ReturnType<typeof reconciliation>;
    };
    expect(envelope.databaseOwnerId).toBe(owner);
    expect(envelope.reconciliation).toMatchObject({
      snapshotId: "prediction-event-1-v1",
      frozenPredictionMutated: false,
      historyUpdateAllowed: true,
    });
    expect(h.query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
  });

  it("loads and verifies bounded append-only reconciliation history", async () => {
    const h = harness();
    await expect(
      h.repository.listReconciliationsByOwner(identity),
    ).resolves.toEqual([reconciliation()]);
    expect(h.query.mock.calls[0]?.[0]).toBe(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    const read = h.query.mock.calls.find(([sql]) =>
      sql.includes("FROM dna.read_open_race_prediction_reconciliations"),
    );
    expect(read?.[1]).toEqual([owner, 48]);
  });

  it("denies another owner and unsafe runtime before prediction access", async () => {
    const h = harness();
    await expect(
      h.repository.listSnapshotsByOwner("user_other"),
    ).rejects.toThrow(unavailable);
    expect(h.factory).not.toHaveBeenCalled();
    const unsafe = harness({
      isolation: [{ ...isolation, runtime_has_direct_table_access: true }],
    });
    await expect(
      unsafe.repository.listSnapshotsByOwner(identity),
    ).rejects.toThrow(unavailable);
    expect(
      unsafe.query.mock.calls.some(([sql]) =>
        sql.includes("FROM dna.read_open_race_prediction_snapshots"),
      ),
    ).toBe(false);
    await expect(
      h.repository.publishReconciliationByOwner("user_other", {
        expectedSnapshotSha256: "c".repeat(64),
        publishedAt: reconciliationPublishedAt,
        reconciliation: reconciliation(),
      }),
    ).rejects.toThrow(unavailable);
  });

  it("refuses to publish a forecast at or after the event start", async () => {
    const h = harness();
    await expect(
      h.repository.publishSnapshotByOwner(identity, {
        requestId: "request-1",
        expectedWorkspaceSha256: "b".repeat(64),
        publishedAt: "2026-10-17T06:00:00.000Z",
        snapshot: snapshot(),
      }),
    ).rejects.toThrow(unavailable);
    expect(h.factory).not.toHaveBeenCalled();
  });

  it("rejects corrupted rows and sanitizes provider errors", async () => {
    const corrupt = harness({
      rows: [row({ snapshot_sha256: "c".repeat(64) })],
    });
    await expect(
      corrupt.repository.listSnapshotsByOwner(identity),
    ).rejects.toThrow(unavailable);
    expect(corrupt.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
    const failed = harness({ failOn: "read_open_race_prediction_snapshots" });
    await expect(
      failed.repository.listSnapshotsByOwner(identity),
    ).rejects.toThrow(unavailable);
    expect(failed.close).toHaveBeenCalledOnce();
    const corruptReconciliation = harness({
      reconciliationRows: [
        reconciliationRow({ reconciliation_sha256: "d".repeat(64) }),
      ],
    });
    await expect(
      corruptReconciliation.repository.listReconciliationsByOwner(identity),
    ).rejects.toThrow(unavailable);
  });
});
