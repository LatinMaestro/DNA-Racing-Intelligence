import { describe, expect, it } from "vitest";
import { cloudflareNeonDnaOpenLabProviderCapacitySourceFromEnvironment } from "@/lib/cloudflare-neon-dna-open-lab-provider-capacity-source";
import {
  createDnaOpenLabProviderCapacityPreflight,
  DNA_OPEN_LAB_PROVIDER_CAPACITY_PREFLIGHT_INTENT,
  DNA_OPEN_LAB_PROVIDER_CAPACITY_PREFLIGHT_VERSION,
} from "@/lib/dna-open-lab-provider-capacity-preflight";
import {
  DNA_OPEN_LAB_PRIVATE_DAILY_REFRESH_PLANNED_NEON_USAGE,
  DNA_OPEN_LAB_PRIVATE_DAILY_REFRESH_PLANNED_R2_USAGE,
} from "@/lib/dna-open-lab-private-daily-refresh-command";

function required(name: string): string {
  const v=process.env[name]?.trim() ?? "";
  if (!v) throw new Error(name+" missing");
  return v;
}

describe("temporary current provider capacity diagnostic",()=>{
  it("reports the actual refresh-envelope capacity without writes",async()=>{
    const ownerId=required("AUTHORIZED_CLERK_USER_ID");
    const source=cloudflareNeonDnaOpenLabProviderCapacitySourceFromEnvironment({
      authorizedOwnerId:ownerId,
      cloudflareAccountId:required("CLOUDFLARE_ACCOUNT_ID"),
      cloudflareAnalyticsApiToken:required("CLOUDFLARE_ANALYTICS_API_TOKEN"),
      r2BucketName:required("DNA_R2_BUCKET_NAME"),
      r2StorageClass:required("DNA_R2_STORAGE_CLASS"),
      neonApiKey:required("NEON_API_KEY"),
      neonProjectId:required("NEON_PROJECT_ID"),
    });
    if(source.status!=="ready") throw new Error("source unavailable");
    const preflight=createDnaOpenLabProviderCapacityPreflight({
      configuredOwnerId:ownerId,
      measurementSource:source,
    });
    const receipt=await preflight.inspect({
      preflightVersion:DNA_OPEN_LAB_PROVIDER_CAPACITY_PREFLIGHT_VERSION,
      intent:DNA_OPEN_LAB_PROVIDER_CAPACITY_PREFLIGHT_INTENT,
      authenticatedOwnerId:ownerId,
      exactCodeHeadSha:required("GITHUB_SHA").toLowerCase(),
      refreshCycleId:"temporary-current-capacity-cycle",
      budgetWindowId:"temporary-current-capacity-window",
      plannedR2UsagePerRefresh:DNA_OPEN_LAB_PRIVATE_DAILY_REFRESH_PLANNED_R2_USAGE,
      plannedNeonUsagePerRefresh:DNA_OPEN_LAB_PRIVATE_DAILY_REFRESH_PLANNED_NEON_USAGE,
    });
    console.log(JSON.stringify({
      status:receipt.status,
      reason:receipt.status==="held"?receipt.reason:null,
      measurementFailureId:receipt.status==="held"?receipt.measurementFailureId:null,
      blockerIds:receipt.status==="held"?receipt.blockerIds:receipt.projection.blockerIds,
      projection:receipt.projection,
      persistentWritePerformed:receipt.persistentWritePerformed,
      providerWritePerformed:receipt.providerWritePerformed,
      paidUsageAllowed:receipt.paidUsageAllowed,
      preserveLastGood:receipt.preserveLastGood,
    }));
    expect(receipt.persistentWritePerformed).toBe(false);
    expect(receipt.providerWritePerformed).toBe(false);
  },30000);
});