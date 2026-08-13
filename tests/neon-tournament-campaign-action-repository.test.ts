import { describe, expect, it, vi } from "vitest";

import {
  createNeonTournamentCampaignActionRepository,
  neonTournamentCampaignActionRepositoryFromEnvironment,
} from "@/lib/neon-tournament-campaign-action-repository";
import type {
  NeonImportPersistenceClient,
  NeonImportPersistenceSessionFactory,
} from "@/lib/neon-import-persistence-driver";

const databaseOwnerId = "11111111-1111-4111-8111-111111111111";
const runtimeRole = "dna_app_runtime";
const authenticatedOwnerId = "user_owner";
const acknowledgement = {
  tournamentId: "tour-1",
  bracketId: "bike-a",
  configurationVersion: "cfg-11111111111111111111111111111111",
  candidateSnapshotVersion: "snapshot-22222222222222222222222222222222",
  action: "Review candidates",
  evidence: "Owner-reviewed evidence.",
};

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
  const close = vi.fn(async () => events.push("close"));
  const sessionFactory = vi.fn(async () => ({ client, close }));
  return {
    events,
    sessionFactory: sessionFactory as NeonImportPersistenceSessionFactory,
  };
}

describe("Neon Tournament campaign action repository", () => {
  it("stays fail-closed until all database settings are present", () => {
    expect(
      neonTournamentCampaignActionRepositoryFromEnvironment({
        databaseUrl: undefined,
        databaseOwnerId,
        runtimeRole,
      }),
    ).toEqual({ status: "not_configured" });
  });

  it("persists only after exact least-privilege owner verification", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [ownerEvidence()],
      [
        {
          configuration_version: acknowledgement.configurationVersion,
          candidate_snapshot_version: acknowledgement.candidateSnapshotVersion,
          owner_acknowledged_at: "2026-08-13T00:00:00.000Z",
        },
      ],
    ]);
    const repository = createNeonTournamentCampaignActionRepository({
      databaseUrl: "postgresql://private.example/dna",
      databaseOwnerId,
      runtimeRole,
      sessionFactory: test.sessionFactory,
    });
    if (repository.status !== "ready") throw new Error("repository not ready");

    await repository.acknowledgeByOwner(authenticatedOwnerId, acknowledgement);
    expect(test.events[3]).toContain(
      "dna.acknowledge_tournament_campaign_action",
    );
    expect(test.events[3]).toContain(acknowledgement.configurationVersion);
    expect(test.events[3]).toContain(acknowledgement.candidateSnapshotVersion);
    expect(test.events.slice(-2)).toEqual(["COMMIT", "close"]);
  });

  it("rolls back privileged identity or returned binding drift", async () => {
    for (const sequence of [
      [
        [{ owner_scope: databaseOwnerId }],
        [ownerEvidence({ runtime_bypasses_rls: true })],
      ],
      [
        [{ owner_scope: databaseOwnerId }],
        [ownerEvidence()],
        [
          {
            configuration_version: acknowledgement.configurationVersion,
            candidate_snapshot_version:
              "snapshot-33333333333333333333333333333333",
          },
        ],
      ],
    ] as const) {
      const test = harness(sequence);
      const repository = createNeonTournamentCampaignActionRepository({
        databaseUrl: "postgresql://private.example/dna",
        databaseOwnerId,
        runtimeRole,
        sessionFactory: test.sessionFactory,
      });
      if (repository.status !== "ready")
        throw new Error("repository not ready");
      await expect(
        repository.acknowledgeByOwner(authenticatedOwnerId, acknowledgement),
      ).rejects.toThrow(/least-privilege|binding drifted/);
      expect(test.events.slice(-2)).toEqual(["ROLLBACK", "close"]);
    }
  });
});
