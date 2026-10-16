import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { PrivateProductionReadinessInput } from "@/domain/private-production-readiness";
import type { NeonImportPersistenceClient } from "@/lib/neon-import-persistence-driver";
import {
  createNeonReadinessAssessmentRepository,
  neonReadinessAssessmentRepositoryFromEnvironment,
} from "@/lib/neon-readiness-assessment-repository";
import { loadReadinessWorkspacePageState } from "@/lib/readiness-workspace-service";

const databaseOwnerId = "11111111-1111-4111-8111-111111111111";
const authenticatedOwnerId = "user_synthetic_owner";
const exactHeadSha = "a".repeat(40);
const now = new Date("2026-10-16T00:00:00.000Z");
const publishedAt = "2026-10-15T02:00:00.000Z";
const assessment: PrivateProductionReadinessInput = {
  assessmentId: "readiness-1",
  assessmentVersion: "readiness-v1",
  assessedAt: "2026-10-15T01:00:00.000Z",
  evidenceCurrentThrough: "2026-10-15T00:00:00.000Z",
  evidenceFreshness: "current",
  exactHeadSha,
  gates: {
    gateA: "accepted",
    gateB: "not_accepted",
    gateC: "not_accepted",
    gateD: "not_accepted",
    gateE: "not_accepted",
  },
  exactHeadCi: "passed",
  representativePrivateImport: "not_run",
  recoveryValidation: "passed",
  performanceCapacity: "not_run",
  securityPrivacy: "not_run",
  accessibilityResponsive: "not_run",
  migrations: "reversible_verified",
  knownLimitationsDocumented: true,
  productionDisabled: true,
  customDomainAttached: false,
  publicRoutesExposed: false,
  fullPrivateDataInProduction: false,
  recurringPaidInfrastructureEnabled: false,
  ownerGateFApproval: false,
  activationRequested: false,
};

function row(overrides: Record<string, unknown> = {}) {
  const snapshot = JSON.stringify({
    version: 1,
    databaseOwnerId,
    publishedAt,
    assessment,
  });
  return {
    assessment_id: assessment.assessmentId,
    assessment_version: assessment.assessmentVersion,
    exact_head_sha: assessment.exactHeadSha,
    evidence_current_through: assessment.evidenceCurrentThrough,
    assessed_at: assessment.assessedAt,
    published_at: publishedAt,
    snapshot_sha256: createHash("sha256").update(snapshot).digest("hex"),
    snapshot_json: snapshot,
    ...overrides,
  };
}

const isolation = {
  database_owner_id: databaseOwnerId,
  authenticated_owner_id: authenticatedOwnerId,
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
  runtime_can_read_assessment: true,
};

function harness(
  options: {
    rows?: unknown[];
    isolation?: unknown[];
    failOn?: string;
    closeFails?: boolean;
  } = {},
) {
  const query = vi.fn<NeonImportPersistenceClient["query"]>(async (sql) => {
    if (options.failOn && sql.includes(options.failOn))
      throw new Error("private provider detail");
    if (sql.includes("AS owner_scope"))
      return { rows: [{ owner_scope: databaseOwnerId }] };
    if (sql.includes("FROM dna.app_owner"))
      return { rows: options.isolation ?? [isolation] };
    if (sql.includes("FROM dna.read_private_readiness"))
      return { rows: options.rows ?? [row()] };
    return { rows: [] };
  });
  const close = vi.fn(async () => {
    if (options.closeFails) throw new Error("private close detail");
  });
  const factory = vi.fn(async () => ({ client: { query }, close }));
  const repository = createNeonReadinessAssessmentRepository({
    databaseUrl: "postgresql://synthetic.invalid/dna",
    databaseOwnerId,
    authenticatedOwnerId,
    runtimeRole: "dna_app_runtime",
    sessionFactory: factory,
    now: () => now,
  });
  if (repository.status !== "ready") throw new Error("repository not ready");
  return { repository, query, close, factory };
}

const unavailable = "Readiness assessment read unavailable.";

describe("compact Neon readiness assessment dependency", () => {
  it("composes only a complete server-side owner environment", () => {
    expect(
      neonReadinessAssessmentRepositoryFromEnvironment({
        databaseUrl: undefined,
        databaseOwnerId,
        runtimeRole: "dna_app_runtime",
        authenticatedOwnerId,
      }),
    ).toEqual({ status: "not_configured" });
    expect(
      neonReadinessAssessmentRepositoryFromEnvironment(
        {
          databaseUrl: "postgresql://synthetic.invalid/dna",
          databaseOwnerId,
          runtimeRole: "dna_app_runtime",
          authenticatedOwnerId,
        },
        async () => {
          throw new Error("must not connect while composing");
        },
      ).status,
    ).toBe("ready");
  });

  it("loads one accepted assessment through a bounded owner-scoped read", async () => {
    const test = harness();
    await expect(
      loadReadinessWorkspacePageState({
        authenticatedOwnerId,
        configuredOwnerId: authenticatedOwnerId,
        repository: test.repository,
        expectedHeadSha: exactHeadSha,
        now,
      }),
    ).resolves.toMatchObject({
      assessmentId: assessment.assessmentId,
      assessmentVersion: assessment.assessmentVersion,
      connectionStatus: "read_model_connected",
      readiness: { status: "review_required", activationAuthorized: false },
    });
    expect(test.query.mock.calls[0]?.[0]).toBe(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    const reads = test.query.mock.calls.filter(([sql]) =>
      sql.includes("FROM dna.read_private_readiness"),
    );
    expect(reads).toHaveLength(1);
    expect(reads[0]?.[1]).toEqual([databaseOwnerId]);
    expect(test.query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
    expect(test.close).toHaveBeenCalledOnce();
  });

  it("keeps an unpublished assessment explicitly empty", async () => {
    const test = harness({ rows: [] });
    await expect(
      test.repository.loadLatestAssessmentByOwner(authenticatedOwnerId),
    ).resolves.toEqual({
      assessment: null,
      acceptedAssessmentVersion: null,
      publishedAt: null,
    });
  });

  it("denies another owner before opening persistence", async () => {
    const test = harness();
    await expect(
      test.repository.loadLatestAssessmentByOwner("user_other"),
    ).rejects.toThrow(unavailable);
    expect(test.factory).not.toHaveBeenCalled();
  });

  it.each([
    { snapshot_sha256: "b".repeat(64) },
    { assessment_id: "readiness-2" },
    { assessment_version: "readiness-v2" },
    { exact_head_sha: "b".repeat(40) },
    { evidence_current_through: "2026-10-15T03:00:00.000Z" },
    { published_at: "2026-10-17T00:00:00.000Z" },
    { snapshot_json: 1 },
  ])("rejects corrupt or source-mismatched snapshots %#", async (overrides) => {
    const test = harness({ rows: [row(overrides)] });
    await expect(
      test.repository.loadLatestAssessmentByOwner(authenticatedOwnerId),
    ).rejects.toThrow(unavailable);
    expect(test.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
  });

  it("rejects unknown or mistyped evidence fields", async () => {
    for (const changed of [
      { ...assessment, privatePayload: "must not pass" },
      { ...assessment, productionDisabled: "true" },
    ]) {
      const snapshot = JSON.stringify({
        version: 1,
        databaseOwnerId,
        publishedAt,
        assessment: changed,
      });
      const test = harness({
        rows: [
          row({
            snapshot_json: snapshot,
            snapshot_sha256: createHash("sha256")
              .update(snapshot)
              .digest("hex"),
          }),
        ],
      });
      await expect(
        test.repository.loadLatestAssessmentByOwner(authenticatedOwnerId),
      ).rejects.toThrow(unavailable);
    }
  });

  it.each([
    { row_security_enabled: false },
    { force_row_security_enabled: false },
    { runtime_is_superuser: true },
    { runtime_bypasses_rls: true },
    { runtime_has_direct_table_access: true },
    { runtime_can_read_assessment: false },
    { authenticated_owner_id: "user_other" },
  ])("denies invalid owner isolation before reading %#", async (changes) => {
    const test = harness({ isolation: [{ ...isolation, ...changes }] });
    await expect(
      test.repository.loadLatestAssessmentByOwner(authenticatedOwnerId),
    ).rejects.toThrow(unavailable);
    expect(
      test.query.mock.calls.some(([sql]) =>
        sql.includes("FROM dna.read_private_readiness"),
      ),
    ).toBe(false);
  });

  it.each([
    "BEGIN TRANSACTION",
    "statement_timeout",
    "AS owner_scope",
    "FROM dna.app_owner",
    "FROM dna.read_private_readiness",
  ])("sanitizes provider failure at %s", async (failOn) => {
    const test = harness({ failOn });
    await expect(
      test.repository.loadLatestAssessmentByOwner(authenticatedOwnerId),
    ).rejects.toThrow(unavailable);
  });
});
