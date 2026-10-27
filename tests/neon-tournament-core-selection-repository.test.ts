import { describe, expect, it, vi } from "vitest";

import {
  createNeonTournamentCoreSelectionRepository,
  neonTournamentCoreSelectionRepositoryFromEnvironment,
} from "@/lib/neon-tournament-core-selection-repository";
import type {
  NeonImportPersistenceClient,
  NeonImportPersistenceSessionFactory,
} from "@/lib/neon-import-persistence-driver";

const databaseOwnerId = "11111111-1111-4111-8111-111111111111";
const runtimeRole = "dna_app_runtime";

function harness(rows: readonly (readonly unknown[])[]) {
  let index = 0;
  const events: string[] = [];
  const query = vi.fn(
    async (statement: string, values?: readonly unknown[]) => {
      const normalized = statement.replace(/\s+/g, " ").trim();
      events.push(`${normalized}|${JSON.stringify(values ?? [])}`);
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(normalized)) {
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
  return {
    events,
    sessionFactory: sessionFactory as NeonImportPersistenceSessionFactory,
  };
}

function ownerEvidence() {
  return {
    authenticated_owner_id: "owner-1",
    selection_row_security_enabled: true,
    selection_force_row_security_enabled: true,
    session_user_name: runtimeRole,
    current_user_name: runtimeRole,
    runtime_is_superuser: false,
    runtime_bypasses_rls: false,
  };
}

const row = {
  tournament_id: "tour-1",
  bracket_id: "bike-a",
  configuration_version: "config-v1",
  candidate_snapshot_version: "snapshot-v1",
  core_ids: ["10457"],
  updated_at: "2026-10-27T12:00:00.000Z",
};

describe("Neon Tournament Core selection repository", () => {
  it("stays unavailable until every database setting is present", () => {
    expect(
      neonTournamentCoreSelectionRepositoryFromEnvironment({
        databaseUrl: undefined,
        databaseOwnerId,
        runtimeRole,
      }),
    ).toEqual({ status: "not_configured" });
  });

  it("reads and writes only after forced-RLS owner verification", async () => {
    const readHarness = harness([
      [{ owner_scope: databaseOwnerId }],
      [ownerEvidence()],
      [row],
    ]);
    const readRepo = createNeonTournamentCoreSelectionRepository({
      databaseUrl: "postgresql://private.example/dna",
      databaseOwnerId,
      runtimeRole,
      sessionFactory: readHarness.sessionFactory,
    });
    if (readRepo.status !== "ready") throw new Error("repository unavailable");
    await expect(
      readRepo.readSelection("owner-1", "tour-1", "bike-a"),
    ).resolves.toEqual({
      tournamentId: "tour-1",
      bracketId: "bike-a",
      configurationVersion: "config-v1",
      candidateSnapshotVersion: "snapshot-v1",
      coreIds: ["10457"],
      updatedAt: "2026-10-27T12:00:00.000Z",
    });
    expect(readHarness.events[2]).toContain(
      "'dna.tournament_core_selection'::regclass",
    );
    expect(readHarness.events[3]).toContain(
      "dna.read_tournament_core_selection",
    );
    expect(readHarness.events.slice(-2)[0]).toContain("COMMIT");
    expect(readHarness.events.at(-1)).toBe("close");

    const writeHarness = harness([
      [{ owner_scope: databaseOwnerId }],
      [ownerEvidence()],
      [row],
    ]);
    const writeRepo = createNeonTournamentCoreSelectionRepository({
      databaseUrl: "postgresql://private.example/dna",
      databaseOwnerId,
      runtimeRole,
      sessionFactory: writeHarness.sessionFactory,
    });
    if (writeRepo.status !== "ready") throw new Error("repository unavailable");
    await writeRepo.replaceSelection("owner-1", {
      tournamentId: "tour-1",
      bracketId: "bike-a",
      configurationVersion: "config-v1",
      candidateSnapshotVersion: "snapshot-v1",
      coreIds: ["10457"],
      updatedAt: "2026-10-27T12:00:00.000Z",
    });
    expect(writeHarness.events[3]).toContain(
      "dna.replace_tournament_core_selection",
    );
  });

  it("rolls back before data access when owner evidence is privileged", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [{ ...ownerEvidence(), runtime_bypasses_rls: true }],
    ]);
    const repo = createNeonTournamentCoreSelectionRepository({
      databaseUrl: "postgresql://private.example/dna",
      databaseOwnerId,
      runtimeRole,
      sessionFactory: test.sessionFactory,
    });
    if (repo.status !== "ready") throw new Error("repository unavailable");
    await expect(
      repo.readSelection("owner-1", "tour-1", "bike-a"),
    ).rejects.toThrow("owner scope denied");
    expect(
      test.events.some((event) =>
        event.includes("dna.read_tournament_core_selection"),
      ),
    ).toBe(false);
    expect(test.events.slice(-2)[0]).toContain("ROLLBACK");
  });
});
