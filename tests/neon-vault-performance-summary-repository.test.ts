import { describe, expect, it, vi } from "vitest";
import type { NeonImportPersistenceClient } from "@/lib/neon-import-persistence-driver";
import { buildVaultPerformanceSummary } from "@/domain/vault-performance-summary";
import { encodeVaultPerformanceSummarySnapshot } from "@/lib/vault-performance-summary-snapshot";
import { createNeonVaultPerformanceSummaryRepository } from "@/lib/neon-vault-performance-summary-repository";
import { loadVaultPerformancePageState } from "@/lib/vault-performance-workspace-service";

const owner = "11111111-1111-4111-8111-111111111111";
const identity = "user_synthetic_owner";
const source = "a".repeat(64);
const now = new Date("2026-10-15T00:00:00.000Z");
const summary = buildVaultPerformanceSummary(
  [
    {
      transactionId: "payout",
      occurredAt: "2026-10-14T00:00:00.000Z",
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
      transactionId: "transfer",
      occurredAt: "2026-10-14T00:00:00.000Z",
      assetCode: "ETH",
      assetKind: "crypto",
      signedAmount: "1.25",
      category: "internal_transfer",
      operating: false,
      aggregateStatus: "included",
      classificationStatus: "confirmed",
      reconciliationStatus: "reconciled",
    },
    {
      transactionId: "burn",
      occurredAt: "2026-10-14T00:00:00.000Z",
      assetCode: "BGC",
      assetKind: "game_credit",
      signedAmount: "8.5",
      category: "burn_bgc_credit",
      operating: true,
      aggregateStatus: "included",
      classificationStatus: "confirmed",
      reconciliationStatus: "reconciled",
    },
  ],
  {
    periodStart: "2026-10-01T00:00:00.000Z",
    periodEnd: "2026-10-31T23:59:59.000Z",
    sourceCoverage: "partial",
    manualTournamentPayoutStatus: "unknown",
    dataCurrentThrough: "2026-10-14T00:00:00.000Z",
    lastImported: "2026-10-14T01:00:00.000Z",
    freshnessState: "current",
  },
);
const snapshot = encodeVaultPerformanceSummarySnapshot({
  databaseOwnerId: owner,
  sourceLedgerSha256: source,
  materializedAt: now.toISOString(),
  summary,
  now,
});
const stored = {
  snapshot_json: snapshot.json,
  snapshot_sha256: snapshot.sha256,
};
const evidence = {
  database_owner_id: owner,
  authenticated_owner_id: identity,
  row_security_enabled: true,
  force_row_security_enabled: true,
  session_user_name: "dna_app_runtime",
  current_user_name: "dna_app_runtime",
  runtime_is_superuser: false,
  runtime_bypasses_rls: false,
  runtime_can_create_roles: false,
  runtime_can_create_databases: false,
  runtime_is_neon_superuser_member: false,
  runtime_has_direct_table_access: false,
};
function harness(
  options: {
    evidence?: unknown[];
    rows?: unknown[];
    source?: string | null;
    failOn?: string;
    closeFails?: boolean;
    rollbackFails?: boolean;
    clock?: Date;
  } = {},
) {
  const query = vi.fn<NeonImportPersistenceClient["query"]>(async (sql) => {
    if (options.failOn && sql.includes(options.failOn))
      throw Error("private provider detail");
    if (sql === "ROLLBACK" && options.rollbackFails)
      throw Error("private rollback detail");
    if (sql.includes("AS owner_scope"))
      return { rows: [{ owner_scope: owner }] };
    if (sql.includes("FROM dna.app_owner"))
      return { rows: options.evidence ?? [evidence] };
    if (sql.includes("FROM dna.read_vault_performance"))
      return { rows: options.rows ?? [stored] };
    return { rows: [] };
  });
  const close = vi.fn(async () => {
    if (options.closeFails) throw Error("private close detail");
  });
  const factory = vi.fn(async () => ({ client: { query }, close }));
  const readSourceIdentity = vi.fn(async () =>
    options.source === undefined ? source : options.source,
  );
  const repository = createNeonVaultPerformanceSummaryRepository({
    databaseUrl: "postgresql://synthetic.invalid/dna",
    databaseOwnerId: owner,
    authenticatedOwnerId: identity,
    runtimeRole: "dna_app_runtime",
    readSourceIdentity,
    sessionFactory: factory,
    now: () => options.clock ?? now,
  });
  if (repository.status !== "ready") throw Error("test repository not ready");
  return { repository, query, close, factory, readSourceIdentity };
}
const unavailable = "Vault Performance summary read unavailable.";

describe("compact Neon Vault Performance summary dependency", () => {
  it("uses a read-only owner transaction, one bounded function read and unchanged exact accounting", async () => {
    const h = harness();
    const page = await loadVaultPerformancePageState({
      authenticatedOwnerId: identity,
      configuredOwnerId: identity,
      repository: h.repository,
      now,
    });
    expect(page).toEqual({ connectionStatus: "read_model_connected", summary });
    expect(page.summary?.cashCryptoTotals[0]?.openRacePayouts).toBe(
      "9007199254740993.000000000000000001",
    );
    expect(
      page.summary?.cashCryptoTotals[1]?.totalRecordedOperatingCashflow,
    ).toBe("0");
    expect(page.summary?.bgcTotals[0]?.netBgcMovement).toBe("8.5");
    expect(h.query.mock.calls[0]?.[0]).toBe(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    expect(h.query.mock.calls[1]?.[0]).toContain("statement_timeout");
    expect(h.readSourceIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ query: h.query }),
      owner,
    );
    const reads = h.query.mock.calls.filter(([sql]) =>
      sql.includes("FROM dna.read_vault_performance"),
    );
    expect(reads).toHaveLength(1);
    expect(reads[0]?.[1]).toEqual([owner, source]);
    expect(h.query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
    expect(h.close).toHaveBeenCalledOnce();
  });
  it("denies another owner and invalid time before opening persistence", async () => {
    const h = harness();
    await expect(h.repository.loadSummaryByOwner("user_other")).rejects.toThrow(
      unavailable,
    );
    expect(h.factory).not.toHaveBeenCalled();
    const invalid = harness({ clock: new Date("invalid") });
    await expect(
      invalid.repository.loadSummaryByOwner(identity),
    ).rejects.toThrow(unavailable);
    expect(invalid.factory).not.toHaveBeenCalled();
  });
  it("returns no report for missing accepted source without reading a stale snapshot", async () => {
    const h = harness({ source: null });
    expect(await h.repository.loadSummaryByOwner(identity)).toBeNull();
    expect(
      h.query.mock.calls.some(([sql]) =>
        sql.includes("FROM dna.read_vault_performance"),
      ),
    ).toBe(false);
    expect(h.query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
  });
  it("returns no report for absent or superseded source summary", async () => {
    const h = harness({ rows: [], source: "b".repeat(64) });
    expect(await h.repository.loadSummaryByOwner(identity)).toBeNull();
    expect(
      h.query.mock.calls.find(([sql]) =>
        sql.includes("FROM dna.read_vault_performance"),
      )?.[1],
    ).toEqual([owner, "b".repeat(64)]);
  });
  it.each([
    { rows: [stored, stored] },
    { rows: [{ ...stored, snapshot_json: snapshot.json + " " }] },
    { rows: [{ ...stored, snapshot_sha256: "b".repeat(64) }] },
    { rows: [{ snapshot_json: 1 }] },
    { source: "invalid" },
    { source: "b".repeat(64) },
  ])(
    "rejects corrupt, duplicate, unbounded or source-mismatched results %#",
    async (options) => {
      const h = harness(options);
      await expect(h.repository.loadSummaryByOwner(identity)).rejects.toThrow(
        unavailable,
      );
      expect(h.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
      expect(h.close).toHaveBeenCalledOnce();
    },
  );
  it.each([
    { database_owner_id: "22222222-2222-4222-8222-222222222222" },
    { authenticated_owner_id: "other" },
    { row_security_enabled: false },
    { force_row_security_enabled: false },
    { session_user_name: "postgres" },
    { current_user_name: "postgres" },
    { runtime_is_superuser: true },
    { runtime_bypasses_rls: true },
    { runtime_can_create_roles: true },
    { runtime_can_create_databases: true },
    { runtime_is_neon_superuser_member: true },
    { runtime_has_direct_table_access: true },
    { runtime_is_superuser: "false" },
  ])(
    "denies invalid isolation before source or snapshot access %#",
    async (overrides) => {
      const h = harness({ evidence: [{ ...evidence, ...overrides }] });
      await expect(h.repository.loadSummaryByOwner(identity)).rejects.toThrow(
        unavailable,
      );
      expect(h.readSourceIdentity).not.toHaveBeenCalled();
      expect(h.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
      expect(h.close).toHaveBeenCalledOnce();
    },
  );
  it("denies missing owner evidence", async () => {
    const h = harness({ evidence: [] });
    await expect(h.repository.loadSummaryByOwner(identity)).rejects.toThrow(
      unavailable,
    );
    expect(h.readSourceIdentity).not.toHaveBeenCalled();
  });
  it.each([
    "BEGIN",
    "set_config",
    "FROM dna.app_owner",
    "FROM dna.read_vault_performance",
    "COMMIT",
  ])("sanitizes %s errors, rolls back and closes", async (failOn) => {
    const h = harness({ failOn, rollbackFails: true });
    await expect(h.repository.loadSummaryByOwner(identity)).rejects.toThrow(
      unavailable,
    );
    expect(h.close).toHaveBeenCalledOnce();
    if (failOn !== "BEGIN")
      expect(h.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
  });
  it("does not reveal connection or close errors", async () => {
    const h = harness({ closeFails: true });
    await expect(h.repository.loadSummaryByOwner(identity)).rejects.toThrow(
      unavailable,
    );
    const failing = harness();
    failing.factory.mockRejectedValueOnce(Error("private connection detail"));
    await expect(
      failing.repository.loadSummaryByOwner(identity),
    ).rejects.toThrow(unavailable);
  });
  it("re-derives stale coverage without changing historical totals", async () => {
    const h = harness({ clock: new Date("2026-11-15T00:00:00.000Z") });
    const result = await h.repository.loadSummaryByOwner(identity);
    expect(result?.freshnessState).toBe("stale");
    expect(result?.warnings).toContain("IMPORTED_DATA_STALE");
    expect(result?.cashCryptoTotals).toEqual(summary.cashCryptoTotals);
    expect(result?.status).toBe("partial");
  });
});
