import {
  DNA_OPEN_LAB_PROVIDER_CAPACITY_PREFLIGHT_INTENT,
  DNA_OPEN_LAB_PROVIDER_CAPACITY_PREFLIGHT_VERSION,
  type DnaOpenLabProviderCapacityPreflight,
} from "./dna-open-lab-provider-capacity-preflight";
import { dnaOpenLabRawEvidenceSha256 } from "./dna-open-lab-v1-adapters";
import type { RaceMergeOutcomeZeroCostCapacityGate } from "./race-merge-outcome-ingestion-service";

const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;
const GIT_OBJECT_ID_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;

/**
 * Conservative compact-row allowance covering the outcome tuple, provenance,
 * generation/object keys, heap alignment and indexes. The connected preflight
 * projects this complete upper bound before the first private R2 read.
 */
export const RACE_MERGE_OUTCOME_MAXIMUM_NEON_BYTES_PER_SOURCE_ROW = 192;
export const RACE_MERGE_OUTCOME_FIXED_NEON_BYTES = 16 * 1024 * 1024;
export const RACE_MERGE_OUTCOME_MAXIMUM_COMPUTE_MILLI_CU_HOURS = 8_000;

function identifier(value: string, field: string): string {
  const normalized = value.trim();
  if (!SAFE_IDENTIFIER_PATTERN.test(normalized)) {
    throw new Error(`Race Merge capacity ${field} is invalid.`);
  }
  return normalized;
}

function sha256(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!SHA_256_PATTERN.test(normalized)) {
    throw new Error(`Race Merge capacity ${field} is invalid.`);
  }
  return normalized;
}

function exactHead(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!GIT_OBJECT_ID_PATTERN.test(normalized)) {
    throw new Error("Race Merge capacity exact head is invalid.");
  }
  return normalized;
}

function positiveCount(value: number, field: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`Race Merge capacity ${field} is outside its bound.`);
  }
  return value;
}

function projectedNeonGrowth(maximumRows: number): number {
  const value =
    maximumRows * RACE_MERGE_OUTCOME_MAXIMUM_NEON_BYTES_PER_SOURCE_ROW +
    RACE_MERGE_OUTCOME_FIXED_NEON_BYTES;
  if (!Number.isSafeInteger(value)) {
    throw new Error("Race Merge capacity Neon projection is invalid.");
  }
  return value;
}

/**
 * Binds Race Merge ingestion to the repository's fresh Cloudflare/Neon A$0
 * preflight. Source CSVs are already retained in private R2, so ingestion adds
 * no storage or Class A writes there; it reserves one bounded Class B object
 * read per source and a conservative complete Neon compact-row upper bound.
 */
export function createRaceMergeOutcomeZeroCostCapacityGate(input: {
  configuredOwnerId: string;
  exactCodeHeadSha: string;
  preflight: DnaOpenLabProviderCapacityPreflight;
}): RaceMergeOutcomeZeroCostCapacityGate {
  const ownerId = identifier(input.configuredOwnerId, "owner");
  const exactCodeHeadSha = exactHead(input.exactCodeHeadSha);

  return Object.freeze({
    async authorize(request) {
      if (identifier(request.ownerId, "owner") !== ownerId) {
        throw new Error("Race Merge capacity owner access denied.");
      }
      const generationId = identifier(request.generationId, "generation");
      const manifestDigestSha256 = sha256(
        request.manifestDigestSha256,
        "manifest digest",
      );
      const sourceObjectCount = positiveCount(
        request.sourceObjectCount,
        "source object count",
        24,
      );
      positiveCount(
        request.sourceByteLength,
        "source byte length",
        9_500_000_000,
      );
      const maximumRowsPerGeneration = positiveCount(
        request.maximumRowsPerGeneration,
        "maximum row count",
        100_000_000,
      );
      const refreshCycleId = dnaOpenLabRawEvidenceSha256({
        domain: "race-merge-outcome-ingestion-cycle/v1",
        ownerId,
        generationId,
        manifestDigestSha256,
      });
      const budgetWindowId = dnaOpenLabRawEvidenceSha256({
        domain: "race-merge-outcome-ingestion-budget/v1",
        ownerId,
        exactCodeHeadSha,
        manifestDigestSha256,
      });
      const receipt = await input.preflight.inspect({
        preflightVersion: DNA_OPEN_LAB_PROVIDER_CAPACITY_PREFLIGHT_VERSION,
        intent: DNA_OPEN_LAB_PROVIDER_CAPACITY_PREFLIGHT_INTENT,
        authenticatedOwnerId: ownerId,
        exactCodeHeadSha,
        refreshCycleId,
        budgetWindowId,
        projectionHorizon: "single_refresh",
        plannedR2UsagePerRefresh: {
          storageBytes: 0,
          classAOperations: 0,
          classBOperations: sourceObjectCount,
        },
        plannedNeonUsagePerRefresh: {
          storageBytes: projectedNeonGrowth(maximumRowsPerGeneration),
          computeMilliCuHours:
            RACE_MERGE_OUTCOME_MAXIMUM_COMPUTE_MILLI_CU_HOURS,
        },
      });
      if (receipt.status !== "ready") {
        throw new Error(`Race Merge capacity held: ${receipt.reason}.`);
      }
      return Object.freeze({
        ownerId,
        generationId,
        manifestDigestSha256,
        measuredAt: receipt.checkedAt,
        validUntil: receipt.validUntil,
        projectedR2RetainedBytes:
          receipt.projection.projectedR2Usage.storageBytes,
        projectedNeonStorageBytes:
          receipt.projection.projectedNeonUsage.storageBytes,
        projectedPaidCostAud: 0 as const,
      });
    },
  });
}
