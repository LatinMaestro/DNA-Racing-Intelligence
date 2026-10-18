import { describe, expect, it, vi } from "vitest";

import {
  createNeonTournamentHorseScreeningRepository,
  neonTournamentHorseScreeningRepositoryFromEnvironment,
} from "@/lib/neon-tournament-horse-screening-repository";
import type { NeonImportPersistenceSessionFactory } from "@/lib/neon-import-persistence-driver";

const databaseOwnerId = "11111111-1111-4111-8111-111111111111";

function harness(ownerOverrides: Record<string, unknown> = {}) {
  const events: string[] = [];
  const query = vi.fn(
    async (statement: string, values?: readonly unknown[]) => {
      const normalized = statement.replace(/\s+/g, " ").trim();
      events.push(`${normalized}|${JSON.stringify(values ?? [])}`);
      if (normalized.startsWith("SELECT set_config")) return { rows: [{}] };
      if (normalized.includes("FROM dna.app_owner owner")) {
        return {
          rows: [
            {
              authenticated_owner_id: "owner-1",
              snapshot_row_security_enabled: true,
              snapshot_force_row_security_enabled: true,
              active_row_security_enabled: true,
              active_force_row_security_enabled: true,
              session_user_name: "dna_app_runtime",
              current_user_name: "dna_app_runtime",
              runtime_is_superuser: false,
              runtime_bypasses_rls: false,
              ...ownerOverrides,
            },
          ],
        };
      }
      if (
        normalized.includes("read_active_tournament_horse_screening_snapshot")
      ) {
        return {
          rows: [
            {
              snapshot_version: "a".repeat(64),
              payload_json:
                '{"modelVersion":"horse-1v1-exact-distance-transfer-v2"}',
              published_at: new Date("2026-10-18T12:00:00.000Z"),
            },
          ],
        };
      }
      return { rows: [] };
    },
  );
  const close = vi.fn(async () => undefined);
  const sessionFactory = vi.fn(async () => ({ client: { query }, close }));
  return {
    events,
    close,
    sessionFactory: sessionFactory as NeonImportPersistenceSessionFactory,
  };
}

describe("Neon Tournament Horse screening repository", () => {
  it("stays unavailable until all environment settings exist", () => {
    expect(
      neonTournamentHorseScreeningRepositoryFromEnvironment({
        databaseUrl: undefined,
        databaseOwnerId,
        runtimeRole: "dna_app_runtime",
      }),
    ).toEqual({ status: "not_configured" });
  });

  it("uses a bounded owner-scoped read-only transaction", async () => {
    const test = harness();
    const repository = createNeonTournamentHorseScreeningRepository({
      databaseUrl: "postgresql://private.example/dna",
      databaseOwnerId,
      runtimeRole: "dna_app_runtime",
      sessionFactory: test.sessionFactory,
    });
    if (repository.status !== "ready") throw new Error("repository not ready");
    await expect(repository.readActiveByOwner("owner-1")).resolves.toEqual({
      snapshotVersion: "a".repeat(64),
      payloadJson: '{"modelVersion":"horse-1v1-exact-distance-transfer-v2"}',
      publishedAt: "2026-10-18T12:00:00.000Z",
    });
    expect(test.events[0]).toContain(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    expect(
      test.events.some((event) => event.includes("set_config('app.owner_id'")),
    ).toBe(true);
    expect(test.events.some((event) => event.startsWith("COMMIT"))).toBe(true);
    expect(test.close).toHaveBeenCalledOnce();
  });

  it("rejects an unsafe runtime role and rolls back", async () => {
    const test = harness({ runtime_bypasses_rls: true });
    const repository = createNeonTournamentHorseScreeningRepository({
      databaseUrl: "postgresql://private.example/dna",
      databaseOwnerId,
      runtimeRole: "dna_app_runtime",
      sessionFactory: test.sessionFactory,
    });
    if (repository.status !== "ready") throw new Error("repository not ready");
    await expect(repository.readActiveByOwner("owner-1")).rejects.toThrow(
      "least-privilege owner isolation",
    );
    expect(test.events.some((event) => event.startsWith("ROLLBACK"))).toBe(
      true,
    );
  });
});
