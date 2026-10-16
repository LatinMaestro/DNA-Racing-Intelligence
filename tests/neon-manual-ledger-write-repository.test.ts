import { describe, expect, it, vi } from "vitest";

import {
  createNeonManualLedgerPersistence,
  neonManualLedgerPersistenceFromEnvironment,
} from "../lib/neon-manual-ledger-write-repository";
import type {
  NeonImportPersistenceClient,
  NeonImportPersistenceSessionFactory,
} from "../lib/neon-import-persistence-driver";
import type { ValidatedManualLedgerEntry } from "../domain/manual-ledger";

const owner = "11111111-1111-4111-8111-111111111111";
const clerk = "user_owner";
const role = "dna_app_runtime";
const hash = "a".repeat(64);

function evidence(overrides: Record<string, unknown> = {}) {
  return {
    database_owner_id: owner,
    authenticated_owner_id: clerk,
    entry_rls: true,
    entry_force_rls: true,
    reversal_rls: true,
    reversal_force_rls: true,
    session_user_name: role,
    current_user_name: role,
    runtime_is_superuser: false,
    runtime_bypasses_rls: false,
    runtime_can_create_roles: false,
    runtime_can_create_databases: false,
    runtime_is_neon_superuser_member: false,
    runtime_has_direct_entry_access: false,
    runtime_has_direct_reversal_access: false,
    ...overrides,
  };
}

function harness(respond: (sql: string) => readonly unknown[]) {
  const events: string[] = [];
  const query = vi.fn(async (statement: string) => {
    const sql = statement.replace(/\s+/g, " ").trim();
    events.push(sql);
    if (sql.startsWith("BEGIN") || sql === "COMMIT" || sql === "ROLLBACK")
      return { rows: [] };
    if (sql.includes("set_config('statement_timeout'")) return { rows: [{}] };
    if (sql.includes("set_config('app.owner_id'"))
      return { rows: [{ owner_scope: owner }] };
    if (sql.includes("FROM dna.app_owner owner")) return { rows: [evidence()] };
    return { rows: respond(sql) };
  });
  const client: NeonImportPersistenceClient = { query };
  const close = vi.fn(async () => {
    events.push("close");
  });
  const sessionFactory = vi.fn(async () => ({ client, close }));
  return {
    events,
    sessionFactory: sessionFactory as NeonImportPersistenceSessionFactory,
  };
}

function ready(test: ReturnType<typeof harness>) {
  return createNeonManualLedgerPersistence({
    databaseUrl: "postgresql://private.example/dna",
    databaseOwnerId: owner,
    runtimeRole: role,
    sessionFactory: test.sessionFactory,
  });
}

function entry(): ValidatedManualLedgerEntry {
  return {
    entryId: "manual-entry-0001",
    occurredAt: "2026-10-16T00:00:00.000Z",
    assetCode: "DEZ",
    assetKind: "crypto",
    assetRegistryVersion: hash,
    assetPrecision: 6,
    amount: "1.25",
    category: "income",
    subcategory: "other_income",
    tournamentId: null,
    tournamentCampaignBinding: null,
    tournamentAggregationEligible: true,
    coreIds: [],
    externalReference: null,
    note: null,
    postings: [
      {
        postingId: "manual-entry-0001:primary",
        accountLabel: "owner",
        assetCode: "DEZ",
        assetKind: "crypto",
        signedAmount: "1.25",
        category: "income",
        subcategory: "other_income",
        operating: true,
        tournamentAggregationEligible: true,
      },
    ],
    warnings: [],
    completeness: "complete",
  };
}

describe("Neon manual ledger persistence", () => {
  it("fails closed until every server-only database setting exists", () => {
    expect(
      neonManualLedgerPersistenceFromEnvironment({
        databaseUrl: undefined,
        databaseOwnerId: owner,
        runtimeRole: role,
      }),
    ).toEqual({ status: "not_configured" });
  });

  it("loads the authoritative asset registry and ledger version", async () => {
    const test = harness((sql) => {
      if (sql.includes("read_manual_economic_write_context"))
        return [
          {
            asset_registry_version: hash,
            assets_json: JSON.stringify([
              { code: "BGC", kind: "game_credit", precision: 0 },
              { code: "DEZ", kind: "crypto", precision: 6 },
            ]),
            ledger_version: "12",
          },
        ];
      return [];
    });
    await expect(ready(test).loadContextByOwner(clerk)).resolves.toEqual({
      assetRegistry: {
        status: "ready",
        version: hash,
        assets: [
          { code: "BGC", kind: "game_credit", precision: 0 },
          { code: "DEZ", kind: "crypto", precision: 6 },
        ],
      },
      ledgerVersion: "12",
    });
    expect(test.events.slice(-2)).toEqual(["COMMIT", "close"]);
  });

  it("writes through the guarded function and maps its disposition", async () => {
    const test = harness((sql) =>
      sql.includes("write_manual_economic_entry")
        ? [
            {
              disposition: "created",
              fingerprint: hash,
              ledger_version: "13",
              reversal_id: null,
            },
          ]
        : [],
    );
    await expect(
      ready(test).repository.saveEntryByOwner(clerk, entry(), hash, "12"),
    ).resolves.toEqual({ status: "created", ledgerVersion: "13" });
    expect(
      test.events.some((sql) => sql.includes("write_manual_economic_entry")),
    ).toBe(true);
  });

  it("loads immutable originals for exact reversal construction", async () => {
    const original = entry();
    const test = harness((sql) =>
      sql.includes("read_manual_economic_entry")
        ? [{ entry_json: JSON.stringify(original), fingerprint: hash }]
        : [],
    );
    await expect(
      ready(test).repository.loadEntryByOwner(clerk, original.entryId),
    ).resolves.toEqual({ entry: original, fingerprint: hash });
  });

  it("rejects privilege drift before reading or writing economic evidence", async () => {
    const events: string[] = [];
    const query = vi.fn(async (statement: string) => {
      const sql = statement.replace(/\s+/g, " ").trim();
      events.push(sql);
      if (sql.startsWith("BEGIN") || sql === "COMMIT" || sql === "ROLLBACK")
        return { rows: [] };
      if (sql.includes("set_config('statement_timeout'")) return { rows: [{}] };
      if (sql.includes("set_config('app.owner_id'"))
        return { rows: [{ owner_scope: owner }] };
      return { rows: [evidence({ runtime_bypasses_rls: true })] };
    });
    const sessionFactory = vi.fn(async () => ({
      client: { query } as NeonImportPersistenceClient,
      close: async () => events.push("close"),
    })) as unknown as NeonImportPersistenceSessionFactory;
    const persistence = createNeonManualLedgerPersistence({
      databaseUrl: "postgresql://private.example/dna",
      databaseOwnerId: owner,
      runtimeRole: role,
      sessionFactory,
    });
    await expect(persistence.loadContextByOwner(clerk)).rejects.toThrow(
      "Manual economic persistence unavailable.",
    );
    expect(events.slice(-2)).toEqual(["ROLLBACK", "close"]);
    expect(
      events.some((sql) => sql.includes("read_manual_economic_write_context")),
    ).toBe(false);
  });
});
