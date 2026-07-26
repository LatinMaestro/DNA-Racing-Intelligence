"use server";

import type { BreedingEconomicEvidenceInput } from "@/domain/breeding-economic-evidence";
import type { OffspringCostBasisInput } from "@/domain/offspring-cost-basis";
import {
  assignOffspringCostBasis,
  recordBreedingEconomicEvidence,
  unavailableBreedingEconomicWriteRepository,
} from "@/lib/breeding-economic-write-service";
import { authenticatedClerkOwnerId } from "@/lib/clerk-owner-session";

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
