import { describe, expect, it, vi } from "vitest";

import {
  createNeonOwnerVaultCatalogueRepository,
  neonOwnerVaultCatalogueRepositoryFromEnvironment,
} from "../lib/neon-owner-vault-catalogue-repository";
import type {
  NeonImportPersistenceClient,
  NeonImportPersistenceSessionFactory,
} from "../lib/neon-import-persistence-driver";

const databaseOwnerId = "11111111-1111-4111-8111-111111111111";
const runtimeRole = "dna_app_runtime";
const clerkOwnerId = "user_owner";

function ownerEvidence(overrides: Record<string, unknown> = {}) {
  return {
    database_owner_id: databaseOwnerId,
    authenticated_owner_id: clerkOwnerId,
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

function harness(sequence: readonly (readonly unknown[] | Error)[]) {
  let index = 0;
  const calls: { statement: string; values: readonly unknown[] | undefined }[] = [];
  const query = vi.fn(async (statement: string, values?: readonly unknown[]) => {
    const normalized = statement.replace(/\s+/g, " ").trim();
    calls.push({ statement: normalized, values });
    if (
      normalized === "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY" ||
      normalized === "COMMIT" ||
      normalized === "ROLLBACK"
    ) {
      return { rows: [] };
    }
    const next = sequence[index++] ?? [];
    if (next instanceof Error) throw next;
    return { rows: next };
  });
  const client: NeonImportPersistenceClient = { query };
  const close = vi.fn(async () => undefined);
  const factory = vi.fn(async () => ({ client, close }));
  return {
    calls,
    close,
    factory: factory as NeonImportPersistenceSessionFactory,
  };
}

function ready(test: ReturnType<typeof harness>) {
  const repository = createNeonOwnerVaultCatalogueRepository({
    databaseUrl: "postgresql://private.example/dna",
    databaseOwnerId,
    runtimeRole,
    sessionFactory: test.factory,
  });
  if (repository.status !== "ready") throw new Error("repository not ready");
  return repository;
}

const filters = {
  scope: "catalogue" as const,
  query: "seven",
  element: "Fire" as const,
  coreClass: "Genesis" as const,
  sex: "female" as const,
  fNumber: 2,
};

describe("Neon owner Vault catalogue repository", () => {
  it("is unavailable until every database runtime setting exists", () => {
    expect(
      neonOwnerVaultCatalogueRepositoryFromEnvironment({
        databaseUrl: undefined,
        databaseOwnerId,
        runtimeRole,
      }),
    ).toEqual({ status: "not_configured" });
  });

  it("reads Core Details and owner Vault state with parameterized filters", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [ownerEvidence()],
      [
        {
          source_core_id: "core-7",
          display_name: "Seven",
          core_class: "Genesis",
          element: "Fire",
          f_number: 2,
          sex: "female",
          in_my_vault: true,
          me_eligible: true,
          version: "3",
          updated_at: "2026-08-11T01:00:00.000Z",
        },
      ],
    ]);
    await expect(ready(test).listCoresByOwner(clerkOwnerId, filters)).resolves.toEqual([
      {
        sourceCoreId: "core-7",
        displayName: "Seven",
        coreClass: "Genesis",
        element: "Fire",
        fNumber: 2,
        sex: "female",
        inMyVault: true,
        meEligible: true,
        version: 3,
        updatedAt: "2026-08-11T01:00:00.000Z",
      },
    ]);
    const listCall = test.calls.find((call) => call.statement.includes("FROM dna.active_core_details"));
    expect(listCall?.values).toEqual([
      databaseOwnerId,
      "seven",
      "Fire",
      "Genesis",
      "female",
      2,
      "catalogue",
      50,
    ]);
    expect(listCall?.statement).toContain("position(lower($2::text)");
    expect(test.close).toHaveBeenCalledOnce();
  });

  it("uses the larger bounded result for the active Vault list", async () => {
    const test = harness([[{ owner_scope: databaseOwnerId }], [ownerEvidence()], []]);
    await ready(test).listCoresByOwner(clerkOwnerId, {
      ...filters,
      scope: "vault",
      query: null,
    });
    const listCall = test.calls.find((call) => call.statement.includes("FROM dna.active_core_details"));
    expect(listCall?.values?.[7]).toBe(500);
  });

  it("fails before catalogue access if owner isolation or runtime privilege is unsafe", async () => {
    for (const evidence of [
      ownerEvidence({ vault_force_row_security_enabled: false }),
      ownerEvidence({ runtime_can_create_roles: true }),
    ]) {
      const test = harness([[{ owner_scope: databaseOwnerId }], [evidence]]);
      await expect(ready(test).listCoresByOwner(clerkOwnerId, filters)).rejects.toThrow(
        /forced owner isolation|least privileged/,
      );
      expect(test.calls.some((call) => call.statement.includes("FROM dna.active_core_details"))).toBe(false);
    }
  });
});
