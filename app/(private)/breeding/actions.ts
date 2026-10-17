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
import { neonOwnerVaultCatalogueRepositoryFromEnvironment } from "@/lib/neon-owner-vault-catalogue-repository";
import type {
  BreedingEconomicFormConfiguration,
  ConfirmedPairingCost,
  ConfirmedPairingRefund,
} from "@/lib/breeding-economic-form-data";

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

function vaultCatalogue() {
  return neonOwnerVaultCatalogueRepositoryFromEnvironment({
    databaseUrl: process.env.DATABASE_URL,
    databaseOwnerId: process.env.DNA_DATABASE_OWNER_ID,
    runtimeRole: process.env.DNA_DATABASE_RUNTIME_ROLE,
  });
}

function boundedFormValue(formData: FormData, name: string): string | null {
  const values = formData.getAll(name);
  if (values.length !== 1 || typeof values[0] !== "string") return null;
  const value = values[0].trim();
  return value !== "" && value.length <= 128 ? value : null;
}

function costBasisConfiguration(
  records: Awaited<
    ReturnType<
      Extract<
        ReturnType<typeof breedingPersistence>,
        { status: "ready" }
      >["loadEvidenceByBreedingEventByOwner"]
    >
  >,
  input: Readonly<{
    breedingEventId: string;
    confirmedOwnedCoreIds: readonly string[];
    assets: BreedingEconomicFormConfiguration["assets"];
    now: Date;
  }>,
): BreedingEconomicFormConfiguration {
  const completedTimes = new Set<string>();
  const confirmedCosts: ConfirmedPairingCost[] = [];
  const confirmedRefunds: ConfirmedPairingRefund[] = [];
  for (const { record } of records) {
    if (record.input.breedingEventId !== input.breedingEventId) {
      throw new Error("Breeding event evidence mismatch.");
    }
    const source = record.assessment.source;
    if (
      source !== "manual_confirmed" &&
      source !== "authoritative_transaction_export"
    ) {
      continue;
    }
    if (
      record.assessment.status === "postable_review" &&
      record.assessment.lifecycle === "completed" &&
      record.assessment.occurredAt !== null
    ) {
      completedTimes.add(record.assessment.occurredAt);
      for (const posting of record.assessment.postings) {
        if (
          posting.direction === "debit" &&
          (posting.category === "dna_base_fee" ||
            posting.category === "external_arena_fee" ||
            posting.category === "arena_fee_bgc")
        ) {
          confirmedCosts.push({
            breedingEventId: input.breedingEventId,
            transactionId: posting.transactionId,
            category: posting.category,
            source,
            evidenceStatus: "confirmed",
            assetCode: posting.assetCode,
            assetKind: posting.assetKind,
            amount: posting.amount,
          });
        }
      }
    }
    if (
      record.assessment.status === "refunded_review" &&
      record.assessment.lifecycle === "refunded"
    ) {
      for (const posting of record.assessment.postings) {
        if (
          posting.category !== "refund" ||
          posting.direction !== "credit" ||
          posting.externalReference === null
        ) {
          throw new Error("Confirmed breeding refund evidence is incomplete.");
        }
        confirmedRefunds.push({
          breedingEventId: input.breedingEventId,
          transactionId: posting.transactionId,
          appliesToTransactionId: posting.externalReference,
          source,
          evidenceStatus: "confirmed",
          assetCode: posting.assetCode,
          assetKind: posting.assetKind,
          amount: posting.amount,
        });
      }
    }
  }
  if (completedTimes.size !== 1) {
    throw new Error("Completed breeding event evidence is unavailable.");
  }
  const occurredAt = [...completedTimes][0]!;
  return {
    assets: input.assets,
    confirmedOwnedCoreIds: input.confirmedOwnedCoreIds,
    completedBreedingEvents: [
      { breedingEventId: input.breedingEventId, occurredAt, status: "completed" },
    ],
    confirmedCosts,
    confirmedRefunds,
    createDurableId: (kind) => `${kind}:${randomUUID()}`,
    now: () => input.now,
  };
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
  const ownerId = await authenticatedOwnerId();
  const persistence = breedingPersistence();
  const vault = vaultCatalogue();
  const breedingEventId = boundedFormValue(formData, "breedingEventId");
  const offspringCoreId = boundedFormValue(formData, "offspringCoreId");
  if (
    !isConfiguredOwner(ownerId) ||
    persistence.status !== "ready" ||
    vault.status !== "ready" ||
    breedingEventId === null ||
    offspringCoreId === null
  ) {
    return runEconomicFormAction({
      authenticatedOwnerId: ownerId,
      configuredOwnerId: configuredOwnerId(),
      formData,
      capability: unavailableEconomicFormActionCapability,
      parse: parseOffspringCostBasisFormData,
    });
  }
  try {
    const [context, records, cores] = await Promise.all([
      persistence.loadContextByOwner(ownerId),
      persistence.loadEvidenceByBreedingEventByOwner(ownerId, breedingEventId),
      vault.listCoresByOwner(ownerId, {
        scope: "catalogue",
        query: offspringCoreId,
        element: null,
        coreClass: null,
        sex: null,
        fNumber: null,
      }),
    ]);
    const ownedMatches = cores.filter(
      (core) => core.sourceCoreId === offspringCoreId && core.inMyVault,
    );
    if (ownedMatches.length !== 1) {
      throw new Error("Offspring ownership is not confirmed.");
    }
    const now = new Date();
    return runEconomicFormAction({
      authenticatedOwnerId: ownerId,
      configuredOwnerId: configuredOwnerId(),
      formData,
      capability: {
        status: "ready" as const,
        configuration: costBasisConfiguration(records, {
          breedingEventId,
          confirmedOwnedCoreIds: [offspringCoreId],
          assets: context.assetRegistry.assets.map(({ code, kind }) => ({
            code,
            kind,
          })),
          now,
        }),
        execute: async (
          verifiedOwnerId: string,
          assignment: OffspringCostBasisRequest,
        ) => {
          const result = await assignOffspringCostBasis({
            authenticatedOwnerId: verifiedOwnerId,
            configuredOwnerId: configuredOwnerId(),
            repository: persistence.repository,
            assetRegistry: context.assetRegistry,
            serverNow: now.toISOString(),
            assignment,
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
          throw new Error("Offspring cost basis was not recorded.");
        },
      },
      parse: parseOffspringCostBasisFormData,
    });
  } catch {
    return runEconomicFormAction({
      authenticatedOwnerId: ownerId,
      configuredOwnerId: configuredOwnerId(),
      formData,
      capability: unavailableEconomicFormActionCapability,
      parse: parseOffspringCostBasisFormData,
    });
  }
}

export async function submitBreedingEconomicEvidenceFormAction(
  _previous: Awaited<
    ReturnType<typeof recordBreedingEconomicEvidenceFormAction>
  > | null,
  formData: FormData,
) {
  return recordBreedingEconomicEvidenceFormAction(formData);
}

export async function submitOffspringCostBasisFormAction(
  _previous: Awaited<
    ReturnType<typeof assignOffspringCostBasisFormAction>
  > | null,
  formData: FormData,
) {
  return assignOffspringCostBasisFormAction(formData);
}

