import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { assessCoreBurnEvent } from "@/domain/core-burn-event";
import { reconcileBurnCredit } from "@/domain/burn-credit-reconciliation";
import type { NeonImportPersistenceClient } from "@/lib/neon-import-persistence-driver";
import { createNeonLifecycleEconomicPersistence } from "@/lib/neon-lifecycle-economic-write-repository";

const owner = "11111111-1111-4111-8111-111111111111";
const identity = "user_synthetic_owner";
const assetVersion = "a".repeat(64);
const assets = [{ code: "BGC", kind: "game_credit", precision: 2 }] as const;
const burnInput = {
  burnId: "core_burn:synthetic-0001",
  coreId: "core-1",
  coreClass: "Freak" as const,
  occurredAt: "2026-10-16T00:00:00.000Z",
  recordedAt: "2026-10-16T01:00:00.000Z",
  evidenceSource: "manual" as const,
  evidenceStatus: "confirmed" as const,
  ownershipAtBurn: "confirmed_active" as const,
  reason: "Synthetic evidence.",
  recommendationReferenceId: null,
};
const burnRecord = { input: burnInput, result: assessCoreBurnEvent(burnInput) };
const credit = {
  creditId: "burn_bgc_credit:synthetic-0001",
  coreId: "core-1",
  burnId: burnInput.burnId,
  occurredAt: "2026-10-16T02:00:00.000Z",
  asset: "BGC",
  amount: "12",
  evidenceSource: "manual" as const,
  evidenceStatus: "confirmed" as const,
  externalReference: null,
};
const creditRecord = {
  credit,
  reconciliation: reconcileBurnCredit({
    burn: {
      burnId: burnInput.burnId,
      coreId: burnInput.coreId,
      occurredAt: burnInput.occurredAt,
      status: "confirmed_event_review",
    },
    credits: [credit],
  }),
  asset: {
    code: "BGC",
    kind: "game_credit" as const,
    precision: 2,
    registryVersion: assetVersion,
  },
};

const hash = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");

const isolation = {
  database_owner_id: owner,
  authenticated_owner_id: identity,
  state_rls: true,
  state_force_rls: true,
  evidence_rls: true,
  evidence_force_rls: true,
  session_user_name: "dna_app_runtime",
  current_user_name: "dna_app_runtime",
  runtime_is_superuser: false,
  runtime_bypasses_rls: false,
  runtime_can_create_roles: false,
  runtime_can_create_databases: false,
  runtime_is_neon_superuser_member: false,
  runtime_has_direct_state_access: false,
  runtime_has_direct_evidence_access: false,
};

function storedRow(kind: "core_burn" | "burn_bgc_credit") {
  const record = kind === "core_burn" ? burnRecord : creditRecord;
  const json = JSON.stringify(record);
  return {
    evidence_kind: kind,
    burn_id: kind === "core_burn" ? null : burnInput.burnId,
    record_json: json,
    fingerprint:
      kind === "core_burn"
        ? hash(json)
        : hash(JSON.stringify({ credit, asset: creditRecord.asset })),
    record_sha256: hash(json),
    lifecycle_version: "2",
  };
}

function harness(
  options: Readonly<{
    readRows?: unknown[];
    creditRows?: unknown[];
    writeRows?: unknown[];
    isolationRows?: unknown[];
    failOn?: string;
  }> = {},
) {
  const query = vi.fn<NeonImportPersistenceClient["query"]>(async (sql) => {
    if (options.failOn && sql.includes(options.failOn))
      throw new Error("private provider detail");
    if (sql.includes("AS owner_scope"))
      return { rows: [{ owner_scope: owner }] };
    if (sql.includes("runtime_has_direct_state_access"))
      return { rows: options.isolationRows ?? [isolation] };
    if (sql.includes("read_lifecycle_economic_write_context"))
      return {
        rows: [
          {
            asset_registry_version: assetVersion,
            assets_json: JSON.stringify(assets),
            lifecycle_version: "0",
          },
        ],
      };
    if (sql.includes("write_lifecycle_economic_evidence"))
      return {
        rows: options.writeRows ?? [
          { disposition: "created", fingerprint: null, lifecycle_version: "1" },
        ],
      };
    if (sql.includes("list_lifecycle_burn_credit_evidence"))
      return { rows: options.creditRows ?? [storedRow("burn_bgc_credit")] };
    if (sql.includes("read_lifecycle_economic_evidence"))
      return { rows: options.readRows ?? [storedRow("core_burn")] };
    return { rows: [] };
  });
  const close = vi.fn(async () => undefined);
  const persistence = createNeonLifecycleEconomicPersistence({
    databaseUrl: "postgresql://synthetic.invalid/dna",
    databaseOwnerId: owner,
    runtimeRole: "dna_app_runtime",
    sessionFactory: async () => ({ client: { query }, close }),
  });
  return { persistence, query, close };
}

describe("Neon lifecycle economic persistence", () => {
  it("loads the authoritative asset registry and lifecycle version", async () => {
    const h = harness();
    await expect(h.persistence.loadContextByOwner(identity)).resolves.toEqual({
      assetRegistry: { status: "ready", version: assetVersion, assets },
      lifecycleVersion: "0",
    });
    expect(h.close).toHaveBeenCalledOnce();
  });

  it("persists canonical burn evidence with separate record integrity", async () => {
    const h = harness();
    const recordJson = JSON.stringify(burnRecord);
    await expect(
      h.persistence.repository.saveBurnByOwner(
        identity,
        burnRecord,
        hash(recordJson),
        "0",
      ),
    ).resolves.toEqual({ status: "created", lifecycleVersion: "1" });
    const write = h.query.mock.calls.find(([sql]) =>
      sql.includes("write_lifecycle_economic_evidence"),
    );
    expect(write?.[1]).toEqual([
      owner,
      "core_burn",
      burnInput.burnId,
      null,
      hash(recordJson),
      hash(recordJson),
      recordJson,
      "0",
    ]);
  });

  it("revalidates stored burns and bounded burn credits", async () => {
    const h = harness();
    await expect(
      h.persistence.repository.loadBurnByOwner(identity, burnInput.burnId),
    ).resolves.toMatchObject({
      record: burnRecord,
      fingerprint: expect.any(String),
    });
    await expect(
      h.persistence.repository.loadBurnCreditsByOwner(
        identity,
        burnInput.burnId,
      ),
    ).resolves.toEqual([credit]);

    const creditHarness = harness({ readRows: [storedRow("burn_bgc_credit")] });
    await expect(
      creditHarness.persistence.repository.loadBurnCreditByOwner(
        identity,
        credit.creditId,
      ),
    ).resolves.toMatchObject({
      record: creditRecord,
      lifecycleVersion: "2",
      fingerprint: expect.any(String),
      recordFingerprint: expect.any(String),
    });
  });

  it("fails closed on owner isolation, malformed evidence and oversized reads", async () => {
    const privileged = harness({
      isolationRows: [{ ...isolation, runtime_bypasses_rls: true }],
    });
    await expect(
      privileged.persistence.loadContextByOwner(identity),
    ).rejects.toThrow("Lifecycle economic persistence unavailable.");

    const corrupt = storedRow("core_burn");
    const malformed = harness({
      readRows: [{ ...corrupt, record_sha256: "b".repeat(64) }],
    });
    await expect(
      malformed.persistence.repository.loadBurnByOwner(
        identity,
        burnInput.burnId,
      ),
    ).rejects.toThrow("Lifecycle economic persistence unavailable.");

    const oversized = harness({
      creditRows: Array.from({ length: 129 }, () =>
        storedRow("burn_bgc_credit"),
      ),
    });
    await expect(
      oversized.persistence.repository.loadBurnCreditsByOwner(
        identity,
        burnInput.burnId,
      ),
    ).rejects.toThrow("Lifecycle economic persistence unavailable.");
  });

  it.each(["BEGIN", "set_config", "runtime_has_direct_state_access", "COMMIT"])(
    "sanitizes %s failures and closes the session",
    async (failOn) => {
      const h = harness({ failOn });
      await expect(h.persistence.loadContextByOwner(identity)).rejects.toThrow(
        ERROR,
      );
      expect(h.close).toHaveBeenCalledOnce();
    },
  );
});

const ERROR = "Lifecycle economic persistence unavailable.";
