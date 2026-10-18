import { describe, expect, it } from "vitest";

import {
  TOURNAMENT_HORSE_SCREENING_PUBLICATION_COMMAND_INTENT,
  TOURNAMENT_HORSE_SCREENING_PUBLICATION_COMMAND_VERSION,
  tournamentHorseScreeningPublicationCommandFromEnvironment,
} from "@/lib/tournament-horse-screening-publication-command";

const connected =
  process.env.TOURNAMENT_HORSE_SCREENING_PUBLICATION_COMMAND === "1";
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
  "hosted Preview Tournament Horse screening publication command",
  () => {
    it(
      "publishes one bounded owner-isolated last-good snapshot without emitting private rows",
      async () => {
        const command =
          tournamentHorseScreeningPublicationCommandFromEnvironment({
            databaseUrl: requiredEnvironment("DATABASE_URL"),
            databaseOwnerId: requiredEnvironment("DNA_DATABASE_OWNER_ID"),
            authenticatedOwnerId: requiredEnvironment(
              "AUTHORIZED_CLERK_USER_ID",
            ),
            runtimeRole: "dna_app_runtime",
            cloudflareAccountId: requiredEnvironment("CLOUDFLARE_ACCOUNT_ID"),
            cloudflareApiToken: requiredEnvironment("CLOUDFLARE_API_TOKEN"),
            r2BucketName: requiredEnvironment("DNA_R2_BUCKET_NAME"),
            r2AccessKeyId: requiredEnvironment("DNA_R2_ACCESS_KEY_ID"),
            r2SecretAccessKey: requiredEnvironment("DNA_R2_SECRET_ACCESS_KEY"),
          });
        if (command.status !== "ready") {
          throw new Error(
            "Tournament Horse screening publication command is not configured",
          );
        }
        const receipt = await command.execute({
          commandVersion:
            TOURNAMENT_HORSE_SCREENING_PUBLICATION_COMMAND_VERSION,
          intent: TOURNAMENT_HORSE_SCREENING_PUBLICATION_COMMAND_INTENT,
          allowPersistentWrite: true,
          exactCodeHeadSha: requiredEnvironment("GITHUB_SHA"),
          publishedAt: requiredEnvironment(
            "TOURNAMENT_HORSE_SCREENING_PUBLICATION_AT",
          ),
        });
        console.log(JSON.stringify(receipt));
        expect(receipt).toEqual({
          status: expect.stringMatching(/^(published|unchanged)$/u),
          exactCodeHeadSha: requiredEnvironment("GITHUB_SHA").toLowerCase(),
          publishedAt: requiredEnvironment(
            "TOURNAMENT_HORSE_SCREENING_PUBLICATION_AT",
          ),
          persistentWriteArmed: true,
          previewOnly: true,
          paidUsageAllowed: false,
          preserveLastGood: true,
        });
      },
      75 * 60_000,
    );
  },
);
