import { describe, expect, it, vi } from "vitest";

import {
  hostedImportActivationWorkerRuntime,
  type HostedImportActivationWorkerEnvironment,
} from "../lib/hosted-import-activation-worker-runtime";
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

function environment(
  overrides: Partial<HostedImportActivationWorkerEnvironment> = {},
): HostedImportActivationWorkerEnvironment {
  return {
    workerId: "activation-worker-1",
    database: {
      databaseUrl: "postgresql://private.example/dna",
      databaseOwnerId,
      runtimeRole,
    },
    leaseDurationMilliseconds: "300000",
    maximumSourceVersions: "24",
    maximumQuarantinedRecords: "1000000",
    ...overrides,
  };
}

function isolationEvidence() {
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
  };
}

function sessionHarness(rows: readonly (readonly unknown[])[]) {
  let index = 0;
  const query = vi.fn(
    async (statement: string, values?: readonly unknown[]) => {
      const normalized = statement.replace(/\s+/g, " ").trim();
      if (
        normalized === "BEGIN ISOLATION LEVEL SERIALIZABLE" ||
        normalized === "COMMIT" ||
        normalized === "ROLLBACK"
      ) {
        return { rows: [] };
      }
      return { rows: rows[index++] ?? [], values };
    },
  );
  const client: NeonImportPersistenceClient = { query };
  const sessionFactory = vi.fn(async () => ({
    client,
    close: async () => undefined,
  }));
  return {
    query,
    sessionFactory: sessionFactory as NeonImportPersistenceSessionFactory,
  };
}

function message() {
  return {
    version: 1 as const,
    kind: "import_activation" as const,
    dispatchId,
  };
}

describe("hosted import activation worker runtime", () => {
  it("fails closed when identity, bounds, or database settings are incomplete", () => {
    expect(
      hostedImportActivationWorkerRuntime({
        environment: environment({ workerId: undefined }),
      }),
    ).toEqual({ status: "not_configured" });
    expect(
      hostedImportActivationWorkerRuntime({
        environment: environment({ leaseDurationMilliseconds: "999" }),
      }),
    ).toEqual({ status: "not_configured" });
    expect(
      hostedImportActivationWorkerRuntime({
        environment: environment({ maximumSourceVersions: "25" }),
      }),
    ).toEqual({ status: "not_configured" });
    expect(
      hostedImportActivationWorkerRuntime({
        environment: environment({ maximumQuarantinedRecords: "0" }),
      }),
    ).toEqual({ status: "not_configured" });
    expect(
      hostedImportActivationWorkerRuntime({
        environment: environment({
          database: {
            databaseUrl: undefined,
            databaseOwnerId,
            runtimeRole,
          },
        }),
      }),
    ).toEqual({ status: "not_configured" });
  });

  it("consumes one delivery through claim, bounded preparation, and activation", async () => {
    const database = sessionHarness([
      [{ owner_scope: databaseOwnerId }],
      [isolationEvidence()],
      [
        {
          status: "claimed",
          authenticated_owner_id: ownerId,
          update_session_id: updateSessionId,
          preview_fingerprint_sha256: sourceHash,
          retry_after: null,
        },
      ],
      [{ owner_scope: databaseOwnerId }],
      [isolationEvidence()],
      [
        {
          prepared_result_id: "prepared-result-1",
          source_version_count: "9",
          quarantined_record_count: "2",
          aggregate_refresh_required: true,
        },
      ],
      [{ owner_scope: databaseOwnerId }],
      [isolationEvidence()],
      [],
    ]);
    const runtime = hostedImportActivationWorkerRuntime({
      environment: environment(),
      dependencies: {
        neonSessionFactory: database.sessionFactory,
        now: () => new Date("2026-08-21T02:00:00.000Z"),
      },
    });
    expect(runtime.status).toBe("ready");
    if (runtime.status !== "ready") throw new Error("expected ready runtime");

    await expect(runtime.consume({ body: message() })).resolves.toEqual({
      disposition: "acknowledge",
      reason: "completed",
    });
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining("dna.claim_import_activation_dispatch"),
      [
        databaseOwnerId,
        dispatchId,
        "activation-worker-1",
        "2026-08-21T02:00:00.000Z",
        "2026-08-21T02:05:00.000Z",
      ],
    );
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining("dna.prepare_import_activation_dataset"),
      [databaseOwnerId, updateSessionId, dispatchId, sourceHash, 24],
    );
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining("dna.complete_import_activation"),
      [
        databaseOwnerId,
        updateSessionId,
        dispatchId,
        "prepared-result-1",
        "2026-08-21T02:00:00.000Z",
        9,
        2,
        true,
      ],
    );
  });

  it("returns the durable lease retry without preparing the dataset", async () => {
    const database = sessionHarness([
      [{ owner_scope: databaseOwnerId }],
      [isolationEvidence()],
      [
        {
          status: "leased_elsewhere",
          update_session_id: updateSessionId,
          retry_after: "2026-08-21T02:04:00.000Z",
        },
      ],
    ]);
    const runtime = hostedImportActivationWorkerRuntime({
      environment: environment(),
      dependencies: { neonSessionFactory: database.sessionFactory },
    });
    if (runtime.status !== "ready") throw new Error("expected ready runtime");

    await expect(
      runtime.consume({
        body: message(),
        now: new Date("2026-08-21T02:00:00.000Z"),
      }),
    ).resolves.toEqual({
      disposition: "retry",
      reason: "leased_elsewhere",
      retryAfter: "2026-08-21T02:04:00.000Z",
    });
    expect(database.query).toHaveBeenCalledTimes(5);
  });

  it("rejects non-activation deliveries before database work", async () => {
    const database = sessionHarness([]);
    const runtime = hostedImportActivationWorkerRuntime({
      environment: environment(),
      dependencies: { neonSessionFactory: database.sessionFactory },
    });
    if (runtime.status !== "ready") throw new Error("expected ready runtime");

    await expect(
      runtime.consume({
        body: {
          version: 1,
          kind: "aggregate_refresh_retry",
          dispatchId: "refresh-dispatch-1",
          refreshId: "refresh-1",
        },
      }),
    ).rejects.toThrow("not available in this worker");
    expect(database.query).not.toHaveBeenCalled();
  });
});
