import { afterEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  ownerId: vi.fn(async (): Promise<string | null> => "owner-1"),
  revalidatePath: vi.fn(),
  rollbackActiveSourceVersion: vi.fn(async () => ({
    status: "restored" as const,
    disposition: "created" as const,
    rollbackId: "rollback-1",
    sourceType: "race_merge" as const,
    restoredBatchId: "batch-prior",
    aggregateRefreshId: "refresh-1",
  })),
  repositoryFromEnvironment: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: dependencies.revalidatePath,
}));

vi.mock("../lib/clerk-owner-session", () => ({
  authenticatedClerkOwnerId: dependencies.ownerId,
}));

vi.mock("../lib/neon-import-rollback-repository", () => ({
  neonImportRollbackRepositoryFromEnvironment:
    dependencies.repositoryFromEnvironment,
}));

import { submitImportRollbackFormAction } from "../app/(private)/imports/actions";

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("import rollback form action", () => {
  it("connects the owner-scoped Neon rollback repository and refreshes the workspace", async () => {
    vi.stubEnv("AUTHORIZED_CLERK_USER_ID", "owner-1");
    vi.stubEnv("DATABASE_URL", "postgresql://preview.invalid/dna");
    vi.stubEnv("DNA_DATABASE_OWNER_ID", "11111111-1111-4111-8111-111111111111");
    vi.stubEnv("DNA_DATABASE_RUNTIME_ROLE", "dna_app_runtime");
    dependencies.repositoryFromEnvironment.mockReturnValue({
      status: "ready",
      rollbackActiveSourceVersion: dependencies.rollbackActiveSourceVersion,
    });
    const formData = new FormData();
    formData.set("batchId", "batch-active");
    formData.set(
      "rollbackReason",
      "Restore the prior accepted source after owner review.",
    );
    formData.set("explicitlyConfirmed", "yes");

    await expect(
      submitImportRollbackFormAction(null, formData),
    ).resolves.toEqual({
      status: "success",
      title: "Rollback recorded",
      detail:
        "The prior accepted race merge dataset is active. Its aggregate refresh is pending; readiness remains unavailable until publication completes.",
    });

    expect(dependencies.repositoryFromEnvironment).toHaveBeenCalledWith({
      databaseUrl: "postgresql://preview.invalid/dna",
      databaseOwnerId: "11111111-1111-4111-8111-111111111111",
      runtimeRole: "dna_app_runtime",
    });
    expect(dependencies.rollbackActiveSourceVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: "owner-1",
        batchId: "batch-active",
        reason: "Restore the prior accepted source after owner review.",
      }),
    );
    expect(dependencies.revalidatePath).toHaveBeenCalledExactlyOnceWith(
      "/imports",
    );
  });

  it("returns validation evidence without calling persistence", async () => {
    vi.stubEnv("AUTHORIZED_CLERK_USER_ID", "owner-1");
    dependencies.repositoryFromEnvironment.mockReturnValue({
      status: "ready",
      rollbackActiveSourceVersion: dependencies.rollbackActiveSourceVersion,
    });
    const formData = new FormData();
    formData.set("batchId", "batch-active");
    formData.set("rollbackReason", "too short");

    await expect(
      submitImportRollbackFormAction(null, formData),
    ).resolves.toEqual({
      status: "error",
      title: "Rollback not recorded",
      detail: "Explicit owner confirmation is required.",
    });
    expect(dependencies.rollbackActiveSourceVersion).not.toHaveBeenCalled();
    expect(dependencies.revalidatePath).not.toHaveBeenCalled();
  });
});
