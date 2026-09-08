import { describe, expect, it, vi } from "vitest";

import {
  createProLeagueBreedingPublicationCommand,
  proLeagueBreedingPublicationCommandFromEnvironment,
  type ProLeagueBreedingPublicationInvocation,
} from "@/lib/pro-league-breeding-ranking-publication-command";

const ownerId = "owner_private";
const invocation: ProLeagueBreedingPublicationInvocation = {
  commandVersion: "pro-league-breeding-publication/v1",
  intent: "publish_accepted_private_analysis",
  allowPersistentWrite: true,
  authenticatedOwnerId: ownerId,
  analysisId: "accepted-analysis-1",
  expectedContentSha256: "a".repeat(64),
  generationId: "97000000-0000-4000-8000-000000000001",
  workerId: "private-commissioning",
  publishedAt: "2026-09-08T03:30:00.000Z",
};

describe("Pro League breeding publication command", () => {
  it("stays unavailable until every server-only database setting exists", () => {
    expect(
      proLeagueBreedingPublicationCommandFromEnvironment({ ownerId }),
    ).toEqual({ status: "not_configured" });
  });

  it("composes without opening a database session", () => {
    const sessionFactory = vi.fn();
    expect(
      proLeagueBreedingPublicationCommandFromEnvironment(
        {
          databaseUrl: "postgresql://private.example/test",
          databaseOwnerId: "97000000-0000-4000-8000-000000000002",
          ownerId,
          runtimeRole: "dna_app_runtime",
        },
        sessionFactory,
      ).status,
    ).toBe("ready");
    expect(sessionFactory).not.toHaveBeenCalled();
  });

  it("refuses an invocation that is not explicitly write-armed", async () => {
    const command = createProLeagueBreedingPublicationCommand({
      configuredOwnerId: ownerId,
      source: { status: "not_configured" },
      authoritySource: { status: "not_configured" },
      target: { status: "not_configured" },
    });
    await expect(
      command.execute({
        ...invocation,
        allowPersistentWrite: false,
      } as unknown as ProLeagueBreedingPublicationInvocation),
    ).rejects.toThrow("not explicitly armed");
  });

  it("passes one explicit packet into the held guarded chain", async () => {
    const loadCurrentAuthorityByOwner = vi.fn().mockResolvedValue({
      rosterEvidenceCutoffAt: "2026-09-08T01:00:00.000Z",
      latestAcceptedPerformanceImportAt: "2026-09-08T01:30:00.000Z",
      latestAcceptedArenaImportAt: null,
    });
    const loadAcceptedAnalysisByOwner = vi
      .fn()
      .mockResolvedValue({ status: "not_found" });
    const publish = vi.fn();
    const command = createProLeagueBreedingPublicationCommand({
      configuredOwnerId: ownerId,
      source: { status: "ready", loadAcceptedAnalysisByOwner },
      authoritySource: { status: "ready", loadCurrentAuthorityByOwner },
      target: { status: "ready", publish },
    });

    await expect(command.execute(invocation)).resolves.toEqual({
      status: "analysis_not_found",
      published: false,
    });
    expect(loadCurrentAuthorityByOwner).toHaveBeenCalledWith(ownerId);
    expect(loadAcceptedAnalysisByOwner).toHaveBeenCalledWith(
      ownerId,
      invocation.analysisId,
    );
    expect(publish).not.toHaveBeenCalled();
  });
});
