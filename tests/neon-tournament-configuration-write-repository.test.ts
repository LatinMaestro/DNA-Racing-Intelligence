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
  seasonLabel: "Season 12",
  qualificationStartsAt: "2026-09-01T00:00:00.000Z",
  qualificationEndsAt: "2026-09-07T23:59:59.000Z",
  bracketId: "bike-a",
  splitLabel: "Bike A",
  mode: "bike" as const,
  eligibleDistancesMetres: [1200, 1400],
  gateCount: 8,
  entryFee: { amount: "0.01", asset: "USD" },
  raceFormat: "Paid qualification",
  eligibility: {
    breeds: ["Genesis"],
    classes: ["Bike"],
    elements: ["Fire"],
    fNumbers: [1, 2, 3],
    fNumberRanges: [{ minimum: 4, maximum: 6 }],
    groups: [
      {
        id: "fire",
        label: "Fire",
        breeds: ["Genesis"],
        classes: ["Bike"],
        elements: ["Fire"],
        fNumbers: [1, 2, 3],
        fNumberRanges: [],
      },
    ],
  },
  leaderboard: {
    splitDimension: "element",
    groups: [{ id: "fire", label: "Fire" }],
    qualifyingRaceSemantics: "shared" as const,
  },
  qualification: {
    minimumRaceCount: 5,
    target: { kind: "percentage" as const, value: "10" },
    rankingMetric: "top_x_finishes" as const,
    topFinishPosition: 3,
    pointsTable: { "1": "10", "2": "6", "3": "3" },
    customScoringConfiguration: {},
  },
  discoveryRelevance: "priority" as const,
  evidence: {
    status: "confirmed" as const,
    notes: "Confirmed rules.",
    sourceEvidence: "Rules screenshot.",
    provenance: { source: "owner_entry" },
  },
  campaignAction: {
    kind: "configured" as const,
    action: "Review candidates",
    ownerAcknowledgedAt: "2026-08-12T00:00:00.000Z",
    evidence: "Owner acknowledgement.",
  },
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

  it("writes the full rule model only after least-privilege owner verification", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [ownerEvidence()],
      [
        {
          configuration_version: "cfg-11111111111111111111111111111111",
          candidate_snapshot_version: "snapshot-unbound",
          updated_at: "2026-08-12T00:30:00.000Z",
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
    expect(test.events[3]).toContain(
      "dna.upsert_complete_tournament_configuration",
    );
    expect(test.events[3]).toContain('"Season 12"');
    expect(test.events[3]).toContain('"top_x_finishes"');
    expect(test.events[3]).not.toContain("client-version");
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
          event.includes("dna.upsert_complete_tournament_configuration"),
        ),
      ).toBe(false);
      expect(test.events.slice(-2)).toEqual(["ROLLBACK", "close"]);
    }
  });

  it("rolls back invalid server binding evidence", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [ownerEvidence()],
      [
        {
          configuration_version: "client-version",
          candidate_snapshot_version: "snapshot-unbound",
          updated_at: "2026-08-12T00:30:00.000Z",
        },
      ],
    ]);

    await expect(
      repository(test).saveByOwner(authenticatedOwnerId, configuration),
    ).rejects.toThrow("server configuration version is invalid");
    expect(test.events.slice(-2)).toEqual(["ROLLBACK", "close"]);
  });
});
