export const DNA_POPULATION_ENTRANT_AUTHORITY_CHECKPOINT_RELATIONS =
  Object.freeze([
    "dna_population_entrant_authority_generation",
    "dna_population_entrant_authority_chunk",
  ] as const);

export const DNA_POPULATION_ENTRANT_AUTHORITY_CHECKPOINT_FUNCTIONS =
  Object.freeze([
    "dna.begin_dna_population_entrant_authority_generation(uuid,jsonb,timestamp with time zone)",
    "dna.register_dna_population_entrant_authority_chunk(uuid,text,jsonb,timestamp with time zone)",
    "dna.read_dna_population_entrant_authority_generation(uuid,text)",
    "dna.read_dna_population_entrant_authority_chunk_manifests(uuid,text,integer,integer)",
    "dna.reject_dna_population_entrant_authority_chunk_mutation()",
  ] as const);

export type DnaPopulationEntrantAuthorityCheckpointReadinessDiagnostic =
  | "ready"
  | "schema_unavailable"
  | "owner_scope_unavailable"
  | "runtime_contract_unavailable";

export type DnaPopulationEntrantAuthorityCheckpointReadiness = Readonly<{
  status: "ready" | "unavailable";
  diagnostic: DnaPopulationEntrantAuthorityCheckpointReadinessDiagnostic;
  schemaReady: boolean;
  ownerScopeReady: boolean;
  runtimeContractReady: boolean;
  previewOnly: true;
  checkpointMutationPerformed: false;
  persistentWritePerformed: false;
}>;

function count(value: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new Error("checkpoint readiness count is invalid");
  }
  return value;
}

/**
 * Reduces a read-only hosted Postgres probe to a deliberately small,
 * non-sensitive commissioning diagnostic. It never accepts row identities,
 * object keys, provider payloads or credentials.
 */
export function assessDnaPopulationEntrantAuthorityCheckpointReadiness(input: {
  ownerBindingValid: boolean;
  ownerScopeValid: boolean;
  runtimeLeastPrivilegeValid: boolean;
  presentRelationCount: number;
  rlsProtectedRelationCount: number;
  presentFunctionCount: number;
  executableFunctionCount: number;
  runtimeDirectTableAccessCount: number;
}): DnaPopulationEntrantAuthorityCheckpointReadiness {
  const requiredRelations =
    DNA_POPULATION_ENTRANT_AUTHORITY_CHECKPOINT_RELATIONS.length;
  const requiredFunctions =
    DNA_POPULATION_ENTRANT_AUTHORITY_CHECKPOINT_FUNCTIONS.length;
  const presentRelationCount = count(
    input.presentRelationCount,
    requiredRelations,
  );
  const rlsProtectedRelationCount = count(
    input.rlsProtectedRelationCount,
    requiredRelations,
  );
  const presentFunctionCount = count(
    input.presentFunctionCount,
    requiredFunctions,
  );
  const executableFunctionCount = count(
    input.executableFunctionCount,
    requiredFunctions,
  );
  const runtimeDirectTableAccessCount = count(
    input.runtimeDirectTableAccessCount,
    requiredRelations,
  );

  const schemaReady =
    presentRelationCount === requiredRelations &&
    rlsProtectedRelationCount === requiredRelations &&
    presentFunctionCount === requiredFunctions;
  const ownerScopeReady =
    input.ownerBindingValid === true && input.ownerScopeValid === true;
  const runtimeContractReady =
    input.runtimeLeastPrivilegeValid === true &&
    executableFunctionCount === requiredFunctions - 1 &&
    runtimeDirectTableAccessCount === 0;

  const diagnostic: DnaPopulationEntrantAuthorityCheckpointReadinessDiagnostic =
    !schemaReady
      ? "schema_unavailable"
      : !ownerScopeReady
        ? "owner_scope_unavailable"
        : !runtimeContractReady
          ? "runtime_contract_unavailable"
          : "ready";

  return Object.freeze({
    status: diagnostic === "ready" ? "ready" : "unavailable",
    diagnostic,
    schemaReady,
    ownerScopeReady,
    runtimeContractReady,
    previewOnly: true as const,
    checkpointMutationPerformed: false as const,
    persistentWritePerformed: false as const,
  });
}
