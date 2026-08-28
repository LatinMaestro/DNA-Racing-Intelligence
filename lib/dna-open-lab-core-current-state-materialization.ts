import {
  inspectDnaCurrentStateCandidate,
  type DnaCurrentStateCandidate,
} from "./dna-open-lab-last-good-publication";
import type {
  CanonicalCoreAttachedAssetsSnapshot,
  CanonicalCoreListingSnapshot,
  CanonicalCoreOwnerSnapshot,
  CanonicalCorePowerSnapshot,
  CanonicalCoreRacingStatsSnapshot,
  CanonicalCoreSplicingSnapshot,
  CanonicalCoreStaminaSnapshot,
  DnaOpenLabEvidence,
} from "./dna-open-lab-v1-adapters";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

type SupplementalCoreSnapshot =
  | CanonicalCoreRacingStatsSnapshot
  | CanonicalCorePowerSnapshot
  | CanonicalCoreListingSnapshot
  | CanonicalCoreAttachedAssetsSnapshot
  | CanonicalCoreOwnerSnapshot
  | CanonicalCoreStaminaSnapshot
  | CanonicalCoreSplicingSnapshot;

export type DnaSupplementalCoreMaterializationRow<
  T extends SupplementalCoreSnapshot,
> = Readonly<{
  sourceCoreId: string;
  observedAt: string;
  rawEvidenceSha256: string;
  canonical: T;
}>;

export type DnaSupplementalCoreMaterialization = Readonly<{
  generationId: string;
  generationObservedAt: string;
  sourceCoreIds: readonly string[];
  racingStats: readonly DnaSupplementalCoreMaterializationRow<CanonicalCoreRacingStatsSnapshot>[];
  power: readonly DnaSupplementalCoreMaterializationRow<CanonicalCorePowerSnapshot>[];
  listings: readonly DnaSupplementalCoreMaterializationRow<CanonicalCoreListingSnapshot>[];
  attachedAssets: readonly DnaSupplementalCoreMaterializationRow<CanonicalCoreAttachedAssetsSnapshot>[];
  owners: readonly DnaSupplementalCoreMaterializationRow<CanonicalCoreOwnerSnapshot>[];
  stamina: readonly DnaSupplementalCoreMaterializationRow<CanonicalCoreStaminaSnapshot>[];
  splicing: readonly DnaSupplementalCoreMaterializationRow<CanonicalCoreSplicingSnapshot>[];
}>;

function materializationError(message: string): never {
  throw new Error(`DNA Open Lab supplemental Core materialization: ${message}`);
}

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 512) {
    materializationError(`${field} is invalid`);
  }
  return normalized;
}

function positiveSafeIntegerText(value: string, field: string): string {
  const normalized = requiredText(value, field);
  const parsed = Number(normalized);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 1 ||
    String(parsed) !== normalized
  ) {
    materializationError(`${field} must be a canonical positive integer`);
  }
  return normalized;
}

function timestamp(value: string, field: string): string {
  const normalized = requiredText(value, field);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      normalized,
    )
  ) {
    materializationError(`${field} must be timezone-qualified`);
  }
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    materializationError(`${field} is invalid`);
  }
  return parsed.toISOString();
}

function checksum(value: string, field: string): string {
  if (!SHA256_PATTERN.test(value)) {
    materializationError(`${field} must be a lowercase SHA-256 value`);
  }
  return value;
}

function expectedCoreIds(input: {
  sourceCoreIds: readonly string[];
  expectedCount: number;
}): readonly string[] {
  if (input.sourceCoreIds.length !== input.expectedCount) {
    materializationError(
      "owned Core IDs must match the complete Core family receipt",
    );
  }
  const normalized = input.sourceCoreIds
    .map((sourceCoreId) =>
      positiveSafeIntegerText(sourceCoreId, "sourceCoreId"),
    )
    .sort((left, right) => Number(left) - Number(right));
  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index - 1] === normalized[index]) {
      materializationError("owned Core IDs must be unique");
    }
  }
  return Object.freeze(normalized);
}

function familyRows<T extends SupplementalCoreSnapshot>(input: {
  family: string;
  endpoint: string;
  sourceType: T["sourceType"];
  expectedCoreIds: readonly string[];
  generationObservedAt: string;
  evidence: readonly DnaOpenLabEvidence<T>[];
}): readonly DnaSupplementalCoreMaterializationRow<T>[] {
  if (input.evidence.length !== input.expectedCoreIds.length) {
    materializationError(
      `${input.family} count must match the complete owned-Core set`,
    );
  }
  const rows = input.evidence
    .map((entry) => {
      if (
        entry.source !== "dna_open_lab" ||
        entry.sourceVersion !== "v1" ||
        entry.scope !== "cores" ||
        entry.endpoint !== input.endpoint ||
        entry.canonical.sourceType !== input.sourceType
      ) {
        materializationError(`${input.family} evidence authority is invalid`);
      }
      const sourceCoreId = positiveSafeIntegerText(
        entry.canonical.sourceCoreId,
        `${input.family}.sourceCoreId`,
      );
      if (entry.entityKey !== `core:${sourceCoreId}`) {
        materializationError(`${input.family} entity key is invalid`);
      }
      const observedAt = timestamp(
        entry.observedAt,
        `${input.family}.observedAt`,
      );
      if (Date.parse(observedAt) > Date.parse(input.generationObservedAt)) {
        materializationError(
          `${input.family} observation cannot follow its generation`,
        );
      }
      return Object.freeze({
        sourceCoreId,
        observedAt,
        rawEvidenceSha256: checksum(
          entry.rawEvidenceSha256,
          `${input.family}.rawEvidenceSha256`,
        ),
        canonical: entry.canonical,
      });
    })
    .sort(
      (left, right) => Number(left.sourceCoreId) - Number(right.sourceCoreId),
    );

  for (let index = 0; index < rows.length; index += 1) {
    if (rows[index]!.sourceCoreId !== input.expectedCoreIds[index]) {
      materializationError(
        `${input.family} must cover every owned Core exactly once`,
      );
    }
  }
  return Object.freeze(rows);
}

/**
 * Produces one deterministic generation-bound payload for all connected
 * supplemental Core families. A missing, duplicate, extra, late or wrongly
 * sourced observation rejects the entire payload, so a persistence transaction
 * cannot publish a partially refreshed Core state.
 */
export function createDnaSupplementalCoreMaterialization(input: {
  candidate: DnaCurrentStateCandidate;
  sourceCoreIds: readonly string[];
  racingStats: readonly DnaOpenLabEvidence<CanonicalCoreRacingStatsSnapshot>[];
  power: readonly DnaOpenLabEvidence<CanonicalCorePowerSnapshot>[];
  listings: readonly DnaOpenLabEvidence<CanonicalCoreListingSnapshot>[];
  attachedAssets: readonly DnaOpenLabEvidence<CanonicalCoreAttachedAssetsSnapshot>[];
  owners: readonly DnaOpenLabEvidence<CanonicalCoreOwnerSnapshot>[];
  stamina: readonly DnaOpenLabEvidence<CanonicalCoreStaminaSnapshot>[];
  splicing: readonly DnaOpenLabEvidence<CanonicalCoreSplicingSnapshot>[];
}): DnaSupplementalCoreMaterialization {
  const readiness = inspectDnaCurrentStateCandidate(input.candidate);
  if (!readiness.ready) {
    materializationError(
      `generation is incomplete: ${readiness.incompleteFamilies.join(", ")}`,
    );
  }
  const generationId = requiredText(
    input.candidate.generationId,
    "generationId",
  );
  const generationObservedAt = timestamp(
    input.candidate.observedAt,
    "generationObservedAt",
  );
  const sourceCoreIds = expectedCoreIds({
    sourceCoreIds: input.sourceCoreIds,
    expectedCount: input.candidate.families.cores.itemCount,
  });

  return Object.freeze({
    generationId,
    generationObservedAt,
    sourceCoreIds,
    racingStats: familyRows({
      family: "racing-stats",
      endpoint: "cores.racing_stats",
      sourceType: "core_racing_stats_snapshot",
      expectedCoreIds: sourceCoreIds,
      generationObservedAt,
      evidence: input.racingStats,
    }),
    power: familyRows({
      family: "power",
      endpoint: "cores.power",
      sourceType: "core_power_snapshot",
      expectedCoreIds: sourceCoreIds,
      generationObservedAt,
      evidence: input.power,
    }),
    listings: familyRows({
      family: "listing",
      endpoint: "cores.listing_price",
      sourceType: "core_listing_snapshot",
      expectedCoreIds: sourceCoreIds,
      generationObservedAt,
      evidence: input.listings,
    }),
    attachedAssets: familyRows({
      family: "attached-assets",
      endpoint: "cores.attached_assets",
      sourceType: "core_attached_assets_snapshot",
      expectedCoreIds: sourceCoreIds,
      generationObservedAt,
      evidence: input.attachedAssets,
    }),
    owners: familyRows({
      family: "owner",
      endpoint: "cores.owner",
      sourceType: "core_owner_snapshot",
      expectedCoreIds: sourceCoreIds,
      generationObservedAt,
      evidence: input.owners,
    }),
    stamina: familyRows({
      family: "stamina",
      endpoint: "cores.stamina",
      sourceType: "core_stamina_snapshot",
      expectedCoreIds: sourceCoreIds,
      generationObservedAt,
      evidence: input.stamina,
    }),
    splicing: familyRows({
      family: "splicing",
      endpoint: "cores.splicing_info",
      sourceType: "core_splicing_snapshot",
      expectedCoreIds: sourceCoreIds,
      generationObservedAt,
      evidence: input.splicing,
    }),
  });
}
