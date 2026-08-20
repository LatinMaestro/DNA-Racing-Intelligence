import { describe, expect, it, vi } from "vitest";

import {
  createNeonImportActivationRepositories,
  neonImportActivationRepositoriesFromEnvironment,
} from "../lib/neon-import-activation";
import type {
  NeonImportPersistenceClient,
  NeonImportPersistenceSessionFactory,
} from "../lib/neon-import-persistence-driver";

const databaseOwnerId = "11111111-1111-4111-8111-111111111111";
const ownerId = "owner-1";
const runtimeRole = "dna_app_runtime";
const updateSessionId = "22222222-2222-4222-8222-222222222222";
const dispatchId = "33333333-3333-4333-8333-333333333333";
const sourceHash = "a".repeat(64);

function evidence(overrides: Record<string, unknown> = {}) {
  return {
    database_owner_id: databaseOwnerId,
    authenticated_owner_id: ownerId,
    dispatch_rls: true,
    dispatch_force_rls: true,
    processing_rls: true,
    processing_force_rls: true,
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
      const normalized = statement.replace(/\s+/g, " ").trim();
      events.push(
        values ? `${normalized}|${JSON.stringify(values)}` : normalized,
      );
      if (
        normalized === "BEGIN ISOLATION LEVEL SERIALIZABLE" ||
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
  return {
    events,
    query,
    sessionFactory: sessionFactory as NeonImportPersistenceSessionFactory,
  };
}

function repositories(test: ReturnType<typeof harness>) {
  return createNeonImportActivationRepositories({
    databaseUrl: "postgresql://private.example/dna",
    databaseOwnerId,
    runtimeRole,
    sessionFactory: test.sessionFactory,
  });
}

describe("Neon import activation repositories", () => {
  it("fails closed until every server-only database setting exists", () => {
    expect(
      neonImportActivationRepositoriesFromEnvironment({
        databaseUrl: undefined,
        databaseOwnerId,
        runtimeRole,
      }),
    ).toBeNull();
  });

  it("reserves a confirmed Preview through forced owner isolation", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [evidence()],
      [
        {
          disposition: "created",
          update_session_id: updateSessionId,
          dispatch_id: dispatchId,
          dispatch_state: "pending",
        },
      ],
    ]);

    await expect(
      repositories(test).activationRepository.reserveConfirmedUpdate({
        ownerId,
        previewId: "preview-1",
        previewFingerprintSha256: sourceHash,
        idempotencyKey: "confirm-1",
        confirmedAt: "2026-08-21T00:00:00.000Z",
      }),
    ).resolves.toEqual({
      disposition: "created",
      updateSessionId,
      dispatchId,
      dispatchState: "pending",
    });
    expect(test.query.mock.calls[3]?.[1]).toEqual([
      databaseOwnerId,
      "preview-1",
      sourceHash,
      "confirm-1",
      "2026-08-21T00:00:00.000Z",
    ]);
    expect(test.events.slice(-2)).toEqual(["COMMIT", "close"]);
  });

  it("maps claimed and leased worker outcomes without trusting message ownership", async () => {
    const claimed = harness([
      [{ owner_scope: databaseOwnerId }],
      [evidence()],
      [
        {
          status: "claimed",
          authenticated_owner_id: ownerId,
          update_session_id: updateSessionId,
          preview_fingerprint_sha256: sourceHash,
          retry_after: null,
        },
      ],
    ]);
    await expect(
      repositories(claimed).processingRepository.claimDispatch({
        dispatchId,
        workerId: "activation-worker-1",
        claimedAt: "2026-08-21T00:01:00.000Z",
        leaseExpiresAt: "2026-08-21T00:06:00.000Z",
      }),
    ).resolves.toEqual({
      status: "claimed",
      ownerId,
      updateSessionId,
      previewFingerprintSha256: sourceHash,
    });
    expect(claimed.query.mock.calls[2]?.[1]).toEqual([databaseOwnerId, null]);

    const leased = harness([
      [{ owner_scope: databaseOwnerId }],
      [evidence()],
      [
        {
          status: "leased_elsewhere",
          update_session_id: updateSessionId,
          retry_after: "2026-08-21T00:06:00.000Z",
        },
      ],
    ]);
    await expect(
      repositories(leased).processingRepository.claimDispatch({
        dispatchId,
        workerId: "activation-worker-2",
        claimedAt: "2026-08-21T00:02:00.000Z",
        leaseExpiresAt: "2026-08-21T00:07:00.000Z",
      }),
    ).resolves.toEqual({
      status: "leased_elsewhere",
      retryAfter: "2026-08-21T00:06:00.000Z",
    });
  });

  it("activates only the exact bounded prepared evidence", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [evidence()],
      [],
    ]);
    await repositories(test).processingRepository.activatePreparedResult({
      ownerId,
      updateSessionId,
      dispatchId,
      preparedResultId: "prepared-1",
      completedAt: "2026-08-21T00:05:00.000Z",
      sourceVersionCount: 9,
      quarantinedRecordCount: 2,
      aggregateRefreshRequired: true,
    });
    expect(test.query.mock.calls[3]?.[1]).toEqual([
      databaseOwnerId,
      updateSessionId,
      dispatchId,
      "prepared-1",
      "2026-08-21T00:05:00.000Z",
      9,
      2,
      true,
    ]);
  });

  it("rejects unsupported durable failure reasons before database access", async () => {
    const test = harness([]);
    const configured = repositories(test);
    await expect(
      configured.activationRepository.markDispatchFailed({
        ownerId,
        updateSessionId,
        dispatchId,
        failedAt: "2026-08-21T00:05:00.000Z",
        reason: "wrong" as "queue_unavailable",
      }),
    ).rejects.toThrow("failure reason is unsupported");
    expect(test.query).not.toHaveBeenCalled();
  });

  it("rolls back before activation when the runtime can bypass RLS", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [evidence({ runtime_bypasses_rls: true })],
    ]);
    await expect(
      repositories(test).processingRepository.activatePreparedResult({
        ownerId,
        updateSessionId,
        dispatchId,
        preparedResultId: "prepared-1",
        completedAt: "2026-08-21T00:05:00.000Z",
        sourceVersionCount: 9,
        quarantinedRecordCount: 0,
        aggregateRefreshRequired: true,
      }),
    ).rejects.toThrow("runtime role is not least privileged");
    expect(test.events.slice(-2)).toEqual(["ROLLBACK", "close"]);
    expect(
      test.events.some((event) => event.includes("complete_import_activation")),
    ).toBe(false);
  });
});
