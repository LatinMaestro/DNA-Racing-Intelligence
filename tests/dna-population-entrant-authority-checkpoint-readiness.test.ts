import { describe, expect, it } from "vitest";

import { assessDnaPopulationEntrantAuthorityCheckpointReadiness } from "@/lib/dna-population-entrant-authority-checkpoint-readiness";

const readyInput = Object.freeze({
  ownerBindingValid: true,
  ownerScopeValid: true,
  runtimeLeastPrivilegeValid: true,
  presentRelationCount: 2,
  rlsProtectedRelationCount: 2,
  presentFunctionCount: 5,
  executableFunctionCount: 4,
  runtimeDirectTableAccessCount: 0,
});

describe("DNA population entrant checkpoint readiness", () => {
  it("accepts the complete read-only hosted contract", () => {
    expect(
      assessDnaPopulationEntrantAuthorityCheckpointReadiness(readyInput),
    ).toEqual({
      status: "ready",
      diagnostic: "ready",
      schemaReady: true,
      ownerScopeReady: true,
      runtimeContractReady: true,
      previewOnly: true,
      checkpointMutationPerformed: false,
      persistentWritePerformed: false,
    });
  });

  it("reports an absent or partial checkpoint migration first", () => {
    expect(
      assessDnaPopulationEntrantAuthorityCheckpointReadiness({
        ...readyInput,
        presentFunctionCount: 0,
        presentRelationCount: 0,
        rlsProtectedRelationCount: 0,
      }).diagnostic,
    ).toBe("schema_unavailable");
  });

  it("separates owner scope from runtime privilege failures", () => {
    expect(
      assessDnaPopulationEntrantAuthorityCheckpointReadiness({
        ...readyInput,
        ownerScopeValid: false,
      }).diagnostic,
    ).toBe("owner_scope_unavailable");
    expect(
      assessDnaPopulationEntrantAuthorityCheckpointReadiness({
        ...readyInput,
        executableFunctionCount: 3,
      }).diagnostic,
    ).toBe("runtime_contract_unavailable");
  });

  it("rejects impossible probe counters", () => {
    expect(() =>
      assessDnaPopulationEntrantAuthorityCheckpointReadiness({
        ...readyInput,
        presentRelationCount: 3,
      }),
    ).toThrow("checkpoint readiness count is invalid");
  });
});
