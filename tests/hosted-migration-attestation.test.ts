import { describe, expect, it } from "vitest";

import {
  projectHostedMigrationAttestations,
  type HostedMigrationAttestationInput,
  type HostedMigrationStepAttestation,
} from "@/domain/hosted-migration-attestation";

const HEAD = "a".repeat(40);
const MIGRATIONS = "b".repeat(64);
const TARGET = "c".repeat(64);
const SCHEMA = "d".repeat(64);

const commands = {
  apply: "postgres_migration_apply",
  smoke: "postgres_migration_smoke",
  reverse: "postgres_migration_reverse",
  removal: "postgres_migration_removal_verify",
} as const;

function attestations(): HostedMigrationStepAttestation[] {
  return Object.entries(commands).map(([step, commandId], index) => ({
    attestationId: `migration-${index + 1}`,
    step: step as HostedMigrationStepAttestation["step"],
    commandId,
    headSha: HEAD,
    migrationSetSha256: MIGRATIONS,
    targetFingerprintSha256: TARGET,
    startedAt: `2026-07-26T08:0${index * 2}:00.000Z`,
    completedAt: `2026-07-26T08:0${index * 2 + 1}:00.000Z`,
    exitCode: 0,
    nonProductionTarget: true,
    ephemeralTarget: true,
    redactedSummaryOnly: true,
    privateDataLoaded: false,
  }));
}

function input(
  overrides: Partial<HostedMigrationAttestationInput> = {},
): HostedMigrationAttestationInput {
  return {
    evidenceId: "hosted-migration-attestations",
    composedHeadSha: HEAD,
    runtimeAvailable: true,
    migrationSetSha256: MIGRATIONS,
    targetFingerprintSha256: TARGET,
    baselineSchemaSha256: SCHEMA,
    finalSchemaSha256: SCHEMA,
    attestations: attestations(),
    ...overrides,
  };
}

describe("hosted migration attestations", () => {
  it("projects complete reversible evidence without Production authority", () => {
    expect(projectHostedMigrationAttestations(input())).toMatchObject({
      status: "attested",
      migration: {
        state: "passed",
        headSha: HEAD,
        nonProductionTarget: true,
        applyPassed: true,
        smokePassed: true,
        reversePassed: true,
        removalPassed: true,
      },
      issues: [],
      privateArtifactsRetained: false,
      productionMutationAllowed: false,
    });
  });

  it("reports unavailable runtime without inventing evidence", () => {
    expect(
      projectHostedMigrationAttestations(
        input({
          runtimeAvailable: false,
          migrationSetSha256: null,
          targetFingerprintSha256: null,
          baselineSchemaSha256: null,
          finalSchemaSha256: null,
          attestations: [],
        }),
      ),
    ).toMatchObject({
      status: "review_required",
      migration: { state: "unavailable", headSha: null },
      issues: [{ code: "RUNTIME_UNAVAILABLE", severity: "review" }],
    });
  });

  it("keeps missing steps review-required", () => {
    const result = projectHostedMigrationAttestations(
      input({ attestations: attestations().slice(0, 3) }),
    );

    expect(result.status).toBe("review_required");
    expect(result.migration.state).toBe("not_run");
    expect(result.issues).toContainEqual({
      code: "STEP_MISSING",
      step: "removal",
      severity: "review",
    });
  });

  it("blocks stale heads, command substitution and digest drift", () => {
    const values = attestations();
    values[0] = {
      ...values[0]!,
      headSha: "e".repeat(40),
      commandId: "postgres_migration_smoke",
      migrationSetSha256: "f".repeat(64),
      targetFingerprintSha256: "0".repeat(64),
    };
    const result = projectHostedMigrationAttestations(
      input({ attestations: values }),
    );

    expect(result.status).toBe("blocked");
    expect(result.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "STEP_STALE",
        "COMMAND_MISMATCH",
        "MIGRATION_SET_MISMATCH",
        "TARGET_MISMATCH",
      ]),
    );
  });

  it("blocks failed, Production, persistent or private-data steps", () => {
    const values = attestations();
    values[1] = {
      ...values[1]!,
      exitCode: 1,
      nonProductionTarget: false,
      ephemeralTarget: false,
      redactedSummaryOnly: false,
      privateDataLoaded: true,
    };
    const result = projectHostedMigrationAttestations(
      input({ attestations: values }),
    );

    expect(result.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "STEP_FAILED",
        "PRODUCTION_TARGET",
        "NON_EPHEMERAL_TARGET",
        "UNREDACTED_SUMMARY",
        "PRIVATE_DATA_LOADED",
      ]),
    );
  });

  it("blocks inverted and overlapping step times", () => {
    const values = attestations();
    values[1] = {
      ...values[1]!,
      startedAt: "2026-07-26T08:00:30.000Z",
      completedAt: "2026-07-26T08:00:00.000Z",
    };
    const result = projectHostedMigrationAttestations(
      input({ attestations: values }),
    );

    expect(result.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining(["INVALID_TIME_ORDER", "STEP_ORDER"]),
    );
  });

  it("requires restoration to the baseline schema", () => {
    const result = projectHostedMigrationAttestations(
      input({ finalSchemaSha256: "e".repeat(64) }),
    );

    expect(result.status).toBe("blocked");
    expect(result.issues).toContainEqual({
      code: "SCHEMA_NOT_RESTORED",
      step: "removal",
      severity: "block",
    });
    expect(result.migration.removalPassed).toBe(false);
  });

  it("rejects duplicates and malformed runtime facts", () => {
    const values = attestations();
    expect(() =>
      projectHostedMigrationAttestations(
        input({ attestations: [...values, values[0]!] }),
      ),
    ).toThrow("must be unique");
    expect(() =>
      projectHostedMigrationAttestations(
        input({
          attestations: [
            {
              ...values[0]!,
              ephemeralTarget: "true" as unknown as boolean,
            },
          ],
        }),
      ),
    ).toThrow("explicit boolean");
    expect(() =>
      projectHostedMigrationAttestations(
        input({
          attestations: [
            {
              ...values[0]!,
              startedAt: "2026-02-30T08:00:00.000Z",
            },
          ],
        }),
      ),
    ).toThrow("valid UTC");
  });

  it("rejects evidence claims when runtime is unavailable", () => {
    expect(() =>
      projectHostedMigrationAttestations(input({ runtimeAvailable: false })),
    ).toThrow("must not claim");
  });
});
