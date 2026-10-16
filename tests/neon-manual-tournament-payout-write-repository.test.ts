import { describe, expect, it, vi } from "vitest";

import type { ManualTournamentPayout } from "../domain/manual-tournament-payout";
import type { TournamentPrizeReconciliation } from "../domain/tournament-prize-reconciliation";
import {
  createNeonManualTournamentPayoutPersistence,
  neonManualTournamentPayoutPersistenceFromEnvironment,
} from "../lib/neon-manual-tournament-payout-write-repository";
import type {
  NeonImportPersistenceClient,
  NeonImportPersistenceSessionFactory,
} from "../lib/neon-import-persistence-driver";

const owner = "11111111-1111-4111-8111-111111111111";
const clerk = "user_owner";
const role = "dna_app_runtime";
const hash = "a".repeat(64);
const otherHash = "b".repeat(64);

function evidence(overrides: Record<string, unknown> = {}) {
  return {
    database_owner_id: owner,
    authenticated_owner_id: clerk,
    payout_rls: true,
    payout_force_rls: true,
    session_user_name: role,
    current_user_name: role,
    runtime_is_superuser: false,
    runtime_bypasses_rls: false,
    runtime_can_create_roles: false,
    runtime_can_create_databases: false,
    runtime_is_neon_superuser_member: false,
    runtime_has_direct_payout_access: false,
    ...overrides,
  };
}

function harness(respond: (sql: string) => readonly unknown[]) {
  const events: string[] = [];
  const query = vi.fn(async (statement: string) => {
    const sql = statement.replace(/\s+/g, " ").trim();
    events.push(sql);
    if (sql.startsWith("BEGIN") || sql === "COMMIT" || sql === "ROLLBACK")
      return { rows: [] };
    if (sql.includes("set_config('statement_timeout'")) return { rows: [{}] };
    if (sql.includes("set_config('app.owner_id'"))
      return { rows: [{ owner_scope: owner }] };
    if (sql.includes("FROM dna.app_owner owner")) return { rows: [evidence()] };
    return { rows: respond(sql) };
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

function ready(test: ReturnType<typeof harness>) {
  return createNeonManualTournamentPayoutPersistence({
    databaseUrl: "postgresql://private.example/dna",
    databaseOwnerId: owner,
    runtimeRole: role,
    sessionFactory: test.sessionFactory,
  });
}

const payout: ManualTournamentPayout = {
  payoutId: "payout-1",
  occurredAt: "2026-10-15T00:00:00.000Z",
  tournamentId: "tournament-1",
  season: null,
  bracketId: null,
  leaderboardId: null,
  stage: "final",
  amount: "10",
  assetCode: "DEZ",
  assetKind: "crypto",
  assetDecimalPlaces: 6,
  assetRegistryVersion: hash,
  tournamentCampaignBinding: {
    tournamentId: "tournament-1",
    evidenceId: "owner-evidence",
    configurationVersion: "cfg-1",
    ownerAcknowledgedAt: "2026-10-14T00:00:00.000Z",
  },
  tournamentAggregationEligible: true,
  receivingAccountLabel: null,
  externalReference: null,
  evidenceNote: null,
  sourceType: "manual_tournament_payout",
  allocationMethod: "vault_unallocated",
  allocationStatus: "vault_unallocated",
  allocations: [],
  allocatedAmount: "0",
  unallocatedAmount: "10",
  duplicateReviewRequired: true,
  operatingIncome: true,
};

const reconciliation: TournamentPrizeReconciliation = {
  payoutId: payout.payoutId,
  status: "clear",
  manualPayoutAggregateStatus: "included",
  duplicateOfImportedTransactionId: null,
  candidates: [],
  warnings: [],
  importedFactsMutable: false,
  automaticExclusionAllowed: false,
  vaultLevelAllocationRequired: false,
};

describe("Neon manual tournament payout persistence", () => {
  it("fails closed until every server-only database setting exists", () => {
    expect(
      neonManualTournamentPayoutPersistenceFromEnvironment({
        databaseUrl: undefined,
        databaseOwnerId: owner,
        runtimeRole: role,
      }),
    ).toEqual({ status: "not_configured" });
  });

  it("loads bounded canonical candidate evidence", async () => {
    const candidates = [
      {
        transactionId: "tx-1",
        occurredAt: "2026-10-14T00:00:00.000Z",
        tournamentId: "tournament-1",
        bracketId: null,
        stage: "final",
        assetCode: "DEZ",
        amount: "10",
        externalReference: null,
        aggregateStatus: "included",
      },
    ];
    const test = harness((sql) =>
      sql.includes("read_manual_tournament_payout_candidates")
        ? [
            {
              active_import_snapshot_hash: hash,
              candidate_set_hash: otherHash,
              candidates_json: JSON.stringify(candidates),
            },
          ]
        : [],
    );
    await expect(
      ready(test).repository.loadImportedCandidateSetByOwner(clerk, {
        tournamentId: "tournament-1",
        occurredAt: payout.occurredAt,
        assetCode: "DEZ",
        amount: "10",
        maximumCandidates: 250,
      }),
    ).resolves.toEqual({
      activeImportSnapshotHash: hash,
      candidateSetHash: otherHash,
      candidates,
    });
    expect(test.events.slice(-2)).toEqual(["COMMIT", "close"]);
  });

  it("writes payout state only through the guarded database function", async () => {
    const test = harness((sql) =>
      sql.includes("write_manual_tournament_payout(")
        ? [
            {
              disposition: "created",
              fingerprint: hash,
              ledger_version: "13",
              reconciliation_revision: "0",
              candidate_set_json: null,
            },
          ]
        : [],
    );
    await expect(
      ready(test).repository.savePayoutByOwner(
        clerk,
        payout,
        reconciliation,
        {
          activeImportSnapshotHash: hash,
          candidateSetHash: otherHash,
          candidateTransactionIds: [],
        },
        hash,
        "12",
      ),
    ).resolves.toEqual({
      status: "created",
      ledgerVersion: "13",
      reconciliationRevision: 0,
    });
  });

  it("rejects privilege drift before any payout evidence query", async () => {
    const events: string[] = [];
    const query = vi.fn(async (statement: string) => {
      const sql = statement.replace(/\s+/g, " ").trim();
      events.push(sql);
      if (sql.startsWith("BEGIN") || sql === "COMMIT" || sql === "ROLLBACK")
        return { rows: [] };
      if (sql.includes("set_config('statement_timeout'")) return { rows: [{}] };
      if (sql.includes("set_config('app.owner_id'"))
        return { rows: [{ owner_scope: owner }] };
      return { rows: [evidence({ runtime_has_direct_payout_access: true })] };
    });
    const sessionFactory = vi.fn(async () => ({
      client: { query } as NeonImportPersistenceClient,
      close: async () => events.push("close"),
    })) as unknown as NeonImportPersistenceSessionFactory;
    const persistence = createNeonManualTournamentPayoutPersistence({
      databaseUrl: "postgresql://private.example/dna",
      databaseOwnerId: owner,
      runtimeRole: role,
      sessionFactory,
    });
    await expect(
      persistence.repository.loadImportedCandidateSetByOwner(clerk, {
        tournamentId: "tournament-1",
        occurredAt: payout.occurredAt,
        assetCode: "DEZ",
        amount: "10",
        maximumCandidates: 250,
      }),
    ).rejects.toThrow("Manual tournament payout persistence unavailable.");
    expect(events.slice(-2)).toEqual(["ROLLBACK", "close"]);
    expect(
      events.some((sql) =>
        sql.includes("read_manual_tournament_payout_candidates"),
      ),
    ).toBe(false);
  });
});
