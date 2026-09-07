import { describe, expect, it, vi } from "vitest";

import {
  buildProLeagueLineupVersion,
  buildProLeagueMatchLock,
} from "@/domain/pro-league-lineup-version";
import { proLeagueMaps } from "@/domain/pro-league-maps";
import type {
  NeonImportPersistenceClient,
  NeonImportPersistenceSessionFactory,
} from "@/lib/neon-import-persistence-driver";
import { createNeonProLeagueLineupRepository } from "@/lib/neon-pro-league-lineup-repository";

const databaseOwnerId = "82000000-0000-4000-8000-000000000001";
const ownerId = "private_owner";
const runtimeRole = "dna_app_runtime";
const rosterCoreIds = ["core-1", "core-2"];

function lineup() {
  return buildProLeagueLineupVersion({
    lineupVersionId: "lineup-v1",
    versionNumber: 1,
    rosterVersionId: "roster-v1",
    rosterCoreIds,
    rationale: "Complete reusable four-map assignment.",
    assignments: proLeagueMaps.flatMap((map) =>
      map.races.map((race) => ({
        mapId: map.mapId,
        raceNumber: race.raceNumber,
        coreId: race.raceNumber % 2 === 0 ? "core-2" : "core-1",
        scope: "single_race" as const,
      })),
    ),
  });
}

function matchLock() {
  return buildProLeagueMatchLock({
    matchLockId: "lock-1",
    matchId: "match-1",
    lineup: lineup(),
    ourVaultId: "vault-away",
    homeVaultId: "vault-home",
    awayVaultId: "vault-away",
    scheduledAt: "2026-09-08T10:00:00.000Z",
    lockedAt: "2026-09-08T09:00:00.000Z",
    rulesetSource: "official-match-page/match-1",
    thirdMapPolicy: "denied_map_excluded",
    homeMapPick: "map-1",
    homeDeniedMap: "map-4",
    awayMapPick: "map-2",
    thirdMap: "map-3",
  });
}

function isolation(overrides: Record<string, unknown> = {}) {
  return {
    authenticated_owner_id: ownerId,
    all_rls_enabled: true,
    all_force_rls_enabled: true,
    runtime_can_read_tables: false,
    runtime_can_store_lineup: true,
    runtime_can_read_lineup: true,
    runtime_can_store_lock: true,
    runtime_can_read_lock: true,
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
      )
        return { rows: [] };
      return { rows: rows[index++] ?? [] };
    },
  );
  const client: NeonImportPersistenceClient = { query };
  const close = vi.fn(async () => {
    events.push("close");
  });
  const sessionFactory = vi.fn(async () => ({ client, close }));
  const repository = createNeonProLeagueLineupRepository({
    databaseUrl: "postgresql://private.example/dna",
    databaseOwnerId,
    ownerId,
    runtimeRole,
    sessionFactory: sessionFactory as NeonImportPersistenceSessionFactory,
  });
  return { events, query, repository };
}

function storedEntries() {
  return lineup()
    .maps.flatMap(({ entries }) => entries)
    .map((entry) => ({
      mapId: entry.mapId,
      raceNumber: entry.raceNumber,
      raceType: entry.raceType,
      distanceMetres: entry.distanceMetres,
      totalGateEntries: entry.totalGateEntries,
      gateEntriesPerVault: entry.gateEntriesPerVault,
      coreId: entry.coreId,
      sourceRaceNumber: entry.sourceRaceNumber,
      scope: entry.scope,
    }));
}

describe("Neon Pro League lineup repository", () => {
  it("stores a complete immutable lineup in a serializable owner scope", async () => {
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [{ disposition: "created", entry_count: 168 }],
    ]);
    await expect(
      test.repository.saveLineup(ownerId, lineup()),
    ).resolves.toMatchObject({
      disposition: "created",
      versionSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(test.events[0]).toBe("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const values = test.query.mock.calls[3]?.[1] as readonly unknown[];
    expect(values.slice(0, 8)).toEqual([
      databaseOwnerId,
      "lineup-v1",
      1,
      "roster-v1",
      "dna-pro-league/lineup-lock-2026-08-29",
      "dna-pro-league/maps-observed-2026-08-29",
      "Complete reusable four-map assignment.",
      expect.stringMatching(/^[a-f0-9]{64}$/u),
    ]);
    expect(JSON.parse(values[8] as string)).toHaveLength(168);
    expect(test.events.slice(-2)).toEqual(["COMMIT", "close"]);
  });

  it("loads and revalidates the exact published map catalogue and fingerprint", async () => {
    const writer = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [{ disposition: "created", entry_count: 168 }],
    ]);
    const saved = await writer.repository.saveLineup(ownerId, lineup());
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [
        {
          lineup_version_id: "lineup-v1",
          version_number: 1,
          roster_version_id: "roster-v1",
          authority_id: "dna-pro-league/lineup-lock-2026-08-29",
          map_catalogue_id: "dna-pro-league/maps-observed-2026-08-29",
          rationale: "Complete reusable four-map assignment.",
          version_sha256: saved.versionSha256,
          created_at: new Date("2026-09-07T10:00:00Z"),
          entries: storedEntries(),
        },
      ],
    ]);
    await expect(
      test.repository.loadLineup(ownerId, "lineup-v1"),
    ).resolves.toMatchObject({
      version: { lineupVersionId: "lineup-v1", maps: expect.any(Array) },
      versionSha256: saved.versionSha256,
      createdAt: "2026-09-07T10:00:00.000Z",
    });
    expect(test.events[0]).toBe(
      "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
  });

  it("stores and loads an exact immutable match lock", async () => {
    const writer = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [{ disposition: "created" }],
    ]);
    const saved = await writer.repository.saveMatchLock(ownerId, matchLock());
    const test = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation()],
      [
        {
          owner_id: databaseOwnerId,
          match_lock_id: "lock-1",
          match_id: "match-1",
          lineup_version_id: "lineup-v1",
          roster_version_id: "roster-v1",
          our_vault_id: "vault-away",
          home_vault_id: "vault-home",
          away_vault_id: "vault-away",
          our_side: "away",
          scheduled_at: new Date("2026-09-08T10:00:00Z"),
          locked_at: new Date("2026-09-08T09:00:00Z"),
          ruleset_source: "official-match-page/match-1",
          third_map_policy: "denied_map_excluded",
          home_map_pick: "map-1",
          home_denied_map: "map-4",
          away_map_pick: "map-2",
          third_map: "map-3",
          fallback_source: null,
          fallback_reference: null,
          match_lock_sha256: saved.matchLockSha256,
          created_at: new Date("2026-09-08T09:00:01Z"),
        },
      ],
    ]);
    await expect(
      test.repository.loadMatchLock(ownerId, "lock-1"),
    ).resolves.toMatchObject({
      lock: {
        matchId: "match-1",
        ourSide: "away",
        selection: { thirdMap: "map-3" },
      },
      matchLockSha256: saved.matchLockSha256,
    });
  });

  it("fails closed on owner mismatch, privilege drift and transaction errors", async () => {
    const denied = harness([]);
    await expect(
      denied.repository.loadLineup("other", "lineup-v1"),
    ).rejects.toThrow("access denied");
    const unsafe = harness([
      [{ owner_scope: databaseOwnerId }],
      [isolation({ runtime_can_read_tables: true })],
    ]);
    await expect(
      unsafe.repository.loadLineup(ownerId, "lineup-v1"),
    ).rejects.toThrow("least-privilege");
    expect(unsafe.events.slice(-2)).toEqual(["ROLLBACK", "close"]);
  });
});
