
import { describe, expect, it } from "vitest";

import { cloudflareNeonDnaOpenLabProviderCapacitySourceFromEnvironment } from "@/lib/cloudflare-neon-dna-open-lab-provider-capacity-source";
import { diagnoseDnaOpenLabR2BudgetLedger } from "@/lib/dna-open-lab-r2-budget-ledger-diagnostic";
import { neonDnaOpenLabR2BudgetRepositoryFromEnvironment } from "@/lib/neon-dna-open-lab-r2-budget-repository";

const connected = process.env.DNA_R2_BUDGET_LEDGER_DIAGNOSTIC === "1";
const describeConnected = connected ? describe : describe.skip;

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim() ?? "";
  if (
    value === "" ||
    value.length > 4096 ||
    /[\\u0000-\\u001f\\u007f-\\u009f]/u.test(value)
  ) {
    throw new Error(name + " is missing or invalid");
  }
  return value;
}

describeConnected("hosted Preview R2 budget ledger diagnostic", () => {
  it("compares the owner-isolated ledger with a fresh provider billing window without writes", async () => {
    const ownerId = requiredEnvironment("AUTHORIZED_CLERK_USER_ID");
    const source =
      cloudflareNeonDnaOpenLabProviderCapacitySourceFromEnvironment({
        authorizedOwnerId: ownerId,
        cloudflareAccountId: requiredEnvironment("CLOUDFLARE_ACCOUNT_ID"),
        cloudflareAnalyticsApiToken: requiredEnvironment(
          "CLOUDFLARE_ANALYTICS_API_TOKEN",
        ),
        r2BucketName: requiredEnvironment("DNA_R2_BUCKET_NAME"),
        r2StorageClass: requiredEnvironment("DNA_R2_STORAGE_CLASS"),
        neonApiKey: requiredEnvironment("NEON_API_KEY"),
        neonProjectId: requiredEnvironment("NEON_PROJECT_ID"),
      });
    const repository = neonDnaOpenLabR2BudgetRepositoryFromEnvironment({
      databaseUrl: requiredEnvironment("DATABASE_URL"),
      databaseOwnerId: requiredEnvironment("DNA_DATABASE_OWNER_ID"),
      runtimeRole: "dna_app_runtime",
    });
    if (source.status !== "ready" || repository.status !== "ready") {
      throw new Error("R2 budget diagnostic dependencies are unavailable");
    }

    const [measurement, window] = await Promise.all([
      source.measure({ ownerId }),
      repository.readWindow(ownerId),
    ]);
    const report = diagnoseDnaOpenLabR2BudgetLedger({ measurement, window });

    console.log(
      "DNA_R2_BUDGET_LEDGER_DIAGNOSTIC=" + JSON.stringify(report),
    );
    expect(report.persistentWritePerformed).toBe(false);
    expect(report.providerWritePerformed).toBe(false);
    expect(report.paidUsageAllowed).toBe(false);
    expect(report.providerWindowStartAt).toBe(measurement.billingWindowStartAt);
    expect(report.providerWindowEndAt).toBe(measurement.billingWindowEndAt);
  }, 60_000);
});
