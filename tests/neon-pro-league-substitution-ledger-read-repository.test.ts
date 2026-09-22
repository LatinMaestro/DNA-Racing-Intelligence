import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { createNeonProLeagueSubstitutionLedgerReadRepository } from "@/lib/neon-pro-league-substitution-ledger-read-repository";
import type {
  NeonImportPersistenceClient,
  NeonImportPersistenceSessionFactory,
} from "@/lib/neon-import-persistence-driver";

const ownerId = "private_owner";
const databaseOwnerId = "11111111-1111-4111-8111-111111111111";
const runtimeRole = "dna_app_runtime";

function sha256(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex");
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
        normalized.startsWith("BEGIN ISOLATION LEVEL") ||
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
  const repository = createNeonProLeagueSubstitutionLedgerReadRepository({
    databaseUrl: "postgresql://private.example/dna",
    databaseOwnerId,
    ownerId,
    runtimeRole,
    sessionFactory: sessionFactory as NeonImportPersistenceSessionFactory,
  });
  return { close, events, query, repository, sessionFactory };
}

function isolation(overrides: Record<string, unknown> = {}) {
  return {
    authenticated_owner_id: ownerId,
    row_security_enabled: true,
    force_row_security_enabled: true,
    runtime_can_read_table: false,
    runtime_can_list_substitutions: true,
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

function storedSubstitution() {
  const value = {
    seasonYear: 2026,
    substitutionNumber: 1,
    fromRosterVersionId: "roster-v1",
    toRosterVersionId: "roster-v2",
    outgoingCoreId: "core-1",
    incomingCoreId: "core-26",
    reason: "Improves first-16 coverage.",
    evidence: {
      asOf: "2026-09-22T00:00:00.000Z",
      generationId: "generation",
      sha256: "a".repeat(64),
      confidence: "moderate" as const,
    },
  };
  return {
    season_year: value.seasonYear,
    substitution_number: value.substitutionNumber,
    from_roster_version_id: value.fromRosterVersionId,
    to_roster_version_id: value.toRosterVersionId,
    outgoing_core_id: value.outgoingCoreId,
    incoming_core_id: value.incomingCoreId,
    reason: value.reason,
    evidence_as_of: new Date(value.evidence.asOf),
    evidence_generation_id: value.evidence.generationId,
    evidence_sha256: value.evidence.sha256,
    evidence_confidence: value.evidence.confidence,
    substitution_sha256: sha256(value),
    recorded_at: new Date("2026-09-22T00:05:00.000Z"),
  };
}

describe("read-only Pro League substitution ledger repository", () => {
  it("reports an undeployed ledger before running isolation verification", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [
        {
          substitution_table_exists: false,
          list_function_exists: false,
        },
      ],
    ]);

    await expect(
      test.repository.listSubstitutions(ownerId, 2026),
    ).rejects.toThrow(
      "Pro League substitution ledger persistence is not configured.",
    );
    expect(test.events.some((event) => event.includes("app_owner"))).toBe(false);
    expect(test.events.slice(-2)).toEqual(["ROLLBACK", "close"]);
  });

  it("requires least-privilege read isolation without any write privilege requirement", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [
        {
          substitution_table_exists: true,
          list_function_exists: true,
        },
      ],
      [isolation()],
      [],
    ]);

    await expect(
      test.repository.listSubstitutions(ownerId, 2026),
    ).resolves.toEqual([]);
    expect(
      test.events.some((event) =>
        event.includes("record_pro_league_roster_substitution"),
      ),
    ).toBe(false);
    expect(
      test.events.some((event) =>
        event.includes("store_pro_league_roster_version"),
      ),
    ).toBe(false);
    expect(test.events.slice(-2)).toEqual(["COMMIT", "close"]);
  });

  it("rejects direct table access even when the list function is executable", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [
        {
          substitution_table_exists: true,
          list_function_exists: true,
        },
      ],
      [isolation({ runtime_can_read_table: true })],
    ]);

    await expect(
      test.repository.listSubstitutions(ownerId, 2026),
    ).rejects.toThrow("least-privilege read isolation");
    expect(test.events.slice(-2)).toEqual(["ROLLBACK", "close"]);
  });

  it("reads and verifies substitution fingerprints", async () => {
    const stored = storedSubstitution();
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [
        {
          substitution_table_exists: true,
          list_function_exists: true,
        },
      ],
      [isolation()],
      [stored],
    ]);

    await expect(
      test.repository.listSubstitutions(ownerId, 2026),
    ).resolves.toEqual([
      expect.objectContaining({
        seasonYear: 2026,
        substitutionNumber: 1,
        outgoingCoreId: "core-1",
        incomingCoreId: "core-26",
        recordedAt: "2026-09-22T00:05:00.000Z",
      }),
    ]);
  });

  it("rejects another owner before opening a database session", async () => {
    const test = harness([]);
    await expect(
      test.repository.listSubstitutions("another_owner", 2026),
    ).rejects.toThrow("access denied");
    expect(test.sessionFactory).not.toHaveBeenCalled();
  });
});
