import { describe, expect, it } from "vitest";

import {
  assessDnaOpenLabP5ProviderPrerequisites,
  DNA_OPEN_LAB_P5_PROVIDER_PREREQUISITE_IDS,
  DNA_OPEN_LAB_P5_REQUIRED_FUNCTION_SIGNATURES,
} from "@/lib/dna-open-lab-p5-provider-prerequisites";
import { DNA_OPEN_LAB_P5_OWNER_RELATION_NAMES } from "@/lib/neon-dna-open-lab-p5-capacity-port";

function completeObservation() {
  return {
    postgresMajorVersion: 18,
    ownerBindingValid: true,
    runtimeLeastPrivilegeValid: true,
    presentRelationCount: DNA_OPEN_LAB_P5_OWNER_RELATION_NAMES.length,
    presentFunctionCount: DNA_OPEN_LAB_P5_REQUIRED_FUNCTION_SIGNATURES.length,
    legacyPublishRevoked: true,
    r2Private: true,
    r2OwnerPrefixReadable: true,
    syntheticResidueObjectCount: 0,
  } as const;
}

describe("DNA Open Lab P5 provider prerequisites", () => {
  it("permits only the bounded synthetic measurement when every prerequisite passes", () => {
    expect(
      assessDnaOpenLabP5ProviderPrerequisites(completeObservation()),
    ).toEqual({
      schemaVersion: 1,
      providerScope: "private_preview",
      postgresMajorVersion: 18,
      requiredRelationCount: 15,
      presentRelationCount: 15,
      requiredFunctionCount: 14,
      presentFunctionCount: 14,
      blockerIds: [],
      readyForBoundedSyntheticMeasurement: true,
      firstPersistentPrivatePreviewSyncAllowed: false,
      productionChangesAllowed: false,
    });
  });

  it("reports every blocker without including provider or owner identities", () => {
    const report = assessDnaOpenLabP5ProviderPrerequisites({
      postgresMajorVersion: 17,
      ownerBindingValid: false,
      runtimeLeastPrivilegeValid: false,
      presentRelationCount: 0,
      presentFunctionCount: 0,
      legacyPublishRevoked: false,
      r2Private: false,
      r2OwnerPrefixReadable: false,
      syntheticResidueObjectCount: 1,
    });
    expect(report.blockerIds).toEqual(
      DNA_OPEN_LAB_P5_PROVIDER_PREREQUISITE_IDS,
    );
    expect(report.readyForBoundedSyntheticMeasurement).toBe(false);
    expect(JSON.stringify(report)).not.toMatch(
      /ownerId|database|bucket|objectKey|credential|secret/iu,
    );
  });

  it("rejects impossible or malformed provider counts", () => {
    expect(() =>
      assessDnaOpenLabP5ProviderPrerequisites({
        ...completeObservation(),
        presentRelationCount: 16,
      }),
    ).toThrow("count is invalid");
    expect(() =>
      assessDnaOpenLabP5ProviderPrerequisites({
        ...completeObservation(),
        syntheticResidueObjectCount: -1,
      }),
    ).toThrow("syntheticResidueObjectCount is invalid");
  });
});
