import {
  RACE_MERGE_CORE_OUTCOME_R2_COHORT_MAXIMUM_BYTES,
  RACE_MERGE_CORE_OUTCOME_R2_COHORT_MAXIMUM_CORES,
  RACE_MERGE_CORE_OUTCOME_R2_GENERATION_VERSION,
  type RaceMergeCoreOutcomeR2CapacityGate,
  type RaceMergeCoreOutcomeR2GenerationAuthority,
} from "./race-merge-core-outcome-r2-generation";
import {
  DNA_OPEN_LAB_PROVIDER_CAPACITY_PREFLIGHT_INTENT,
  DNA_OPEN_LAB_PROVIDER_CAPACITY_PREFLIGHT_VERSION,
  createDnaOpenLabProviderCapacityPreflight,
  type DnaOpenLabProviderCapacityMeasurementSource,
  type DnaOpenLabProviderCapacityPreflight,
} from "./dna-open-lab-provider-capacity-preflight";
import {
  cloudflareNeonDnaOpenLabProviderCapacitySourceFromEnvironment,
  type CloudflareNeonDnaOpenLabProviderCapacityEnvironment,
} from "./cloudflare-neon-dna-open-lab-provider-capacity-source";
import { dnaOpenLabRawEvidenceSha256 } from "./dna-open-lab-v1-adapters";
import { DNA_OPEN_LAB_ZERO_COST_NEON_BUDGETS } from "./dna-open-lab-zero-cost-provider-capacity";
import { DNA_OPEN_LAB_ZERO_COST_R2_BUDGETS } from "./dna-open-lab-zero-cost-refresh-policy";

const GIT_OBJECT_ID_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;
const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;

/**
 * Conservative complete Neon allowance for one generation row, immutable
 * receipt rows, indexes and transaction overhead. Outcome bodies stay in R2.
 */
export const RACE_MERGE_CORE_OUTCOME_R2_CAPACITY_FIXED_NEON_BYTES = 16 * 1024;
export const RACE_MERGE_CORE_OUTCOME_R2_CAPACITY_NEON_BYTES_PER_CORE = 8 * 1024;
export const RACE_MERGE_CORE_OUTCOME_R2_CAPACITY_NEON_COMPUTE_MILLI_CU_HOURS = 2_000;

/**
 * One conditional object write plus a conservative four Class B operations
 * per Core cover write verification, reopen verification and exact replay.
 */
export const RACE_MERGE_CORE_OUTCOME_R2_CAPACITY_CLASS_A_PER_CORE = 1;
export const RACE_MERGE_CORE_OUTCOME_R2_CAPACITY_CLASS_B_PER_CORE = 4;

function fail(message: string): never {
  throw new Error(`Race Merge Core outcome R2 capacity gate: ${message}`);
}

function identity(value: string, field: string): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length < 1 ||
    value.length > 512 ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    fail(`${field} is invalid`);
  }
  return value;
}

function exactHead(value: string): string {
  const normalized = identity(value, "exact code head").toLowerCase();
  if (!GIT_OBJECT_ID_PATTERN.test(normalized)) {
    fail("exact code head is invalid");
  }
  return normalized;
}

function identifier(value: string, field: string): string {
  const normalized = identity(value, field);
  if (!SAFE_IDENTIFIER_PATTERN.test(normalized)) {
    fail(`${field} is invalid`);
  }
  return normalized;
}

function sha256(value: string, field: string): string {
  const normalized = identity(value, field).toLowerCase();
  if (!SHA_256_PATTERN.test(normalized)) {
    fail(`${field} is invalid`);
  }
  return normalized;
}

function positive(value: number, field: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    fail(`${field} is outside its bound`);
  }
  return value;
}

function checkedAuthority(
  value: RaceMergeCoreOutcomeR2GenerationAuthority,
): RaceMergeCoreOutcomeR2GenerationAuthority {
  const generationId = identifier(value.generationId, "generationId");
  const receiptSetSha256 = sha256(value.receiptSetSha256, "receiptSetSha256");
  const firstSourceCoreId = positive(
    value.firstSourceCoreId,
    "firstSourceCoreId",
    Number.MAX_SAFE_INTEGER,
  );
  const lastSourceCoreId = positive(
    value.lastSourceCoreId,
    "lastSourceCoreId",
    Number.MAX_SAFE_INTEGER,
  );
  const coreCount = positive(
    value.coreCount,
    "coreCount",
    RACE_MERGE_CORE_OUTCOME_R2_COHORT_MAXIMUM_CORES,
  );
  const uniqueOutcomeCount = positive(
    value.uniqueOutcomeCount,
    "uniqueOutcomeCount",
    Number.MAX_SAFE_INTEGER,
  );
  const sourceObservationCount = positive(
    value.sourceObservationCount,
    "sourceObservationCount",
    Number.MAX_SAFE_INTEGER,
  );
  if (
    value.version !== RACE_MERGE_CORE_OUTCOME_R2_GENERATION_VERSION ||
    lastSourceCoreId < firstSourceCoreId ||
    sourceObservationCount < uniqueOutcomeCount
  ) {
    fail("generation authority is inconsistent");
  }
  return Object.freeze({
    version: RACE_MERGE_CORE_OUTCOME_R2_GENERATION_VERSION,
    generationId,
    cohortOrdinal: positive(
      value.cohortOrdinal,
      "cohortOrdinal",
      Number.MAX_SAFE_INTEGER,
    ),
    firstSourceCoreId,
    lastSourceCoreId,
    coreCount,
    uniqueOutcomeCount,
    sourceObservationCount,
    retainedR2Bytes: positive(
      value.retainedR2Bytes,
      "retainedR2Bytes",
      RACE_MERGE_CORE_OUTCOME_R2_COHORT_MAXIMUM_BYTES,
    ),
    receiptSetSha256,
  });
}

function multiply(value: number, factor: number, field: string): number {
  const product = value * factor;
  if (!Number.isSafeInteger(product)) fail(`${field} is invalid`);
  return product;
}

function add(left: number, right: number, field: string): number {
  const sum = left + right;
  if (!Number.isSafeInteger(sum)) fail(`${field} is invalid`);
  return sum;
}

/**
 * Binds one exact compact Core-outcome cohort to a fresh read-only provider
 * measurement. The gate performs no R2, Neon or DNA write. It reserves the
 * exact retained R2 bytes and conservative complete operation/manifest costs,
 * failing closed whenever either provider would leave its A$0 operating cap.
 */
export function createRaceMergeCoreOutcomeR2CapacityGate(
  input: Readonly<{
    configuredOwnerId: string;
    exactCodeHeadSha: string;
    preflight: DnaOpenLabProviderCapacityPreflight;
  }>,
): RaceMergeCoreOutcomeR2CapacityGate {
  const ownerId = identity(input.configuredOwnerId, "ownerId");
  const exactCodeHeadSha = exactHead(input.exactCodeHeadSha);

  return Object.freeze({
    async assertFreshCurrentCapacity(requestedAuthority) {
      const authority = checkedAuthority(requestedAuthority);
      const refreshCycleId = dnaOpenLabRawEvidenceSha256({
        domain: "race-merge-core-outcome-r2-capacity-cycle/v1",
        ownerId,
        exactCodeHeadSha,
        authority,
      });
      const budgetWindowId = dnaOpenLabRawEvidenceSha256({
        domain: "race-merge-core-outcome-r2-capacity-budget/v1",
        ownerId,
        exactCodeHeadSha,
        generationId: authority.generationId,
        cohortOrdinal: authority.cohortOrdinal,
        receiptSetSha256: authority.receiptSetSha256,
      });
      const plannedNeonStorageBytes = add(
        RACE_MERGE_CORE_OUTCOME_R2_CAPACITY_FIXED_NEON_BYTES,
        multiply(
          authority.coreCount,
          RACE_MERGE_CORE_OUTCOME_R2_CAPACITY_NEON_BYTES_PER_CORE,
          "planned Neon manifest bytes",
        ),
        "planned Neon storage bytes",
      );
      const receipt = await input.preflight.inspect({
        preflightVersion: DNA_OPEN_LAB_PROVIDER_CAPACITY_PREFLIGHT_VERSION,
        intent: DNA_OPEN_LAB_PROVIDER_CAPACITY_PREFLIGHT_INTENT,
        authenticatedOwnerId: ownerId,
        exactCodeHeadSha,
        refreshCycleId,
        budgetWindowId,
        projectionHorizon: "single_refresh",
        plannedR2UsagePerRefresh: {
          storageBytes: authority.retainedR2Bytes,
          classAOperations: multiply(
            authority.coreCount,
            RACE_MERGE_CORE_OUTCOME_R2_CAPACITY_CLASS_A_PER_CORE,
            "planned R2 Class A operations",
          ),
          classBOperations: multiply(
            authority.coreCount,
            RACE_MERGE_CORE_OUTCOME_R2_CAPACITY_CLASS_B_PER_CORE,
            "planned R2 Class B operations",
          ),
        },
        plannedNeonUsagePerRefresh: {
          storageBytes: plannedNeonStorageBytes,
          computeMilliCuHours:
            RACE_MERGE_CORE_OUTCOME_R2_CAPACITY_NEON_COMPUTE_MILLI_CU_HOURS,
        },
      });
      if (receipt.status !== "ready") {
        fail(`capacity held: ${receipt.reason}`);
      }
      if (
        receipt.exactCodeHeadSha !== exactCodeHeadSha ||
        receipt.refreshCycleId !== refreshCycleId ||
        receipt.budgetWindowId !== budgetWindowId ||
        receipt.readyForRefresh !== true ||
        receipt.persistentWritePerformed !== false ||
        receipt.providerWritePerformed !== false ||
        receipt.paidUsageAllowed !== false ||
        receipt.preserveLastGood !== true ||
        receipt.projection.projectedR2Usage.storageBytes >
          DNA_OPEN_LAB_ZERO_COST_R2_BUDGETS.storageBytes ||
        receipt.projection.projectedNeonUsage.storageBytes >
          DNA_OPEN_LAB_ZERO_COST_NEON_BUDGETS.storageBytes
      ) {
        fail("provider capacity authority drifted");
      }
      return Object.freeze({
        version: 1 as const,
        generationId: authority.generationId,
        cohortOrdinal: authority.cohortOrdinal,
        receiptSetSha256: authority.receiptSetSha256,
        retainedR2Bytes: authority.retainedR2Bytes,
        measuredAt: receipt.checkedAt,
        validUntil: receipt.validUntil,
        capacityAllowed: true as const,
        projectedPaidCostAud: 0 as const,
      });
    },
  });
}

export type RaceMergeCoreOutcomeR2CapacityGateEnvironment =
  CloudflareNeonDnaOpenLabProviderCapacityEnvironment &
    Readonly<{ exactCodeHeadSha?: string }>;

/**
 * Connected fail-closed composition used by the private generation runtime.
 * It only exposes a gate when all provider measurement configuration and the
 * exact code head are present. Construction itself performs no provider call.
 */
export function raceMergeCoreOutcomeR2CapacityGateFromEnvironment(
  environment: RaceMergeCoreOutcomeR2CapacityGateEnvironment,
  dependencies: Readonly<{
    now?: () => Date;
    fetch?: typeof globalThis.fetch;
    measurementSource?: DnaOpenLabProviderCapacityMeasurementSource;
  }> = {},
):
  | Readonly<{ status: "not_configured" }>
  | Readonly<{ status: "ready"; gate: RaceMergeCoreOutcomeR2CapacityGate }> {
  const ownerId = environment.authorizedOwnerId?.trim();
  const codeHead = environment.exactCodeHeadSha?.trim();
  if (!ownerId || !codeHead) {
    return Object.freeze({ status: "not_configured" as const });
  }
  const measurementSource =
    dependencies.measurementSource ??
    cloudflareNeonDnaOpenLabProviderCapacitySourceFromEnvironment(environment, {
      ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
      ...(dependencies.fetch === undefined
        ? {}
        : { fetch: dependencies.fetch }),
    });
  if (measurementSource.status !== "ready") {
    return Object.freeze({ status: "not_configured" as const });
  }
  try {
    return Object.freeze({
      status: "ready" as const,
      gate: createRaceMergeCoreOutcomeR2CapacityGate({
        configuredOwnerId: ownerId,
        exactCodeHeadSha: codeHead,
        preflight: createDnaOpenLabProviderCapacityPreflight({
          configuredOwnerId: ownerId,
          measurementSource,
          ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
        }),
      }),
    });
  } catch {
    return Object.freeze({ status: "not_configured" as const });
  }
}
