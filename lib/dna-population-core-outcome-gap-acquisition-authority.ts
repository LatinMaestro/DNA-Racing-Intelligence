import { createHash } from "node:crypto";

import { dnaCoreRaceHistoryCoreSetSha256 } from "./dna-core-race-history-acquisition-cycle";
import { dnaOpenLabRawEvidenceSha256 } from "./dna-open-lab-v1-adapters";

const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;

export const DNA_POPULATION_CORE_OUTCOME_GAP_ACQUISITION_AUTHORITY_VERSION =
  "dna-population-core-outcome-gap-acquisition-authority/v1" as const;

export type DnaPopulationCoreOutcomeGapAcquisitionAuthority = Readonly<{
  version: typeof DNA_POPULATION_CORE_OUTCOME_GAP_ACQUISITION_AUTHORITY_VERSION;
  generationId: string;
  evaluatedAt: string;
  apiGapCoreCount: number;
  apiGapCoreSetSha256: string;
  missingMembershipSetSha256: string;
  coreSetSha256: string;
  coreIds: readonly number[];
}>;

function fail(message: string): never {
  throw new Error(`DNA population Core outcome gap acquisition authority: ${message}`);
}

function sha256(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!SHA_256_PATTERN.test(normalized)) fail(`${field} is invalid`);
  return normalized;
}

function timestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    fail("evaluatedAt is invalid");
  }
  return parsed.toISOString();
}

function normalizedCoreIds(values: readonly number[]): readonly number[] {
  if (values.length < 1 || values.length > 100_000) {
    fail("Core count is outside its bound");
  }
  const normalized = [...values];
  let previous = 0;
  for (const value of normalized) {
    if (!Number.isSafeInteger(value) || value < 1 || value <= previous) {
      fail("Core IDs must be positive, unique, and strictly increasing");
    }
    previous = value;
  }
  return Object.freeze(normalized);
}

function deterministicGenerationId(gapCoreSetSha256: string): string {
  const digest = createHash("sha256")
    .update(
      `${DNA_POPULATION_CORE_OUTCOME_GAP_ACQUISITION_AUTHORITY_VERSION}\u0000${gapCoreSetSha256}`,
      "utf8",
    )
    .digest("hex");
  const value = digest.slice(0, 32).split("");
  value[12] = "5";
  value[16] = "8";
  const hex = value.join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

export function createDnaPopulationCoreOutcomeGapAcquisitionAuthority(input: {
  evaluatedAt: string;
  apiGapCoreIds: readonly number[];
  expectedApiGapCoreCount: number;
  expectedApiGapCoreSetSha256: string;
  expectedMissingMembershipSetSha256: string;
}): DnaPopulationCoreOutcomeGapAcquisitionAuthority {
  const coreIds = normalizedCoreIds(input.apiGapCoreIds);
  if (
    !Number.isSafeInteger(input.expectedApiGapCoreCount) ||
    input.expectedApiGapCoreCount < 1 ||
    coreIds.length !== input.expectedApiGapCoreCount
  ) {
    fail("Core count does not match the accepted exact-gap measurement");
  }
  const apiGapCoreSetSha256 = sha256(
    input.expectedApiGapCoreSetSha256,
    "apiGapCoreSetSha256",
  );
  const actualGapCoreSetSha256 = dnaOpenLabRawEvidenceSha256({
    domain: "dna-population-core-outcome-api-gap-core-set/v1",
    coreIds,
  });
  if (actualGapCoreSetSha256 !== apiGapCoreSetSha256) {
    fail("Core set does not match the accepted exact-gap measurement");
  }
  const missingMembershipSetSha256 = sha256(
    input.expectedMissingMembershipSetSha256,
    "missingMembershipSetSha256",
  );

  return Object.freeze({
    version: DNA_POPULATION_CORE_OUTCOME_GAP_ACQUISITION_AUTHORITY_VERSION,
    generationId: deterministicGenerationId(apiGapCoreSetSha256),
    evaluatedAt: timestamp(input.evaluatedAt),
    apiGapCoreCount: coreIds.length,
    apiGapCoreSetSha256,
    missingMembershipSetSha256,
    coreSetSha256: dnaCoreRaceHistoryCoreSetSha256(coreIds),
    coreIds,
  });
}
