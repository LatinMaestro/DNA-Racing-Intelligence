import {
  DNA_POPULATION_ENTRANT_AUTHORITY_CONTINUATION_COMMAND_INTENT,
  DNA_POPULATION_ENTRANT_AUTHORITY_CONTINUATION_COMMAND_VERSION,
  DnaPopulationEntrantAuthorityContinuationCommandError,
  type DnaPopulationEntrantAuthorityContinuationCommandInvocation,
  type DnaPopulationEntrantAuthorityContinuationCommandReceipt,
  type DnaPopulationEntrantAuthorityContinuationCommandSession,
} from "./dna-population-entrant-authority-continuation-command";
import { DNA_POPULATION_ENTRANT_AUTHORITY_AGGREGATE_REQUESTS_PER_MINUTE } from "./dna-population-entrant-authority-cohort";

export const DNA_POPULATION_ENTRANT_AUTHORITY_AUTONOMOUS_RUNNER_VERSION =
  "dna-population-entrant-authority-autonomous-runner/v1" as const;
export const DNA_POPULATION_ENTRANT_AUTHORITY_AUTONOMOUS_RUNNER_INTENT =
  "complete_private_preview_unresolved_race_authority" as const;

const GIT_OBJECT_ID_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;

export type DnaPopulationEntrantAuthorityAutonomousBoundary = Readonly<{
  version: 1;
  status: "ready_for_continuation" | "authority_complete";
  exactCodeHeadSha: string;
  unresolvedRaceCount: number;
  unresolvedRaceSetSha256: string;
  recoveredChunkCount: number;
  recoveredRaceCount: number;
  nextChunkOrdinal: number;
  checkpointUpdatedAt: string;
  capacityObservedAt: string;
  durableBoundarySha256: string;
  previewOnly: true;
  providerRequestPerformed: false;
  persistentWritePerformed: false;
  providerWritePerformed: false;
  paidUsageAllowed: false;
}>;

export type DnaPopulationEntrantAuthorityAutonomousRunnerInvocation = Readonly<{
  runnerVersion: typeof DNA_POPULATION_ENTRANT_AUTHORITY_AUTONOMOUS_RUNNER_VERSION;
  intent: typeof DNA_POPULATION_ENTRANT_AUTHORITY_AUTONOMOUS_RUNNER_INTENT;
  allowPersistentWrite: true;
  exactCodeHeadSha: string;
  acceptedBoundary: DnaPopulationEntrantAuthorityAutonomousBoundary;
}>;

export type DnaPopulationEntrantAuthorityAutonomousRunnerReceipt = Readonly<{
  version: typeof DNA_POPULATION_ENTRANT_AUTHORITY_AUTONOMOUS_RUNNER_VERSION;
  status: "authority_complete";
  exactCodeHeadSha: string;
  unresolvedRaceCount: number;
  unresolvedRaceSetSha256: string;
  initialRecoveredRaceCount: number;
  completedCohortCount: number;
  recoveredChunkCount: number;
  recoveredRaceCount: number;
  nextChunkOrdinal: number;
  checkpointUpdatedAt: string;
  durableBoundarySha256: string;
  previewOnly: true;
  providerWritePerformed: false;
  paidUsageAllowed: false;
  preserveLastGood: true;
}>;

export type DnaPopulationEntrantAuthorityAutonomousSessionReceipt = Readonly<{
  version: typeof DNA_POPULATION_ENTRANT_AUTHORITY_AUTONOMOUS_RUNNER_VERSION;
  status: "advanced" | "authority_complete";
  boundary: DnaPopulationEntrantAuthorityAutonomousBoundary;
  initialRecoveredRaceCount: number;
  completedCohortCount: number;
  previewOnly: true;
  providerWritePerformed: false;
  paidUsageAllowed: false;
  preserveLastGood: true;
}>;

export type DnaPopulationEntrantAuthorityAutonomousRunnerDiagnostic =
  | "invalid_configuration"
  | "not_explicitly_armed"
  | "exact_head_mismatch"
  | "accepted_boundary_invalid"
  | "boundary_unavailable"
  | "boundary_drift"
  | "continuation_unavailable"
  | `continuation_${DnaPopulationEntrantAuthorityContinuationCommandError["diagnostic"]}`
  | "commit_unavailable"
  | "commit_invariant_failed"
  | "completion_unverified";

export class DnaPopulationEntrantAuthorityAutonomousRunnerError extends Error {
  readonly diagnostic: DnaPopulationEntrantAuthorityAutonomousRunnerDiagnostic;

  constructor(
    diagnostic: DnaPopulationEntrantAuthorityAutonomousRunnerDiagnostic,
  ) {
    super("Population entrant autonomous runner is unavailable");
    this.name = "DnaPopulationEntrantAuthorityAutonomousRunnerError";
    this.diagnostic = diagnostic;
  }
}

export type DnaPopulationEntrantAuthorityAutonomousBoundaryInspector =
  Readonly<{
    inspect: () => Promise<DnaPopulationEntrantAuthorityAutonomousBoundary>;
  }>;

export type DnaPopulationEntrantAuthorityAutonomousContinuationCommand =
  Readonly<{
    executeContinuation: (
      invocation: DnaPopulationEntrantAuthorityContinuationCommandInvocation,
    ) => Promise<DnaPopulationEntrantAuthorityContinuationCommandSession>;
  }>;

export type DnaPopulationEntrantAuthorityAutonomousCohortGuard = Readonly<{
  assertCurrentExactHead: (exactCodeHeadSha: string) => Promise<void>;
}>;

function runnerError(
  diagnostic: DnaPopulationEntrantAuthorityAutonomousRunnerDiagnostic,
): never {
  throw new DnaPopulationEntrantAuthorityAutonomousRunnerError(diagnostic);
}

function exactHead(
  value: string,
  diagnostic: "invalid_configuration" | "exact_head_mismatch",
): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.toLowerCase() !== value ||
    !GIT_OBJECT_ID_PATTERN.test(value)
  ) {
    runnerError(diagnostic);
  }
  return value;
}

function sha256(value: string): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.toLowerCase() !== value ||
    !SHA_256_PATTERN.test(value)
  ) {
    runnerError("accepted_boundary_invalid");
  }
  return value;
}

function timestamp(value: string): string {
  if (typeof value !== "string") runnerError("accepted_boundary_invalid");
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    runnerError("accepted_boundary_invalid");
  }
  return parsed.toISOString();
}

function positiveInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    runnerError("accepted_boundary_invalid");
  }
  return value;
}

function canonicalBoundary(
  value: DnaPopulationEntrantAuthorityAutonomousBoundary,
): DnaPopulationEntrantAuthorityAutonomousBoundary {
  if (
    value === null ||
    typeof value !== "object" ||
    value.version !== 1 ||
    (value.status !== "ready_for_continuation" &&
      value.status !== "authority_complete") ||
    value.previewOnly !== true ||
    value.providerRequestPerformed !== false ||
    value.persistentWritePerformed !== false ||
    value.providerWritePerformed !== false ||
    value.paidUsageAllowed !== false
  ) {
    runnerError("accepted_boundary_invalid");
  }

  const unresolvedRaceCount = positiveInteger(value.unresolvedRaceCount);
  const recoveredChunkCount = positiveInteger(value.recoveredChunkCount);
  const recoveredRaceCount = positiveInteger(value.recoveredRaceCount);
  const nextChunkOrdinal = positiveInteger(value.nextChunkOrdinal);
  const unresolvedRaceSetSha256 = sha256(value.unresolvedRaceSetSha256);

  if (
    nextChunkOrdinal !== recoveredChunkCount + 1 ||
    recoveredRaceCount > unresolvedRaceCount ||
    (value.status === "ready_for_continuation" &&
      recoveredRaceCount >= unresolvedRaceCount) ||
    (value.status === "authority_complete" &&
      recoveredRaceCount !== unresolvedRaceCount)
  ) {
    runnerError("accepted_boundary_invalid");
  }

  return Object.freeze({
    version: 1 as const,
    status: value.status,
    exactCodeHeadSha: exactHead(value.exactCodeHeadSha, "exact_head_mismatch"),
    unresolvedRaceCount,
    unresolvedRaceSetSha256,
    recoveredChunkCount,
    recoveredRaceCount,
    nextChunkOrdinal,
    checkpointUpdatedAt: timestamp(value.checkpointUpdatedAt),
    capacityObservedAt: timestamp(value.capacityObservedAt),
    durableBoundarySha256: sha256(value.durableBoundarySha256),
    previewOnly: true as const,
    providerRequestPerformed: false as const,
    persistentWritePerformed: false as const,
    providerWritePerformed: false as const,
    paidUsageAllowed: false as const,
  });
}

function sameBoundary(
  left: DnaPopulationEntrantAuthorityAutonomousBoundary,
  right: DnaPopulationEntrantAuthorityAutonomousBoundary,
): boolean {
  return (
    left.version === right.version &&
    left.status === right.status &&
    left.exactCodeHeadSha === right.exactCodeHeadSha &&
    left.unresolvedRaceCount === right.unresolvedRaceCount &&
    left.unresolvedRaceSetSha256 === right.unresolvedRaceSetSha256 &&
    left.recoveredChunkCount === right.recoveredChunkCount &&
    left.recoveredRaceCount === right.recoveredRaceCount &&
    left.nextChunkOrdinal === right.nextChunkOrdinal &&
    left.checkpointUpdatedAt === right.checkpointUpdatedAt &&
    left.durableBoundarySha256 === right.durableBoundarySha256 &&
    left.previewOnly === right.previewOnly &&
    left.providerRequestPerformed === right.providerRequestPerformed &&
    left.persistentWritePerformed === right.persistentWritePerformed &&
    left.providerWritePerformed === right.providerWritePerformed &&
    left.paidUsageAllowed === right.paidUsageAllowed
  );
}

function sameAuthority(
  left: DnaPopulationEntrantAuthorityAutonomousBoundary,
  right: DnaPopulationEntrantAuthorityAutonomousBoundary,
): boolean {
  return (
    left.exactCodeHeadSha === right.exactCodeHeadSha &&
    left.unresolvedRaceCount === right.unresolvedRaceCount &&
    left.unresolvedRaceSetSha256 === right.unresolvedRaceSetSha256
  );
}

function observedAt(now: () => Date, checkpointUpdatedAt: string): string {
  let value: Date;
  try {
    value = now();
  } catch {
    runnerError("invalid_configuration");
  }
  if (
    !(value instanceof Date) ||
    Number.isNaN(value.getTime()) ||
    value.getTime() < Date.parse(checkpointUpdatedAt)
  ) {
    runnerError("invalid_configuration");
  }
  return value.toISOString();
}

function invocationFromBoundary(input: {
  boundary: DnaPopulationEntrantAuthorityAutonomousBoundary;
  now: () => Date;
}): DnaPopulationEntrantAuthorityContinuationCommandInvocation {
  return Object.freeze({
    commandVersion:
      DNA_POPULATION_ENTRANT_AUTHORITY_CONTINUATION_COMMAND_VERSION,
    intent: DNA_POPULATION_ENTRANT_AUTHORITY_CONTINUATION_COMMAND_INTENT,
    allowPersistentWrite: true as const,
    exactCodeHeadSha: input.boundary.exactCodeHeadSha,
    cohortObservedAt: observedAt(input.now, input.boundary.checkpointUpdatedAt),
    expectedUnresolvedRaceCount: input.boundary.unresolvedRaceCount,
    expectedUnresolvedRaceSetSha256: input.boundary.unresolvedRaceSetSha256,
    expectedRecoveredChunkCount: input.boundary.recoveredChunkCount,
    expectedRecoveredRaceCount: input.boundary.recoveredRaceCount,
    expectedNextChunkOrdinal: input.boundary.nextChunkOrdinal,
    expectedCheckpointUpdatedAt: input.boundary.checkpointUpdatedAt,
    readinessCapacityObservedAt: input.boundary.capacityObservedAt,
    durableBoundarySha256: input.boundary.durableBoundarySha256,
  });
}

function validateCommit(input: {
  boundary: DnaPopulationEntrantAuthorityAutonomousBoundary;
  receipt: DnaPopulationEntrantAuthorityContinuationCommandReceipt;
}): void {
  const receipt = input.receipt;
  if (
    receipt.status !== "committed" ||
    receipt.exactCodeHeadSha !== input.boundary.exactCodeHeadSha ||
    receipt.chunkOrdinal !== input.boundary.nextChunkOrdinal ||
    receipt.checkpointRaceCountBefore !== input.boundary.recoveredRaceCount ||
    !Number.isSafeInteger(receipt.rowCount) ||
    receipt.rowCount < 1 ||
    receipt.checkpointRaceCountAfter !==
      receipt.checkpointRaceCountBefore + receipt.rowCount ||
    receipt.checkpointRaceCountAfter > input.boundary.unresolvedRaceCount ||
    receipt.resolvedRaceCount + receipt.quarantinedRaceCount !==
      receipt.rowCount ||
    receipt.authorityComplete !==
      (receipt.checkpointRaceCountAfter ===
        input.boundary.unresolvedRaceCount) ||
    receipt.persistentWriteArmed !== true ||
    receipt.previewOnly !== true ||
    receipt.providerRequestPerformed !== false ||
    receipt.persistentWritePerformed !== true ||
    receipt.providerWritePerformed !== false ||
    receipt.paidUsageAllowed !== false ||
    receipt.preserveLastGood !== true
  ) {
    runnerError("commit_invariant_failed");
  }
}

function validatePostCommitBoundary(input: {
  before: DnaPopulationEntrantAuthorityAutonomousBoundary;
  commit: DnaPopulationEntrantAuthorityContinuationCommandReceipt;
  after: DnaPopulationEntrantAuthorityAutonomousBoundary;
}): void {
  if (
    !sameAuthority(input.before, input.after) ||
    input.after.recoveredChunkCount !== input.before.recoveredChunkCount + 1 ||
    input.after.recoveredRaceCount !== input.commit.checkpointRaceCountAfter ||
    input.after.nextChunkOrdinal !== input.commit.chunkOrdinal + 1 ||
    Date.parse(input.after.checkpointUpdatedAt) <
      Date.parse(input.before.checkpointUpdatedAt) ||
    (input.commit.authorityComplete &&
      input.after.status !== "authority_complete") ||
    (!input.commit.authorityComplete &&
      input.after.status !== "ready_for_continuation")
  ) {
    runnerError(
      input.commit.authorityComplete
        ? "completion_unverified"
        : "boundary_drift",
    );
  }
}

export function createDnaPopulationEntrantAuthorityAutonomousRunner(input: {
  runtimeCodeHeadSha: string;
  boundaryInspector: DnaPopulationEntrantAuthorityAutonomousBoundaryInspector;
  continuationCommand: DnaPopulationEntrantAuthorityAutonomousContinuationCommand;
  cohortGuard?: DnaPopulationEntrantAuthorityAutonomousCohortGuard;
  now?: () => Date;
}): Readonly<{
  runBoundedSession: (
    invocation: DnaPopulationEntrantAuthorityAutonomousRunnerInvocation,
    maximumCohortCount: number,
  ) => Promise<DnaPopulationEntrantAuthorityAutonomousSessionReceipt>;
  runToCompletion: (
    invocation: DnaPopulationEntrantAuthorityAutonomousRunnerInvocation,
  ) => Promise<DnaPopulationEntrantAuthorityAutonomousRunnerReceipt>;
}> {
  const runtimeCodeHeadSha = exactHead(
    input.runtimeCodeHeadSha,
    "invalid_configuration",
  );
  const now = input.now ?? (() => new Date());

  async function runSession(
    invocation: DnaPopulationEntrantAuthorityAutonomousRunnerInvocation,
    maximumCohortCount: number | null,
  ): Promise<DnaPopulationEntrantAuthorityAutonomousSessionReceipt> {
    if (
      maximumCohortCount !== null &&
      (!Number.isSafeInteger(maximumCohortCount) || maximumCohortCount < 1)
    ) {
      runnerError("invalid_configuration");
    }
    if (
      invocation.runnerVersion !==
        DNA_POPULATION_ENTRANT_AUTHORITY_AUTONOMOUS_RUNNER_VERSION ||
      invocation.intent !==
        DNA_POPULATION_ENTRANT_AUTHORITY_AUTONOMOUS_RUNNER_INTENT ||
      invocation.allowPersistentWrite !== true
    ) {
      runnerError("not_explicitly_armed");
    }
    if (
      exactHead(invocation.exactCodeHeadSha, "exact_head_mismatch") !==
      runtimeCodeHeadSha
    ) {
      runnerError("exact_head_mismatch");
    }

    const acceptedBoundary = canonicalBoundary(invocation.acceptedBoundary);
    if (acceptedBoundary.exactCodeHeadSha !== runtimeCodeHeadSha) {
      runnerError("exact_head_mismatch");
    }

    let current: DnaPopulationEntrantAuthorityAutonomousBoundary;
    try {
      current = canonicalBoundary(await input.boundaryInspector.inspect());
    } catch (error) {
      if (error instanceof DnaPopulationEntrantAuthorityAutonomousRunnerError) {
        throw error;
      }
      runnerError("boundary_unavailable");
    }
    if (!sameBoundary(current, acceptedBoundary)) {
      runnerError("boundary_drift");
    }

    const initialRecoveredRaceCount = current.recoveredRaceCount;
    let completedCohortCount = 0;

    while (
      current.status !== "authority_complete" &&
      (maximumCohortCount === null || completedCohortCount < maximumCohortCount)
    ) {
      if (input.cohortGuard !== undefined) {
        try {
          await input.cohortGuard.assertCurrentExactHead(runtimeCodeHeadSha);
        } catch {
          runnerError("boundary_drift");
        }
      }
      let session: DnaPopulationEntrantAuthorityContinuationCommandSession;
      try {
        session = await input.continuationCommand.executeContinuation(
          invocationFromBoundary({ boundary: current, now }),
        );
      } catch (error) {
        if (error instanceof DnaPopulationEntrantAuthorityContinuationCommandError) {
          runnerError(`continuation_${error.diagnostic}`);
        }
        runnerError("continuation_unavailable");
      }

      if (
        session.prepared.recoveredChunkCount !== current.recoveredChunkCount ||
        session.prepared.recoveredRaceCount !== current.recoveredRaceCount ||
        session.prepared.chunkOrdinal !== current.nextChunkOrdinal ||
        session.prepared.durableBoundarySha256 !==
          current.durableBoundarySha256 ||
        session.prepared.aggregateRequestsPerMinute !==
          DNA_POPULATION_ENTRANT_AUTHORITY_AGGREGATE_REQUESTS_PER_MINUTE ||
        session.prepared.persistentWriteArmed !== true ||
        session.prepared.previewOnly !== true ||
        session.prepared.entrantChunkPersistentWritePerformed !== false ||
        session.prepared.providerWritePerformed !== false ||
        session.prepared.paidUsageAllowed !== false ||
        session.prepared.preserveLastGood !== true
      ) {
        runnerError("continuation_unavailable");
      }

      let commit: DnaPopulationEntrantAuthorityContinuationCommandReceipt;
      try {
        commit = await session.commit();
      } catch {
        runnerError("commit_unavailable");
      }
      validateCommit({ boundary: current, receipt: commit });

      let next: DnaPopulationEntrantAuthorityAutonomousBoundary;
      try {
        next = canonicalBoundary(await input.boundaryInspector.inspect());
      } catch (error) {
        if (
          error instanceof DnaPopulationEntrantAuthorityAutonomousRunnerError
        ) {
          throw error;
        }
        runnerError(
          commit.authorityComplete
            ? "completion_unverified"
            : "boundary_unavailable",
        );
      }
      validatePostCommitBoundary({ before: current, commit, after: next });
      current = next;
      completedCohortCount += 1;
    }

    return Object.freeze({
      version: DNA_POPULATION_ENTRANT_AUTHORITY_AUTONOMOUS_RUNNER_VERSION,
      status:
        current.status === "authority_complete"
          ? ("authority_complete" as const)
          : ("advanced" as const),
      boundary: current,
      initialRecoveredRaceCount,
      completedCohortCount,
      previewOnly: true as const,
      providerWritePerformed: false as const,
      paidUsageAllowed: false as const,
      preserveLastGood: true as const,
    });
  }

  return Object.freeze({
    async runBoundedSession(invocation, maximumCohortCount) {
      return runSession(invocation, maximumCohortCount);
    },
    async runToCompletion(invocation) {
      const session = await runSession(invocation, null);
      if (session.status !== "authority_complete") {
        runnerError("completion_unverified");
      }
      const current = session.boundary;
      return Object.freeze({
        version: DNA_POPULATION_ENTRANT_AUTHORITY_AUTONOMOUS_RUNNER_VERSION,
        status: "authority_complete" as const,
        exactCodeHeadSha: current.exactCodeHeadSha,
        unresolvedRaceCount: current.unresolvedRaceCount,
        unresolvedRaceSetSha256: current.unresolvedRaceSetSha256,
        initialRecoveredRaceCount: session.initialRecoveredRaceCount,
        completedCohortCount: session.completedCohortCount,
        recoveredChunkCount: current.recoveredChunkCount,
        recoveredRaceCount: current.recoveredRaceCount,
        nextChunkOrdinal: current.nextChunkOrdinal,
        checkpointUpdatedAt: current.checkpointUpdatedAt,
        durableBoundarySha256: current.durableBoundarySha256,
        previewOnly: true as const,
        providerWritePerformed: false as const,
        paidUsageAllowed: false as const,
        preserveLastGood: true as const,
      });
    },
  });
}
