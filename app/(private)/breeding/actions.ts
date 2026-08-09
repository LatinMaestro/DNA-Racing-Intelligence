"use server";

import type { BreedingEconomicEvidenceInput } from "@/domain/breeding-economic-evidence";
import type { OffspringCostBasisInput } from "@/domain/offspring-cost-basis";
import {
  parseBreedingEconomicEvidenceFormData,
  parseOffspringCostBasisFormData,
} from "@/lib/breeding-economic-form-data";
import {
  assignOffspringCostBasis,
  recordBreedingEconomicEvidence,
  unavailableBreedingEconomicAssetRegistry,
  unavailableBreedingEconomicWriteRepository,
} from "@/lib/breeding-economic-write-service";
import { authenticatedClerkOwnerId } from "@/lib/clerk-owner-session";
import {
  runEconomicFormAction,
  unavailableEconomicFormActionCapability,
} from "@/lib/economic-form-action-service";

type OffspringCostBasisRequest = Omit<
  OffspringCostBasisInput,
  "previouslyAssignedTransactionIds"
>;

function authenticatedOwnerId(): Promise<string | null> {
  return authenticatedClerkOwnerId({
    environment: {
      publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
      secretKey: process.env.CLERK_SECRET_KEY,
    },
  });
}

function configuredOwnerId(): string | null {
  return process.env.AUTHORIZED_CLERK_USER_ID ?? null;
}

function serverNow(): string {
  return new Date().toISOString();
}

export async function recordBreedingEconomicEvidenceAction(
  input: Readonly<{
    evidence: BreedingEconomicEvidenceInput;
    expectedAssetRegistryVersion: string;
    expectedEconomicVersion: string;
  }>,
) {
  return recordBreedingEconomicEvidence({
    authenticatedOwnerId: await authenticatedOwnerId(),
    configuredOwnerId: configuredOwnerId(),
    repository: unavailableBreedingEconomicWriteRepository,
    assetRegistry: unavailableBreedingEconomicAssetRegistry,
    serverNow: serverNow(),
    evidence: input.evidence,
    expectedAssetRegistryVersion: input.expectedAssetRegistryVersion,
    expectedEconomicVersion: input.expectedEconomicVersion,
  });
}

export async function assignOffspringCostBasisAction(
  input: Readonly<{
    assignment: OffspringCostBasisRequest;
    expectedAssetRegistryVersion: string;
    expectedEconomicVersion: string;
  }>,
) {
  return assignOffspringCostBasis({
    authenticatedOwnerId: await authenticatedOwnerId(),
    configuredOwnerId: configuredOwnerId(),
    repository: unavailableBreedingEconomicWriteRepository,
    assetRegistry: unavailableBreedingEconomicAssetRegistry,
    serverNow: serverNow(),
    assignment: input.assignment,
    expectedAssetRegistryVersion: input.expectedAssetRegistryVersion,
    expectedEconomicVersion: input.expectedEconomicVersion,
  });
}

export async function recordBreedingEconomicEvidenceFormAction(
  formData: FormData,
) {
  return runEconomicFormAction({
    authenticatedOwnerId: await authenticatedOwnerId(),
    configuredOwnerId: configuredOwnerId(),
    formData,
    capability: unavailableEconomicFormActionCapability,
    parse: parseBreedingEconomicEvidenceFormData,
  });
}

export async function assignOffspringCostBasisFormAction(formData: FormData) {
  return runEconomicFormAction({
    authenticatedOwnerId: await authenticatedOwnerId(),
    configuredOwnerId: configuredOwnerId(),
    formData,
    capability: unavailableEconomicFormActionCapability,
    parse: parseOffspringCostBasisFormData,
  });
}
