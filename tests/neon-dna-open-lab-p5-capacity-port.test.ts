import { describe, expect, it, vi } from "vitest";

import { createNeonDnaOpenLabP5PostgresCapacityPort } from "@/lib/neon-dna-open-lab-p5-capacity-port";
import type {
  NeonImportPersistenceClient,
  NeonImportPersistenceSessionFactory,
} from "@/lib/neon-import-persistence-driver";

const databaseOwnerId = "11111111-1111-4111-8111-111111111111";
const relations = [
  "dna_open_lab_current_state_generation",
  "dna_open_lab_current_state_evidence_receipt",
] as const;

function runtimeEvidence(overrides: Record<string, unknown> = {}) {
  return {
    database_owner_id: databaseOwnerId,
    authenticated_owner_id: "owner-1",
    session_user_name: "dna_app_runtime",
    current_user_name: "dna_app_runtime",
    runtime_is_superuser: false,
    runtime_bypasses_rls: false,
    runtime_can_create_roles: false,
    runtime_can_create_databases: false,
    runtime_can_create_in_database: false,
    runtime_can_create_in_schema: false,
    runtime_is_neon_superuser_member: false,
    ...overrides,
  };
}

function fixture(
  overrides: {
    runtime?: Record<string, unknown>;
    relationCount?: string;
    relationBytes?: Record<string, unknown>;
  } = {},
) {
  const query = vi.fn<NeonImportPersistenceClient["query"]>();
  query.mockImplementation(async (statement) => {
    if (statement.includes("BEGIN")) return { rows: [] };
    if (statement.includes("set_config")) {
      return { rows: [{ owner_scope: databaseOwnerId }] };
    }
    if (statement.includes("FROM dna.app_owner")) {
      return { rows: [runtimeEvidence(overrides.runtime)] };
    }
    if (statement.includes("server_version_num")) {
      return { rows: [{ server_version_num: "180001" }] };
    }
    if (statement.includes("pg_database_size")) {
      return { rows: [{ storage_bytes: "125000000" }] };
    }
    if (statement.includes("pg_catalog.pg_class")) {
      return {
        rows: [
          {
            relation_count: overrides.relationCount ?? "2",
            heap_bytes: "45000000",
            index_bytes: "20000000",
            toast_bytes: "5000000",
            ...overrides.relationBytes,
          },
        ],
      };
    }
    if (statement === "COMMIT" || statement === "ROLLBACK") return { rows: [] };
    throw new Error("unexpected query");
  });
  const close = vi.fn(async () => undefined);
  const sessionFactory = vi.fn<NeonImportPersistenceSessionFactory>(
    async () => ({
      client: { query },
      close,
    }),
  );
  const port = createNeonDnaOpenLabP5PostgresCapacityPort({
    authorizedOwnerId: "owner-1",
    databaseOwnerId,
    databaseUrl: "postgresql://runtime:secret@preview.invalid/dna",
    runtimeRole: "dna_app_runtime",
    ownerRelationNames: relations,
    sessionFactory,
  });
  return { port, query, close, sessionFactory };
}

describe("DNA Open Lab P5 Neon capacity port", () => {
  it("reads version, database and exact owner relations in separate read-only transactions", async () => {
    const { port, query, close, sessionFactory } = fixture();

    await expect(port.readMajorVersion()).resolves.toBe(18);
    await expect(port.readDatabaseBytes()).resolves.toBe(125_000_000);
    await expect(port.readOwnerRelationBytes()).resolves.toEqual({
      heapBytes: 45_000_000,
      indexBytes: 20_000_000,
      toastBytes: 5_000_000,
    });

    expect(sessionFactory).toHaveBeenCalledTimes(3);
    expect(close).toHaveBeenCalledTimes(3);
    expect(
      query.mock.calls
        .filter(([sql]) => sql.includes("BEGIN"))
        .map(([sql]) => sql),
    ).toEqual([
      "BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY",
      "BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY",
      "BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY",
    ]);
    const relationQuery = query.mock.calls.find(([sql]) =>
      sql.includes("pg_catalog.pg_class"),
    );
    expect(relationQuery?.[1]).toEqual([[...relations].sort()]);
    expect(relationQuery?.[0]).toContain("relation.relname = ANY($1::text[])");
    expect(relationQuery?.[0]).not.toContain(relations[0]);
  });

  it.each([
    ["superuser", { runtime_is_superuser: true }],
    ["RLS bypass", { runtime_bypasses_rls: true }],
    ["database CREATE", { runtime_can_create_in_database: true }],
    ["schema CREATE", { runtime_can_create_in_schema: true }],
    ["Neon superuser", { runtime_is_neon_superuser_member: true }],
  ])(
    "rejects a runtime with %s authority before catalog measurement",
    async (_label, runtime) => {
      const { port, query } = fixture({ runtime });

      await expect(port.readDatabaseBytes()).rejects.toThrow(
        "measurement failed",
      );
      expect(
        query.mock.calls.some(([sql]) => sql.includes("pg_database_size")),
      ).toBe(false);
      expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
    },
  );

  it("fails closed when any allowlisted owner relation is absent", async () => {
    const { port, query } = fixture({ relationCount: "1" });

    await expect(port.readOwnerRelationBytes()).rejects.toThrow(
      "measurement failed",
    );
    expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
  });

  it.each(["-1", "1.5", "9007199254740992", 12, null])(
    "rejects invalid physical bytes %j",
    async (heap_bytes) => {
      const { port } = fixture({ relationBytes: { heap_bytes } });
      await expect(port.readOwnerRelationBytes()).rejects.toThrow(
        "measurement failed",
      );
    },
  );

  it("rejects unsafe or duplicate relation allowlists before opening a session", () => {
    const sessionFactory = vi.fn<NeonImportPersistenceSessionFactory>();
    const base = {
      authorizedOwnerId: "owner-1",
      databaseOwnerId,
      databaseUrl: "postgresql://preview.invalid/dna",
      runtimeRole: "dna_app_runtime",
      sessionFactory,
    };
    expect(() =>
      createNeonDnaOpenLabP5PostgresCapacityPort({
        ...base,
        ownerRelationNames: ["valid", "valid"],
      }),
    ).toThrow("ownerRelationNames is invalid");
    expect(() =>
      createNeonDnaOpenLabP5PostgresCapacityPort({
        ...base,
        ownerRelationNames: ["dna.valid; DROP TABLE dna.app_owner"],
      }),
    ).toThrow("ownerRelationNames is invalid");
    expect(sessionFactory).not.toHaveBeenCalled();
  });

  it("sanitizes provider failures and closes the session", async () => {
    const { port, query, close } = fixture();
    query.mockRejectedValueOnce(new Error("private preview provider detail"));

    await expect(port.readMajorVersion()).rejects.not.toThrow(
      /private preview provider detail/u,
    );
    expect(close).toHaveBeenCalledOnce();
  });
});
