import { describe, expect, it, vi } from "vitest";
import type { NeonImportPersistenceClient } from "@/lib/neon-import-persistence-driver";
import {
  createNeonVaultPerformanceSummaryMaterializer,
  readNeonVaultPerformanceSourceIdentity,
} from "@/lib/neon-vault-performance-summary-materializer";
import { materializeVaultPerformanceSummary } from "@/lib/vault-performance-summary-materializer";

const owner = "11111111-1111-4111-8111-111111111111";
const identity = "user_synthetic_owner";
const now = new Date("2026-10-15T04:00:00.000Z");
const records = [
  {
    transactionId: "11111111-1111-4111-8111-111111111190",
    occurredAt: "2026-10-15T02:00:00.000Z",
    assetCode: "DEZ",
    assetKind: "crypto",
    signedAmount: "9007199254740993.000000000000000001",
    category: "open_race_payout",
    operating: true,
    aggregateStatus: "included",
    classificationStatus: "confirmed",
    reconciliationStatus: "reconciled",
  },
  {
    transactionId: "11111111-1111-4111-8111-111111111191",
    occurredAt: "2026-10-15T02:30:00.000Z",
    assetCode: "BGC",
    assetKind: "game_credit",
    signedAmount: "7",
    category: "burn_bgc_credit",
    operating: true,
    aggregateStatus: "included",
    classificationStatus: "confirmed",
    reconciliationStatus: "review_required",
  },
];
const coverage = {
  periodStart: "2026-10-15T02:00:00.000Z",
  periodEnd: "2026-10-15T02:30:00.000Z",
  sourceCoverage: "unknown",
  manualTournamentPayoutStatus: "unknown",
  costBasisByAsset: [],
  dataCurrentThrough: "2026-10-15T02:30:00.000Z",
  lastImported: "2026-10-15T03:00:00.000Z",
  freshnessState: "unknown",
};
const evidence = {
  database_owner_id: owner,
  authenticated_owner_id: identity,
  source_row_security_enabled: true,
  source_force_row_security_enabled: true,
  summary_row_security_enabled: true,
  summary_force_row_security_enabled: true,
  session_user_name: "dna_app_runtime",
  current_user_name: "dna_app_runtime",
  runtime_is_superuser: false,
  runtime_bypasses_rls: false,
  runtime_can_create_roles: false,
  runtime_can_create_databases: false,
  runtime_is_neon_superuser_member: false,
  runtime_has_direct_source_access: false,
  runtime_has_direct_summary_access: false,
  runtime_can_read_canonical_source: true,
  runtime_can_claim_source: true,
  runtime_can_publish_summary: true,
};

function harness(
  options: Readonly<{
    unsupported?: string;
    coverage?: unknown;
    claim?: boolean;
    publication?: "published" | "unchanged" | "source_changed" | "invalid";
    evidence?: unknown[];
    failOn?: string;
    closeFails?: boolean;
  }> = {},
) {
  const query = vi.fn<NeonImportPersistenceClient["query"]>(
    async (sql, values) => {
      if (options.failOn && sql.includes(options.failOn))
        throw new Error("private provider and financial detail");
      if (sql.includes("AS owner_scope"))
        return { rows: [{ owner_scope: owner }] };
      if (sql.includes("runtime_can_read_canonical_source"))
        return { rows: options.evidence ?? [evidence] };
      if (sql.includes("FROM dna.read_vault_performance_canonical_source"))
        return {
          rows: [
            {
              source_revision: "7",
              records_json: records,
              coverage_json:
                options.coverage === undefined ? coverage : options.coverage,
              unsupported_count: options.unsupported ?? "0",
            },
          ],
        };
      if (sql.includes("SELECT dna.claim_vault_performance_source_identity"))
        return { rows: [{ claimed: options.claim ?? true }] };
      if (sql.includes("SELECT dna.publish_vault_performance_summary_snapshot"))
        return {
          rows: [{ publication_status: options.publication ?? "published" }],
        };
      if (sql.includes("FROM dna.read_vault_performance_source_identity"))
        return { rows: [{ source_ledger_sha256: "a".repeat(64) }] };
      void values;
      return { rows: [] };
    },
  );
  const close = vi.fn(async () => {
    if (options.closeFails) throw new Error("private close detail");
  });
  const factory = vi.fn(async () => ({ client: { query }, close }));
  const materializer = createNeonVaultPerformanceSummaryMaterializer({
    databaseUrl: "postgresql://synthetic.invalid/dna",
    databaseOwnerId: owner,
    authenticatedOwnerId: identity,
    runtimeRole: "dna_app_runtime",
    sessionFactory: factory,
  });
  return { materializer, query, close, factory };
}

const unavailable =
  "Vault Performance canonical source materialization unavailable.";

describe("Neon Vault Performance canonical source and publication adapter", () => {
  it("claims one deterministic owner/source identity before returning canonical input", async () => {
    const h = harness();
    const source = await h.materializer.loadCanonicalSource(owner);
    expect(source).toMatchObject({
      sourceLedgerSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      records,
      coverage,
    });
    const claim = h.query.mock.calls.find(([sql]) =>
      sql.includes("SELECT dna.claim_vault_performance_source_identity"),
    );
    expect(claim?.[1]).toEqual([owner, "7", source?.sourceLedgerSha256]);
    expect(h.query.mock.calls[0]?.[0]).toBe(
      "BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE",
    );
    expect(h.query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
    expect(h.close).toHaveBeenCalledOnce();
  });

  it("runs the unchanged calculator and atomic publisher through the production adapter", async () => {
    const h = harness();
    await expect(
      materializeVaultPerformanceSummary({
        databaseOwnerId: owner,
        materializer: h.materializer,
        now: () => now,
      }),
    ).resolves.toEqual({ status: "published" });
    const publication = h.query.mock.calls.find(([sql]) =>
      sql.includes("SELECT dna.publish_vault_performance_summary_snapshot"),
    );
    expect(publication?.[1]?.[0]).toBe(owner);
    expect(publication?.[1]?.[1]).toMatch(/^[a-f0-9]{64}$/);
    expect(publication?.[1]?.[2]).toBe(now.toISOString());
    expect(publication?.[1]?.[3]).toEqual(expect.any(String));
    expect(publication?.[1]?.[4]).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each(["unchanged", "source_changed"] as const)(
    "preserves the database %s publication outcome",
    async (publication) => {
      const h = harness({ publication });
      await expect(
        materializeVaultPerformanceSummary({
          databaseOwnerId: owner,
          materializer: h.materializer,
          now: () => now,
        }),
      ).resolves.toEqual({ status: publication });
    },
  );

  it("withholds unsupported, empty-coverage and concurrently invalidated sources", async () => {
    for (const options of [
      { unsupported: "1" },
      { coverage: null },
      { claim: false },
    ]) {
      const h = harness(options);
      await expect(
        h.materializer.loadCanonicalSource(owner),
      ).resolves.toBeNull();
      if (options.claim === false)
        expect(h.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
      else
        expect(
          h.query.mock.calls.some(([sql]) =>
            sql.includes("SELECT dna.claim_vault_performance_source_identity"),
          ),
        ).toBe(false);
    }
  });

  it("reads only the compact accepted source identity for routine summary reads", async () => {
    const h = harness();
    await expect(
      readNeonVaultPerformanceSourceIdentity({ query: h.query }, owner),
    ).resolves.toBe("a".repeat(64));
    expect(h.query.mock.calls.at(-1)?.[1]).toEqual([owner]);
  });

  it.each([
    { runtime_is_superuser: true },
    { runtime_bypasses_rls: true },
    { runtime_has_direct_source_access: true },
    { runtime_has_direct_summary_access: true },
    { runtime_can_read_canonical_source: false },
    { source_force_row_security_enabled: false },
    { authenticated_owner_id: "another_owner" },
  ])("rejects invalid owner/isolation evidence %#", async (override) => {
    const h = harness({ evidence: [{ ...evidence, ...override }] });
    await expect(h.materializer.loadCanonicalSource(owner)).rejects.toThrow(
      unavailable,
    );
    expect(h.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
  });

  it("denies another owner and invalid configuration before persistence", async () => {
    const h = harness();
    await expect(
      h.materializer.loadCanonicalSource(
        "22222222-2222-4222-8222-222222222222",
      ),
    ).rejects.toThrow(unavailable);
    expect(h.factory).not.toHaveBeenCalled();
    expect(() =>
      createNeonVaultPerformanceSummaryMaterializer({
        databaseUrl: "",
        databaseOwnerId: owner,
        authenticatedOwnerId: identity,
        runtimeRole: "dna_app_runtime",
      }),
    ).toThrow(unavailable);
  });

  it.each([
    "BEGIN",
    "set_config",
    "runtime_can_read_canonical_source",
    "read_vault_performance_canonical_source",
    "claim_vault_performance_source_identity",
    "publish_vault_performance_summary_snapshot",
    "COMMIT",
  ])("sanitizes %s failures and closes the session", async (failOn) => {
    const h = harness({ failOn });
    const operation = failOn.includes("publish")
      ? h.materializer.publishCandidate({
          databaseOwnerId: owner,
          expectedSourceLedgerSha256: "a".repeat(64),
          materializedAt: now.toISOString(),
          snapshotJson: "{}",
          snapshotSha256: "b".repeat(64),
        })
      : h.materializer.loadCanonicalSource(owner);
    await expect(operation).rejects.toThrow(unavailable);
    expect(h.close).toHaveBeenCalledOnce();
  });

  it("rejects malformed publication inputs and responses without leaking values", async () => {
    const h = harness({ publication: "invalid" });
    await expect(
      h.materializer.publishCandidate({
        databaseOwnerId: owner,
        expectedSourceLedgerSha256: "a".repeat(64),
        materializedAt: now.toISOString(),
        snapshotJson: "{}",
        snapshotSha256: "b".repeat(64),
      }),
    ).rejects.toThrow(unavailable);
    await expect(
      h.materializer.publishCandidate({
        databaseOwnerId: owner,
        expectedSourceLedgerSha256: "not-a-hash",
        materializedAt: "not-a-time",
        snapshotJson: "private",
        snapshotSha256: "bad",
      }),
    ).rejects.toThrow(unavailable);
  });
});
