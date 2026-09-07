import { describe, expect, it, vi } from "vitest";

import {
  createNeonDnaOpenLabSyncRatePolicyRepository,
  neonDnaOpenLabSyncRatePolicyRepositoryFromEnvironment,
} from "@/lib/neon-dna-open-lab-sync-rate-policy-repository";
import type {
  NeonImportPersistenceClient,
  NeonImportPersistenceSessionFactory,
} from "@/lib/neon-import-persistence-driver";

const databaseOwnerId = "11111111-1111-4111-8111-111111111111";
const ownerId = "user_owner";

function policyRow() {
  return {
    requested_requests_per_minute: 150,
    effective_requests_per_minute: 150,
    elevated_until: "2026-09-08T10:00:00Z",
    fallback_reason: null,
    consecutive_rate_limits: 0,
    last_rate_limited_at: null,
    last_provider_limit: 150,
    version: "2",
    updated_at: "2026-09-07T10:00:00Z",
  };
}

function harness(sequence: readonly (readonly unknown[])[]) {
  let index = 0;
  const statements: string[] = [];
  const query = vi.fn(async (statement: string) => {
    const normalized = statement.replace(/\s+/gu, " ").trim();
    statements.push(normalized);
    if (
      ["BEGIN ISOLATION LEVEL SERIALIZABLE", "COMMIT", "ROLLBACK"].includes(
        normalized,
      )
    ) {
      return { rows: [] };
    }
    return { rows: sequence[index++] ?? [] };
  });
  const client: NeonImportPersistenceClient = { query };
  const sessionFactory = vi.fn(async () => ({
    client,
    close: vi.fn(async () => undefined),
  })) as unknown as NeonImportPersistenceSessionFactory;
  return { statements, sessionFactory };
}

function ownerEvidence() {
  return {
    owner_id: databaseOwnerId,
    clerk_user_id: ownerId,
    rls: true,
    force_rls: true,
    session_user_name: "dna_app_runtime",
    current_user_name: "dna_app_runtime",
    rolsuper: false,
    rolbypassrls: false,
  };
}

describe("Neon DNA Open Lab sync rate policy repository", () => {
  it("stays unconfigured unless every private runtime value exists", () => {
    expect(
      neonDnaOpenLabSyncRatePolicyRepositoryFromEnvironment({
        databaseUrl: undefined,
        databaseOwnerId,
        runtimeRole: "dna_app_runtime",
      }),
    ).toEqual({ status: "not_configured" });
  });

  it("reads policy only after verifying owner scope and forced RLS", async () => {
    const test = harness([[{}], [ownerEvidence()], [policyRow()]]);
    const repository = createNeonDnaOpenLabSyncRatePolicyRepository({
      databaseUrl: "postgresql://private.example/dna",
      databaseOwnerId,
      runtimeRole: "dna_app_runtime",
      sessionFactory: test.sessionFactory,
    });
    if (repository.status !== "ready") throw new Error("repository not ready");
    await expect(repository.read(ownerId)).resolves.toMatchObject({
      requestedRequestsPerMinute: 150,
      effectiveRequestsPerMinute: 150,
      version: 2,
    });
    expect(
      test.statements.some((value) => value.includes("relforcerowsecurity")),
    ).toBe(true);
    expect(
      test.statements.some((value) =>
        value.includes("read_dna_open_lab_sync_rate_policy"),
      ),
    ).toBe(true);
  });

  it("records only sanitized rate state through the guarded function", async () => {
    const test = harness([[{}], [ownerEvidence()], [policyRow()]]);
    const repository = createNeonDnaOpenLabSyncRatePolicyRepository({
      databaseUrl: "postgresql://private.example/dna",
      databaseOwnerId,
      runtimeRole: "dna_app_runtime",
      sessionFactory: test.sessionFactory,
    });
    if (repository.status !== "ready") throw new Error("repository not ready");
    await repository.recordObservation({
      ownerId,
      rateLimited: true,
      providerLimit: 30,
      observedAt: "2026-09-07T10:01:00Z",
    });
    expect(
      test.statements.some((value) =>
        value.includes("record_dna_open_lab_rate_observation"),
      ),
    ).toBe(true);
    expect(JSON.stringify(test.statements)).not.toContain("Bearer");
  });
});
