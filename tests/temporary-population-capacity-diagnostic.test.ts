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

async function jsonGet(url: string, token: string): Promise<{ status: number; body: any | null }> {
  const response = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  let body: any | null = null;
  try { body = await response.json(); } catch {}
  return { status: response.status, body };
}

describe("temporary population capacity diagnostic", () => {
  it("prints only sanitized current usage and paid-plan eligibility signals", async () => {
    const ownerId = required("AUTHORIZED_CLERK_USER_ID");
    const neonApiKey = required("NEON_API_KEY");
    const neonProjectId = required("NEON_PROJECT_ID");
    const source = cloudflareNeonDnaOpenLabProviderCapacitySourceFromEnvironment({
      authorizedOwnerId: ownerId,
      cloudflareAccountId: required("CLOUDFLARE_ACCOUNT_ID"),
      cloudflareAnalyticsApiToken: required("CLOUDFLARE_ANALYTICS_API_TOKEN"),
      r2BucketName: required("DNA_R2_BUCKET_NAME"),
      r2StorageClass: required("DNA_R2_STORAGE_CLASS"),
      neonApiKey,
      neonProjectId,
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

    const projectResponse = await jsonGet(
      `https://console.neon.tech/api/v2/projects/${encodeURIComponent(neonProjectId)}`,
      neonApiKey,
    );
    const project = projectResponse.body?.project ?? null;
    const organizationId =
      typeof project?.org_id === "string"
        ? project.org_id
        : typeof project?.owner_id === "string" && project.owner_id.startsWith("org-")
          ? project.owner_id
          : null;

    let organizationPlan: string | null = null;
    let spendingLimitCents: number | null | "unavailable" = "unavailable";
    let spendingLimitLookupStatus: number | null = null;
    if (organizationId !== null) {
      const orgResponse = await jsonGet(
        `https://console.neon.tech/api/v2/organizations/${encodeURIComponent(organizationId)}`,
        neonApiKey,
      );
      if (orgResponse.status === 200 && typeof orgResponse.body?.organization?.plan === "string") {
        organizationPlan = orgResponse.body.organization.plan;
      } else if (orgResponse.status === 200 && typeof orgResponse.body?.plan === "string") {
        organizationPlan = orgResponse.body.plan;
      }

      const limitResponse = await jsonGet(
        `https://console.neon.tech/api/v2/organizations/${encodeURIComponent(organizationId)}/billing/spending_limit`,
        neonApiKey,
      );
      spendingLimitLookupStatus = limitResponse.status;
      if (limitResponse.status === 200) {
        const value =
          limitResponse.body?.spending_limit_cents ??
          limitResponse.body?.spending_limit?.spending_limit_cents ??
          null;
        spendingLimitCents =
          value === null || (Number.isSafeInteger(value) && value >= 0) ? value : "unavailable";
      }
    }

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
      organizationPlan,
      spendingLimitCents,
      spendingLimitLookupStatus,
      paidUsageAllowed: projection.paidUsageAllowed,
      preserveLastGood: projection.preserveLastGood,
    }));

    expect(measurement.evidenceSource).toBe("provider_api");
    expect(projectResponse.status).toBe(200);
  }, 30_000);
});
