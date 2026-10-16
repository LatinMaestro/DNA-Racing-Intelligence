import { describe, expect, it, vi } from "vitest";
import type { NeonImportPersistenceClient } from "@/lib/neon-import-persistence-driver";
import { materializeAcceptedMaidenEvidence } from "@/lib/maiden-accepted-evidence-materializer";
import { createNeonMaidenAcceptedEvidenceMaterializer } from "@/lib/neon-maiden-accepted-evidence-materializer";

const owner = "11111111-1111-4111-8111-111111111111";
const identity = "user_synthetic_owner";
const sourceHash = "a".repeat(64);
const source = {
  databaseOwnerId: owner,
  sourceEvidenceSha256: sourceHash,
  coverage: {
    state: "accepted",
    generationIntegrityVerified: true,
    ownerStrategyCorrectionsVerified: true,
    crossModeGenerationVerified: true,
    expectedOwnerMaidenEligibleCores: 1,
    verifiedOwnerMaidenEligibleCores: 1,
    expectedBrackets: 1,
    verifiedBrackets: 1,
    unsupportedSourceRows: 0,
  },
  evidence: {
    brackets: [
      {
        tournamentId: "synthetic-maiden",
        tournamentLabel: "Synthetic Maiden",
        bracketId: "synthetic-horse",
        bracketLabel: "Synthetic Horse",
        mode: "horse",
        configurationVersion: "config-v1",
        candidateSnapshotVersion: "snapshot-v1",
        projectionVersion: "method-v1",
        reviewCapacity: 1,
        availability: "upcoming",
        ruleStatus: "confirmed",
      },
    ],
    candidates: [
      {
        candidateId: "candidate-1",
        coreId: "core-1",
        tournamentId: "synthetic-maiden",
        bracketId: "synthetic-horse",
        mode: "horse",
        configurationVersion: "config-v1",
        candidateSnapshotVersion: "snapshot-v1",
        projectionVersion: "method-v1",
        projectionBasis: "time_led_chronological",
        projectedValueBasisPoints: 8500,
        suitability: "review_candidate",
        lifecycleState: "eligible",
        evidenceConfidence: "moderate",
        timeEvidence: "competitive",
        historicalStarSupport: "supports",
        crossModeEvidenceComplete: true,
        dataCurrentThrough: "2026-10-15T00:00:00.000Z",
        lastImported: "2026-10-15T01:00:00.000Z",
        freshness: "current",
      },
    ],
    lastImportedAt: "2026-10-15T01:00:00.000Z",
  },
} as const;

const isolation = {
  database_owner_id: owner,
  authenticated_owner_id: identity,
  source_row_security_enabled: true,
  source_force_row_security_enabled: true,
  snapshot_row_security_enabled: true,
  snapshot_force_row_security_enabled: true,
  session_user_name: "dna_app_runtime",
  current_user_name: "dna_app_runtime",
  runtime_is_superuser: false,
  runtime_bypasses_rls: false,
  runtime_can_create_roles: false,
  runtime_can_create_databases: false,
  runtime_is_neon_superuser_member: false,
  runtime_has_direct_source_access: false,
  runtime_has_direct_snapshot_access: false,
  runtime_can_read_generation: true,
  runtime_can_read_identity: true,
  runtime_can_publish_snapshot: true,
};

function harness(
  options: Readonly<{
    sourceRows?: unknown[];
    identityRows?: unknown[];
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
    if (sql.includes("runtime_can_read_generation"))
      return { rows: options.isolation ?? [isolation] };
    if (sql.includes("read_maiden_allocation_accepted_generation"))
      return {
        rows: options.sourceRows ?? [
          {
            source_evidence_sha256: sourceHash,
            generation_json: JSON.stringify(source),
          },
        ],
      };
    if (sql.includes("read_maiden_allocation_accepted_source_identity"))
      return {
        rows: options.identityRows ?? [{ source_evidence_sha256: sourceHash }],
      };
    if (sql.includes("publish_maiden_allocation_evidence_snapshot"))
      return {
        rows: [{ publication_status: options.publication ?? "published" }],
      };
    return { rows: [] };
  });
  const close = vi.fn(async () => undefined);
  const factory = vi.fn(async () => ({ client: { query }, close }));
  const boundary = createNeonMaidenAcceptedEvidenceMaterializer({
    databaseUrl: "postgresql://synthetic.invalid/dna",
    databaseOwnerId: owner,
    authenticatedOwnerId: identity,
    runtimeRole: "dna_app_runtime",
    sessionFactory: factory,
  });
  return { boundary, query, close, factory };
}

describe("Neon Maiden accepted generation and publication adapter", () => {
  it("materializes the accepted persisted generation through atomic publication", async () => {
    const h = harness();
    await expect(
      materializeAcceptedMaidenEvidence({
        databaseOwnerId: owner,
        boundary: h.boundary,
        now: () => new Date("2026-10-16T00:00:00.000Z"),
      }),
    ).resolves.toEqual({ status: "published" });
    const publish = h.query.mock.calls.find(([sql]) =>
      sql.includes("SELECT dna.publish_maiden_allocation_evidence_snapshot"),
    );
    expect(publish?.[1]).toEqual([
      owner,
      sourceHash,
      "2026-10-16T00:00:00.000Z",
      expect.any(String),
      expect.stringMatching(/^[a-f0-9]{64}$/),
    ]);
    expect(h.close).toHaveBeenCalledTimes(3);
  });

  it("returns unavailable for a missing accepted generation", async () => {
    const h = harness({ sourceRows: [] });
    await expect(h.boundary.loadCanonicalSource(owner)).resolves.toBeNull();
    expect(h.query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
  });

  it.each(["unchanged", "source_changed"])(
    "preserves the %s publication result",
    async (publication) => {
      const h = harness({ publication });
      await expect(
        h.boundary.publishCandidate({
          databaseOwnerId: owner,
          expectedSourceEvidenceSha256: sourceHash,
          materializedAt: "2026-10-16T00:00:00.000Z",
          snapshotJson: "{}",
          snapshotSha256: "b".repeat(64),
        }),
      ).resolves.toBe(publication);
    },
  );

  it("fails closed on owner, persisted identity and isolation mismatches", async () => {
    const other = harness();
    await expect(
      other.boundary.loadCanonicalSource(
        "22222222-2222-4222-8222-222222222222",
      ),
    ).rejects.toThrow("Maiden accepted generation persistence unavailable.");
    expect(other.factory).not.toHaveBeenCalled();

    const mismatch = harness({
      sourceRows: [
        {
          source_evidence_sha256: "b".repeat(64),
          generation_json: JSON.stringify(source),
        },
      ],
    });
    await expect(mismatch.boundary.loadCanonicalSource(owner)).rejects.toThrow(
      "Maiden accepted generation persistence unavailable.",
    );

    const privileged = harness({
      isolation: [{ ...isolation, runtime_bypasses_rls: true }],
    });
    await expect(
      privileged.boundary.loadCanonicalSource(owner),
    ).rejects.toThrow("Maiden accepted generation persistence unavailable.");
  });

  it.each([
    "BEGIN",
    "set_config",
    "runtime_can_read_generation",
    "read_maiden_allocation_accepted_generation",
    "read_maiden_allocation_accepted_source_identity",
    "publish_maiden_allocation_evidence_snapshot",
    "COMMIT",
  ])("sanitizes %s failures and closes sessions", async (failOn) => {
    const h = harness({ failOn });
    const operation = failOn.includes("identity")
      ? h.boundary.readAcceptedSourceIdentity(owner)
      : failOn.includes("publish")
        ? h.boundary.publishCandidate({
            databaseOwnerId: owner,
            expectedSourceEvidenceSha256: sourceHash,
            materializedAt: "2026-10-16T00:00:00.000Z",
            snapshotJson: "{}",
            snapshotSha256: "b".repeat(64),
          })
        : h.boundary.loadCanonicalSource(owner);
    await expect(operation).rejects.toThrow(
      "Maiden accepted generation persistence unavailable.",
    );
    expect(h.close).toHaveBeenCalledOnce();
  });
});
