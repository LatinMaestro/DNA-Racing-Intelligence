import { describe, expect, it, vi } from "vitest";

import {
  createNeonProLeagueBreedingPublicationAuthorityRepository,
  neonProLeagueBreedingPublicationAuthoritySourceFromEnvironment,
} from "@/lib/neon-pro-league-breeding-publication-authority-repository";
import type {
  NeonImportPersistenceClient,
  NeonImportPersistenceSessionFactory,
} from "@/lib/neon-import-persistence-driver";

const databaseOwnerId = "87000000-0000-4000-8000-000000000001";
const ownerId = "private_owner";
const runtimeRole = "dna_app_runtime";

function isolation(overrides: Record<string, unknown> = {}) {
  return {
    authenticated_owner_id: ownerId,
    runtime_can_access_tables: false,
    runtime_can_read: true,
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

function authority(overrides: Record<string, unknown> = {}) {
  return {
    roster_evidence_cutoff_at: "2026-09-08T01:00:00.000Z",
    latest_performance_import_at: "2026-09-08T00:30:00.000Z",
    latest_arena_import_at: null,
    ...overrides,
  };
}

function harness(rows: readonly (readonly unknown[])[]) {
  const events: string[] = [];
  let index = 0;
  const query = vi.fn(
    async (statement: string, values?: readonly unknown[]) => {
      const normalized = statement.replace(/\s+/gu, " ").trim();
      events.push(
        values ? `${normalized}|${JSON.stringify(values)}` : normalized,
      );
      if (
        normalized.startsWith("BEGIN TRANSACTION") ||
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
  const repository = createNeonProLeagueBreedingPublicationAuthorityRepository({
    databaseUrl: "postgresql://private.example/dna",
    databaseOwnerId,
    ownerId,
    runtimeRole,
    sessionFactory:
      sessionFactory as unknown as NeonImportPersistenceSessionFactory,
  });
  return { events, query, repository };
}

describe("Neon Pro League breeding publication authority repository", () => {
  it("fails closed without complete environment configuration", () => {
    expect(
      neonProLeagueBreedingPublicationAuthoritySourceFromEnvironment({
        databaseUrl: "postgresql://private.example/dna",
      }),
    ).toEqual({ status: "not_configured" });
  });

  it("exposes only the owner-scoped current-authority read", () => {
    const source =
      neonProLeagueBreedingPublicationAuthoritySourceFromEnvironment({
        databaseUrl: "postgresql://private.example/dna",
        databaseOwnerId,
        ownerId,
        runtimeRole,
      });
    expect(source.status).toBe("ready");
    expect(Object.keys(source).sort()).toEqual([
      "loadCurrentAuthorityByOwner",
      "status",
    ]);
    expect(Object.isFrozen(source)).toBe(true);
  });

  it("reads one current authority in a stable owner-scoped transaction", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [authority()],
    ]);
    await expect(
      test.repository.loadCurrentAuthorityByOwner(ownerId),
    ).resolves.toEqual({
      rosterEvidenceCutoffAt: "2026-09-08T01:00:00.000Z",
      latestAcceptedPerformanceImportAt: "2026-09-08T00:30:00.000Z",
      latestAcceptedArenaImportAt: null,
    });
    expect(test.events[0]).toBe(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    expect(test.query.mock.calls[3]?.[1]).toEqual([databaseOwnerId]);
    expect(test.events.at(-2)).toBe("COMMIT");
    expect(test.events.at(-1)).toBe("close");
  });

  it("returns held authority when no complete current row exists", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [],
    ]);
    await expect(
      test.repository.loadCurrentAuthorityByOwner(ownerId),
    ).resolves.toBeNull();
  });

  it("denies cross-owner reads before opening a session", async () => {
    const test = harness([]);
    await expect(
      test.repository.loadCurrentAuthorityByOwner("different_owner"),
    ).rejects.toThrow("owner scope denied");
    expect(test.query).not.toHaveBeenCalled();
  });

  it.each([
    ["direct table access", { runtime_can_access_tables: true }],
    ["missing function grant", { runtime_can_read: false }],
    ["RLS bypass", { runtime_bypasses_rls: true }],
  ])("fails closed for unsafe isolation: %s", async (_label, override) => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation(override)],
    ]);
    await expect(
      test.repository.loadCurrentAuthorityByOwner(ownerId),
    ).rejects.toThrow("owner isolation failed");
    expect(test.events.at(-2)).toBe("ROLLBACK");
    expect(test.events.at(-1)).toBe("close");
  });

  it("rejects duplicate or malformed current authority", async () => {
    const duplicate = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [authority(), authority()],
    ]);
    await expect(
      duplicate.repository.loadCurrentAuthorityByOwner(ownerId),
    ).rejects.toThrow("multiple current rows");

    const malformed = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [authority({ latest_performance_import_at: "not-a-time" })],
    ]);
    await expect(
      malformed.repository.loadCurrentAuthorityByOwner(ownerId),
    ).rejects.toThrow("performance import is invalid");
  });
});
