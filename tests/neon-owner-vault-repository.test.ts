import { describe, expect, it, vi } from "vitest";

import {
  createNeonOwnerVaultMutationRepository,
  neonOwnerVaultMutationRepositoryFromEnvironment,
} from "../lib/neon-owner-vault-repository";
import type {
  NeonImportPersistenceClient,
  NeonImportPersistenceSessionFactory,
} from "../lib/neon-import-persistence-driver";

const databaseOwnerId = "11111111-1111-4111-8111-111111111111";
const coreId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const runtimeRole = "dna_app_runtime";
const authenticatedOwnerId = "user_owner";

function ownerEvidence(overrides: Record<string, unknown> = {}) {
  return {
    database_owner_id: databaseOwnerId,
    authenticated_owner_id: authenticatedOwnerId,
    core_row_security_enabled: true,
    core_force_row_security_enabled: true,
    vault_row_security_enabled: true,
    vault_force_row_security_enabled: true,
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

function queryHarness(sequence: readonly (readonly unknown[] | Error)[]) {
  const events: string[] = [];
  let index = 0;
  const query = vi.fn(async (statement: string, values?: readonly unknown[]) => {
    const normalized = statement.replace(/\s+/g, " ").trim();
    events.push(values ? `${normalized}|${JSON.stringify(values)}` : normalized);
    if (
      ["BEGIN ISOLATION LEVEL SERIALIZABLE", "COMMIT", "ROLLBACK"].includes(
        normalized,
      )
    ) {
      return { rows: [] };
    }
    const next = sequence[index++] ?? [];
    if (next instanceof Error) throw next;
    return { rows: next };
  });
  const client: NeonImportPersistenceClient = { query };
  const close = vi.fn(async () => {
    events.push("close");
  });
  const sessionFactory = vi.fn(async () => ({ client, close }));
  return {
    events,
    query,
    sessionFactory: sessionFactory as NeonImportPersistenceSessionFactory,
    sessionFactoryMock: sessionFactory,
  };
}

function repository(test: ReturnType<typeof queryHarness>) {
  const result = createNeonOwnerVaultMutationRepository({
    databaseUrl: "postgresql://private.example/dna",
    databaseOwnerId,
    runtimeRole,
    sessionFactory: test.sessionFactory,
  });
  if (result.status !== "ready") throw new Error("repository not ready");
  return result;
}

function mutation() {
  return {
    ownerId: authenticatedOwnerId,
    sourceCoreId: "core-1",
    inMyVault: true,
    meEligible: true,
    expectedVersion: 0,
    idempotencyKey: "vault-1",
    requestFingerprintSha256: "a".repeat(64),
    requestedAt: "2026-08-11T01:00:00.000Z",
  };
}

describe("Neon owner Vault repository", () => {
  it("stays fail-closed until all database runtime settings are present", () => {
    expect(
      neonOwnerVaultMutationRepositoryFromEnvironment({
        databaseUrl: undefined,
        databaseOwnerId,
        runtimeRole,
      }),
    ).toEqual({ status: "not_configured" });
    expect(
      neonOwnerVaultMutationRepositoryFromEnvironment({
        databaseUrl: "postgresql://private.example/dna",
        databaseOwnerId: undefined,
        runtimeRole,
      }),
    ).toEqual({ status: "not_configured" });
  });

  it("resolves the durable source ID and mutates through the guarded function", async () => {
    const test = queryHarness([
      [{ owner_scope: databaseOwnerId }],
      [ownerEvidence()],
      [{ core_id: coreId, source_core_id: "core-1" }],
      [
        {
          disposition: "applied",
          core_id: coreId,
          in_my_vault: true,
          me_eligible: true,
          version: "1",
          updated_at: "2026-08-11T01:00:00.000Z",
        },
      ],
    ]);

    await expect(repository(test).setCoreState(mutation())).resolves.toEqual({
      status: "applied",
      sourceCoreId: "core-1",
      inMyVault: true,
      meEligible: true,
      version: 1,
      updatedAt: "2026-08-11T01:00:00.000Z",
    });
    expect(test.events[0]).toBe("BEGIN ISOLATION LEVEL SERIALIZABLE");
    expect(test.events[2]).toContain("'dna.owner_vault_core'::regclass");
    expect(test.events[3]).toContain("FROM dna.core core");
    expect(test.events[4]).toContain("FROM dna.set_owner_vault_core(");
    expect(test.events.slice(-2)).toEqual(["COMMIT", "close"]);
  });

  it("returns a fixed missing-core state without calling the mutation function", async () => {
    const test = queryHarness([
      [{ owner_scope: databaseOwnerId }],
      [ownerEvidence()],
      [],
    ]);
    await expect(repository(test).setCoreState(mutation())).resolves.toEqual({
      status: "core_unavailable",
    });
    expect(
      test.events.some((event) => event.includes("set_owner_vault_core")),
    ).toBe(false);
    expect(test.events.slice(-2)).toEqual(["COMMIT", "close"]);
  });

  it("rejects non-least-privilege or non-forced-RLS runtime evidence before core lookup", async () => {
    for (const evidence of [
      ownerEvidence({ vault_force_row_security_enabled: false }),
      ownerEvidence({ runtime_bypasses_rls: true }),
    ]) {
      const test = queryHarness([
        [{ owner_scope: databaseOwnerId }],
        [evidence],
      ]);
      await expect(repository(test).setCoreState(mutation())).rejects.toThrow(
        /forced owner RLS|least privileged/,
      );
      expect(test.events.slice(-2)).toEqual(["ROLLBACK", "close"]);
      expect(
        test.events.some((event) => event.includes("FROM dna.core core")),
      ).toBe(false);
    }
  });

  it("maps concurrency conflicts without leaking the database failure", async () => {
    const test = queryHarness([
      [{ owner_scope: databaseOwnerId }],
      [ownerEvidence()],
      [{ core_id: coreId, source_core_id: "core-1" }],
      new Error("Vault state changed; refresh before retrying"),
    ]);
    await expect(repository(test).setCoreState(mutation())).resolves.toEqual({
      status: "conflict",
    });
    expect(test.events.slice(-2)).toEqual(["ROLLBACK", "close"]);
  });
});
