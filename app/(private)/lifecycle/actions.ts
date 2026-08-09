"use server";

import type { BurnCreditEvidence } from "@/domain/burn-credit-reconciliation";
import type { CoreBurnEventInput } from "@/domain/core-burn-event";
import type { CoreSaleEvidenceInput } from "@/domain/core-sale-evidence";
import { authenticatedClerkOwnerId } from "@/lib/clerk-owner-session";
import {
  recordBurnCreditEvidence,
  recordCoreBurnEvidence,
  recordCoreSaleEvidence,
  unavailableLifecycleEconomicAssetRegistry,
  unavailableLifecycleEconomicWriteRepository,
} from "@/lib/lifecycle-economic-write-service";

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

export async function recordCoreSaleEvidenceAction(
  input: Readonly<{
    sale: CoreSaleEvidenceInput;
    expectedAssetRegistryVersion: string;
    expectedLifecycleVersion: string;
  }>,
) {
  return recordCoreSaleEvidence({
    authenticatedOwnerId: await authenticatedOwnerId(),
    configuredOwnerId: configuredOwnerId(),
    repository: unavailableLifecycleEconomicWriteRepository,
    assetRegistry: unavailableLifecycleEconomicAssetRegistry,
    serverNow: serverNow(),
    sale: input.sale,
    expectedAssetRegistryVersion: input.expectedAssetRegistryVersion,
    expectedLifecycleVersion: input.expectedLifecycleVersion,
  });
}

export async function recordCoreBurnEvidenceAction(
  input: Readonly<{
    burn: CoreBurnEventInput;
    expectedLifecycleVersion: string;
  }>,
) {
  return recordCoreBurnEvidence({
    authenticatedOwnerId: await authenticatedOwnerId(),
    configuredOwnerId: configuredOwnerId(),
    repository: unavailableLifecycleEconomicWriteRepository,
    serverNow: serverNow(),
    burn: input.burn,
    expectedLifecycleVersion: input.expectedLifecycleVersion,
  });
}

export async function recordBurnCreditEvidenceAction(
  input: Readonly<{
    credit: BurnCreditEvidence;
    expectedAssetRegistryVersion: string;
    expectedLifecycleVersion: string;
  }>,
) {
  return recordBurnCreditEvidence({
    authenticatedOwnerId: await authenticatedOwnerId(),
    configuredOwnerId: configuredOwnerId(),
    repository: unavailableLifecycleEconomicWriteRepository,
    assetRegistry: unavailableLifecycleEconomicAssetRegistry,
    serverNow: serverNow(),
    credit: input.credit,
    expectedAssetRegistryVersion: input.expectedAssetRegistryVersion,
    expectedLifecycleVersion: input.expectedLifecycleVersion,
  });
}
