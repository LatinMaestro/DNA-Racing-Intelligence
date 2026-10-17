import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { classifyBreedingEconomicEvidence } from "@/domain/breeding-economic-evidence";
import { buildOffspringCostBasis } from "@/domain/offspring-cost-basis";
import type { NeonImportPersistenceClient } from "@/lib/neon-import-persistence-driver";
import { createNeonBreedingEconomicPersistence } from "@/lib/neon-breeding-economic-write-repository";

const ERROR = "Breeding economic persistence unavailable.";
const owner = "91700000-0000-4000-8000-000000000001";
const identity = "owner-1";
const assetVersion = "a".repeat(64);
const assets = [{ code: "DEZ", kind: "crypto" as const, precision: 4 }];
const hash = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");

const evidenceInput = {
  evidenceId: "breeding_economic_evidence:synthetic-0001",
  breedingEventId: "breeding-event-synthetic-0001",
  source: "manual_confirmed" as const,
  lifecycle: "completed" as const,
  occurredAt: "2026-10-16T00:00:00.000Z",
  parentCoreIds: ["parent-a", "parent-b"] as [string, string],
  offspringCoreId: "offspring-1",
  evidenceNote: "Synthetic evidence.",
  entries: [
    {
      transactionId: "transaction-1",
      category: "dna_base_fee" as const,
      direction: "debit" as const,
      assetCode: "DEZ",
      assetKind: "crypto" as const,
      amount: "2.5",
      externalReference: null,
    },
  ],
};
const assetEvidence = [
  {
    code: "DEZ",
    kind: "crypto" as const,
    precision: 4,
    registryVersion: assetVersion,
  },
];
const evidenceRecord = {
  input: evidenceInput,
  assessment: classifyBreedingEconomicEvidence(evidenceInput),
  assets: assetEvidence,
};

const request = {
  assignmentId: "offspring_cost_basis:synthetic-0001",
  offspringCoreId: "offspring-1",
  breedingEventId: "breeding-event-synthetic-0001",
  breedingOccurredAt: "2026-10-16T00:00:00.000Z",
  requestedAt: "2026-10-16T01:00:00.000Z",
  ownershipStatus: "confirmed_owned" as const,
  breedingEventStatus: "completed" as const,
  costs: [
    {
      transactionId: "transaction-1",
      category: "dna_base_fee" as const,
      source: "manual_confirmed" as const,
      evidenceStatus: "confirmed" as const,
      assetCode: "DEZ",
      assetKind: "crypto" as const,
      amount: "2.5",
    },
  ],
  refunds: [],
};
const costRecord = {
  request,
  assessment: buildOffspringCostBasis({
    ...request,
    previouslyAssignedTransactionIds: [],
  }),
  assets: assetEvidence,
};

const isolation = {
  database_owner_id: owner,
  authenticated_owner_id: identity,
  state_rls: true,
  state_force_rls: true,
  record_rls: true,
  record_force_rls: true,
  assignment_rls: true,
  assignment_force_rls: true,
  session_user_name: "dna_app_runtime",
  current_user_name: "dna_app_runtime",
  runtime_is_superuser: false,
  runtime_bypasses_rls: false,
  runtime_can_create_roles: false,
  runtime_can_create_databases: false,
  runtime_is_neon_superuser_member: false,
  runtime_has_direct_state_access: false,
  runtime_has_direct_record_access: false,
  runtime_has_direct_assignment_access: false,
};

function storedRow(kind: "evidence" | "cost_basis") {
  const record = kind === "evidence" ? evidenceRecord : costRecord;
  const recordJson = JSON.stringify(record);
  const canonical =
    kind === "evidence"
      ? { input: evidenceRecord.input, assets: evidenceRecord.assets }
      : { request: costRecord.request, assets: costRecord.assets };
  return {
    record_kind: kind,
    record_json: recordJson,
    fingerprint: hash(JSON.stringify(canonical)),
    record_sha256: hash(recordJson),
    economic_version: "2",
  };
}

function harness(
  options: Readonly<{
    readRows?: unknown[];
    assignedRows?: unknown[];
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
    if (sql.includes("read_breeding_economic_write_context"))
      return {
        rows: [
          {
            asset_registry_version: assetVersion,
            assets_json: JSON.stringify(assets),
            economic_version: "0",
          },
        ],
      };
    if (sql.includes("write_breeding_economic_record"))
      return {
        rows: options.writeRows ?? [
          { disposition: "created", fingerprint: null, economic_version: "1" },
        ],
      };
    if (sql.includes("list_breeding_economic_evidence_by_event"))
      return { rows: options.readRows ?? [storedRow("evidence")] };
    if (sql.includes("list_assigned_breeding_cost_transactions"))
      return {
        rows: options.assignedRows ?? [{ transaction_id: "transaction-1" }],
      };
    if (sql.includes("read_breeding_economic_record"))
      return { rows: options.readRows ?? [storedRow("evidence")] };
    return { rows: [] };
  });
  const close = vi.fn(async () => undefined);
  const persistence = createNeonBreedingEconomicPersistence({
    databaseUrl: "postgresql://synthetic.invalid/dna",
    databaseOwnerId: owner,
    runtimeRole: "dna_app_runtime",
    sessionFactory: async () => ({ client: { query }, close }),
  });
  return { persistence, query, close };
}

describe("Neon breeding economic persistence", () => {
  it("loads the authoritative asset registry and economic version", async () => {
    const h = harness();
    await expect(h.persistence.loadContextByOwner(identity)).resolves.toEqual({
      assetRegistry: { status: "ready", version: assetVersion, assets },
      economicVersion: "0",
    });
    expect(h.close).toHaveBeenCalledOnce();
  });

  it("persists evidence and cost basis with separate record integrity", async () => {
    const evidence = harness();
    const evidenceFingerprint = hash(
      JSON.stringify({
        input: evidenceRecord.input,
        assets: evidenceRecord.assets,
      }),
    );
    await expect(
      evidence.persistence.repository.saveEvidenceByOwner(
        identity,
        evidenceRecord,
        evidenceFingerprint,
        "0",
      ),
    ).resolves.toEqual({ status: "created", economicVersion: "1" });
    const evidenceWrite = evidence.query.mock.calls.find(([sql]) =>
      sql.includes("write_breeding_economic_record"),
    );
    expect(evidenceWrite?.[1]?.slice(0, 4)).toEqual([
      owner,
      "evidence",
      evidenceInput.evidenceId,
      evidenceFingerprint,
    ]);
    expect(evidenceWrite?.[1]?.[7]).toEqual([]);

    const cost = harness();
    const costFingerprint = hash(
      JSON.stringify({
        request: costRecord.request,
        assets: costRecord.assets,
      }),
    );
    await expect(
      cost.persistence.repository.saveCostBasisByOwner(
        identity,
        costRecord,
        costFingerprint,
        "0",
      ),
    ).resolves.toEqual({ status: "created", economicVersion: "1" });
    const costWrite = cost.query.mock.calls.find(([sql]) =>
      sql.includes("write_breeding_economic_record"),
    );
    expect(costWrite?.[1]?.[7]).toEqual(["transaction-1"]);
  });

  it("revalidates stored records and returns bounded assigned transactions", async () => {
    const evidence = harness();
    await expect(
      evidence.persistence.repository.loadEvidenceByOwner(
        identity,
        evidenceInput.evidenceId,
      ),
    ).resolves.toEqual({
      record: evidenceRecord,
      fingerprint: storedRow("evidence").fingerprint,
      economicVersion: "2",
    });

    const cost = harness({ readRows: [storedRow("cost_basis")] });
    await expect(
      cost.persistence.repository.loadCostBasisByOwner(
        identity,
        request.assignmentId,
      ),
    ).resolves.toMatchObject({ record: costRecord, economicVersion: "2" });
    await expect(
      cost.persistence.repository.loadAssignedTransactionIdsByOwner(identity, [
        "transaction-1",
      ]),
    ).resolves.toEqual(["transaction-1"]);
  });

  it("loads only bounded, revalidated evidence for one breeding event", async () => {
    const h = harness();
    await expect(
      h.persistence.loadEvidenceByBreedingEventByOwner(
        identity,
        evidenceInput.breedingEventId,
      ),
    ).resolves.toEqual([
      {
        record: evidenceRecord,
        fingerprint: storedRow("evidence").fingerprint,
        economicVersion: "2",
      },
    ]);
    const read = h.query.mock.calls.find(([sql]) =>
      sql.includes("list_breeding_economic_evidence_by_event"),
    );
    expect(read?.[1]).toEqual([owner, evidenceInput.breedingEventId, 128]);
    await expect(
      h.persistence.loadEvidenceByBreedingEventByOwner(identity, " "),
    ).rejects.toThrow(ERROR);
  });

  it("fails closed on privilege drift, corruption and oversized transaction reads", async () => {
    const privileged = harness({
      isolationRows: [{ ...isolation, runtime_bypasses_rls: true }],
    });
    await expect(
      privileged.persistence.loadContextByOwner(identity),
    ).rejects.toThrow(ERROR);

    const corrupt = storedRow("evidence");
    const malformed = harness({
      readRows: [{ ...corrupt, record_sha256: "b".repeat(64) }],
    });
    await expect(
      malformed.persistence.repository.loadEvidenceByOwner(
        identity,
        evidenceInput.evidenceId,
      ),
    ).rejects.toThrow(ERROR);

    await expect(
      harness().persistence.repository.loadAssignedTransactionIdsByOwner(
        identity,
        Array.from({ length: 129 }, (_, index) => `transaction-${index}`),
      ),
    ).rejects.toThrow(ERROR);
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

