import { describe, expect, it, vi } from "vitest";
import {
  createOwnerScopedImportPersistenceOperationAdapter,
  type ImportPersistenceDriver,
  type ImportPersistenceDriverFactory,
  type ImportPersistenceTransaction,
} from "../lib/import-persistence-operation-adapter";

const databaseOwnerId = "11111111-1111-4111-8111-111111111111";
const authenticatedOwnerId = "owner-1";
const requestFingerprintSha256 = "a".repeat(64);

function harness(
  overrides: Partial<ImportPersistenceTransaction> = {},
): Readonly<{
  events: string[];
  transaction: ImportPersistenceTransaction;
  driver: ImportPersistenceDriver;
  driverFactory: ImportPersistenceDriverFactory;
  driverFactoryMock: ReturnType<typeof vi.fn>;
}> {
  const events: string[] = [];
  const transaction: ImportPersistenceTransaction = {
    setLocalOwnerScope: vi.fn(async () => {
      events.push("scope");
      return { ownerScope: databaseOwnerId };
    }),
    verifyOwnerIsolation: vi.fn(async () => {
      events.push("verify");
      return {
        databaseOwnerId,
        authenticatedOwnerId,
        rowSecurityEnabled: true,
        forceRowSecurityEnabled: true,
      };
    }),
    reserveOperation: vi.fn<ImportPersistenceTransaction["reserveOperation"]>(
      async () => {
        events.push("reserve");
        return {
          disposition: "created",
          operationId: "operation-1",
          requestFingerprintSha256,
        };
      },
    ),
    ...overrides,
  };
  const driver: ImportPersistenceDriver = {
    transaction: vi.fn(async (operation) => {
      events.push("begin");
      try {
        const result = await operation(transaction);
        events.push("commit");
        return result;
      } catch (error) {
        events.push("rollback");
        throw error;
      }
    }),
  };
  const driverFactoryMock = vi.fn(async () => driver);
  const driverFactory: ImportPersistenceDriverFactory = driverFactoryMock;
  return { events, transaction, driver, driverFactory, driverFactoryMock };
}

function request() {
  return {
    operationKind: "upload_batch" as const,
    idempotencyKey: "request-1",
    requestFingerprintSha256,
    now: new Date("2026-07-26T00:00:00.000Z"),
  };
}

describe("owner-scoped import persistence operation adapter", () => {
  it("initializes lazily once and reserves only after forced owner isolation", async () => {
    const test = harness();
    const adapter = createOwnerScopedImportPersistenceOperationAdapter({
      databaseOwnerId,
      authenticatedOwnerId: ` ${authenticatedOwnerId} `,
      driverFactory: test.driverFactory,
    });

    expect(test.driverFactoryMock).not.toHaveBeenCalled();
    await expect(adapter.reserveOperation(request())).resolves.toEqual({
      disposition: "created",
      operationId: "operation-1",
    });
    await adapter.reserveOperation({
      ...request(),
      idempotencyKey: "request-2",
    });

    expect(test.driverFactoryMock).toHaveBeenCalledTimes(1);
    expect(test.events).toEqual([
      "begin",
      "scope",
      "verify",
      "reserve",
      "commit",
      "begin",
      "scope",
      "verify",
      "reserve",
      "commit",
    ]);
  });

  it("passes canonical owner, operation and idempotency evidence", async () => {
    const test = harness();
    const adapter = createOwnerScopedImportPersistenceOperationAdapter({
      databaseOwnerId,
      authenticatedOwnerId,
      driverFactory: test.driverFactory,
    });

    await adapter.reserveOperation(request());

    expect(test.transaction.setLocalOwnerScope).toHaveBeenCalledWith({
      databaseOwnerId,
    });
    expect(test.transaction.verifyOwnerIsolation).toHaveBeenCalledWith({
      databaseOwnerId,
      authenticatedOwnerId,
    });
    expect(test.transaction.reserveOperation).toHaveBeenCalledWith({
      databaseOwnerId,
      operationKind: "upload_batch",
      idempotencyKey: "request-1",
      requestFingerprintSha256,
      requestedAt: "2026-07-26T00:00:00.000Z",
    });
  });

  it("rolls back before owner verification when local scope disagrees", async () => {
    const test = harness({
      setLocalOwnerScope: vi.fn(async () => ({
        ownerScope: "22222222-2222-4222-8222-222222222222",
      })),
    });
    const adapter = createOwnerScopedImportPersistenceOperationAdapter({
      databaseOwnerId,
      authenticatedOwnerId,
      driverFactory: test.driverFactory,
    });

    await expect(adapter.reserveOperation(request())).rejects.toThrow(
      "owner scope denied",
    );
    expect(test.transaction.verifyOwnerIsolation).not.toHaveBeenCalled();
    expect(test.transaction.reserveOperation).not.toHaveBeenCalled();
    expect(test.events).toEqual(["begin", "rollback"]);
  });

  it("rolls back before reservation when Clerk ownership does not match", async () => {
    const test = harness({
      verifyOwnerIsolation: vi.fn(async () => ({
        databaseOwnerId,
        authenticatedOwnerId: "other-owner",
        rowSecurityEnabled: true,
        forceRowSecurityEnabled: true,
      })),
    });
    const adapter = createOwnerScopedImportPersistenceOperationAdapter({
      databaseOwnerId,
      authenticatedOwnerId,
      driverFactory: test.driverFactory,
    });

    await expect(adapter.reserveOperation(request())).rejects.toThrow(
      "owner scope denied",
    );
    expect(test.transaction.reserveOperation).not.toHaveBeenCalled();
  });

  it.each([
    {
      rowSecurityEnabled: false,
      forceRowSecurityEnabled: true,
    },
    {
      rowSecurityEnabled: true,
      forceRowSecurityEnabled: false,
    },
  ])("requires enabled and forced RLS before reservation", async (flags) => {
    const test = harness({
      verifyOwnerIsolation: vi.fn(async () => ({
        databaseOwnerId,
        authenticatedOwnerId,
        ...flags,
      })),
    });
    const adapter = createOwnerScopedImportPersistenceOperationAdapter({
      databaseOwnerId,
      authenticatedOwnerId,
      driverFactory: test.driverFactory,
    });

    await expect(adapter.reserveOperation(request())).rejects.toThrow(
      "forced owner RLS is required",
    );
    expect(test.transaction.reserveOperation).not.toHaveBeenCalled();
  });

  it("replays an exact durable operation without creating a second identity", async () => {
    const test = harness({
      reserveOperation: vi.fn<ImportPersistenceTransaction["reserveOperation"]>(
        async () => ({
          disposition: "existing",
          operationId: "operation-1",
          requestFingerprintSha256,
        }),
      ),
    });
    const adapter = createOwnerScopedImportPersistenceOperationAdapter({
      databaseOwnerId,
      authenticatedOwnerId,
      driverFactory: test.driverFactory,
    });

    await expect(adapter.reserveOperation(request())).resolves.toEqual({
      disposition: "existing",
      operationId: "operation-1",
    });
  });

  it("rolls back when an idempotency key resolves to different evidence", async () => {
    const test = harness({
      reserveOperation: vi.fn<ImportPersistenceTransaction["reserveOperation"]>(
        async () => ({
          disposition: "existing",
          operationId: "operation-1",
          requestFingerprintSha256: "b".repeat(64),
        }),
      ),
    });
    const adapter = createOwnerScopedImportPersistenceOperationAdapter({
      databaseOwnerId,
      authenticatedOwnerId,
      driverFactory: test.driverFactory,
    });

    await expect(adapter.reserveOperation(request())).rejects.toThrow(
      "idempotency conflict",
    );
    expect(test.events.at(-1)).toBe("rollback");
  });

  it("rejects malformed configuration and operation evidence before persistence", async () => {
    const test = harness();
    expect(() =>
      createOwnerScopedImportPersistenceOperationAdapter({
        databaseOwnerId: "not-a-uuid",
        authenticatedOwnerId,
        driverFactory: test.driverFactory,
      }),
    ).toThrow("must be a UUID");

    const adapter = createOwnerScopedImportPersistenceOperationAdapter({
      databaseOwnerId,
      authenticatedOwnerId,
      driverFactory: test.driverFactory,
    });
    await expect(
      adapter.reserveOperation({
        ...request(),
        requestFingerprintSha256: "not-a-hash",
      }),
    ).rejects.toThrow("requestFingerprintSha256 is invalid");
    expect(test.driverFactoryMock).not.toHaveBeenCalled();
  });
});
