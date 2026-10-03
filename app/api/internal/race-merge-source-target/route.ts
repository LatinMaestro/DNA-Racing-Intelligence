import { NextRequest, NextResponse } from "next/server";

import { hostedImportUploadIntakeRuntime } from "@/lib/hosted-import-upload-intake-runtime";
import { createRaceMergeSourceEvidenceUploadTarget } from "@/lib/race-merge-source-evidence-bridge";

export const dynamic = "force-dynamic";

function unavailable(): NextResponse {
  return new NextResponse("Not Found", {
    status: 404,
    headers: {
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    },
  });
}

export async function GET(request: NextRequest) {
  if (
    process.env.VERCEL_ENV !== "preview" ||
    process.env.ENABLE_PHASE0_REVIEW !== "true" ||
    process.env.DNA_RACE_MERGE_EVIDENCE_BRIDGE_ENABLED !== "true"
  ) {
    return unavailable();
  }
  const ownerId = process.env.AUTHORIZED_CLERK_USER_ID?.trim() ?? "";
  const nonce =
    process.env.DNA_RACE_MERGE_EVIDENCE_BRIDGE_NONCE?.trim() ?? "";
  const exactDeploymentSha = process.env.VERCEL_GIT_COMMIT_SHA?.trim() ?? "";
  const encryptedPayload = request.nextUrl.searchParams.get("payload") ?? "";
  if (
    ownerId === "" ||
    nonce === "" ||
    exactDeploymentSha === "" ||
    encryptedPayload === ""
  ) {
    return unavailable();
  }

  try {
    const result = await createRaceMergeSourceEvidenceUploadTarget({
      encryptedPayload,
      bridgeNonce: nonce,
      exactDeploymentSha,
      ownerId,
      now: new Date(),
      capabilities: hostedImportUploadIntakeRuntime({
        environment: {
          authorizedOwnerId: ownerId,
          database: {
            databaseUrl: process.env.DATABASE_URL,
            databaseOwnerId: process.env.DNA_DATABASE_OWNER_ID,
            runtimeRole: process.env.DNA_DATABASE_RUNTIME_ROLE,
          },
          r2: {
            accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
            bucketName: process.env.DNA_R2_BUCKET_NAME,
            accessKeyId: process.env.DNA_R2_ACCESS_KEY_ID,
            secretAccessKey: process.env.DNA_R2_SECRET_ACCESS_KEY,
          },
          cloudflareApiToken: process.env.CLOUDFLARE_API_TOKEN,
          queueId: process.env.DNA_IMPORT_QUEUE_ID,
          capacity: {
            approvedLimits: {
              r2_storage_bytes: process.env.DNA_IMPORT_LIMIT_R2_STORAGE_BYTES,
              r2_class_a_operations:
                process.env.DNA_IMPORT_LIMIT_R2_CLASS_A_OPERATIONS,
              r2_class_b_operations:
                process.env.DNA_IMPORT_LIMIT_R2_CLASS_B_OPERATIONS,
              neon_storage_bytes:
                process.env.DNA_IMPORT_LIMIT_NEON_STORAGE_BYTES,
              queue_backlog_messages:
                process.env.DNA_IMPORT_LIMIT_QUEUE_BACKLOG_MESSAGES,
            },
            minimumHeadroomBasisPoints:
              process.env.DNA_IMPORT_MINIMUM_HEADROOM_BASIS_POINTS,
            maximumMeasurementAgeMilliseconds:
              process.env.DNA_IMPORT_MAXIMUM_MEASUREMENT_AGE_MILLISECONDS,
          },
        },
      }),
    });
    if (result.status !== "ready") return unavailable();
    return NextResponse.json(
      {
        status: "ready",
        objectId: result.objectId,
        targetToken: result.targetToken,
        expiresAt: result.expiresAt,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
          "X-Robots-Tag": "noindex, nofollow, noarchive",
        },
      },
    );
  } catch {
    return unavailable();
  }
}
