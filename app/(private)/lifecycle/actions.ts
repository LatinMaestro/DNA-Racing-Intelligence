"use server";

import type { BurnCreditEvidence } from "@/domain/burn-credit-reconciliation";
import type { CoreBurnEventInput } from "@/domain/core-burn-event";
import type { CoreSaleEvidenceInput } from "@/domain/core-sale-evidence";
import { authenticatedClerkOwnerId } from "@/lib/clerk-owner-session";
import { runEconomicActionForFeedback } from "@/lib/economic-action-feedback-service";
import {
  recordActualBurnCredit,
  recordCoreBurnEvidence,
  recordCoreSaleEvidence,
  unavailableLifecycleEconomicWriteRepository,
} from "@/lib/lifecycle-economic-write-service";

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

export async function recordCoreSaleEvidenceAction(
  sale: CoreSaleEvidenceInput,
) {
  return recordCoreSaleEvidence({
    authenticatedOwnerId: await authenticatedOwnerId(),
    configuredOwnerId: configuredOwnerId(),
    repository: unavailableLifecycleEconomicWriteRepository,
    sale,
  });
}

export async function recordCoreSaleEvidenceFeedbackAction(
  sale: CoreSaleEvidenceInput,
) {
  return runEconomicActionForFeedback({
    operation: "core_sale",
    execute: () => recordCoreSaleEvidenceAction(sale),
  });
}

export async function recordCoreBurnEvidenceAction(burn: CoreBurnEventInput) {
  return recordCoreBurnEvidence({
    authenticatedOwnerId: await authenticatedOwnerId(),
    configuredOwnerId: configuredOwnerId(),
    repository: unavailableLifecycleEconomicWriteRepository,
    burn,
  });
}

export async function recordCoreBurnEvidenceFeedbackAction(
  burn: CoreBurnEventInput,
) {
  return runEconomicActionForFeedback({
    operation: "core_burn",
    execute: () => recordCoreBurnEvidenceAction(burn),
  });
}

export async function recordActualBurnCreditAction(credit: BurnCreditEvidence) {
  return recordActualBurnCredit({
    authenticatedOwnerId: await authenticatedOwnerId(),
    configuredOwnerId: configuredOwnerId(),
    repository: unavailableLifecycleEconomicWriteRepository,
    credit,
  });
}

export async function recordActualBurnCreditFeedbackAction(
  credit: BurnCreditEvidence,
) {
  return runEconomicActionForFeedback({
    operation: "burn_bgc_credit",
    execute: () => recordActualBurnCreditAction(credit),
  });
}
