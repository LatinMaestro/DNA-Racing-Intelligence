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
  const calls: { statement: string; values: readonly unknown[] | undefined }[] =
    [];
  const query = vi.fn(
    async (statement: string, values?: readonly unknown[]) => {
      const normalized = statement.replace(/\s+/g, " ").trim();
      calls.push({ statement: normalized, values });
      if (
        normalized ===
          "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY" ||
        normalized === "COMMIT" ||
        normalized === "ROLLBACK"
      ) {
        return { rows: [] };
      }
      const next = sequence[index++] ?? [];
      if (next instanceof Error) throw next;
      return { rows: next };
    },
  );
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
    await expect(
      ready(test).listCoresByOwner(clerkOwnerId, filters),
    ).resolves.toEqual([
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
    const listCall = test.calls.find((call) =>
      call.statement.includes("FROM dna.search_owner_vault_catalogue("),
    );
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
    expect(listCall?.statement).toContain("$8::integer");
    expect(test.close).toHaveBeenCalledOnce();
  });

  it("uses the larger bounded result for the active Vault list", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [ownerEvidence()],
      [],
    ]);
    await ready(test).listCoresByOwner(clerkOwnerId, {
      ...filters,
      scope: "vault",
      query: null,
    });
    const listCall = test.calls.find((call) =>
      call.statement.includes("FROM dna.search_owner_vault_catalogue("),
    );
    expect(listCall?.values?.[7]).toBe(500);
  });

  it("reads accepted publication identity and catalogue rows atomically", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [ownerEvidence()],
      [
        {
          core_dataset_version_id: "22222222-2222-4222-8222-222222222222",
          import_batch_id: "33333333-3333-4333-8333-333333333333",
          source_sha256: "a".repeat(64),
          source_row_count: "8",
          accepted_row_count: "7",
          core_count: "7",
          evidence_row_count: "8",
          activated_at: "2026-08-11T00:30:00.000Z",
          data_current_through: null,
          aggregate_refreshed_at: "2026-08-11T00:45:00.000Z",
          evidence_sealed_at: "2026-08-11T00:50:00.000Z",
        },
      ],
      [],
    ]);
    const repository = ready(test);
    await expect(
      repository.readCataloguePageByOwner!(clerkOwnerId, filters),
    ).resolves.toEqual({
      cores: [],
      publication: {
        coreDatasetVersionId: "22222222-2222-4222-8222-222222222222",
        importBatchId: "33333333-3333-4333-8333-333333333333",
        sourceSha256: "a".repeat(64),
        sourceRowCount: 8,
        acceptedRowCount: 7,
        coreCount: 7,
        evidenceRowCount: 8,
        activatedAt: "2026-08-11T00:30:00.000Z",
        dataCurrentThrough: null,
        aggregateRefreshedAt: "2026-08-11T00:45:00.000Z",
        evidenceSealedAt: "2026-08-11T00:50:00.000Z",
      },
    });
    expect(test.calls[0]?.statement).toContain("REPEATABLE READ READ ONLY");
    expect(
      test.calls.some((call) =>
        call.statement.includes(
          "FROM dna.read_owner_vault_catalogue_publication($1::uuid)",
        ),
      ),
    ).toBe(true);
    expect(test.calls.at(-1)?.statement).toBe("COMMIT");
  });

  it("fails before catalogue access if owner isolation or runtime privilege is unsafe", async () => {
    for (const evidence of [
      ownerEvidence({ vault_force_row_security_enabled: false }),
      ownerEvidence({ runtime_can_create_roles: true }),
    ]) {
      const test = harness([[{ owner_scope: databaseOwnerId }], [evidence]]);
      await expect(
        ready(test).listCoresByOwner(clerkOwnerId, filters),
      ).rejects.toThrow(/forced owner isolation|least privileged/);
      expect(
        test.calls.some((call) =>
          call.statement.includes("FROM dna.search_owner_vault_catalogue("),
        ),
      ).toBe(false);
    }
  });
});
