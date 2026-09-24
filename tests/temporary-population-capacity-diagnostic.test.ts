import { describe, expect, it } from "vitest";

import { cloudflareNeonDnaOpenLabProviderCapacitySourceFromEnvironment } from "@/lib/cloudflare-neon-dna-open-lab-provider-capacity-source";
import {
  DNA_POPULATION_RACE_INDEX_PREVIEW_PLANNED_NEON_USAGE,
  DNA_POPULATION_RACE_INDEX_PREVIEW_PLANNED_R2_USAGE,
} from "@/lib/dna-population-race-index-private-preview-operator";
import { projectDnaOpenLabZeroCostProviderCapacity } from "@/lib/dna-open-lab-zero-cost-provider-capacity";

function required(name: string): string {
  const value = process.env[name]?.trim() ?? "";
  if (!value) throw new Error(name + " missing");
  return value;
}

describe("temporary population capacity diagnostic", () => {
  it("prints only sanitized current usage and the population-index projection", async () => {
    const ownerId = required("AUTHORIZED_CLERK_USER_ID");
    const source = cloudflareNeonDnaOpenLabProviderCapacitySourceFromEnvironment({
      authorizedOwnerId: ownerId,
      cloudflareAccountId: required("CLOUDFLARE_ACCOUNT_ID"),
      cloudflareAnalyticsApiToken: required("CLOUDFLARE_ANALYTICS_API_TOKEN"),
      r2BucketName: required("DNA_R2_BUCKET_NAME"),
      r2StorageClass: required("DNA_R2_STORAGE_CLASS"),
      neonApiKey: required("NEON_API_KEY"),
      neonProjectId: required("NEON_PROJECT_ID"),
    });
    if (source.status !== "ready") throw new Error("source unavailable");

    const measurement = await source.measure({ ownerId });
    const projection = projectDnaOpenLabZeroCostProviderCapacity({
      r2StorageClass: measurement.r2StorageClass,
      measuredAt: measurement.measuredAt,
      billingWindowStartAt: measurement.billingWindowStartAt,
      billingWindowEndAt: measurement.billingWindowEndAt,
      neonMeasuredAt: measurement.neonMeasuredAt,
      neonBillingWindowStartAt: measurement.neonBillingWindowStartAt,
      neonBillingWindowEndAt: measurement.neonBillingWindowEndAt,
      currentR2Usage: measurement.currentR2Usage,
      plannedR2UsagePerRefresh: DNA_POPULATION_RACE_INDEX_PREVIEW_PLANNED_R2_USAGE,
      currentNeonUsage: measurement.currentNeonUsage,
      plannedNeonUsagePerRefresh: DNA_POPULATION_RACE_INDEX_PREVIEW_PLANNED_NEON_USAGE,
    });

    console.log("DNA_POPULATION_CAPACITY_DIAGNOSTIC=" + JSON.stringify({
      measuredAt: measurement.measuredAt,
      currentR2Usage: measurement.currentR2Usage,
      currentNeonUsage: measurement.currentNeonUsage,
      plannedR2UsagePerRefresh: DNA_POPULATION_RACE_INDEX_PREVIEW_PLANNED_R2_USAGE,
      plannedNeonUsagePerRefresh: DNA_POPULATION_RACE_INDEX_PREVIEW_PLANNED_NEON_USAGE,
      allowed: projection.allowed,
      blockerIds: projection.blockerIds,
      r2RemainingRefreshes: projection.r2RemainingRefreshes,
      neonRemainingRefreshes: projection.neonRemainingRefreshes,
      projectedR2Usage: projection.projectedR2Usage,
      projectedNeonUsage: projection.projectedNeonUsage,
      r2Headroom: projection.r2Headroom,
      neonHeadroom: projection.neonHeadroom,
      r2Budgets: projection.r2Budgets,
      neonBudgets: projection.neonBudgets,
      r2FreeAllowances: projection.r2FreeAllowances,
      neonFreeAllowances: projection.neonFreeAllowances,
      paidUsageAllowed: projection.paidUsageAllowed,
      preserveLastGood: projection.preserveLastGood,
    }));

    expect(measurement.evidenceSource).toBe("provider_api");
  }, 30_000);
});
