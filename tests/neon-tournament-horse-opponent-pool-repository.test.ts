import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { createNeonTournamentHorseOpponentPoolRepository } from "@/lib/neon-tournament-horse-opponent-pool-repository";
import type { NeonImportPersistenceClient } from "@/lib/neon-import-persistence-driver";

const ERROR = "Tournament Horse opponent pool repository unavailable.";
const databaseOwnerId = "11111111-1111-4111-8111-111111111111";
const ownerId = "user_synthetic_owner";
const publishedAt = "2026-10-18T15:00:00.000Z";

const payload = Object.freeze({
  version: 1,
  state: "accepted",
  completeForRosterElements: true,
  truncated: false,
  cores: [
    { coreId: "201", name: "Opponent Two", element: "Fire" },
    { coreId: "101", name: "Opponent One", element: "Fire" },
  ],
  groups: [
    {
      element: "Fire",
      distanceMetres: 1000,
      tournamentFieldOpponentCoreIds: ["201", "101"],
      topTenPercentOpponentCoreIds: ["101"],
      status: "confirmed",
    },
  ],
} as const);

const canonicalPayload = Object.freeze({
  version: 1,
  state: "accepted",
  completeForRosterElements: true,
  truncated: false,
  cores: [
    { coreId: "101", name: "Opponent One", element: "Fire" },
    { coreId: "201", name: "Opponent Two", element: "Fire" },
  ],
  groups: [
    {
      element: "Fire",
      distanceMetres: 1000,
      tournamentFieldOpponentCoreIds: ["101", "201"],
      topTenPercentOpponentCoreIds: ["101"],
      status: "confirmed",
    },
  ],
} as const);
const payloadJson = JSON.stringify(canonicalPayload);
const snapshotVersion = createHash("sha256")
  .update(payloadJson, "utf8")
  .digest("hex");

const isolation = Object.freeze({
  database_owner_id: databaseOwnerId,
  authenticated_owner_id: ownerId,
  snapshot_row_security_enabled: true,
  snapshot_force_row_security_enabled: true,
  active_row_security_enabled: true,
  active_force_row_security_enabled: true,
  session_user_name: "dna_app_runtime",
  current_user_name: "dna_app_runtime",
  runtime_is_superuser: false,
  runtime_bypasses_rls: false,
  runtime_can_create_roles: false,
  runtime_can_create_databases: false,
  runtime_is_neon_superuser_member: false,
  runtime_has_direct_snapshot_access: false,
  runtime_has_direct_active_access: false,
  runtime_can_read_snapshot: true,
  runtime_can_publish_snapshot: true,
});

function harness(
  change: {
    readRows?: readonly unknown[];
    isolationRows?: readonly unknown[];
    publicationStatus?: string;
    failOn?: string;
  } = {},
) {
  const query = vi.fn<NeonImportPersistenceClient["query"]>(async (sql) => {
    if (change.failOn && sql.includes(change.failOn))
      throw new Error("private database detail");
    if (sql.includes("AS owner_scope"))
      return { rows: [{ owner_scope: databaseOwnerId }] };
    if (sql.includes("runtime_can_read_snapshot"))
      return { rows: change.isolationRows ?? [isolation] };
    if (sql.includes("read_active_tournament_horse_opponent_pool_snapshot"))
      return {
        rows: change.readRows ?? [
          {
            snapshot_version: snapshotVersion,
            payload_json: payloadJson,
            published_at: publishedAt,
          },
        ],
      };
    if (sql.includes("publish_tournament_horse_opponent_pool_snapshot"))
      return {
        rows: [{ publication_status: change.publicationStatus ?? "published" }],
      };
    return { rows: [] };
  });
  const close = vi.fn(async () => undefined);
  const sessionFactory = vi.fn(async () => ({ client: { query }, close }));
  return {
    repository: createNeonTournamentHorseOpponentPoolRepository({
      databaseUrl: "postgresql://synthetic.invalid/dna",
      databaseOwnerId,
      authenticatedOwnerId: ownerId,
      runtimeRole: "dna_app_runtime",
      sessionFactory,
    }),
    query,
    close,
    sessionFactory,
  };
}

describe("Neon Tournament Horse opponent-pool repository", () => {
  it("reads the immutable active authority through owner-scoped functions", async () => {
    const test = harness();
    await expect(
      test.repository.loadAcceptedHorseOpponentPoolsByOwner(ownerId),
    ).resolves.toEqual({
      databaseOwnerId,
      opponentPoolSnapshotVersion: snapshotVersion,
      state: "accepted",
      completeForRosterElements: true,
      truncated: false,
      cores: canonicalPayload.cores,
      groups: canonicalPayload.groups,
    });
    expect(test.query.mock.calls[0]?.[0]).toContain("SERIALIZABLE READ ONLY");
    expect(test.query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
    expect(test.close).toHaveBeenCalledOnce();
  });

  it("returns the exact active content identity", async () => {
    const test = harness();
    await expect(
      test.repository.readAcceptedHorseOpponentPoolVersionByOwner(ownerId),
    ).resolves.toBe(snapshotVersion);
  });

  it("canonicalizes and publishes a content-addressed authority", async () => {
    const test = harness();
    await expect(
      test.repository.publishAcceptedHorseOpponentPools(ownerId, {
        expectedActiveSnapshotVersion: null,
        state: "accepted",
        completeForRosterElements: true,
        truncated: false,
        cores: payload.cores,
        groups: payload.groups,
        publishedAt,
      }),
    ).resolves.toEqual({ status: "published", snapshotVersion });
    const publication = test.query.mock.calls.find(([sql]) =>
      sql.includes(
        "SELECT dna.publish_tournament_horse_opponent_pool_snapshot",
      ),
    );
    expect(publication?.[1]).toEqual([
      databaseOwnerId,
      snapshotVersion,
      null,
      payloadJson,
      publishedAt,
    ]);
  });

  it.each(["unchanged", "source_changed"])(
    "preserves the %s compare-and-swap outcome",
    async (publicationStatus) => {
      const test = harness({ publicationStatus });
      await expect(
        test.repository.publishAcceptedHorseOpponentPools(ownerId, {
          expectedActiveSnapshotVersion: snapshotVersion,
          state: "accepted",
          completeForRosterElements: true,
          truncated: false,
          cores: payload.cores,
          groups: payload.groups,
          publishedAt,
        }),
      ).resolves.toEqual({ status: publicationStatus, snapshotVersion });
    },
  );

  it("rejects cross-owner, privileged, tampered and unconfirmed accepted data", async () => {
    const crossOwner = harness();
    await expect(
      crossOwner.repository.loadAcceptedHorseOpponentPoolsByOwner("user_other"),
    ).rejects.toThrow(ERROR);
    expect(crossOwner.sessionFactory).not.toHaveBeenCalled();

    const privileged = harness({
      isolationRows: [{ ...isolation, runtime_bypasses_rls: true }],
    });
    await expect(
      privileged.repository.loadAcceptedHorseOpponentPoolsByOwner(ownerId),
    ).rejects.toThrow(ERROR);

    const tampered = harness({
      readRows: [
        {
          snapshot_version: snapshotVersion,
          payload_json: `${payloadJson} `,
          published_at: publishedAt,
        },
      ],
    });
    await expect(
      tampered.repository.loadAcceptedHorseOpponentPoolsByOwner(ownerId),
    ).rejects.toThrow(ERROR);

    const test = harness();
    await expect(
      test.repository.publishAcceptedHorseOpponentPools(ownerId, {
        expectedActiveSnapshotVersion: null,
        state: "accepted",
        completeForRosterElements: true,
        truncated: false,
        cores: payload.cores,
        groups: [{ ...payload.groups[0]!, status: "review_required" }],
        publishedAt,
      }),
    ).rejects.toThrow(ERROR);
  });

  it.each([
    "BEGIN",
    "statement_timeout",
    "runtime_can_read_snapshot",
    "COMMIT",
  ])("sanitizes %s failures and closes the session", async (failOn) => {
    const test = harness({ failOn });
    await expect(
      test.repository.loadAcceptedHorseOpponentPoolsByOwner(ownerId),
    ).rejects.toThrow(ERROR);
    expect(test.close).toHaveBeenCalledOnce();
  });
});
