import { describe, expect, it } from "vitest";

import {
  PRO_LEAGUE_API_EVIDENCE_PUBLICATION_COMMAND_INTENT,
  PRO_LEAGUE_API_EVIDENCE_PUBLICATION_COMMAND_VERSION,
  proLeagueApiEvidencePublicationCommandFromEnvironment,
} from "@/lib/pro-league-api-evidence-publication-command";

const connected =
  process.env.PRO_LEAGUE_API_EVIDENCE_PUBLICATION_COMMAND === "1";
const describeConnected = connected ? describe : describe.skip;

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (
    value === undefined ||
    value.length < 1 ||
    value.trim() !== value ||
    value.length > 4_096 ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    throw new Error(`${name} is missing or invalid`);
  }
  return value;
}

describeConnected(
  "hosted Preview active API Pro League evidence publication command",
  () => {
    it(
      "publishes one complete owner-isolated generation and emits no private rows",
      async () => {
        const ownerId = requiredEnvironment("AUTHORIZED_CLERK_USER_ID");
        const command = proLeagueApiEvidencePublicationCommandFromEnvironment({
          databaseUrl: requiredEnvironment("DATABASE_URL"),
          databaseOwnerId: requiredEnvironment("DNA_DATABASE_OWNER_ID"),
          ownerId,
          runtimeRole: "dna_app_runtime",
        });
        if (command.status !== "ready") {
          throw new Error("Pro League API evidence command is not configured");
        }
        const receipt = await command.execute({
          commandVersion: PRO_LEAGUE_API_EVIDENCE_PUBLICATION_COMMAND_VERSION,
          intent: PRO_LEAGUE_API_EVIDENCE_PUBLICATION_COMMAND_INTENT,
          allowPersistentWrite: true,
          exactCodeHeadSha: requiredEnvironment("GITHUB_SHA"),
          publishedAt: requiredEnvironment(
            "PRO_LEAGUE_API_EVIDENCE_PUBLICATION_AT",
          ),
        });
        console.log(JSON.stringify(receipt));
        expect(receipt).toMatchObject({
          status: expect.stringMatching(/^(published|existing)$/u),
          inputObservationCount: 101_575,
          acceptedEntryCount: expect.any(Number),
          benchmarkCount: expect.any(Number),
          profileCount: expect.any(Number),
          exactCodeHeadSha: requiredEnvironment("GITHUB_SHA").toLowerCase(),
          persistentWriteArmed: true,
          previewOnly: true,
          paidUsageAllowed: false,
          preserveLastGood: true,
        });
        expect(receipt.acceptedEntryCount).toBeGreaterThan(0);
        expect(receipt.benchmarkCount).toBeGreaterThan(0);
        expect(receipt.profileCount).toBeGreaterThan(0);
        expect(receipt.unbenchmarkedEntryCount).toBeGreaterThanOrEqual(0);
      },
      2 * 60 * 60_000,
    );
  },
);
