import type { CumulativeRehearsalEvidenceInput } from "@/domain/cumulative-rehearsal-evidence";

const REQUIRED_STEPS = ["apply", "smoke", "reverse", "removal"] as const;

const COMMAND_BY_STEP = {
  apply: "postgres_migration_apply",
  smoke: "postgres_migration_smoke",
  reverse: "postgres_migration_reverse",
  removal: "postgres_migration_removal_verify",
} as const;

export type HostedMigrationStep = (typeof REQUIRED_STEPS)[number];
export type HostedMigrationCommandId =
  (typeof COMMAND_BY_STEP)[HostedMigrationStep];

export type HostedMigrationStepAttestation = Readonly<{
  attestationId: string;
  step: HostedMigrationStep;
  commandId: HostedMigrationCommandId;
  headSha: string;
  migrationSetSha256: string;
  targetFingerprintSha256: string;
  startedAt: string;
  completedAt: string;
  exitCode: number;
  nonProductionTarget: boolean;
  ephemeralTarget: boolean;
  redactedSummaryOnly: boolean;
  privateDataLoaded: boolean;
}>;

export type HostedMigrationAttestationInput = Readonly<{
  evidenceId: string;
  composedHeadSha: string;
  runtimeAvailable: boolean;
  migrationSetSha256: string | null;
  targetFingerprintSha256: string | null;
  baselineSchemaSha256: string | null;
  finalSchemaSha256: string | null;
  attestations: readonly HostedMigrationStepAttestation[];
}>;

export type HostedMigrationAttestationIssue = Readonly<{
  code:
    | "RUNTIME_UNAVAILABLE"
    | "STEP_MISSING"
    | "STEP_ORDER"
    | "STEP_STALE"
    | "COMMAND_MISMATCH"
    | "MIGRATION_SET_MISMATCH"
    | "TARGET_MISMATCH"
    | "STEP_FAILED"
    | "PRODUCTION_TARGET"
    | "NON_EPHEMERAL_TARGET"
    | "UNREDACTED_SUMMARY"
    | "PRIVATE_DATA_LOADED"
    | "INVALID_TIME_ORDER"
    | "SCHEMA_NOT_RESTORED";
  step: HostedMigrationStep | null;
  severity: "review" | "block";
}>;

type CumulativeMigration = CumulativeRehearsalEvidenceInput["migration"];

export type HostedMigrationAttestationProjection = Readonly<{
  status: "blocked" | "review_required" | "attested";
  migration: CumulativeMigration;
  issues: readonly HostedMigrationAttestationIssue[];
  privateArtifactsRetained: false;
  productionMutationAllowed: false;
}>;

function requiredText(value: string, field: string): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} is required.`);
  }
}

function exactSha(value: string, field: string): void {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/.test(value)) {
    throw new Error(
      `${field} must contain 40 lowercase hexadecimal characters.`,
    );
  }
}

function sha256(value: string, field: string): void {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(
      `${field} must contain 64 lowercase hexadecimal characters.`,
    );
  }
}

function optionalSha256(value: string | null, field: string): void {
  if (value !== null) sha256(value, field);
}

function exactUtc(value: string, field: string): number {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  ) {
    throw new Error(`${field} must be an exact UTC timestamp.`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error(`${field} must be a valid UTC timestamp.`);
  }
  return parsed;
}

function explicitBoolean(value: boolean, field: string): void {
  if (typeof value !== "boolean") {
    throw new Error(`${field} must be an explicit boolean.`);
  }
}

function assertRuntimeShape(input: HostedMigrationAttestationInput): void {
  requiredText(input.evidenceId, "Evidence ID");
  exactSha(input.composedHeadSha, "Composed head");
  explicitBoolean(input.runtimeAvailable, "Runtime availability");
  optionalSha256(input.migrationSetSha256, "Migration-set digest");
  optionalSha256(input.targetFingerprintSha256, "Target fingerprint");
  optionalSha256(input.baselineSchemaSha256, "Baseline schema digest");
  optionalSha256(input.finalSchemaSha256, "Final schema digest");

  if (!Array.isArray(input.attestations)) {
    throw new Error("Migration attestations must be an array.");
  }
  if (
    !input.runtimeAvailable &&
    (input.migrationSetSha256 !== null ||
      input.targetFingerprintSha256 !== null ||
      input.baselineSchemaSha256 !== null ||
      input.finalSchemaSha256 !== null ||
      input.attestations.length !== 0)
  ) {
    throw new Error("Unavailable runtime must not claim migration evidence.");
  }
  if (
    input.runtimeAvailable &&
    [
      input.migrationSetSha256,
      input.targetFingerprintSha256,
      input.baselineSchemaSha256,
      input.finalSchemaSha256,
    ].some((value) => value === null)
  ) {
    throw new Error("Available runtime requires all migration digests.");
  }

  const ids = new Set<string>();
  const steps = new Set<HostedMigrationStep>();
  for (const attestation of input.attestations) {
    requiredText(attestation.attestationId, "Attestation ID");
    if (ids.has(attestation.attestationId)) {
      throw new Error(
        `Attestation ID ${attestation.attestationId} must be unique.`,
      );
    }
    ids.add(attestation.attestationId);
    if (!REQUIRED_STEPS.includes(attestation.step)) {
      throw new Error("Migration attestation step is invalid.");
    }
    if (steps.has(attestation.step)) {
      throw new Error(
        `Migration attestation ${attestation.step} must be unique.`,
      );
    }
    steps.add(attestation.step);
    requiredText(attestation.commandId, "Command ID");
    exactSha(attestation.headSha, `${attestation.step} head`);
    sha256(
      attestation.migrationSetSha256,
      `${attestation.step} migration-set digest`,
    );
    sha256(
      attestation.targetFingerprintSha256,
      `${attestation.step} target fingerprint`,
    );
    exactUtc(attestation.startedAt, `${attestation.step} start`);
    exactUtc(attestation.completedAt, `${attestation.step} completion`);
    if (
      !Number.isSafeInteger(attestation.exitCode) ||
      attestation.exitCode < 0
    ) {
      throw new Error(`${attestation.step} exit code is invalid.`);
    }
    explicitBoolean(
      attestation.nonProductionTarget,
      `${attestation.step} non-Production evidence`,
    );
    explicitBoolean(
      attestation.ephemeralTarget,
      `${attestation.step} ephemeral-target evidence`,
    );
    explicitBoolean(
      attestation.redactedSummaryOnly,
      `${attestation.step} redaction evidence`,
    );
    explicitBoolean(
      attestation.privateDataLoaded,
      `${attestation.step} private-data evidence`,
    );
  }
}

function issue(
  code: HostedMigrationAttestationIssue["code"],
  step: HostedMigrationAttestationIssue["step"],
  severity: HostedMigrationAttestationIssue["severity"],
): HostedMigrationAttestationIssue {
  return { code, step, severity };
}

export function projectHostedMigrationAttestations(
  input: HostedMigrationAttestationInput,
): HostedMigrationAttestationProjection {
  assertRuntimeShape(input);

  if (!input.runtimeAvailable) {
    return {
      status: "review_required",
      migration: {
        state: "unavailable",
        headSha: null,
        nonProductionTarget: false,
        applyPassed: false,
        smokePassed: false,
        reversePassed: false,
        removalPassed: false,
      },
      issues: [issue("RUNTIME_UNAVAILABLE", null, "review")],
      privateArtifactsRetained: false,
      productionMutationAllowed: false,
    };
  }

  const issues: HostedMigrationAttestationIssue[] = [];
  const byStep = new Map(
    input.attestations.map((attestation) => [attestation.step, attestation]),
  );
  const stepPassed = new Map<HostedMigrationStep, boolean>();

  for (const step of REQUIRED_STEPS) {
    const attestation = byStep.get(step);
    if (attestation === undefined) {
      issues.push(issue("STEP_MISSING", step, "review"));
      stepPassed.set(step, false);
      continue;
    }

    const blocking: HostedMigrationAttestationIssue["code"][] = [];
    if (attestation.headSha !== input.composedHeadSha) {
      blocking.push("STEP_STALE");
    }
    if (attestation.commandId !== COMMAND_BY_STEP[step]) {
      blocking.push("COMMAND_MISMATCH");
    }
    if (attestation.migrationSetSha256 !== input.migrationSetSha256) {
      blocking.push("MIGRATION_SET_MISMATCH");
    }
    if (attestation.targetFingerprintSha256 !== input.targetFingerprintSha256) {
      blocking.push("TARGET_MISMATCH");
    }
    if (attestation.exitCode !== 0) {
      blocking.push("STEP_FAILED");
    }
    if (!attestation.nonProductionTarget) {
      blocking.push("PRODUCTION_TARGET");
    }
    if (!attestation.ephemeralTarget) {
      blocking.push("NON_EPHEMERAL_TARGET");
    }
    if (!attestation.redactedSummaryOnly) {
      blocking.push("UNREDACTED_SUMMARY");
    }
    if (attestation.privateDataLoaded) {
      blocking.push("PRIVATE_DATA_LOADED");
    }
    if (
      Date.parse(attestation.completedAt) < Date.parse(attestation.startedAt)
    ) {
      blocking.push("INVALID_TIME_ORDER");
    }
    for (const code of blocking) {
      issues.push(issue(code, step, "block"));
    }
    stepPassed.set(step, blocking.length === 0);
  }

  for (let index = 1; index < REQUIRED_STEPS.length; index += 1) {
    const previous = byStep.get(REQUIRED_STEPS[index - 1]!);
    const current = byStep.get(REQUIRED_STEPS[index]!);
    if (
      previous !== undefined &&
      current !== undefined &&
      Date.parse(current.startedAt) < Date.parse(previous.completedAt)
    ) {
      issues.push(issue("STEP_ORDER", current.step, "block"));
      stepPassed.set(current.step, false);
    }
  }

  if (input.baselineSchemaSha256 !== input.finalSchemaSha256) {
    issues.push(issue("SCHEMA_NOT_RESTORED", "removal", "block"));
    stepPassed.set("removal", false);
  }

  const hasBlock = issues.some(({ severity }) => severity === "block");
  const hasMissing = issues.some(({ code }) => code === "STEP_MISSING");
  const allPassed = REQUIRED_STEPS.every(
    (step) => stepPassed.get(step) === true,
  );

  return {
    status: hasBlock ? "blocked" : hasMissing ? "review_required" : "attested",
    migration: {
      state: hasBlock ? "failed" : allPassed ? "passed" : "not_run",
      headSha: hasBlock || allPassed ? input.composedHeadSha : null,
      nonProductionTarget: REQUIRED_STEPS.every(
        (step) => byStep.get(step)?.nonProductionTarget === true,
      ),
      applyPassed: stepPassed.get("apply") === true,
      smokePassed: stepPassed.get("smoke") === true,
      reversePassed: stepPassed.get("reverse") === true,
      removalPassed: stepPassed.get("removal") === true,
    },
    issues,
    privateArtifactsRetained: false,
    productionMutationAllowed: false,
  };
}
