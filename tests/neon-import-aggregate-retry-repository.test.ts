import { describe, expect, it, vi } from "vitest";
import { createNeonImportAggregateRetryRepository } from "../lib/neon-import-aggregate-retry-repository";

const databaseOwnerId = "11111111-1111-4111-8111-111111111111";

function sessionFactory(refreshStatus: string, refreshExists = true) {
  const query = vi.fn(
    async (statement: string, _values?: readonly unknown[]) => {
      void _values;
      if (statement.includes("set_config")) {
        return { rows: [{ owner_scope: databaseOwnerId }] };
      }
      if (statement.includes("pg_catalog.pg_class")) {
        return {
          rows: [
            {
              database_owner_id: databaseOwnerId,
              authenticated_owner_id: "owner-1",
              job_rls: true,
              job_force_rls: true,
              reservation_rls: true,
              reservation_force_rls: true,
              session_user_name: "dna_app_runtime",
              current_user_name: "dna_app_runtime",
              runtime_is_superuser: false,
              runtime_bypasses_rls: false,
            },
          ],
        };
      }
      if (statement.includes("FROM dna.aggregate_refresh_job")) {
        return {
          rows: refreshExists
            ? [{ status: refreshStatus, failure_code: "worker_error" }]
            : [],
        };
      }
      if (statement.includes("reserve_import_operation")) {
        return {
          rows: [
            {
              disposition: "created",
              operation_id: "dispatch-1",
              request_fingerprint_sha256: expect.any(String),
            },
          ],
        };
      }
      return { rows: [] };
    },
  );
  return {
    query,
    factory: vi.fn(async () => ({
      client: { query },
      close: vi.fn(async () => undefined),
    })),
  };
}

describe("Neon import aggregate retry repository", () => {
  it("reserves a failed owner-scoped refresh and marks dispatch pending", async () => {
    const session = sessionFactory("failed");
    let requestFingerprint = "";
    session.query.mockImplementation(
      async (statement: string, values?: readonly unknown[]) => {
        if (statement.includes("reserve_import_operation")) {
          requestFingerprint = String(values?.[2]);
          return {
            rows: [
              {
                disposition: "created",
                operation_id: "dispatch-1",
                request_fingerprint_sha256: requestFingerprint,
              },
            ],
          };
        }
        if (statement.includes("set_config")) {
          return { rows: [{ owner_scope: databaseOwnerId }] };
        }
        if (statement.includes("pg_catalog.pg_class")) {
          return {
            rows: [
              {
                database_owner_id: databaseOwnerId,
                authenticated_owner_id: "owner-1",
                job_rls: true,
                job_force_rls: true,
                reservation_rls: true,
                reservation_force_rls: true,
                session_user_name: "dna_app_runtime",
                current_user_name: "dna_app_runtime",
                runtime_is_superuser: false,
                runtime_bypasses_rls: false,
              },
            ],
          };
        }
        if (statement.includes("FROM dna.aggregate_refresh_job")) {
          return { rows: [{ status: "failed", failure_code: "worker_error" }] };
        }
        return { rows: [] };
      },
    );
    const repository = createNeonImportAggregateRetryRepository({
      databaseUrl: "postgresql://preview.invalid/dna",
      databaseOwnerId,
      runtimeRole: "dna_app_runtime",
      sessionFactory: session.factory,
    });

    await expect(
      repository.reserveRetry({
        ownerId: "owner-1",
        failedRefreshId: "22222222-2222-4222-8222-222222222222",
        reason: "Retry after the source correction was accepted.",
        idempotencyKey: "aggregate-retry:1",
        requestedAt: "2026-10-20T02:00:00.000Z",
      }),
    ).resolves.toEqual({
      status: "reserved",
      refreshId: "22222222-2222-4222-8222-222222222222",
      dispatchId: "dispatch-1",
      disposition: "created",
      dispatchState: "pending",
    });
    expect(requestFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(
      session.query.mock.calls.some(
        ([statement, values]) =>
          String(statement).includes("SET status = 'queued'") &&
          values?.[2] === "retry_dispatch_pending:dispatch-1",
      ),
    ).toBe(true);
  });

  it("does not reserve a non-failed refresh", async () => {
    const session = sessionFactory("running");
    const repository = createNeonImportAggregateRetryRepository({
      databaseUrl: "postgresql://preview.invalid/dna",
      databaseOwnerId,
      runtimeRole: "dna_app_runtime",
      sessionFactory: session.factory,
    });
    await expect(
      repository.reserveRetry({
        ownerId: "owner-1",
        failedRefreshId: "22222222-2222-4222-8222-222222222222",
        reason: "Retry after the source correction was accepted.",
        idempotencyKey: "aggregate-retry:1",
        requestedAt: "2026-10-20T02:00:00.000Z",
      }),
    ).resolves.toEqual({ status: "not_retryable", refreshStatus: "running" });
    expect(
      session.query.mock.calls.some(([statement]) =>
        String(statement).includes("FOR UPDATE"),
      ),
    ).toBe(false);
  });

  it("returns not found without locking or mutating an absent refresh", async () => {
    const session = sessionFactory("failed", false);
    const repository = createNeonImportAggregateRetryRepository({
      databaseUrl: "postgresql://preview.invalid/dna",
      databaseOwnerId,
      runtimeRole: "dna_app_runtime",
      sessionFactory: session.factory,
    });
    await expect(
      repository.reserveRetry({
        ownerId: "owner-1",
        failedRefreshId: "22222222-2222-4222-8222-222222222222",
        reason: "Retry after the source correction was accepted.",
        idempotencyKey: "aggregate-retry:1",
        requestedAt: "2026-10-20T02:00:00.000Z",
      }),
    ).resolves.toEqual({ status: "not_found" });
    const statements = session.query.mock.calls.map(([statement]) =>
      String(statement),
    );
    expect(
      statements.some((statement) => statement.includes("FOR UPDATE")),
    ).toBe(false);
    expect(
      statements.some((statement) =>
        statement.includes("reserve_import_operation"),
      ),
    ).toBe(false);
    expect(
      statements.some((statement) =>
        statement.includes("SET status = 'queued'"),
      ),
    ).toBe(false);
  });
});
