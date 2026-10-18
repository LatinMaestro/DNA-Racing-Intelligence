import { describe, expect, it, vi } from "vitest";

import type {
  TournamentHorseScreeningAcceptedSourceBoundary,
  TournamentHorseScreeningPublicationBoundary,
} from "@/lib/tournament-horse-screening-materializer";
import { materializeTournamentHorseScreeningSnapshot } from "@/lib/tournament-horse-screening-materializer";
import {
  TOURNAMENT_HORSE_SCREENING_PUBLICATION_COMMAND_INTENT,
  TOURNAMENT_HORSE_SCREENING_PUBLICATION_COMMAND_VERSION,
  tournamentHorseScreeningPublicationCommandFromEnvironment,
} from "@/lib/tournament-horse-screening-publication-command";

const databaseOwnerId = "a1050000-0000-4000-8000-000000000001";
const source = {
  loadAcceptedSourceByOwner: vi.fn(),
  readAcceptedSourceIdentityByOwner: vi.fn(),
} satisfies TournamentHorseScreeningAcceptedSourceBoundary;
const publication = {
  readActiveSnapshotVersionByOwner: vi.fn(),
  publishCandidate: vi.fn(),
} satisfies TournamentHorseScreeningPublicationBoundary;

const invocation = Object.freeze({
  commandVersion: TOURNAMENT_HORSE_SCREENING_PUBLICATION_COMMAND_VERSION,
  intent: TOURNAMENT_HORSE_SCREENING_PUBLICATION_COMMAND_INTENT,
  allowPersistentWrite: true as const,
  exactCodeHeadSha: "D".repeat(40),
  publishedAt: "2026-10-18T18:00:00.000Z",
});

describe("Tournament Horse screening publication command", () => {
  it("is inert until an exact explicitly armed invocation executes", async () => {
    const materialize = vi.fn<
      typeof materializeTournamentHorseScreeningSnapshot
    >(async () => ({ status: "published" as const }));
    const command = tournamentHorseScreeningPublicationCommandFromEnvironment(
      {
        databaseUrl: "postgres://runtime@example.invalid/private",
        databaseOwnerId,
        authenticatedOwnerId: "private_owner",
      },
      { source, publication, materialize },
    );

    expect(command.status).toBe("ready");
    expect(materialize).not.toHaveBeenCalled();
    expect(source.loadAcceptedSourceByOwner).not.toHaveBeenCalled();
    expect(publication.publishCandidate).not.toHaveBeenCalled();
    if (command.status !== "ready") throw new Error("command unavailable");

    await expect(command.execute(invocation)).resolves.toEqual({
      status: "published",
      exactCodeHeadSha: "d".repeat(40),
      publishedAt: invocation.publishedAt,
      persistentWriteArmed: true,
      previewOnly: true,
      paidUsageAllowed: false,
      preserveLastGood: true,
    });
    expect(materialize).toHaveBeenCalledOnce();
    const input = materialize.mock.calls[0]?.[0];
    expect(input).toMatchObject({ databaseOwnerId, source, publication });
    expect(input?.now).toBeTypeOf("function");
    expect(input?.now?.()).toEqual(new Date(invocation.publishedAt));
  });

  it("fails closed before materialization when the write arm or audit fields are invalid", async () => {
    const materialize = vi.fn<
      typeof materializeTournamentHorseScreeningSnapshot
    >(async () => ({ status: "unchanged" as const }));
    const command = tournamentHorseScreeningPublicationCommandFromEnvironment(
      {
        databaseUrl: "postgres://runtime@example.invalid/private",
        databaseOwnerId,
        authenticatedOwnerId: "private_owner",
      },
      { source, publication, materialize },
    );
    if (command.status !== "ready") throw new Error("command unavailable");

    await expect(
      command.execute({ ...invocation, allowPersistentWrite: false as true }),
    ).rejects.toThrow("not explicitly armed");
    await expect(
      command.execute({ ...invocation, exactCodeHeadSha: "not-a-head" }),
    ).rejects.toThrow("head is invalid");
    await expect(
      command.execute({ ...invocation, publishedAt: "2026-10-18" }),
    ).rejects.toThrow("timestamp is invalid");
    expect(materialize).not.toHaveBeenCalled();
  });

  it("stays unavailable without owner/database configuration or private R2 authority", () => {
    expect(
      tournamentHorseScreeningPublicationCommandFromEnvironment(
        {},
        {
          source,
          publication,
        },
      ),
    ).toEqual({ status: "not_configured" });
    expect(
      tournamentHorseScreeningPublicationCommandFromEnvironment({
        databaseUrl: "postgres://runtime@example.invalid/private",
        databaseOwnerId,
        authenticatedOwnerId: "private_owner",
      }),
    ).toEqual({ status: "not_configured" });
  });
});
