import { describe, expect, it, vi } from "vitest";
import {
  createNeonImportBatchRepository,
  importBatchRepositoryFromEnvironment,
  type TransactionExecutorFactory,
} from "@/lib/neon-import-batch-repository";

const databaseOwnerId = "11111111-1111-4111-8111-111111111111";

function row(overrides: Record<string, unknown> = {}) {
  return {
    batch_id: "22222222-2222-4222-8222-222222222222",
    source_type: "race_merge",
    status: "accepted",
    uploaded_at: "2026-07-24T06:00:00.000Z",
    import_completed_at: "2026-07-24T06:05:00.000Z",
    data_current_through: "2026-07-23T06:00:00.000Z",
    aggregate_refreshed_at: "2026-07-24T06:06:00.000Z",
    source_rows: "2",
    accepted_rows: "2",
    rejected_rows: "0",
    warning_rows: "1",
    is_active: true,
    prior_version_available: false,
    identity_review_count: "0",
    reconciliation_review_count: "1",
    issue_counts: [
      {
        code: "SYNTHETIC_WARNING",
        severity: "warning",
        occurrenceCount: 1,
      },
    ],
    ...overrides,
  };
}

function executorFactory(
  ownerRows: readonly unknown[] = [{ owner_id: databaseOwnerId }],
  batchRows: readonly unknown[] = [row()],
) {
  const executor = vi.fn(async () => [[], ownerRows, batchRows] as const);
  const factory: TransactionExecutorFactory = vi.fn(async () => executor);
  return { executor, factory };
}

describe("lazy Neon import-batch repository", () => {
  it("stays explicitly unconfigured until every server-only value exists", () => {
    expect(
      importBatchRepositoryFromEnvironment({
        databaseUrl: undefined,
        databaseOwnerId,
      }),
    ).toEqual({ status: "not_configured" });
    expect(
      importBatchRepositoryFromEnvironment({
        databaseUrl: "postgresql://synthetic.invalid/database",
        databaseOwnerId: undefined,
      }),
    ).toEqual({ status: "not_configured" });
  });

  it("rejects a malformed database owner scope before creating a client", () => {
    const { factory } = executorFactory();
    expect(() =>
      createNeonImportBatchRepository({
        databaseUrl: "postgresql://synthetic.invalid/database",
        databaseOwnerId: "not-a-uuid",
        executorFactory: factory,
      }),
    ).toThrow("must be a UUID");
    expect(factory).not.toHaveBeenCalled();
  });

  it("creates the executor lazily and reuses it for owner-scoped reads", async () => {
    const { executor, factory } = executorFactory();
    const repository = createNeonImportBatchRepository({
      databaseUrl: "postgresql://synthetic.invalid/database",
      databaseOwnerId,
      executorFactory: factory,
    });

    expect(factory).not.toHaveBeenCalled();
    if (repository.status !== "ready") throw new Error("repository not ready");

    const first = await repository.listBatchesByOwner("configured-owner");
    const second = await repository.listBatchesByOwner("configured-owner");

    expect(factory).toHaveBeenCalledExactlyOnceWith(
      "postgresql://synthetic.invalid/database",
    );
    expect(executor).toHaveBeenCalledTimes(2);
    expect(executor).toHaveBeenNthCalledWith(1, {
      databaseOwnerId,
      authenticatedOwnerId: "configured-owner",
    });
    expect(first).toEqual(second);
    expect(first[0]).toMatchObject({
      sourceType: "race_merge",
      status: "accepted",
      sourceRows: 2,
      acceptedRows: 2,
      warningRows: 1,
      isActive: true,
      reconciliationReviewCount: 1,
      issueCounts: [
        {
          code: "SYNTHETIC_WARNING",
          severity: "warning",
          occurrenceCount: 1,
        },
      ],
    });
  });

  it("fails closed when the database owner and Clerk identity do not match", async () => {
    const { factory } = executorFactory([]);
    const repository = createNeonImportBatchRepository({
      databaseUrl: "postgresql://synthetic.invalid/database",
      databaseOwnerId,
      executorFactory: factory,
    });
    if (repository.status !== "ready") throw new Error("repository not ready");

    await expect(repository.listBatchesByOwner("other-owner")).rejects.toThrow(
      "owner scope denied",
    );
  });

  it("fails closed when persistence returns a different database owner", async () => {
    const { factory } = executorFactory([
      { owner_id: "33333333-3333-4333-8333-333333333333" },
    ]);
    const repository = createNeonImportBatchRepository({
      databaseUrl: "postgresql://synthetic.invalid/database",
      databaseOwnerId,
      executorFactory: factory,
    });
    if (repository.status !== "ready") throw new Error("repository not ready");

    await expect(
      repository.listBatchesByOwner("configured-owner"),
    ).rejects.toThrow("owner scope denied");
  });

  it("rejects unsafe numeric and issue evidence returned by persistence", async () => {
    const { factory } = executorFactory(undefined, [
      row({ source_rows: "9007199254740992" }),
    ]);
    const repository = createNeonImportBatchRepository({
      databaseUrl: "postgresql://synthetic.invalid/database",
      databaseOwnerId,
      executorFactory: factory,
    });
    if (repository.status !== "ready") throw new Error("repository not ready");

    await expect(
      repository.listBatchesByOwner("configured-owner"),
    ).rejects.toThrow("non-negative safe integer");
  });

  it.each([
    [{ is_active: "true" }, "is_active must be a boolean"],
    [
      {
        issue_counts: [
          {
            code: "SYNTHETIC_WARNING",
            severity: "critical",
            occurrenceCount: 1,
          },
        ],
      },
      "severity is unsupported",
    ],
  ] as const)(
    "rejects malformed Boolean or warning evidence",
    async (overrides, expected) => {
      const { factory } = executorFactory(undefined, [row(overrides)]);
      const repository = createNeonImportBatchRepository({
        databaseUrl: "postgresql://synthetic.invalid/database",
        databaseOwnerId,
        executorFactory: factory,
      });
      if (repository.status !== "ready")
        throw new Error("repository not ready");

      await expect(
        repository.listBatchesByOwner("configured-owner"),
      ).rejects.toThrow(expected);
    },
  );

  it("rejects unsupported source and status values from persistence", async () => {
    const { factory } = executorFactory(undefined, [
      row({ source_type: "manual_economic" }),
    ]);
    const repository = createNeonImportBatchRepository({
      databaseUrl: "postgresql://synthetic.invalid/database",
      databaseOwnerId,
      executorFactory: factory,
    });
    if (repository.status !== "ready") throw new Error("repository not ready");

    await expect(
      repository.listBatchesByOwner("configured-owner"),
    ).rejects.toThrow("source_type is unsupported");
  });

  it("rejects a missing required persistence timestamp", async () => {
    const { factory } = executorFactory(undefined, [
      row({ uploaded_at: null }),
    ]);
    const repository = createNeonImportBatchRepository({
      databaseUrl: "postgresql://synthetic.invalid/database",
      databaseOwnerId,
      executorFactory: factory,
    });
    if (repository.status !== "ready") throw new Error("repository not ready");

    await expect(
      repository.listBatchesByOwner("configured-owner"),
    ).rejects.toThrow("uploaded_at is required");
  });
});
