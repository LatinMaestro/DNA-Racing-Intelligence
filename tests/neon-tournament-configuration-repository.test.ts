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
    tournament_row_security_enabled: true,
    tournament_force_row_security_enabled: true,
    vault_row_security_enabled: true,
    vault_force_row_security_enabled: true,
    session_user_name: runtimeRole,
    current_user_name: runtimeRole,
    runtime_is_superuser: false,
    runtime_bypasses_rls: false,
    ...overrides,
  };
}

function completeConfigurationRow() {
  return {
    tournament_id: "tour-1",
    tournament_label: "Cup",
    season_label: "Season 12",
    qualification_starts_at: "2026-08-01T00:00:00.000Z",
    qualification_ends_at: "2026-08-31T00:00:00.000Z",
    bracket_id: "bike-a",
    split_label: "Bike A",
    mode: "bike",
    eligible_distances_metres: ["1200", 1400],
    gate_count: 4,
    entry_fee_amount: "2.5000",
    entry_fee_asset: "ETH",
    race_format: "Four gates; best two results count",
    eligible_breeds: ["Genesis"],
    eligible_classes: [],
    eligible_elements: ["Fire"],
    eligible_f_numbers: [1],
    eligible_f_number_ranges: [{ minimum: 2, maximum: 4 }],
    eligibility_groups: [],
    leaderboard_split_dimension: "element",
    leaderboard_groups: [{ id: "fire", label: "Fire" }],
    minimum_race_count: 10,
    qualification_count: 5,
    qualification_percentage: null,
    ranking_metric: "points",
    top_finish_position: null,
    points_table: { "1": "10", "2": "6" },
    custom_scoring_configuration: {},
    qualifying_race_semantics: "separate",
    discovery_relevance: "priority",
    rule_evidence_status: "confirmed",
    rule_notes: "",
    source_evidence: "Owner-reviewed tournament rules",
    provenance: { source: "owner" },
    campaign_action: null,
    configuration_version: "config-1",
    candidate_snapshot_version: "snapshot-1",
    updated_at: "2026-07-31T12:00:00.000Z",
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
      if ([
          "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
          "COMMIT",
          "ROLLBACK",
        ].includes(normalized)) {
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

  it("binds active My Vault cores to each configured split without inventing rankings", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [ownerEvidence()],
      [completeConfigurationRow()],
      [
        { source_core_id: "core-2", me_eligible: false },
        { source_core_id: "core-7", me_eligible: true },
      ],
      [
        {
          core_id: "core-2",
          mode: "bike",
          distance: 1200,
          data_current_through: "2026-07-30T00:00:00.000Z",
          last_imported_at: "2026-08-01T03:00:00.000Z",
        },
        {
          core_id: "core-2",
          mode: "bike",
          distance: 1400,
          data_current_through: "2026-07-20T00:00:00.000Z",
          last_imported_at: "2026-08-01T03:00:00.000Z",
        },
        {
          core_id: "core-7",
          mode: "bike",
          distance: 1400,
          data_current_through: "2026-07-25T00:00:00.000Z",
          last_imported_at: "2026-08-01T03:00:00.000Z",
        },
      ],
    ]);

    const result =
      await repository(test).listCandidateEvidenceByOwner(authenticatedOwnerId);
    expect(result.lastImportedAt).toBe("2026-08-01T03:00:00.000Z");
    expect(result.brackets).toHaveLength(1);
    expect(result.brackets[0]).toMatchObject({
      tournamentId: "tour-1",
      tournamentLabel: "Cup",
      bracketId: "bike-a",
      splitLabel: "Bike A",
      mode: "bike",
      eligibleDistancesMetres: [1200, 1400],
      discoveryRelevance: "priority",
      qualificationMetricLabel: "points",
      configurationVersion: "config-1",
      candidateSnapshotVersion: "snapshot-1",
      ruleConfiguration: {
        seasonLabel: "Season 12",
        qualificationStartsAt: "2026-08-01T00:00:00.000Z",
        qualificationEndsAt: "2026-08-31T00:00:00.000Z",
        gateCount: 4,
        entryFee: { amount: "2.5000", asset: "ETH" },
        raceFormat: "Four gates; best two results count",
        eligibility: {
          breeds: ["Genesis"],
          classes: [],
          elements: ["Fire"],
          fNumbers: [1],
          fNumberRanges: [{ minimum: 2, maximum: 4 }],
          groups: [],
        },
        leaderboard: {
          splitDimension: "element",
          groups: [{ id: "fire", label: "Fire" }],
          qualifyingRaceSemantics: "separate",
        },
        qualification: {
          minimumRaceCount: 10,
          target: { kind: "count", value: 5 },
          rankingMetric: "points",
          topFinishPosition: null,
          pointsTable: { "1": "10", "2": "6" },
          customScoringConfiguration: {},
        },
        evidence: {
          status: "confirmed",
          notes: "",
          sourceEvidence: "Owner-reviewed tournament rules",
          provenance: { source: "owner" },
        },
        campaignAction: null,
        updatedAt: "2026-07-31T12:00:00.000Z",
      },
      candidates: [
        {
          coreId: "core-2",
          leaderboardGroupId: "unassigned",
          eligibility: "review_required",
          maidenState: "not_eligible",
          dataCurrentThrough: "2026-07-20T00:00:00.000Z",
          lastImported: "2026-08-01T03:00:00.000Z",
          freshness: "unknown",
        },
        {
          coreId: "core-7",
          leaderboardGroupId: "unassigned",
          eligibility: "review_required",
          maidenState: "eligible",
          maidenModeDisposition: "unresolved",
          dataCurrentThrough: "2026-07-25T00:00:00.000Z",
          lastImported: "2026-08-01T03:00:00.000Z",
          freshness: "unknown",
        },
      ],
    });
    expect(test.events[0]).toBe(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    expect(test.events[2]).toContain(
      "'dna.tournament_configuration'::regclass",
    );
    expect(test.events[3]).toContain(
      "dna.list_bound_tournament_configurations",
    );
    expect(test.events[4]).toContain("dna.owner_vault_core");
    expect(test.events[4]).toContain("vault.in_my_vault");
    expect(test.events[5]).toContain("dna.list_core_performance_profiles");
    expect(test.events.slice(-2)).toEqual(["COMMIT", "close"]);
  });

  it("rejects inconsistent profile import evidence instead of publishing freshness", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [ownerEvidence()],
      [completeConfigurationRow()],
      [{ source_core_id: "core-2", me_eligible: false }],
      [
        {
          core_id: "core-2",
          mode: "bike",
          distance: 1200,
          data_current_through: "2026-07-30T00:00:00.000Z",
          last_imported_at: "2026-08-01T03:00:00.000Z",
        },
        {
          core_id: "core-2",
          mode: "bike",
          distance: 1400,
          data_current_through: "2026-07-20T00:00:00.000Z",
          last_imported_at: "2026-08-02T03:00:00.000Z",
        },
      ],
    ]);

    await expect(
      repository(test).listCandidateEvidenceByOwner(authenticatedOwnerId),
    ).rejects.toThrow(
      "Tournament performance import evidence is inconsistent.",
    );
    expect(test.events.slice(-2)).toEqual(["ROLLBACK", "close"]);
  });

  it("rejects non-owner or privileged runtime evidence before reading configuration", async () => {
    for (const evidence of [
      ownerEvidence({ authenticated_owner_id: "user_other" }),
      ownerEvidence({ tournament_force_row_security_enabled: false }),
      ownerEvidence({ vault_force_row_security_enabled: false }),
      ownerEvidence({ runtime_bypasses_rls: true }),
    ]) {
      const test = harness([[{ owner_scope: databaseOwnerId }], [evidence]]);
      await expect(
        repository(test).listCandidateEvidenceByOwner(authenticatedOwnerId),
      ).rejects.toThrow(/owner scope denied|least-privilege owner isolation/);
      expect(
        test.events.some((event) =>
          event.includes("dna.list_bound_tournament_configurations"),
        ),
      ).toBe(false);
      expect(test.events.slice(-2)).toEqual(["ROLLBACK", "close"]);
    }
  });
});
