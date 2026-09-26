import { createHash } from "node:crypto";

import { DNA_OPEN_LAB_PROVIDER_CAPACITY_MAXIMUM_AGE_MILLISECONDS } from "./dna-open-lab-provider-capacity-preflight";
import type { DnaPopulationEntrantAuthorityReadinessReceipt } from "./dna-population-entrant-authority-readiness";

export const DNA_POPULATION_ENTRANT_AUTHORITY_READINESS_HANDOFF_VERSION =
  "dna-population-entrant-authority-readiness-handoff/v1" as const;
export const DNA_POPULATION_ENTRANT_AUTHORITY_READINESS_HANDOFF_MAXIMUM_AGE_MILLISECONDS =
  DNA_OPEN_LAB_PROVIDER_CAPACITY_MAXIMUM_AGE_MILLISECONDS;

const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;

export type DnaPopulationEntrantAuthorityReadinessHandoff = Readonly<{
  version: typeof DNA_POPULATION_ENTRANT_AUTHORITY_READINESS_HANDOFF_VERSION;
  exactCodeHeadSha: string;
  expectedUnresolvedRaceCount: number;
  expectedUnresolvedRaceSetSha256: string;
  readinessCapacityObservedAt: string;
  readinessReceiptSha256: string;
}>;

export type DnaPopulationEntrantAuthorityReadinessHandoffDiagnostic =
  | "invalid"
  | "stale";

export class DnaPopulationEntrantAuthorityReadinessHandoffError extends Error {
  readonly diagnostic: DnaPopulationEntrantAuthorityReadinessHandoffDiagnostic;

  constructor(
    diagnostic: DnaPopulationEntrantAuthorityReadinessHandoffDiagnostic,
  ) {
    super("Population entrant readiness handoff is unavailable");
    this.name = "DnaPopulationEntrantAuthorityReadinessHandoffError";
    this.diagnostic = diagnostic;
  }
}

function handoffError(
  diagnostic: DnaPopulationEntrantAuthorityReadinessHandoffDiagnostic,
): never {
  throw new DnaPopulationEntrantAuthorityReadinessHandoffError(diagnostic);
}

function exactHead(value: string): string {
  if (
    typeof value !== "string" ||
    value.toLowerCase() !== value ||
    !COMMIT_PATTERN.test(value)
  ) {
    handoffError("invalid");
  }
  return value;
}

function positiveCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) handoffError("invalid");
  return value;
}

function sha256(value: string): string {
  if (
    typeof value !== "string" ||
    value.toLowerCase() !== value ||
    !SHA_256_PATTERN.test(value)
  ) {
    handoffError("invalid");
  }
  return value;
}

function exactTimestamp(value: string): string {
  if (typeof value !== "string") handoffError("invalid");
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    handoffError("invalid");
  }
  return parsed.toISOString();
}

function canonicalReceipt(input: {
  exactCodeHeadSha: string;
  unresolvedRaceCount: number;
  unresolvedRaceSetSha256: string;
  capacityObservedAt: string;
}) {
  return Object.freeze({
    status: "ready" as const,
    exactCodeHeadSha: exactHead(input.exactCodeHeadSha),
    unresolvedRaceCount: positiveCount(input.unresolvedRaceCount),
    unresolvedRaceSetSha256: sha256(input.unresolvedRaceSetSha256),
    capacityObservedAt: exactTimestamp(input.capacityObservedAt),
    previewOnly: true as const,
    dnaEntrantHydrationPerformed: false as const,
    checkpointInitializationPerformed: false as const,
    entrantChunkPersistentWritePerformed: false as const,
    providerWritePerformed: false as const,
    paidUsageAllowed: false as const,
  });
}

function receiptSha256(
  receipt: ReturnType<typeof canonicalReceipt>,
): string {
  return createHash("sha256")
    .update(
      `${DNA_POPULATION_ENTRANT_AUTHORITY_READINESS_HANDOFF_VERSION}\u0000${JSON.stringify(
        receipt,
      )}`,
      "utf8",
    )
    .digest("hex");
}

export function createDnaPopulationEntrantAuthorityReadinessHandoff(
  receipt: DnaPopulationEntrantAuthorityReadinessReceipt,
): DnaPopulationEntrantAuthorityReadinessHandoff {
  if (
    receipt.status !== "ready" ||
    receipt.previewOnly !== true ||
    receipt.dnaEntrantHydrationPerformed !== false ||
    receipt.checkpointInitializationPerformed !== false ||
    receipt.entrantChunkPersistentWritePerformed !== false ||
    receipt.providerWritePerformed !== false ||
    receipt.paidUsageAllowed !== false
  ) {
    handoffError("invalid");
  }
  const canonical = canonicalReceipt(receipt);
  return Object.freeze({
    version: DNA_POPULATION_ENTRANT_AUTHORITY_READINESS_HANDOFF_VERSION,
    exactCodeHeadSha: canonical.exactCodeHeadSha,
    expectedUnresolvedRaceCount: canonical.unresolvedRaceCount,
    expectedUnresolvedRaceSetSha256: canonical.unresolvedRaceSetSha256,
    readinessCapacityObservedAt: canonical.capacityObservedAt,
    readinessReceiptSha256: receiptSha256(canonical),
  });
}

export function validateDnaPopulationEntrantAuthorityReadinessHandoff(input: {
  handoff: DnaPopulationEntrantAuthorityReadinessHandoff;
  checkedAt: string;
}): DnaPopulationEntrantAuthorityReadinessHandoff {
  const handoff = input.handoff;
  if (
    handoff === null ||
    typeof handoff !== "object" ||
    handoff.version !==
      DNA_POPULATION_ENTRANT_AUTHORITY_READINESS_HANDOFF_VERSION
  ) {
    handoffError("invalid");
  }
  const canonical = canonicalReceipt({
    exactCodeHeadSha: handoff.exactCodeHeadSha,
    unresolvedRaceCount: handoff.expectedUnresolvedRaceCount,
    unresolvedRaceSetSha256: handoff.expectedUnresolvedRaceSetSha256,
    capacityObservedAt: handoff.readinessCapacityObservedAt,
  });
  const digest = sha256(handoff.readinessReceiptSha256);
  if (digest !== receiptSha256(canonical)) handoffError("invalid");

  const checkedAt = Date.parse(exactTimestamp(input.checkedAt));
  const observedAt = Date.parse(canonical.capacityObservedAt);
  if (
    observedAt > checkedAt ||
    checkedAt - observedAt >
      DNA_POPULATION_ENTRANT_AUTHORITY_READINESS_HANDOFF_MAXIMUM_AGE_MILLISECONDS
  ) {
    handoffError("stale");
  }

  return Object.freeze({
    version: DNA_POPULATION_ENTRANT_AUTHORITY_READINESS_HANDOFF_VERSION,
    exactCodeHeadSha: canonical.exactCodeHeadSha,
    expectedUnresolvedRaceCount: canonical.unresolvedRaceCount,
    expectedUnresolvedRaceSetSha256: canonical.unresolvedRaceSetSha256,
    readinessCapacityObservedAt: canonical.capacityObservedAt,
    readinessReceiptSha256: digest,
  });
}
