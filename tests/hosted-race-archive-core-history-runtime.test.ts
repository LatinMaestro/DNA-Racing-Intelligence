import { describe, expect, it, vi } from "vitest";

import type { NeonRaceArchiveCoreLocatorRepository } from "@/lib/neon-race-archive-core-locator-repository";
import type { SealedRaceArchiveManifestRepository } from "@/lib/neon-sealed-race-archive-manifest-repository";
import type { PrivateDatasetEvidenceObjectReader } from "@/lib/private-dataset-evidence-object-reader";
import { hostedRaceArchiveCoreHistoryRuntime } from "@/lib/hosted-race-archive-core-history-runtime";

const environment = {
  authorizedOwnerId: "user_owner",
  databaseUrl: "postgresql://dna_app_runtime:secret@example.test/dna",
  databaseOwnerId: "11111111-1111-4111-8111-111111111111",
  runtimeRole: "dna_app_runtime",
  cloudflareAccountId: "a".repeat(32),
  cloudflareApiToken: "token",
  bucketName: "dna-racing-import-preview",
  r2AccessKeyId: "access",
  r2SecretAccessKey: "secret",
};

function dependencies() {
  const locatorRepository: NeonRaceArchiveCoreLocatorRepository = {
    replace: vi.fn(async () => {
      throw new Error("replace is not used by history reads");
    }),
    listForCore: vi.fn(async () => []),
  };
  const manifestRepository: SealedRaceArchiveManifestRepository = {
    list: vi.fn(async () => ({ status: "missing" as const })),
  };
  const objectReader: PrivateDatasetEvidenceObjectReader = {
    read: vi.fn(async () => {
      throw new Error("object read should not occur without a locator");
    }),
  };
  return { locatorRepository, manifestRepository, objectReader };
}

describe("hosted Race archive Core history runtime", () => {
  it("fails closed when any private provider configuration is absent", () => {
    expect(
      hostedRaceArchiveCoreHistoryRuntime({
        environment: { ...environment, r2SecretAccessKey: undefined },
      }),
    ).toEqual({ status: "not_configured" });
  });

  it("composes the bounded history service from validated private dependencies", async () => {
    const injected = dependencies();
    const runtime = hostedRaceArchiveCoreHistoryRuntime({
      environment,
      dependencies: injected,
    });

    expect(runtime.status).toBe("ready");
    if (runtime.status !== "ready") return;
    await expect(
      runtime.service.load({ ownerId: "user_owner", sourceCoreId: "core-7" }),
    ).resolves.toEqual({
      sourceCoreId: "core-7",
      locatorVersionCount: 0,
      selectedPartitionCount: 0,
      rows: [],
    });
    expect(injected.locatorRepository.listForCore).toHaveBeenCalledWith({
      ownerId: "user_owner",
      sourceCoreId: "core-7",
      maximumVersions: 24,
    });
    expect(injected.manifestRepository.list).not.toHaveBeenCalled();
    expect(injected.objectReader.read).not.toHaveBeenCalled();
  });
});
