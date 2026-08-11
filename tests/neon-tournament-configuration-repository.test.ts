import { describe, expect, it, vi } from "vitest";

import {
  createNeonTournamentConfigurationRepository,
  neonTournamentConfigurationRepositoryFromEnvironment,
} from "../lib/neon-tournament-configuration-repository";
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
  const query = vi.fn(async (statement: string, values?: readonly unknown[]) => {
    const normalized = statement.replace(/\s+/g, " ").trim();
    events.push(
      values ? `${normalized}|${JSON.stringify(values)}` : normalized,
    );
    if (["BEGIN READ ONLY", "COMMIT", "ROLLBACK"].includes(normalized)) {
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
    sessionFactory: sessionFactory as NeonImportPersistenceSessionFactory,
  };
}

function repository(test: ReturnType<typeof harness>) {
  const result = createNeonTournamentConfigurationRepository({
    databaseUrl: "postgresql://private.example/dna",
    databaseOwnerId,
    runtimeRole,
    sessionFactory: test.sessionFactory,
  });
  if (result.status !== "ready") throw new Error("repository not ready");
  return result;
}

describe("Neon Tournament configuration repository", () => {
  it("stays fail-closed until every database setting is present", () => {
    expect(
      neonTournamentConfigurationRepositoryFromEnvironment({
        databaseUrl: undefined,
        databaseOwnerId,
        runtimeRole,
      }),
    ).toEqual({ status: "not_configured" });
  });

  it("maps owner-scoped configuration without inventing candidate evidence", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [ownerEvidence()],
      [
        {
          tournament_id: "tour-1",
          tournament_label: "Cup",
          bracket_id: "bike-a",
          split_label: "Bike A",
          mode: "bike",
          eligible_distances_metres: ["1200", 1400],
          discovery_relevance: "priority",
          qualification_metric_label: "Qualification points",
          configuration_version: "config-1",
          candidate_snapshot_version: "snapshot-1",
        },
      ],
    ]);

    await expect(
      repository(test).listCandidateEvidenceByOwner(authenticatedOwnerId),
    ).resolves.toEqual({
      brackets: [
        {
          tournamentId: "tour-1",
          tournamentLabel: "Cup",
          bracketId: "bike-a",
          splitLabel: "Bike A",
          mode: "bike",
          eligibleDistancesMetres: [1200, 1400],
          discoveryRelevance: "priority",
          qualificationMetricLabel: "Qualification points",
          configurationVersion: "config-1",
          candidateSnapshotVersion: "snapshot-1",
          candidates: [],
        },
      ],
      lastImportedAt: null,
    });
    expect(test.events[0]).toBe("BEGIN READ ONLY");
    expect(test.events[2]).toContain(
      "'dna.tournament_configuration'::regclass",
    );
    expect(test.events[3]).toContain("dna.list_tournament_configurations");
    expect(test.events.slice(-2)).toEqual(["COMMIT", "close"]);
  });

  it("rejects non-owner or privileged runtime evidence before reading configuration", async () => {
    for (const evidence of [
      ownerEvidence({ authenticated_owner_id: "user_other" }),
      ownerEvidence({ force_row_security_enabled: false }),
      ownerEvidence({ runtime_bypasses_rls: true }),
    ]) {
      const test = harness([[{ owner_scope: databaseOwnerId }], [evidence]]);
      await expect(
        repository(test).listCandidateEvidenceByOwner(authenticatedOwnerId),
      ).rejects.toThrow(/owner scope denied|least-privilege owner isolation/);
      expect(
        test.events.some((event) =>
          event.includes("dna.list_tournament_configurations"),
        ),
      ).toBe(false);
      expect(test.events.slice(-2)).toEqual(["ROLLBACK", "close"]);
    }
  });
});
