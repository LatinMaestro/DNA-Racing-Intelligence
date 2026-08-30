import type { ProbeMode } from "./discovery-probe-plan";
import type { BreederOffspringOutcome, BreederScope } from "./breeder-quality";

export const offspringCreationAuthorities = [
  "authoritative_minted_at",
  "first_race_proxy",
  "unknown",
] as const;
export type OffspringCreationAuthority =
  (typeof offspringCreationAuthorities)[number];

export type BreedingOffspringEvidence = Readonly<{
  parentCoreId: string;
  coParentCoreId: string;
  offspringCoreId: string;
  mode: ProbeMode;
  distanceMetres: number | null;
  offspringQualityPercentile: number;
  expectedQualityPercentile: number;
  residualPercentile: number;
  offspringRaceSampleSize: number;
  benchmarkPopulationSize: number;
  creationAuthority: OffspringCreationAuthority;
  offspringCreatedAt: string | null;
  expectedModelCutoff: string;
  evaluationCutoff: string;
  source: string;
}>;

export type BreedingOffspringEvidenceAssessment = Readonly<{
  evidence: BreedingOffspringEvidence;
  usableForEliteBreederTarget: boolean;
  warnings: readonly string[];
}>;

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized === "") throw new Error(`${label} is required.`);
  return normalized;
}

function canonicalTimestamp(value: string, label: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${label} must be a canonical timestamp.`);
  }
  return value;
}

function percent(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`${label} must be between 0 and 100.`);
  }
  return value;
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  return value;
}

export function assessBreedingOffspringEvidence(
  evidence: BreedingOffspringEvidence,
): BreedingOffspringEvidenceAssessment {
  required(evidence.parentCoreId, "Parent Core ID");
  required(evidence.coParentCoreId, "Co-parent Core ID");
  required(evidence.offspringCoreId, "Offspring Core ID");
  required(evidence.source, "Offspring evidence source");
  if (evidence.parentCoreId === evidence.coParentCoreId) {
    throw new Error("Parent and co-parent Core IDs must differ.");
  }
  if (!offspringCreationAuthorities.includes(evidence.creationAuthority)) {
    throw new Error("Offspring creation authority is invalid.");
  }
  if (evidence.distanceMetres !== null) {
    if (!Number.isSafeInteger(evidence.distanceMetres) || evidence.distanceMetres <= 0) {
      throw new Error("Offspring evidence distance must be a positive safe integer.");
    }
  }
  percent(evidence.offspringQualityPercentile, "Offspring quality percentile");
  percent(evidence.expectedQualityPercentile, "Expected quality percentile");
  percent(evidence.residualPercentile, "Residual percentile");
  nonNegativeInteger(evidence.offspringRaceSampleSize, "Offspring race sample size");
  nonNegativeInteger(evidence.benchmarkPopulationSize, "Benchmark population size");
  const expectedModelCutoff = canonicalTimestamp(
    evidence.expectedModelCutoff,
    "Expected-model cutoff",
  );
  canonicalTimestamp(evidence.evaluationCutoff, "Evaluation cutoff");

  const warnings: string[] = [];
  let usableForEliteBreederTarget = false;
  if (evidence.creationAuthority === "authoritative_minted_at") {
    if (evidence.offspringCreatedAt === null) {
      throw new Error("Authoritative minted-at evidence requires offspringCreatedAt.");
    }
    const createdAt = canonicalTimestamp(
      evidence.offspringCreatedAt,
      "Offspring creation time",
    );
    if (Date.parse(expectedModelCutoff) > Date.parse(createdAt)) {
      throw new Error(
        "Expected mating baseline must be frozen no later than authoritative offspring creation.",
      );
    }
    usableForEliteBreederTarget = true;
  } else if (evidence.creationAuthority === "first_race_proxy") {
    warnings.push("FIRST_RACE_IS_NOT_AUTHORITATIVE_CREATION_TIME");
    warnings.push("PROXY_EVIDENCE_CANNOT_PROMOTE_ELITE_BREEDER_TARGET");
    if (evidence.offspringCreatedAt === null) {
      throw new Error("First-race proxy evidence requires the proxy timestamp.");
    }
    canonicalTimestamp(evidence.offspringCreatedAt, "First-race proxy time");
  } else {
    warnings.push("OFFSPRING_CREATION_TIME_UNKNOWN");
    warnings.push("EVIDENCE_CANNOT_PROMOTE_ELITE_BREEDER_TARGET");
  }

  return Object.freeze({
    evidence,
    usableForEliteBreederTarget,
    warnings: Object.freeze(warnings),
  });
}

export function toAuthoritativeBreederOutcome(
  evidence: BreedingOffspringEvidence,
): BreederOffspringOutcome | null {
  const assessment = assessBreedingOffspringEvidence(evidence);
  if (!assessment.usableForEliteBreederTarget || evidence.offspringCreatedAt === null) {
    return null;
  }
  const scope: BreederScope = Object.freeze({
    mode: evidence.mode,
    distanceMetres: evidence.distanceMetres,
  });
  return Object.freeze({
    parentCoreId: evidence.parentCoreId,
    coParentCoreId: evidence.coParentCoreId,
    offspringCoreId: evidence.offspringCoreId,
    scope,
    offspringQualityPercentile: evidence.offspringQualityPercentile,
    expectedQualityPercentile: evidence.expectedQualityPercentile,
    residualPercentile: evidence.residualPercentile,
    offspringRaceSampleSize: evidence.offspringRaceSampleSize,
    benchmarkPopulationSize: evidence.benchmarkPopulationSize,
    offspringCreatedAt: evidence.offspringCreatedAt,
    expectedModelCutoff: evidence.expectedModelCutoff,
    evaluationCutoff: evidence.evaluationCutoff,
  });
}
