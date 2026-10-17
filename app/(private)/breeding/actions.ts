"use server";

import { randomUUID } from "node:crypto";
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
import { neonBreedingEconomicPersistenceFromEnvironment } from "@/lib/neon-breeding-economic-write-repository";

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

function breedingPersistence() {
  return neonBreedingEconomicPersistenceFromEnvironment({
    databaseUrl: process.env.DATABASE_URL,
    databaseOwnerId: process.env.DNA_DATABASE_OWNER_ID,
    runtimeRole: process.env.DNA_DATABASE_RUNTIME_ROLE,
  });
}

function isConfiguredOwner(ownerId: string | null): ownerId is string {
  return ownerId !== null && ownerId === configuredOwnerId();
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
  const ownerId = await authenticatedOwnerId();
  const persistence = breedingPersistence();
  if (!isConfiguredOwner(ownerId) || persistence.status !== "ready") {
    return runEconomicFormAction({
      authenticatedOwnerId: ownerId,
      configuredOwnerId: configuredOwnerId(),
      formData,
      capability: unavailableEconomicFormActionCapability,
      parse: parseBreedingEconomicEvidenceFormData,
    });
  }
  let context: Awaited<ReturnType<typeof persistence.loadContextByOwner>>;
  try {
    context = await persistence.loadContextByOwner(ownerId);
  } catch {
    return runEconomicFormAction({
      authenticatedOwnerId: ownerId,
      configuredOwnerId: configuredOwnerId(),
      formData,
      capability: unavailableEconomicFormActionCapability,
      parse: parseBreedingEconomicEvidenceFormData,
    });
  }
  const now = new Date();
  return runEconomicFormAction({
    authenticatedOwnerId: ownerId,
    configuredOwnerId: configuredOwnerId(),
    formData,
    capability: {
      status: "ready" as const,
      configuration: {
        assets: context.assetRegistry.assets.map(({ code, kind }) => ({
          code,
          kind,
        })),
        confirmedOwnedCoreIds: [],
        completedBreedingEvents: [],
        confirmedCosts: [],
        confirmedRefunds: [],
        createDurableId: (kind: string) => `${kind}:${randomUUID()}`,
        now: () => now,
      },
      execute: async (
        verifiedOwnerId: string,
        evidence: BreedingEconomicEvidenceInput,
      ) => {
        const result = await recordBreedingEconomicEvidence({
          authenticatedOwnerId: verifiedOwnerId,
          configuredOwnerId: configuredOwnerId(),
          repository: persistence.repository,
          assetRegistry: context.assetRegistry,
          serverNow: now.toISOString(),
          evidence,
          expectedAssetRegistryVersion: context.assetRegistry.version,
          expectedEconomicVersion: context.economicVersion,
        });
        if (
          result.status === "recorded" ||
          result.status === "replayed" ||
          result.status === "held"
        ) {
          return { status: result.status } as const;
        }
        throw new Error("Breeding economic evidence was not recorded.");
      },
    },
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

export async function submitBreedingEconomicEvidenceFormAction(
  _previous: Awaited<
    ReturnType<typeof recordBreedingEconomicEvidenceFormAction>
  > | null,
  formData: FormData,
) {
  return recordBreedingEconomicEvidenceFormAction(formData);
}
