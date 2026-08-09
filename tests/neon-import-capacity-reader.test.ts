import { describe, expect, it, vi } from "vitest";

import { createNeonImportStorageBytesReader } from "../lib/neon-import-capacity-reader";
import type {
  NeonImportPersistenceClient,
  NeonImportPersistenceSessionFactory,
} from "../lib/neon-import-persistence-driver";

const databaseOwnerId = "11111111-1111-4111-8111-111111111111";

function ownerEvidence(overrides: Record<string, unknown> = {}) {
  return {
    database_owner_id: databaseOwnerId,
    authenticated_owner_id: "owner-1",
    session_user_name: "dna_app_runtime",
    current_user_name: "dna_app_runtime",
    runtime_is_superuser: false,
    runtime_bypasses_rls: false,
    runtime_can_create_roles: false,
    runtime_can_create_databases: false,
    runtime_is_neon_superuser_member: false,
    ...overrides,
  };
}

function fixture(
  input: { evidence?: Record<string, unknown>; size?: unknown } = {},
) {
  const query = vi.fn<NeonImportPersistenceClient["query"]>();
  query.mockImplementation(async (statement) => {
    if (statement.includes("BEGIN")) return { rows: [] };
    if (statement.includes("set_config")) {
      return { rows: [{ owner_scope: databaseOwnerId }] };
    }
    if (statement.includes("FROM dna.app_owner")) {
      return { rows: [input.evidence ?? ownerEvidence()] };
    }
    if (statement.includes("pg_database_size")) {
      return {
        rows: [
          { storage_bytes: input.size === undefined ? "8192" : input.size },
        ],
      };
    }
    if (statement.includes("COMMIT") || statement.includes("ROLLBACK")) {
      return { rows: [] };
    }
    throw new Error("unexpected query");
  });
  const close = vi.fn(async () => undefined);
  const sessionFactory = vi.fn<NeonImportPersistenceSessionFactory>(
    async () => ({
      client: { query },
      close,
    }),
  );
  const reader = createNeonImportStorageBytesReader({
    authorizedOwnerId: "owner-1",
    databaseOwnerId,
    databaseUrl: "postgresql://runtime:secret@preview.invalid/dna",
    runtimeRole: "dna_app_runtime",
    sessionFactory,
  });
  return { reader, sessionFactory, query, close };
}

describe("Neon import capacity reader", () => {
  it("reads database storage in an owner-bound least-privilege transaction", async () => {
    const { reader, sessionFactory, query, close } = fixture();

    await expect(reader({ ownerId: "owner-1" })).resolves.toBe(8192);

    expect(sessionFactory).toHaveBeenCalledExactlyOnceWith(
      "postgresql://runtime:secret@preview.invalid/dna",
    );
    expect(query.mock.calls.map(([statement]) => statement.trim())).toEqual([
      "BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY",
      expect.stringContaining("set_config('app.owner_id'"),
      expect.stringContaining("FROM dna.app_owner"),
      expect.stringContaining("pg_database_size(current_database())"),
      "COMMIT",
    ]);
    expect(query.mock.calls[1]?.[1]).toEqual([databaseOwnerId]);
    expect(query.mock.calls[2]?.[1]).toEqual([databaseOwnerId, "owner-1"]);
    expect(close).toHaveBeenCalledOnce();
  });

  it("denies another owner before opening a database session", async () => {
    const { reader, sessionFactory } = fixture();

    await expect(reader({ ownerId: "owner-2" })).rejects.toThrow(
      "access denied",
    );
    expect(sessionFactory).not.toHaveBeenCalled();
  });

  it.each([
    ["database owner", { database_owner_id: "other-owner" }],
    ["authenticated owner", { authenticated_owner_id: "owner-2" }],
    ["session role", { session_user_name: "neondb_owner" }],
    ["current role", { current_user_name: "neondb_owner" }],
    ["superuser", { runtime_is_superuser: true }],
    ["RLS bypass", { runtime_bypasses_rls: true }],
    ["role creation", { runtime_can_create_roles: true }],
    ["database creation", { runtime_can_create_databases: true }],
    ["Neon superuser membership", { runtime_is_neon_superuser_member: true }],
  ])("fails closed on invalid %s evidence", async (_label, override) => {
    const { reader, query, close } = fixture({
      evidence: ownerEvidence(override),
    });

    await expect(reader({ ownerId: "owner-1" })).rejects.toThrow(
      "measurement failed",
    );
    expect(
      query.mock.calls.some(([sql]) => sql.includes("pg_database_size")),
    ).toBe(false);
    expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
    expect(close).toHaveBeenCalledOnce();
  });

  it.each(["-1", "1.5", "9007199254740992", 8192, null])(
    "rejects invalid storage value %j and rolls back",
    async (size) => {
      const { reader, query, close } = fixture({ size });

      await expect(reader({ ownerId: "owner-1" })).rejects.toThrow(
        "measurement failed",
      );
      expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
      expect(close).toHaveBeenCalledOnce();
    },
  );

  it("sanitizes provider errors and closes the session", async () => {
    const { reader, query, close } = fixture();
    query.mockRejectedValueOnce(new Error("private preview database detail"));

    await expect(reader({ ownerId: "owner-1" })).rejects.not.toThrow(
      /private preview database detail/,
    );
    expect(close).toHaveBeenCalledOnce();
  });

  it("rejects malformed configuration before provider access", () => {
    const sessionFactory = vi.fn<NeonImportPersistenceSessionFactory>();
    expect(() =>
      createNeonImportStorageBytesReader({
        authorizedOwnerId: "owner-1",
        databaseOwnerId: "not-a-uuid",
        databaseUrl: "postgresql://preview.invalid/dna",
        runtimeRole: "dna_app_runtime",
        sessionFactory,
      }),
    ).toThrow("databaseOwnerId is invalid");
    expect(sessionFactory).not.toHaveBeenCalled();
  });
});
