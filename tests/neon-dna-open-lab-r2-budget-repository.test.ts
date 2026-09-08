import { describe, expect, it, vi } from "vitest";

import {
  createNeonDnaOpenLabR2BudgetRepository,
  neonDnaOpenLabR2BudgetRepositoryFromEnvironment,
} from "@/lib/neon-dna-open-lab-r2-budget-repository";
import type {
  NeonImportPersistenceClient,
  NeonImportPersistenceSessionFactory,
} from "@/lib/neon-import-persistence-driver";

const databaseOwnerId = "11111111-1111-4111-8111-111111111111";
const ownerId = "private-owner";
const hash = (character: string) => character.repeat(64);

function ownerEvidence() {
  return {
    owner_id: databaseOwnerId,
    clerk_user_id: ownerId,
    budget_rls: true,
    budget_force_rls: true,
    reservation_rls: true,
    reservation_force_rls: true,
    session_user_name: "dna_app_runtime",
    current_user_name: "dna_app_runtime",
    rolsuper: false,
    rolbypassrls: false,
  };
}

function windowRow() {
  return {
    window_id: hash("a"),
    window_start_at: "2026-09-01T00:00:00Z",
    window_end_at: "2026-10-01T00:00:00Z",
    measured_at: "2026-09-08T00:00:00Z",
    baseline_storage_bytes: "1000",
    baseline_class_a_operations: "100",
    baseline_class_b_operations: "200",
    accounted_storage_bytes: "400",
    accounted_class_a_operations: "9",
    accounted_class_b_operations: "19",
    reserved_storage_bytes: "500",
    reserved_class_a_operations: "10",
    reserved_class_b_operations: "20",
    last_blocked_at: null,
    last_blocker_ids: [],
    revision: "3",
    updated_at: "2026-09-08T00:01:00Z",
  };
}

function reservationRow() {
  return {
    window_id: hash("a"),
    refresh_cycle_id: hash("b"),
    request_sha256: hash("c"),
    status: "accounted",
    planned_storage_bytes: "500",
    planned_class_a_operations: "10",
    planned_class_b_operations: "20",
    actual_storage_bytes: "400",
    actual_class_a_operations: "9",
    actual_class_b_operations: "19",
    reserved_at: "2026-09-08T00:00:00Z",
    accounted_at: "2026-09-08T00:01:00Z",
  };
}

function harness(sequence: readonly (readonly unknown[])[]) {
  let index = 0;
  const statements: string[] = [];
  const values: (readonly unknown[])[] = [];
  const query = vi.fn(
    async (statement: string, queryValues?: readonly unknown[]) => {
      const normalized = statement.replace(/\s+/gu, " ").trim();
      statements.push(normalized);
      values.push(queryValues ?? []);
      if (
        ["BEGIN ISOLATION LEVEL SERIALIZABLE", "COMMIT", "ROLLBACK"].includes(
          normalized,
        )
      ) {
        return { rows: [] };
      }
      return { rows: sequence[index++] ?? [] };
    },
  );
  const client: NeonImportPersistenceClient = { query };
  const sessionFactory = vi.fn(async () => ({
    client,
    close: vi.fn(async () => undefined),
  })) as unknown as NeonImportPersistenceSessionFactory;
  return { statements, values, sessionFactory };
}

function repository(test: ReturnType<typeof harness>) {
  return createNeonDnaOpenLabR2BudgetRepository({
    databaseUrl: "postgresql://private.example/dna",
    databaseOwnerId,
    runtimeRole: "dna_app_runtime",
    sessionFactory: test.sessionFactory,
  });
}

describe("Neon DNA Open Lab R2 budget repository", () => {
  it("stays unavailable unless every private runtime value exists", () => {
    expect(
      neonDnaOpenLabR2BudgetRepositoryFromEnvironment({
        databaseUrl: undefined,
        databaseOwnerId,
        runtimeRole: "dna_app_runtime",
      }),
    ).toEqual({ status: "not_configured" });
  });

  it("reads only after verifying both forced-RLS relations and runtime role", async () => {
    const test = harness([[{}], [ownerEvidence()], [windowRow()]]);
    const subject = repository(test);
    if (subject.status !== "ready") throw new Error("repository not ready");

    await expect(subject.readWindow(ownerId)).resolves.toMatchObject({
      windowId: hash("a"),
      baselineUsage: { storageBytes: 1000 },
      accountedUsage: { classAOperations: 9 },
      reservedUsage: { classBOperations: 20 },
      revision: 3,
    });
    expect(
      test.statements.some((entry) => entry.includes("relforcerowsecurity")),
    ).toBe(true);
  });

  it("uses the restart-safe timestamp-free reservation function", async () => {
    const test = harness([
      [{}],
      [ownerEvidence()],
      [
        {
          allowed: true,
          blocker_ids: [],
          projected_storage_bytes: "2000",
          projected_class_a_operations: "110",
          projected_class_b_operations: "220",
          reservation_status: "reserved",
        },
      ],
    ]);
    const subject = repository(test);
    if (subject.status !== "ready") throw new Error("repository not ready");

    await expect(
      subject.reserve({
        ownerId,
        windowId: hash("a"),
        refreshCycleId: hash("b"),
        requestSha256: hash("c"),
        plannedUsage: {
          storageBytes: 1000,
          classAOperations: 10,
          classBOperations: 20,
        },
      }),
    ).resolves.toMatchObject({
      allowed: true,
      reservationStatus: "reserved",
      paidUsageAllowed: false,
      preserveLastGood: true,
    });
    const call = test.statements.find((entry) =>
      entry.includes("reserve_dna_open_lab_r2_budget"),
    );
    expect(call).toContain("$7::bigint)");
    expect(call).not.toContain("timestamptz");
  });

  it("accounts only bounded usage through the restart-safe function", async () => {
    const test = harness([[{}], [ownerEvidence()], [reservationRow()]]);
    const subject = repository(test);
    if (subject.status !== "ready") throw new Error("repository not ready");

    await expect(
      subject.account({
        ownerId,
        windowId: hash("a"),
        refreshCycleId: hash("b"),
        requestSha256: hash("c"),
        actualUsage: {
          storageBytes: 400,
          classAOperations: 9,
          classBOperations: 19,
        },
      }),
    ).resolves.toMatchObject({
      status: "accounted",
      actualUsage: { storageBytes: 400, classAOperations: 9 },
    });
    expect(
      test.statements.some((entry) =>
        entry.includes("account_dna_open_lab_r2_budget"),
      ),
    ).toBe(true);
    expect(JSON.stringify(test.values)).not.toContain("Bearer");
  });
});
