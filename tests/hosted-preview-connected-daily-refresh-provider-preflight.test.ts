import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { cloudflareNeonDnaOpenLabProviderCapacitySourceFromEnvironment } from "@/lib/cloudflare-neon-dna-open-lab-provider-capacity-source";
import {
  createDnaOpenLabProviderCapacityPreflight,
  DNA_OPEN_LAB_PROVIDER_CAPACITY_PREFLIGHT_INTENT,
  DNA_OPEN_LAB_PROVIDER_CAPACITY_PREFLIGHT_VERSION,
} from "@/lib/dna-open-lab-provider-capacity-preflight";

const connected =
  process.env.DNA_OPEN_LAB_DAILY_REFRESH_PROVIDER_PREFLIGHT === "1";
const describeConnected = connected ? describe : describe.skip;

class ProviderCapacityHeldError extends Error {}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim() ?? "";
  if (
    value === "" ||
    value.length > 4096 ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    throw new Error(`${name} is missing or invalid`);
  }
  return value;
}

function authorityId(domain: string, value: string): string {
  return createHash("sha256").update(`${domain}\u0000${value}`).digest("hex");
}

describeConnected("hosted Preview daily-refresh provider preflight", () => {
  it("proves fresh zero-cost capacity without persistent or provider writes", async () => {
    try {
      const ownerId = requiredEnvironment("AUTHORIZED_CLERK_USER_ID");
      const exactCodeHeadSha = requiredEnvironment("GITHUB_SHA").toLowerCase();
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
      if (source.status !== "ready") {
        throw new Error("provider measurement source is not configured");
      }
      const checkedAt = new Date();
      const billingMonth = `${checkedAt.getUTCFullYear()}-${String(
        checkedAt.getUTCMonth() + 1,
      ).padStart(2, "0")}`;
      const preflight = createDnaOpenLabProviderCapacityPreflight({
        configuredOwnerId: ownerId,
        measurementSource: source,
        now: () => checkedAt,
      });
      const receipt = await preflight.inspect({
        preflightVersion: DNA_OPEN_LAB_PROVIDER_CAPACITY_PREFLIGHT_VERSION,
        intent: DNA_OPEN_LAB_PROVIDER_CAPACITY_PREFLIGHT_INTENT,
        authenticatedOwnerId: ownerId,
        exactCodeHeadSha,
        refreshCycleId: authorityId(
          "dna-open-lab-preview-capacity-cycle/v1",
          exactCodeHeadSha,
        ),
        budgetWindowId: authorityId(
          "dna-open-lab-preview-capacity-window/v1",
          billingMonth,
        ),
        plannedR2UsagePerRefresh: {
          storageBytes: 1_000_000,
          classAOperations: 100,
          classBOperations: 200,
        },
        plannedNeonUsagePerRefresh: {
          storageBytes: 250_000,
          computeMilliCuHours: 500,
        },
      });
      if (receipt.status !== "ready") {
        throw new ProviderCapacityHeldError(
          `provider capacity held: ${receipt.reason}:${
            receipt.measurementFailureId ?? "none"
          }:${receipt.blockerIds.join(",")}`,
        );
      }
      const report = Object.freeze({
        preflightVersion: DNA_OPEN_LAB_PROVIDER_CAPACITY_PREFLIGHT_VERSION,
        status: receipt.status,
        readyForRefresh: receipt.readyForRefresh,
        exactCodeHeadSha: receipt.exactCodeHeadSha,
        r2RemainingRefreshes: receipt.projection.r2RemainingRefreshes,
        neonRemainingRefreshes: receipt.projection.neonRemainingRefreshes,
        maximumSafeR2RemainingRefreshes:
          receipt.projection.maximumSafeR2RemainingRefreshes,
        maximumSafeNeonRemainingRefreshes:
          receipt.projection.maximumSafeNeonRemainingRefreshes,
        blockerIds: receipt.projection.blockerIds,
        persistentWritePerformed: receipt.persistentWritePerformed,
        providerWritePerformed: receipt.providerWritePerformed,
        paidUsageAllowed: receipt.paidUsageAllowed,
        preserveLastGood: receipt.preserveLastGood,
      });
      console.log(JSON.stringify(report));
      expect(report).toMatchObject({
        status: "ready",
        readyForRefresh: true,
        exactCodeHeadSha,
        blockerIds: [],
        persistentWritePerformed: false,
        providerWritePerformed: false,
        paidUsageAllowed: false,
        preserveLastGood: true,
      });
      expect(report.maximumSafeR2RemainingRefreshes).toBe(
        report.r2RemainingRefreshes,
      );
      expect(report.maximumSafeNeonRemainingRefreshes).toBe(
        report.neonRemainingRefreshes,
      );
    } catch (error) {
      if (error instanceof ProviderCapacityHeldError) throw error;
      throw new Error("DNA Open Lab daily-refresh provider preflight failed");
    }
  }, 30_000);
});
