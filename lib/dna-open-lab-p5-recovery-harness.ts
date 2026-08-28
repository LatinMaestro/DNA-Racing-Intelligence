export const DNA_OPEN_LAB_P5_RECOVERY_CASES = Object.freeze([
  "crash_after_evidence_write",
  "concurrent_checkpoint_advancement",
  "rate_limited_retry_after",
  "lower_rate_allowance",
  "eligibility_loss",
  "eligibility_reinstatement",
  "api_outage_or_invalid_body",
  "missing_or_conflicting_evidence",
  "atomic_publication_failure",
  "dynamic_plan_drift",
] as const);

export type DnaOpenLabP5RecoveryCase =
  (typeof DNA_OPEN_LAB_P5_RECOVERY_CASES)[number];

export type DnaOpenLabP5RecoveryProviderScope =
  "synthetic_local" | "private_preview";

export type DnaOpenLabP5RecoveryObservation = Readonly<{
  caseId: DnaOpenLabP5RecoveryCase;
  outcome: "passed" | "failed";
  apiRequestCount: number;
  syntheticProviderWriteCount: number;
  persistentOwnerDataWriteCount: 0;
  residueObjectCount: 0;
  rawPayloadIncluded: false;
  secretMaterialIncluded: false;
  lastGoodPreserved: boolean;
  checkpointRecovered: boolean;
  immutableEvidenceVerified: boolean;
  retryBoundaryObserved: boolean;
  catchUpCompleted: boolean;
  summary: string;
}>;

export type DnaOpenLabP5RecoveryResult = Readonly<
  DnaOpenLabP5RecoveryObservation & {
    codeHeadSha: string;
    providerScope: DnaOpenLabP5RecoveryProviderScope;
    executedAt: string;
  }
>;

export type DnaOpenLabP5RecoveryCheckpoint = Readonly<{
  version: 1;
  codeHeadSha: string;
  providerScope: DnaOpenLabP5RecoveryProviderScope;
  results: readonly DnaOpenLabP5RecoveryResult[];
}>;

export type DnaOpenLabP5RecoveryReport = Readonly<{
  version: 1;
  codeHeadSha: string;
  providerScope: DnaOpenLabP5RecoveryProviderScope;
  passed: boolean;
  completedAt: string;
  results: readonly DnaOpenLabP5RecoveryResult[];
}>;

export type DnaOpenLabP5RecoveryHarnessStep =
  | Readonly<{
      kind: "case_completed";
      completedCaseId: DnaOpenLabP5RecoveryCase;
      nextCaseId: DnaOpenLabP5RecoveryCase;
      checkpoint: DnaOpenLabP5RecoveryCheckpoint;
    }>
  | Readonly<{
      kind: "complete";
      checkpoint: DnaOpenLabP5RecoveryCheckpoint;
      report: DnaOpenLabP5RecoveryReport;
    }>;

function harnessError(message: string): never {
  throw new Error(`DNA Open Lab P5 recovery harness: ${message}`);
}

function exactHeadSha(value: string): string {
  const normalized = value.trim();
  if (!/^[0-9a-f]{40}$/u.test(normalized)) {
    harnessError("codeHeadSha must be an exact lowercase 40-character SHA");
  }
  return normalized;
}

function providerScope(
  value: DnaOpenLabP5RecoveryProviderScope,
): DnaOpenLabP5RecoveryProviderScope {
  if (value !== "synthetic_local" && value !== "private_preview") {
    harnessError("providerScope is unsupported");
  }
  return value;
}

function timestamp(value: string): string {
  const normalized = value.trim();
  const parsed = new Date(normalized);
  if (
    Number.isNaN(parsed.getTime()) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      normalized,
    )
  ) {
    harnessError("executedAt must be a timezone-qualified ISO timestamp");
  }
  return parsed.toISOString();
}

function count(value: number, field: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    harnessError(`${field} must be an integer between 0 and ${maximum}`);
  }
  return value;
}

function validateObservation(input: {
  expectedCaseId: DnaOpenLabP5RecoveryCase;
  providerScope: DnaOpenLabP5RecoveryProviderScope;
  observation: DnaOpenLabP5RecoveryObservation;
}): DnaOpenLabP5RecoveryObservation {
  const observation = input.observation;
  if (observation.caseId !== input.expectedCaseId) {
    harnessError(
      `expected ${input.expectedCaseId}, received ${observation.caseId}`,
    );
  }
  if (observation.outcome !== "passed" && observation.outcome !== "failed") {
    harnessError("outcome must be passed or failed");
  }
  count(observation.apiRequestCount, "apiRequestCount", 1);
  const maximumProviderWrites =
    input.providerScope === "synthetic_local" ? 0 : 4;
  count(
    observation.syntheticProviderWriteCount,
    "syntheticProviderWriteCount",
    maximumProviderWrites,
  );
  if (observation.persistentOwnerDataWriteCount !== 0) {
    harnessError("persistent owner-data writes are prohibited");
  }
  if (observation.residueObjectCount !== 0) {
    harnessError("synthetic provider residue must be zero");
  }
  if (observation.rawPayloadIncluded !== false) {
    harnessError("raw payloads are prohibited in recovery evidence");
  }
  if (observation.secretMaterialIncluded !== false) {
    harnessError("secret material is prohibited in recovery evidence");
  }
  for (const field of [
    "lastGoodPreserved",
    "checkpointRecovered",
    "immutableEvidenceVerified",
    "retryBoundaryObserved",
    "catchUpCompleted",
  ] as const) {
    if (typeof observation[field] !== "boolean") {
      harnessError(`${field} must be boolean`);
    }
  }
  if (
    observation.outcome === "passed" &&
    (!observation.lastGoodPreserved ||
      !observation.checkpointRecovered ||
      !observation.immutableEvidenceVerified ||
      !observation.retryBoundaryObserved ||
      !observation.catchUpCompleted)
  ) {
    harnessError("passed outcome requires every recovery assertion");
  }
  if (typeof observation.summary !== "string") {
    harnessError("summary must be a string");
  }
  const summary = observation.summary.trim();
  if (summary.length < 1 || summary.length > 1_000) {
    harnessError("summary must contain 1 to 1,000 characters");
  }

  return Object.freeze({
    ...observation,
    apiRequestCount: count(observation.apiRequestCount, "apiRequestCount", 1),
    syntheticProviderWriteCount: count(
      observation.syntheticProviderWriteCount,
      "syntheticProviderWriteCount",
      maximumProviderWrites,
    ),
    summary,
  });
}

function validateCheckpoint(input: {
  checkpoint: DnaOpenLabP5RecoveryCheckpoint | null;
  codeHeadSha: string;
  providerScope: DnaOpenLabP5RecoveryProviderScope;
}): readonly DnaOpenLabP5RecoveryResult[] {
  if (input.checkpoint === null) return Object.freeze([]);
  if (input.checkpoint.version !== 1) {
    harnessError("checkpoint version is unsupported");
  }
  if (input.checkpoint.codeHeadSha !== input.codeHeadSha) {
    harnessError("checkpoint code head changed");
  }
  if (input.checkpoint.providerScope !== input.providerScope) {
    harnessError("checkpoint provider scope changed");
  }
  if (input.checkpoint.results.length > DNA_OPEN_LAB_P5_RECOVERY_CASES.length) {
    harnessError("checkpoint contains too many results");
  }
  const results: DnaOpenLabP5RecoveryResult[] = [];
  for (const [index, result] of input.checkpoint.results.entries()) {
    if (result.caseId !== DNA_OPEN_LAB_P5_RECOVERY_CASES[index]) {
      harnessError("checkpoint recovery cases are incomplete or out of order");
    }
    if (
      result.codeHeadSha !== input.codeHeadSha ||
      result.providerScope !== input.providerScope
    ) {
      harnessError("checkpoint result authority changed");
    }
    const executedAt = timestamp(result.executedAt);
    const observation = validateObservation({
      expectedCaseId: DNA_OPEN_LAB_P5_RECOVERY_CASES[index]!,
      providerScope: input.providerScope,
      observation: result,
    });
    results.push(
      Object.freeze({
        ...observation,
        codeHeadSha: input.codeHeadSha,
        providerScope: input.providerScope,
        executedAt,
      }),
    );
  }
  return Object.freeze(results);
}

/**
 * Runs exactly one recovery case per invocation. The injected case executor is
 * responsible for exercising the real local or bounded private-Preview path;
 * this boundary validates, orders and redacts its evidence into a restart-safe
 * exact-head report. It never authorises persistent real owner-data sync.
 */
export async function runDnaOpenLabP5RecoveryHarnessStep(input: {
  codeHeadSha: string;
  providerScope: DnaOpenLabP5RecoveryProviderScope;
  executedAt: string;
  checkpoint: DnaOpenLabP5RecoveryCheckpoint | null;
  runCase: (
    caseId: DnaOpenLabP5RecoveryCase,
  ) => Promise<DnaOpenLabP5RecoveryObservation>;
}): Promise<DnaOpenLabP5RecoveryHarnessStep> {
  const codeHeadSha = exactHeadSha(input.codeHeadSha);
  const scopedProvider = providerScope(input.providerScope);
  const executedAt = timestamp(input.executedAt);
  const previous = validateCheckpoint({
    checkpoint: input.checkpoint,
    codeHeadSha,
    providerScope: scopedProvider,
  });
  if (previous.length === DNA_OPEN_LAB_P5_RECOVERY_CASES.length) {
    harnessError("checkpoint is already complete");
  }

  const caseId = DNA_OPEN_LAB_P5_RECOVERY_CASES[previous.length]!;
  const observation = validateObservation({
    expectedCaseId: caseId,
    providerScope: scopedProvider,
    observation: await input.runCase(caseId),
  });
  const result = Object.freeze({
    ...observation,
    codeHeadSha,
    providerScope: scopedProvider,
    executedAt,
  });
  const results = Object.freeze([...previous, result]);
  const checkpoint = Object.freeze({
    version: 1 as const,
    codeHeadSha,
    providerScope: scopedProvider,
    results,
  });

  if (results.length < DNA_OPEN_LAB_P5_RECOVERY_CASES.length) {
    return Object.freeze({
      kind: "case_completed",
      completedCaseId: caseId,
      nextCaseId: DNA_OPEN_LAB_P5_RECOVERY_CASES[results.length]!,
      checkpoint,
    });
  }

  return Object.freeze({
    kind: "complete",
    checkpoint,
    report: Object.freeze({
      version: 1 as const,
      codeHeadSha,
      providerScope: scopedProvider,
      passed: results.every((entry) => entry.outcome === "passed"),
      completedAt: executedAt,
      results,
    }),
  });
}
