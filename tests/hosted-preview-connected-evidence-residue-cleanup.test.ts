import { describe, expect, it } from "vitest";

import { recoverHostedPreviewEvidenceResidue } from "./hosted-preview-evidence-residue-recovery";

const connected =
  process.env.DNA_CONNECTED_PREVIEW_EVIDENCE_RESIDUE_CLEANUP === "1";
const describeConnected = connected ? describe : describe.skip;

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim() ?? "";
  if (value === "" || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${name} is missing or invalid`);
  }
  return value;
}

describeConnected("hosted Preview orphan evidence recovery", () => {
  it("removes only exact unregistered owner evidence before commissioning", async () => {
    const result = await recoverHostedPreviewEvidenceResidue({
      ownerId: requiredEnvironment("AUTHORIZED_CLERK_USER_ID"),
      databaseUrl: requiredEnvironment("DATABASE_URL"),
      databaseOwnerId: requiredEnvironment("DNA_DATABASE_OWNER_ID"),
      runtimeRole: "dna_app_runtime",
      accountId: requiredEnvironment("CLOUDFLARE_ACCOUNT_ID"),
      apiToken: requiredEnvironment("CLOUDFLARE_API_TOKEN"),
      bucketName: requiredEnvironment("DNA_R2_BUCKET_NAME"),
      accessKeyId: requiredEnvironment("DNA_R2_ACCESS_KEY_ID"),
      secretAccessKey: requiredEnvironment("DNA_R2_SECRET_ACCESS_KEY"),
      requireEmptyDurableOwnerState: true,
    });
    expect(result.retained).toBe(0);
    console.log(
      `Recovered ${result.deleted} unregistered Preview evidence object(s); ${result.missing} were already missing.`,
    );
  });
});
