import type { DnaPopulationHistoryAcquisitionPlan } from "./dna-population-history-acquisition-plan";
import {
  hydrateDnaRaceDocuments,
  DNA_RACE_DOCUMENT_BATCH_LIMIT,
} from "./dna-open-lab-race-document-hydrator";
import type { DnaOpenLabProviderCapacityMeasurement } from "./dna-open-lab-provider-capacity-preflight";
import {
  DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
  type DnaOpenLabRequestBudget,
} from "./dna-open-lab-request-budget";
import { dnaOpenLabRawEvidenceCanonicalJson } from "./dna-open-lab-v1-adapters";
import type { DnaOpenLabClient } from "./dna-open-lab-v1-client";
import { DNA_OPEN_LAB_ZERO_COST_NEON_BUDGETS } from "./dna-open-lab-zero-cost-provider-capacity";
import { DNA_OPEN_LAB_ZERO_COST_R2_BUDGETS } from "./dna-open-lab-zero-cost-refresh-policy";

const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;

export type DnaPopulationEntrantHydrationReadOnlyMeasurement = Readonly<{
  authority: Readonly<{
    unresolvedRaceCount: number;
    unresolvedRaceSetSha256: string;
    selectedRaceCount: number;
  }>;
  providerRequestCount: number;
  returnedRowCount: number;
  canonicalResponseBytes: number;
  maximumCanonicalRaceBytes: number;
  projectedR2PayloadBytesCeiling: number;
  projectedR2PayloadFitsZeroCostStorageBudget: boolean;
  capacity: Readonly<{
    currentR2StorageBytes: number;
    r2StorageHeadroomBytes: number;
    currentNeonStorageBytes: number;
    neonStorageHeadroomBytes: number;
    currentNeonComputeMilliCuHours: number;
    neonComputeHeadroomMilliCuHours: number;
  }>;
  aggregateRequestsPerMinute: typeof DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE;
  persistentWritePerformed: false;
  providerWritePerformed: false;
  paidUsageAllowed: false;
  persistentCollectionAllowed: false;
}>;

function measurementError(message: string): never {
  throw new Error(`Population entrant hydration measurement: ${message}`);
}

function nonNegativeSafeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    measurementError(`${field} is invalid`);
  }
  return value;
}

function positiveSafeInteger(value: number, field: string): number {
  const normalized = nonNegativeSafeInteger(value, field);
  if (normalized < 1) measurementError(`${field} is invalid`);
  return normalized;
}

function safeAdd(left: number, right: number, field: string): number {
  const value = left + right;
  if (!Number.isSafeInteger(value) || value < 0) {
    measurementError(`${field} exceeds safe integer capacity`);
  }
  return value;
}

function safeMultiply(left: number, right: number, field: string): number {
  const value = left * right;
  if (!Number.isSafeInteger(value) || value < 0) {
    measurementError(`${field} exceeds safe integer capacity`);
  }
  return value;
}

function sha256(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!SHA_256_PATTERN.test(normalized)) {
    measurementError(`${field} is invalid`);
  }
  return normalized;
}

function utf8Bytes(value: unknown): number {
  return Buffer.byteLength(dnaOpenLabRawEvidenceCanonicalJson(value), "utf8");
}

/**
 * Performs the smallest useful connected measurement of the unresolved
 * population Race universe. Authority count/hash and current zero-cost
 * capacity are checked before the first DNA provider request.
 *
 * The sample is one deterministic endpoint-sized slice (at most 20 races).
 * Results remain memory-only. The R2 projection is deliberately payload-only;
 * persistent collection stays disallowed until a later storage plan accounts
 * for object metadata/manifests and passes the complete zero-cost guards.
 */
export async function measureDnaPopulationEntrantHydrationReadOnly(input: {
  plan: DnaPopulationHistoryAcquisitionPlan;
  expectedUnresolvedRaceCount: number;
  expectedUnresolvedRaceSetSha256: string;
  providerCapacity: DnaOpenLabProviderCapacityMeasurement;
  client: Pick<DnaOpenLabClient, "raceDocs">;
  requestBudget: DnaOpenLabRequestBudget;
  observedAt: string;
}): Promise<DnaPopulationEntrantHydrationReadOnlyMeasurement> {
  const expectedUnresolvedRaceCount = positiveSafeInteger(
    input.expectedUnresolvedRaceCount,
    "expected unresolved Race count",
  );
  const expectedUnresolvedRaceSetSha256 = sha256(
    input.expectedUnresolvedRaceSetSha256,
    "expected unresolved Race set SHA-256",
  );
  if (
    input.plan.unresolvedRaceCount !== expectedUnresolvedRaceCount ||
    input.plan.unresolvedRaceSetSha256 !== expectedUnresolvedRaceSetSha256
  ) {
    measurementError("audited unresolved Race authority does not match");
  }
  if (input.plan.status !== "held_incomplete_race_authority") {
    measurementError("entrant hydration is not required by the current plan");
  }

  const selectedRaceIds = input.plan.unresolvedRaceMeasurementSampleIds;
  if (
    selectedRaceIds.length < 1 ||
    selectedRaceIds.length > DNA_RACE_DOCUMENT_BATCH_LIMIT ||
    selectedRaceIds.some((raceId) => raceId.trim() === "")
  ) {
    measurementError("deterministic unresolved Race sample is invalid");
  }

  const initialBudget = input.requestBudget.snapshot();
  if (
    initialBudget.effectiveRequestsPerMinute >
    DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE
  ) {
    measurementError("aggregate DNA request budget exceeds the safe ceiling");
  }

  const currentR2StorageBytes = nonNegativeSafeInteger(
    input.providerCapacity.currentR2Usage.storageBytes,
    "current R2 storage",
  );
  const currentR2ClassAOperations = nonNegativeSafeInteger(
    input.providerCapacity.currentR2Usage.classAOperations,
    "current R2 Class A operations",
  );
  const currentR2ClassBOperations = nonNegativeSafeInteger(
    input.providerCapacity.currentR2Usage.classBOperations,
    "current R2 Class B operations",
  );
  const currentNeonStorageBytes = nonNegativeSafeInteger(
    input.providerCapacity.currentNeonUsage.storageBytes,
    "current Neon storage",
  );
  const currentNeonComputeMilliCuHours = nonNegativeSafeInteger(
    input.providerCapacity.currentNeonUsage.computeMilliCuHours,
    "current Neon compute",
  );
  if (
    input.providerCapacity.r2StorageClass !== "Standard" ||
    currentR2StorageBytes >= DNA_OPEN_LAB_ZERO_COST_R2_BUDGETS.storageBytes ||
    currentR2ClassAOperations >=
      DNA_OPEN_LAB_ZERO_COST_R2_BUDGETS.classAOperations ||
    currentR2ClassBOperations >=
      DNA_OPEN_LAB_ZERO_COST_R2_BUDGETS.classBOperations ||
    currentNeonStorageBytes >=
      DNA_OPEN_LAB_ZERO_COST_NEON_BUDGETS.storageBytes ||
    currentNeonComputeMilliCuHours >=
      DNA_OPEN_LAB_ZERO_COST_NEON_BUDGETS.computeMilliCuHours
  ) {
    measurementError("current zero-cost provider capacity is unavailable");
  }

  let providerRequestCount = 0;
  let canonicalResponseBytes = 0;
  let maximumCanonicalRaceBytes = 0;
  const measuringClient: Pick<DnaOpenLabClient, "raceDocs"> = Object.freeze({
    raceDocs: async (raceIds) => {
      providerRequestCount += 1;
      const response = await input.client.raceDocs(raceIds);
      canonicalResponseBytes = safeAdd(
        canonicalResponseBytes,
        utf8Bytes(response.result),
        "canonical response byte count",
      );
      if (Array.isArray(response.result)) {
        for (const document of response.result) {
          maximumCanonicalRaceBytes = Math.max(
            maximumCanonicalRaceBytes,
            utf8Bytes(document),
          );
        }
      }
      return response;
    },
  });

  const hydration = await hydrateDnaRaceDocuments({
    raceIds: selectedRaceIds,
    client: measuringClient,
    requestBudget: input.requestBudget,
    observedAt: input.observedAt,
  });
  if (
    hydration.batchCount !== 1 ||
    providerRequestCount !== 1 ||
    hydration.requestedRaceCount !== selectedRaceIds.length ||
    hydration.documents.length !== selectedRaceIds.length ||
    maximumCanonicalRaceBytes < 1 ||
    canonicalResponseBytes < maximumCanonicalRaceBytes
  ) {
    measurementError("bounded provider measurement did not reconcile");
  }

  const projectedR2PayloadBytesCeiling = safeMultiply(
    maximumCanonicalRaceBytes,
    expectedUnresolvedRaceCount,
    "projected R2 payload byte ceiling",
  );
  const projectedR2StorageBytesIncludingCurrentUsage = safeAdd(
    currentR2StorageBytes,
    projectedR2PayloadBytesCeiling,
    "projected R2 storage",
  );

  return Object.freeze({
    authority: Object.freeze({
      unresolvedRaceCount: expectedUnresolvedRaceCount,
      unresolvedRaceSetSha256: expectedUnresolvedRaceSetSha256,
      selectedRaceCount: selectedRaceIds.length,
    }),
    providerRequestCount,
    returnedRowCount: hydration.documents.length,
    canonicalResponseBytes,
    maximumCanonicalRaceBytes,
    projectedR2PayloadBytesCeiling,
    projectedR2PayloadFitsZeroCostStorageBudget:
      projectedR2StorageBytesIncludingCurrentUsage <=
      DNA_OPEN_LAB_ZERO_COST_R2_BUDGETS.storageBytes,
    capacity: Object.freeze({
      currentR2StorageBytes,
      r2StorageHeadroomBytes:
        DNA_OPEN_LAB_ZERO_COST_R2_BUDGETS.storageBytes - currentR2StorageBytes,
      currentNeonStorageBytes,
      neonStorageHeadroomBytes:
        DNA_OPEN_LAB_ZERO_COST_NEON_BUDGETS.storageBytes -
        currentNeonStorageBytes,
      currentNeonComputeMilliCuHours,
      neonComputeHeadroomMilliCuHours:
        DNA_OPEN_LAB_ZERO_COST_NEON_BUDGETS.computeMilliCuHours -
        currentNeonComputeMilliCuHours,
    }),
    aggregateRequestsPerMinute: DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
    persistentWritePerformed: false,
    providerWritePerformed: false,
    paidUsageAllowed: false,
    persistentCollectionAllowed: false,
  });
}
