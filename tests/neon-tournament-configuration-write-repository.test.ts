import { describe, expect, it, vi } from "vitest";

import {
  createNeonTournamentConfigurationWriteRepository,
  neonTournamentConfigurationWriteRepositoryFromEnvironment,
} from "../lib/neon-tournament-configuration-write-repository";
import type {
  NeonImportPersistenceClient,
  NeonImportPersistenceSessionFactory,
} from "../lib/neon-import-persistence-driver";

const databaseOwnerId = "11111111-1111-4111-8111-111111111111";
const runtimeRole = "dna_app_runtime";
const authenticatedOwnerId = "user_owner";

function ownerEvidence(overrides: Record<string, unknown> = {}) {
  return {
    authenticated_owner_id: authenticatedOwnerId,
    row_security_enabled: true,
    force_row_security_enabled: true,
    session_user_name: runtimeRole,
    current_user_name: runtimeRole,
    runtime_is_superuser: false,
    runtime_bypasses_rls: false,
    ...overrides,
  };
}

function harness(sequence: readonly (readonly unknown[] | Error)[]) {
  const events: string[] = [];
  let index = 0;
  const query = vi.fn(
    async (statement: string, values?: readonly unknown[]) => {
      const normalized = statement.replace(/\s+/g, " ").trim();
      events.push(
        values ? `${normalized}|${JSON.stringify(values)}` : normalized,
      );
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

function repository(test: ReturnType<typeof harness>) {
  const result = createNeonTournamentConfigurationWriteRepository({
    databaseUrl: "postgresql://private.example/dna",
    databaseOwnerId,
    runtimeRole,
    sessionFactory: test.sessionFactory,
  });
  if (result.status !== "ready") throw new Error("repository not ready");
  return result;
}

const configuration = {
  tournamentId: "tour-1",
  tournamentLabel: "Cup",
  bracketId: "bike-a",
  splitLabel: "Bike A",
  mode: "bike" as const,
  eligibleDistancesMetres: [1200, 1400],
  discoveryRelevance: "priority" as const,
  qualificationMetricLabel: "Qualification points",
  configurationVersion: "config-2",
  candidateSnapshotVersion: "snapshot-3",
  updatedAt: "2026-08-11T10:30:00.000Z",
};

describe("Neon Tournament configuration write repository", () => {
  it("stays fail-closed until every database setting is present", () => {
    expect(
      neonTournamentConfigurationWriteRepositoryFromEnvironment({
        databaseUrl: undefined,
        databaseOwnerId,
        runtimeRole,
      }),
    ).toEqual({ status: "not_configured" });
  });

  it("writes only after least-privilege owner verification", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [ownerEvidence()],
      [
        {
          tournament_id: "tour-1",
          bracket_id: "bike-a",
          updated_at: "2026-08-11T10:30:00.000Z",
        },
      ],
    ]);

    await expect(
      repository(test).saveByOwner(authenticatedOwnerId, configuration),
    ).resolves.toBeUndefined();
    expect(test.events[0]).toBe("BEGIN ISOLATION LEVEL SERIALIZABLE");
    expect(test.events[2]).toContain(
      "'dna.tournament_configuration'::regclass",
    );
    expect(test.events[3]).toContain("dna.upsert_tournament_configuration");
    expect(test.events.slice(-2)).toEqual(["COMMIT", "close"]);
  });

  it("rejects privileged or mismatched owner evidence before write", async () => {
    for (const evidence of [
      ownerEvidence({ authenticated_owner_id: "user_other" }),
      ownerEvidence({ force_row_security_enabled: false }),
      ownerEvidence({ runtime_bypasses_rls: true }),
    ]) {
      const test = harness([[{ owner_scope: databaseOwnerId }], [evidence]]);
      await expect(
        repository(test).saveByOwner(authenticatedOwnerId, configuration),
      ).rejects.toThrow(/owner scope denied|least-privilege owner isolation/);
      expect(
        test.events.some((event) =>
          event.includes("dna.upsert_tournament_configuration"),
        ),
      ).toBe(false);
      expect(test.events.slice(-2)).toEqual(["ROLLBACK", "close"]);
    }
  });
});
