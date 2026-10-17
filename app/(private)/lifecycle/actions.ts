"use server";

import { randomUUID } from "node:crypto";
import type { BurnCreditEvidence } from "@/domain/burn-credit-reconciliation";
import type { CoreBurnEventInput } from "@/domain/core-burn-event";
import type { CoreSaleEvidenceInput } from "@/domain/core-sale-evidence";
import { authenticatedClerkOwnerId } from "@/lib/clerk-owner-session";
import {
  runEconomicFormAction,
  unavailableEconomicFormActionCapability,
} from "@/lib/economic-form-action-service";
import {
  parseBurnCreditFormData,
  parseCoreBurnFormData,
  parseCoreSaleFormData,
  type ActiveLifecycleCore,
  type LifecycleEconomicFormConfiguration,
} from "@/lib/lifecycle-economic-form-data";
import {
  recordBurnCreditEvidence,
  recordCoreBurnEvidence,
  recordCoreSaleEvidence,
  unavailableLifecycleEconomicAssetRegistry,
  unavailableLifecycleEconomicWriteRepository,
} from "@/lib/lifecycle-economic-write-service";
import { neonLifecycleEconomicPersistenceFromEnvironment } from "@/lib/neon-lifecycle-economic-write-repository";
import { neonOwnerVaultCatalogueRepositoryFromEnvironment } from "@/lib/neon-owner-vault-catalogue-repository";

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

function lifecyclePersistence() {
  return neonLifecycleEconomicPersistenceFromEnvironment({
    databaseUrl: process.env.DATABASE_URL,
    databaseOwnerId: process.env.DNA_DATABASE_OWNER_ID,
    runtimeRole: process.env.DNA_DATABASE_RUNTIME_ROLE,
  });
}

function ownerVaultCatalogue() {
  return neonOwnerVaultCatalogueRepositoryFromEnvironment({
    databaseUrl: process.env.DATABASE_URL,
    databaseOwnerId: process.env.DNA_DATABASE_OWNER_ID,
    runtimeRole: process.env.DNA_DATABASE_RUNTIME_ROLE,
  });
}

function isConfiguredOwner(ownerId: string | null): ownerId is string {
  const authenticated = ownerId?.trim() ?? "";
  const configured = configuredOwnerId()?.trim() ?? "";
  return authenticated !== "" && authenticated === configured;
}

function selectedText(
  formData: FormData,
  field: string,
  maximumLength: number,
): string | null {
  const values = formData.getAll(field);
  if (values.length !== 1 || typeof values[0] !== "string") return null;
  const value = values[0].trim();
  return value !== "" && value.length <= maximumLength ? value : null;
}

async function activeCoreByOwner(
  ownerId: string,
  formData: FormData,
): Promise<readonly ActiveLifecycleCore[]> {
  const coreId = selectedText(formData, "coreId", 128);
  if (coreId === null) return [];
  const repository = ownerVaultCatalogue();
  if (repository.status !== "ready") {
    throw new Error("Owner Vault catalogue is unavailable.");
  }
  const matches = (
    await repository.listCoresByOwner(ownerId, {
      scope: "vault",
      query: coreId,
      element: null,
      coreClass: null,
      sex: null,
      fNumber: null,
    })
  ).filter((core) => core.sourceCoreId === coreId && core.inMyVault);
  if (matches.length !== 1) return [];
  return [{ coreId, coreClass: matches[0]!.coreClass }];
}

function configuration(input: {
  assets: readonly string[];
  activeCores?: readonly ActiveLifecycleCore[];
  confirmedBurns?: LifecycleEconomicFormConfiguration["confirmedBurns"];
  now: Date;
}): LifecycleEconomicFormConfiguration {
  return {
    assets: input.assets,
    activeCores: input.activeCores ?? [],
    confirmedBurns: input.confirmedBurns ?? [],
    createDurableId: (kind) => `${kind}:${randomUUID()}`,
    now: () => input.now,
  };
}

async function unavailableFormAction<Parsed>(input: {
  ownerId: string | null;
  formData: FormData;
  parse: (
    formData: FormData,
    configuration: LifecycleEconomicFormConfiguration,
  ) => Parsed;
}) {
  return runEconomicFormAction({
    authenticatedOwnerId: input.ownerId,
    configuredOwnerId: configuredOwnerId(),
    formData: input.formData,
    capability: unavailableEconomicFormActionCapability,
    parse: input.parse,
  });
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

export async function recordCoreSaleFormAction(formData: FormData) {
  const ownerId = await authenticatedOwnerId();
  const persistence = lifecyclePersistence();
  if (!isConfiguredOwner(ownerId) || persistence.status !== "ready") {
    return unavailableFormAction({
      ownerId,
      formData,
      parse: parseCoreSaleFormData,
    });
  }
  let context: Awaited<ReturnType<typeof persistence.loadContextByOwner>>;
  let activeCores: readonly ActiveLifecycleCore[];
  try {
    [context, activeCores] = await Promise.all([
      persistence.loadContextByOwner(ownerId),
      activeCoreByOwner(ownerId, formData),
    ]);
  } catch {
    return unavailableFormAction({
      ownerId,
      formData,
      parse: parseCoreSaleFormData,
    });
  }
  const now = new Date();
  return runEconomicFormAction({
    authenticatedOwnerId: ownerId,
    configuredOwnerId: configuredOwnerId(),
    formData,
    capability: {
      status: "ready" as const,
      configuration: configuration({
        assets: context.assetRegistry.assets.map(({ code }) => code),
        activeCores,
        now,
      }),
      execute: async (verifiedOwnerId: string, sale: CoreSaleEvidenceInput) => {
        const result = await recordCoreSaleEvidence({
          authenticatedOwnerId: verifiedOwnerId,
          configuredOwnerId: configuredOwnerId(),
          repository: persistence.repository,
          assetRegistry: context.assetRegistry,
          expectedAssetRegistryVersion: context.assetRegistry.version,
          expectedLifecycleVersion: context.lifecycleVersion,
          serverNow: now.toISOString(),
          sale,
        });
        if (result.status === "recorded" || result.status === "replayed") {
          return { status: result.status } as const;
        }
        throw new Error("Core sale evidence was not recorded.");
      },
    },
    parse: parseCoreSaleFormData,
  });
}

export async function recordCoreBurnFormAction(formData: FormData) {
  const ownerId = await authenticatedOwnerId();
  const persistence = lifecyclePersistence();
  if (!isConfiguredOwner(ownerId) || persistence.status !== "ready") {
    return unavailableFormAction({
      ownerId,
      formData,
      parse: parseCoreBurnFormData,
    });
  }
  let context: Awaited<ReturnType<typeof persistence.loadContextByOwner>>;
  let activeCores: readonly ActiveLifecycleCore[];
  try {
    [context, activeCores] = await Promise.all([
      persistence.loadContextByOwner(ownerId),
      activeCoreByOwner(ownerId, formData),
    ]);
  } catch {
    return unavailableFormAction({
      ownerId,
      formData,
      parse: parseCoreBurnFormData,
    });
  }
  const now = new Date();
  return runEconomicFormAction({
    authenticatedOwnerId: ownerId,
    configuredOwnerId: configuredOwnerId(),
    formData,
    capability: {
      status: "ready" as const,
      configuration: configuration({
        assets: context.assetRegistry.assets.map(({ code }) => code),
        activeCores,
        now,
      }),
      execute: async (verifiedOwnerId: string, burn: CoreBurnEventInput) => {
        const result = await recordCoreBurnEvidence({
          authenticatedOwnerId: verifiedOwnerId,
          configuredOwnerId: configuredOwnerId(),
          repository: persistence.repository,
          expectedLifecycleVersion: context.lifecycleVersion,
          serverNow: now.toISOString(),
          burn,
        });
        if (result.status === "recorded" || result.status === "replayed") {
          return { status: result.status } as const;
        }
        throw new Error("Core burn evidence was not recorded.");
      },
    },
    parse: parseCoreBurnFormData,
  });
}

export async function recordBurnCreditFormAction(formData: FormData) {
  const ownerId = await authenticatedOwnerId();
  const persistence = lifecyclePersistence();
  if (!isConfiguredOwner(ownerId) || persistence.status !== "ready") {
    return unavailableFormAction({
      ownerId,
      formData,
      parse: parseBurnCreditFormData,
    });
  }
  let context: Awaited<ReturnType<typeof persistence.loadContextByOwner>>;
  let confirmedBurns: LifecycleEconomicFormConfiguration["confirmedBurns"] = [];
  try {
    context = await persistence.loadContextByOwner(ownerId);
    const burnId = selectedText(formData, "burnId", 128);
    if (burnId !== null) {
      const stored = await persistence.repository.loadBurnByOwner(
        ownerId,
        burnId,
      );
      if (stored?.record.result.status === "confirmed_event_review") {
        confirmedBurns = [
          {
            burnId: stored.record.result.burnId,
            coreId: stored.record.result.coreId,
            occurredAt: stored.record.input.occurredAt,
            status: "confirmed_event_review",
          },
        ];
      }
    }
  } catch {
    return unavailableFormAction({
      ownerId,
      formData,
      parse: parseBurnCreditFormData,
    });
  }
  const now = new Date();
  return runEconomicFormAction({
    authenticatedOwnerId: ownerId,
    configuredOwnerId: configuredOwnerId(),
    formData,
    capability: {
      status: "ready" as const,
      configuration: configuration({
        assets: context.assetRegistry.assets.map(({ code }) => code),
        confirmedBurns,
        now,
      }),
      execute: async (verifiedOwnerId: string, credit: BurnCreditEvidence) => {
        const result = await recordBurnCreditEvidence({
          authenticatedOwnerId: verifiedOwnerId,
          configuredOwnerId: configuredOwnerId(),
          repository: persistence.repository,
          assetRegistry: context.assetRegistry,
          expectedAssetRegistryVersion: context.assetRegistry.version,
          expectedLifecycleVersion: context.lifecycleVersion,
          serverNow: now.toISOString(),
          credit,
        });
        if (result.status === "recorded" || result.status === "replayed") {
          return { status: result.status } as const;
        }
        throw new Error("Burn credit evidence was not recorded.");
      },
    },
    parse: parseBurnCreditFormData,
  });
}

export async function submitCoreSaleFormAction(
  _previous: Awaited<ReturnType<typeof recordCoreSaleFormAction>> | null,
  formData: FormData,
) {
  return recordCoreSaleFormAction(formData);
}

export async function submitCoreBurnFormAction(
  _previous: Awaited<ReturnType<typeof recordCoreBurnFormAction>> | null,
  formData: FormData,
) {
  return recordCoreBurnFormAction(formData);
}

export async function submitBurnCreditFormAction(
  _previous: Awaited<ReturnType<typeof recordBurnCreditFormAction>> | null,
  formData: FormData,
) {
  return recordBurnCreditFormAction(formData);
}
