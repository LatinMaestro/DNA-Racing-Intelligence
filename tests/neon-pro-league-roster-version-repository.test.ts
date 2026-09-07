import { describe, expect, it, vi } from "vitest";

import {
  buildProLeagueRosterSubstitution,
  buildProLeagueRosterVersion,
} from "@/domain/pro-league-roster-version";
import type { ProLeagueRosterCore } from "@/domain/pro-league-roster";
import type {
  NeonImportPersistenceClient,
  NeonImportPersistenceSessionFactory,
} from "@/lib/neon-import-persistence-driver";
import { createNeonProLeagueRosterVersionRepository } from "@/lib/neon-pro-league-roster-version-repository";

const databaseOwnerId = "80000000-0000-4000-8000-000000000001";
const ownerId = "private_owner";
const runtimeRole = "dna_app_runtime";
const elements = ["Metal", "Fire", "Earth", "Water"] as const;

function core(index: number): ProLeagueRosterCore {
  return {
    coreId: `core-${index}`,
    displayName: `Core ${index}`,
    element: elements[(index - 1) % elements.length]!,
    coreClass: "Morphed",
    sex: index <= 4 ? "female" : "male",
    fNumber: index <= 2 ? 16 : 11,
    inMyVault: true,
  };
}

function version(
  id: string,
  number: number,
  lastCore = 12,
  alternateFirst = false,
) {
  const rostered = Array.from({ length: 12 }, (_, index) => {
    const value = core(index === 11 ? lastCore : index + 1);
    return {
      core: value,
      disposition: "rostered" as const,
      role: "nucleus" as const,
      reason: "Exact-format evidence retained.",
      evidence: {
        asOf: "2026-09-02T23:00:00.000Z",
        generationId: "generation-1",
        sha256: "a".repeat(64),
        confidence: "moderate" as const,
      },
    };
  });
  const alternate = {
    ...rostered[0]!,
    core: core(90),
    disposition: "alternate" as const,
    role: "alternate" as const,
  };
  return buildProLeagueRosterVersion({
    rosterVersionId: id,
    versionNumber: number,
    initialRosterCountingPolicy: "unresolved",
    evidenceCutoffAt: "2026-09-03T00:00:00.000Z",
    rationale: "Quality-first roster snapshot.",
    members: alternateFirst ? [alternate, ...rostered] : rostered,
  });
}

function isolation(overrides: Record<string, unknown> = {}) {
  return {
    authenticated_owner_id: ownerId,
    all_rls_enabled: true,
    all_force_rls_enabled: true,
    runtime_can_read_tables: false,
    runtime_can_store_version: true,
    runtime_can_read_version: true,
    runtime_can_record_substitution: true,
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
  const repository = createNeonProLeagueRosterVersionRepository({
    databaseUrl: "postgresql://private.example/dna",
    databaseOwnerId,
    ownerId,
    runtimeRole,
    sessionFactory: sessionFactory as NeonImportPersistenceSessionFactory,
  });
  return { close, events, query, repository, sessionFactory };
}

function memberRows(value = version("roster-v1", 1)) {
  return value.members.map((member) => ({
    coreId: member.core.coreId,
    displayName: member.core.displayName,
    element: member.core.element,
    coreClass: member.core.coreClass,
    sex: member.core.sex,
    fNumber: member.core.fNumber,
    inMyVault: true,
    disposition: member.disposition,
    role: member.role,
    position: member.position,
    reason: member.reason,
    evidence: member.evidence,
  }));
}

describe("Neon Pro League roster version repository", () => {
  it("stores a validated immutable roster in a serializable owner scope", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [
        {
          disposition: "created",
          rostered_core_count: 12,
          alternate_core_count: 0,
        },
      ],
    ]);

    await expect(
      test.repository.saveVersion(ownerId, version("roster-v1", 1)),
    ).resolves.toMatchObject({ disposition: "created" });
    expect(test.events[0]).toBe("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const values = test.query.mock.calls[3]?.[1] as readonly unknown[];
    expect(values.slice(0, 9)).toEqual([
      databaseOwnerId,
      "roster-v1",
      1,
      "dna-pro-league/owner-confirmed-2026-08-31",
      "owner-pro-league/ageing-aware-25-core-2026-08-31",
      "unresolved",
      "2026-09-03T00:00:00.000Z",
      "Quality-first roster snapshot.",
      expect.stringMatching(/^[a-f0-9]{64}$/u),
    ]);
    expect(JSON.parse(values[9] as string)).toHaveLength(12);
    expect(test.events.slice(-2)).toEqual(["COMMIT", "close"]);
  });

  it("loads and revalidates a stored roster without historical leakage", async () => {
    const storedVersion = version("roster-v1", 1);
    const writer = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [
        {
          disposition: "created",
          rostered_core_count: 12,
          alternate_core_count: 0,
        },
      ],
    ]);
    const { versionSha256 } = await writer.repository.saveVersion(
      ownerId,
      storedVersion,
    );
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [
        {
          roster_version_id: "roster-v1",
          version_number: 1,
          ruleset_id: "dna-pro-league/owner-confirmed-2026-08-31",
          strategy_id: "owner-pro-league/ageing-aware-25-core-2026-08-31",
          initial_roster_counting_policy: "unresolved",
          evidence_cutoff_at: new Date("2026-09-03T00:00:00Z"),
          rationale: "Quality-first roster snapshot.",
          version_sha256: versionSha256,
          created_at: new Date("2026-09-03T00:01:00Z"),
          members: memberRows(storedVersion),
        },
      ],
    ]);

    await expect(
      test.repository.loadVersion(ownerId, "roster-v1"),
    ).resolves.toMatchObject({
      version: {
        rosterVersionId: "roster-v1",
        audit: { readiness: "compliant" },
      },
      versionSha256,
      createdAt: "2026-09-03T00:01:00.000Z",
    });
    expect(test.events[0]).toBe(
      "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
  });

  it("fingerprints roster and alternate lanes independently of input interleaving", async () => {
    const storedVersion = version("roster-v1", 1, 12, true);
    const writer = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [
        {
          disposition: "created",
          rostered_core_count: 12,
          alternate_core_count: 1,
        },
      ],
    ]);
    const { versionSha256 } = await writer.repository.saveVersion(
      ownerId,
      storedVersion,
    );
    const storedMembers = memberRows(storedVersion).sort(
      (left, right) =>
        (left.disposition === right.disposition
          ? 0
          : left.disposition === "rostered"
            ? -1
            : 1) || left.position - right.position,
    );
    const reader = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [
        {
          roster_version_id: "roster-v1",
          version_number: 1,
          ruleset_id: "dna-pro-league/owner-confirmed-2026-08-31",
          strategy_id: "owner-pro-league/ageing-aware-25-core-2026-08-31",
          initial_roster_counting_policy: "unresolved",
          evidence_cutoff_at: new Date("2026-09-03T00:00:00Z"),
          rationale: "Quality-first roster snapshot.",
          version_sha256: versionSha256,
          created_at: new Date("2026-09-03T00:01:00Z"),
          members: storedMembers,
        },
      ],
    ]);

    await expect(
      reader.repository.loadVersion(ownerId, "roster-v1"),
    ).resolves.toMatchObject({
      versionSha256,
      version: { alternateCoreIds: ["core-90"] },
    });
  });

  it("records and reads the contiguous annual substitution ledger", async () => {
    const before = version("roster-v1", 1);
    const after = version("roster-v2", 2, 13);
    const substitution = buildProLeagueRosterSubstitution({
      seasonYear: 2026,
      substitutionNumber: 1,
      from: before,
      to: after,
      reason: "Improves an exact-format roster gap.",
      evidence: {
        asOf: "2026-09-02T23:30:00.000Z",
        generationId: "generation-1",
        sha256: "c".repeat(64),
        confidence: "strong",
      },
    });
    const writer = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [{ disposition: "created", substitution_number: 1 }],
    ]);
    const storedSubstitution = await writer.repository.recordSubstitution(
      ownerId,
      substitution,
    );
    expect(storedSubstitution).toMatchObject({ disposition: "created" });

    const reader = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [
        {
          owner_id: databaseOwnerId,
          season_year: 2026,
          substitution_number: 1,
          from_roster_version_id: "roster-v1",
          to_roster_version_id: "roster-v2",
          outgoing_core_id: "core-12",
          incoming_core_id: "core-13",
          reason: "Improves an exact-format roster gap.",
          evidence_as_of: new Date("2026-09-02T23:30:00Z"),
          evidence_generation_id: "generation-1",
          evidence_sha256: "c".repeat(64),
          evidence_confidence: "strong",
          substitution_sha256: storedSubstitution.substitutionSha256,
          recorded_at: new Date("2026-09-03T00:02:00Z"),
        },
      ],
    ]);
    await expect(
      reader.repository.listSubstitutions(ownerId, 2026),
    ).resolves.toEqual([
      expect.objectContaining({
        substitutionNumber: 1,
        outgoingCoreId: "core-12",
        incomingCoreId: "core-13",
      }),
    ]);
  });

  it("rejects roster and substitution fingerprint drift on read", async () => {
    const driftedVersion = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [
        {
          roster_version_id: "roster-v1",
          version_number: 1,
          ruleset_id: "dna-pro-league/owner-confirmed-2026-08-31",
          strategy_id: "owner-pro-league/ageing-aware-25-core-2026-08-31",
          initial_roster_counting_policy: "unresolved",
          evidence_cutoff_at: new Date("2026-09-03T00:00:00Z"),
          rationale: "Quality-first roster snapshot.",
          version_sha256: "b".repeat(64),
          created_at: new Date("2026-09-03T00:01:00Z"),
          members: memberRows(),
        },
      ],
    ]);
    await expect(
      driftedVersion.repository.loadVersion(ownerId, "roster-v1"),
    ).rejects.toThrow("roster version fingerprint drifted");

    const driftedSubstitution = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [
        {
          season_year: 2026,
          substitution_number: 1,
          from_roster_version_id: "roster-v1",
          to_roster_version_id: "roster-v2",
          outgoing_core_id: "core-12",
          incoming_core_id: "core-13",
          reason: "Improves an exact-format roster gap.",
          evidence_as_of: new Date("2026-09-02T23:30:00Z"),
          evidence_generation_id: "generation-1",
          evidence_sha256: "c".repeat(64),
          evidence_confidence: "strong",
          substitution_sha256: "d".repeat(64),
          recorded_at: new Date("2026-09-03T00:02:00Z"),
        },
      ],
    ]);
    await expect(
      driftedSubstitution.repository.listSubstitutions(ownerId, 2026),
    ).rejects.toThrow("substitution fingerprint drifted");
  });

  it("rolls back unsafe runtime isolation and rejects another owner", async () => {
    const unsafe = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation({ runtime_can_read_tables: true })],
    ]);
    await expect(
      unsafe.repository.loadVersion(ownerId, "roster-v1"),
    ).rejects.toThrow("least-privilege owner isolation");
    expect(unsafe.events.slice(-2)).toEqual(["ROLLBACK", "close"]);

    const denied = harness([]);
    await expect(
      denied.repository.loadVersion("another_owner", "roster-v1"),
    ).rejects.toThrow("access denied");
    expect(denied.sessionFactory).not.toHaveBeenCalled();
  });
});
