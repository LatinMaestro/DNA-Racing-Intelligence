"use server";

import type { BreedingEconomicEvidenceInput } from "@/domain/breeding-economic-evidence";
import type { OffspringCostBasisInput } from "@/domain/offspring-cost-basis";
import {
  assignOffspringCostBasis,
  recordBreedingEconomicEvidence,
  unavailableBreedingEconomicWriteRepository,
} from "@/lib/breeding-economic-write-service";
import {
  parseBreedingEconomicEvidenceFormData,
  parseOffspringCostBasisFormData,
} from "@/lib/breeding-economic-form-data";
import { authenticatedClerkOwnerId } from "@/lib/clerk-owner-session";
import {
  runEconomicFormAction,
  unavailableEconomicFormActionCapability,
} from "@/lib/economic-form-action-service";
import { runEconomicActionForFeedback } from "@/lib/economic-action-feedback-service";

type OffspringCostBasisRequest = Omit<
  OffspringCostBasisInput,
  "previouslyAssignedTransactionIds"
>;

async function authenticatedOwnerId(): Promise<string | null> {
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

export async function recordBreedingEconomicEvidenceAction(
  evidence: BreedingEconomicEvidenceInput,
) {
  return recordBreedingEconomicEvidence({
    authenticatedOwnerId: await authenticatedOwnerId(),
    configuredOwnerId: configuredOwnerId(),
    repository: unavailableBreedingEconomicWriteRepository,
    evidence,
  });
}

export async function recordBreedingEconomicEvidenceFeedbackAction(
  evidence: BreedingEconomicEvidenceInput,
) {
  return runEconomicActionForFeedback({
    operation: "breeding_evidence",
    execute: () => recordBreedingEconomicEvidenceAction(evidence),
  });
}

export async function recordBreedingEconomicEvidenceFormAction(
  formData: FormData,
) {
  return runEconomicFormAction({
    operation: "breeding_evidence",
    authenticatedOwnerId: await authenticatedOwnerId(),
    configuredOwnerId: configuredOwnerId(),
    formData,
    capability: unavailableEconomicFormActionCapability,
    parse: parseBreedingEconomicEvidenceFormData,
  });
}

export async function assignOffspringCostBasisAction(
  assignment: OffspringCostBasisRequest,
) {
  return assignOffspringCostBasis({
    authenticatedOwnerId: await authenticatedOwnerId(),
    configuredOwnerId: configuredOwnerId(),
    repository: unavailableBreedingEconomicWriteRepository,
    assignment,
  });
}

export async function assignOffspringCostBasisFeedbackAction(
  assignment: OffspringCostBasisRequest,
) {
  return runEconomicActionForFeedback({
    operation: "offspring_cost_basis",
    execute: () => assignOffspringCostBasisAction(assignment),
  });
}

export async function assignOffspringCostBasisFormAction(formData: FormData) {
  return runEconomicFormAction({
    operation: "offspring_cost_basis",
    authenticatedOwnerId: await authenticatedOwnerId(),
    configuredOwnerId: configuredOwnerId(),
    formData,
    capability: unavailableEconomicFormActionCapability,
    parse: parseOffspringCostBasisFormData,
  });
}
