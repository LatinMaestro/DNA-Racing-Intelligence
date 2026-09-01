import { DNA_OPEN_LAB_P5_OWNER_RELATION_NAMES } from "./neon-dna-open-lab-p5-capacity-port";

export const DNA_OPEN_LAB_P5_REQUIRED_FUNCTION_SIGNATURES = Object.freeze([
  "dna.stage_dna_open_lab_token_splice_candidate(uuid,uuid,timestamp with time zone,timestamp with time zone,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)",
  "dna.save_dna_open_lab_current_state_evidence_index(uuid,uuid,jsonb,timestamp with time zone)",
  "dna.publish_dna_open_lab_indexed_sync_candidate(uuid,uuid,timestamp with time zone)",
  "dna.read_dna_open_lab_serving_current_state_evidence_index(uuid)",
  "dna.pause_dna_open_lab_sync(uuid,text,timestamp with time zone,integer)",
  "dna.read_dna_open_lab_sync_state(uuid)",
  "dna.read_dna_open_lab_serving_owned_cores(uuid)",
  "dna.read_dna_open_lab_serving_active_races(uuid)",
  "dna.read_dna_open_lab_serving_race_fills(uuid)",
  "dna.read_dna_open_lab_serving_supplemental_cores(uuid)",
  "dna.read_dna_open_lab_serving_token_prices(uuid)",
  "dna.read_dna_open_lab_serving_splice_arena_pages(uuid)",
  "dna.read_dna_open_lab_serving_splice_arena(uuid)",
  "dna.read_dna_open_lab_p5_recovery_fingerprints(uuid)",
] as const);

export const DNA_OPEN_LAB_P5_PROVIDER_PREREQUISITE_IDS = Object.freeze([
  "postgres_18",
  "owner_binding",
  "runtime_least_privilege",
  "api_schema_complete",
  "runtime_function_contract",
  "legacy_publish_revoked",
  "r2_private",
  "r2_owner_prefix_readable",
  "synthetic_residue_clear",
] as const);

export type DnaOpenLabP5ProviderPrerequisiteId =
  (typeof DNA_OPEN_LAB_P5_PROVIDER_PREREQUISITE_IDS)[number];

export type DnaOpenLabP5ProviderPrerequisiteObservation = Readonly<{
  postgresMajorVersion: number;
  ownerBindingValid: boolean;
  runtimeLeastPrivilegeValid: boolean;
  presentRelationCount: number;
  presentFunctionCount: number;
  legacyPublishRevoked: boolean;
  r2Private: boolean;
  r2OwnerPrefixReadable: boolean;
  syntheticResidueObjectCount: number;
}>;

export type DnaOpenLabP5ProviderPrerequisiteReport = Readonly<{
  schemaVersion: 1;
  providerScope: "private_preview";
  postgresMajorVersion: number;
  requiredRelationCount: number;
  presentRelationCount: number;
  requiredFunctionCount: number;
  presentFunctionCount: number;
  blockerIds: readonly DnaOpenLabP5ProviderPrerequisiteId[];
  readyForBoundedSyntheticMeasurement: boolean;
  firstPersistentPrivatePreviewSyncAllowed: false;
  productionChangesAllowed: false;
}>;

function nonNegativeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(
      `DNA Open Lab P5 provider prerequisite ${field} is invalid`,
    );
  }
  return value;
}

/**
 * Reduces connected provider observations to a bounded, identity-free report.
 * It can authorize only the rollback-only synthetic measurement. Persistent
 * Preview synchronization and every Production change remain prohibited.
 */
export function assessDnaOpenLabP5ProviderPrerequisites(
  observation: DnaOpenLabP5ProviderPrerequisiteObservation,
): DnaOpenLabP5ProviderPrerequisiteReport {
  const postgresMajorVersion = nonNegativeInteger(
    observation.postgresMajorVersion,
    "postgresMajorVersion",
  );
  const presentRelationCount = nonNegativeInteger(
    observation.presentRelationCount,
    "presentRelationCount",
  );
  const presentFunctionCount = nonNegativeInteger(
    observation.presentFunctionCount,
    "presentFunctionCount",
  );
  const syntheticResidueObjectCount = nonNegativeInteger(
    observation.syntheticResidueObjectCount,
    "syntheticResidueObjectCount",
  );
  const requiredRelationCount = DNA_OPEN_LAB_P5_OWNER_RELATION_NAMES.length;
  const requiredFunctionCount =
    DNA_OPEN_LAB_P5_REQUIRED_FUNCTION_SIGNATURES.length;
  if (
    presentRelationCount > requiredRelationCount ||
    presentFunctionCount > requiredFunctionCount
  ) {
    throw new Error("DNA Open Lab P5 provider prerequisite count is invalid");
  }

  const blockerIds: DnaOpenLabP5ProviderPrerequisiteId[] = [];
  if (postgresMajorVersion !== 18) blockerIds.push("postgres_18");
  if (observation.ownerBindingValid !== true) blockerIds.push("owner_binding");
  if (observation.runtimeLeastPrivilegeValid !== true) {
    blockerIds.push("runtime_least_privilege");
  }
  if (presentRelationCount !== requiredRelationCount) {
    blockerIds.push("api_schema_complete");
  }
  if (presentFunctionCount !== requiredFunctionCount) {
    blockerIds.push("runtime_function_contract");
  }
  if (observation.legacyPublishRevoked !== true) {
    blockerIds.push("legacy_publish_revoked");
  }
  if (observation.r2Private !== true) blockerIds.push("r2_private");
  if (observation.r2OwnerPrefixReadable !== true) {
    blockerIds.push("r2_owner_prefix_readable");
  }
  if (syntheticResidueObjectCount !== 0) {
    blockerIds.push("synthetic_residue_clear");
  }

  return Object.freeze({
    schemaVersion: 1 as const,
    providerScope: "private_preview" as const,
    postgresMajorVersion,
    requiredRelationCount,
    presentRelationCount,
    requiredFunctionCount,
    presentFunctionCount,
    blockerIds: Object.freeze(blockerIds),
    readyForBoundedSyntheticMeasurement: blockerIds.length === 0,
    firstPersistentPrivatePreviewSyncAllowed: false as const,
    productionChangesAllowed: false as const,
  });
}
