import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { createNeonTournamentHorseScreeningPublicationBoundary } from "@/lib/neon-tournament-horse-screening-materializer";
import type { NeonImportPersistenceClient } from "@/lib/neon-import-persistence-driver";

const owner = "11111111-1111-4111-8111-111111111111";
const identity = "user_synthetic_owner";
const sourceVersion = "a".repeat(64);
const activeVersion = "b".repeat(64);
const payloadJson = JSON.stringify({
  modelVersion: "horse-1v1-exact-distance-transfer-v2",
  evidenceCutoff: "2026-10-18T00:00:00.000Z",
  sourceSnapshotVersion: sourceVersion,
  candidates: [{ coreId: "101" }],
});
const snapshotVersion = createHash("sha256")
  .update(payloadJson, "utf8")
  .digest("hex");

const isolation = {
  database_owner_id: owner,
  authenticated_owner_id: identity,
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
};

function harness(
  options: Readonly<{
    activeRows?: unknown[];
    publication?: string;
    isolation?: unknown[];
    failOn?: string;
  }> = {},
) {
  const query = vi.fn<NeonImportPersistenceClient["query"]>(async (sql) => {
    if (options.failOn && sql.includes(options.failOn))
      throw new Error("private provider detail");
    if (sql.includes("AS owner_scope"))
      return { rows: [{ owner_scope: owner }] };
    if (sql.includes("runtime_can_read_snapshot"))
      return { rows: options.isolation ?? [isolation] };
    if (sql.includes("read_active_tournament_horse_screening_snapshot"))
      return {
        rows: options.activeRows ?? [{ snapshot_version: activeVersion }],
      };
    if (sql.includes("publish_tournament_horse_screening_snapshot"))
      return {
        rows: [{ publication_status: options.publication ?? "published" }],
      };
    return { rows: [] };
  });
  const close = vi.fn(async () => undefined);
  const sessionFactory = vi.fn(async () => ({ client: { query }, close }));
  const boundary = createNeonTournamentHorseScreeningPublicationBoundary({
    databaseUrl: "postgresql://synthetic.invalid/dna",
    databaseOwnerId: owner,
    authenticatedOwnerId: identity,
    runtimeRole: "dna_app_runtime",
    sessionFactory,
  });
  return { boundary, query, close, sessionFactory };
}

function candidate() {
  return {
    databaseOwnerId: owner,
    expectedActiveSnapshotVersion: activeVersion,
    sourceSnapshotVersion: sourceVersion,
    snapshotVersion,
    payloadJson,
    publishedAt: "2026-10-19T00:00:00.000Z",
  } as const;
}

describe("Neon Tournament Horse screening publication boundary", () => {
  it("reads the owner-scoped active version in a bounded read-only transaction", async () => {
    const test = harness();
    await expect(
      test.boundary.readActiveSnapshotVersionByOwner(owner),
    ).resolves.toBe(activeVersion);
    expect(test.query.mock.calls[0]?.[0]).toContain("SERIALIZABLE READ ONLY");
    expect(test.query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
    expect(test.close).toHaveBeenCalledOnce();
  });

  it("publishes through the database compare-and-swap function", async () => {
    const test = harness();
    await expect(test.boundary.publishCandidate(candidate())).resolves.toBe(
      "published",
    );
    const publication = test.query.mock.calls.find(([sql]) =>
      sql.includes("SELECT dna.publish_tournament_horse_screening_snapshot"),
    );
    expect(publication?.[1]).toEqual([
      owner,
      snapshotVersion,
      activeVersion,
      payloadJson,
      "2026-10-19T00:00:00.000Z",
    ]);
  });

  it.each(["unchanged", "source_changed"])(
    "preserves the %s publication outcome",
    async (publication) => {
      const test = harness({ publication });
      await expect(test.boundary.publishCandidate(candidate())).resolves.toBe(
        publication,
      );
    },
  );

  it("rejects cross-owner, privileged and tampered publication attempts", async () => {
    const crossOwner = harness();
    await expect(
      crossOwner.boundary.readActiveSnapshotVersionByOwner(
        "22222222-2222-4222-8222-222222222222",
      ),
    ).rejects.toThrow("Tournament Horse screening publication unavailable.");
    expect(crossOwner.sessionFactory).not.toHaveBeenCalled();

    const privileged = harness({
      isolation: [{ ...isolation, runtime_bypasses_rls: true }],
    });
    await expect(
      privileged.boundary.readActiveSnapshotVersionByOwner(owner),
    ).rejects.toThrow("Tournament Horse screening publication unavailable.");

    const tampered = harness();
    await expect(
      tampered.boundary.publishCandidate({
        ...candidate(),
        payloadJson: `${payloadJson} `,
      }),
    ).rejects.toThrow("Tournament Horse screening publication unavailable.");
    expect(tampered.sessionFactory).not.toHaveBeenCalled();
  });

  it.each([
    "BEGIN",
    "statement_timeout",
    "set_config('app.owner_id'",
    "runtime_can_read_snapshot",
    "read_active_tournament_horse_screening_snapshot",
    "publish_tournament_horse_screening_snapshot",
    "COMMIT",
  ])("sanitizes %s failures and closes sessions", async (failOn) => {
    const test = harness({ failOn });
    const operation = failOn.includes("publish")
      ? test.boundary.publishCandidate(candidate())
      : test.boundary.readActiveSnapshotVersionByOwner(owner);
    await expect(operation).rejects.toThrow(
      "Tournament Horse screening publication unavailable.",
    );
    expect(test.close).toHaveBeenCalledOnce();
  });
});
