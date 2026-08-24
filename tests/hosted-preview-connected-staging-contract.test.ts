import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { adaptSourceRow } from "@/domain/source-adapters";
import { stageSourceHeader } from "@/domain/source-schema";
import type { DurablePreviewStagedRow } from "@/lib/durable-import-preview-staging-sink";
import { completePrivateImportUpload } from "@/lib/import-upload-completion-service";
import { createNeonDurableImportPreviewStagingRepository } from "@/lib/neon-durable-import-preview-staging-repository";
import { createNeonImportPreActivationCleanupRepository } from "@/lib/neon-import-pre-activation-cleanup-repository";
import { createNeonImportPreviewProcessingRepository } from "@/lib/neon-import-preview-processing-repository";
import { createNeonImportUploadCompletionRepository } from "@/lib/neon-import-upload-completion-repository";
import { createNeonImportUploadIntakeRepository } from "@/lib/neon-import-upload-intake-repository";

const connected = process.env.DNA_CONNECTED_PREVIEW_ACCEPTANCE === "1";
const describeConnected = connected ? describe : describe.skip;

type SourceFamily = "race_merge" | "core_details" | "current_arena";
type ProbeFile = Readonly<{
  clientFileId: string;
  sourceFamily: SourceFamily;
  originalFileName: string;
  text: string;
  payload: Uint8Array;
  sha256: string;
}>;

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim() ?? "";
  if (value === "" || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${name} is missing or invalid`);
  }
  return value;
}

function probeFiles(runId: string, runAttempt: string): readonly ProbeFile[] {
  const definitions = [
    {
      clientFileId: `staging-probe-core-${runId}-${runAttempt}`,
      sourceFamily: "core_details" as const,
      originalFileName: "Core Details.csv",
      text: [
        "bikeid,core_name,core_type,gender,f_no,element",
        "connected-core,Connected Core,Genesis,Female,F1,Fire",
      ].join("\n"),
    },
    ...Array.from({ length: 7 }, (_, index) => {
      const segment = index + 1;
      const day = String(10 + index).padStart(2, "0");
      const payout = segment % 2 === 0 ? "Winner Take All" : "Top 3";
      return {
        clientFileId: `staging-probe-race-${segment}-${runId}-${runAttempt}`,
        sourceFamily: "race_merge" as const,
        originalFileName: `Race Merge ${segment}.csv`,
        text: [
          "event_id,rstart_time,rmode,rcb,token_id,rgate_count,gold_star,blue_star,pos,time,rpayout,rfee,prize,toke_curr,r_tags",
          `staging-probe-event-${runId}-${runAttempt}-${segment},2026-08-${day}T00:00:00.000Z,Bike,1000,connected-core,8,false,false,1,61.${segment}0,${payout},0,0,DEZ,Synthetic`,
        ].join("\n"),
      };
    }),
    {
      clientFileId: `staging-probe-arena-${runId}-${runAttempt}`,
      sourceFamily: "current_arena" as const,
      originalFileName: "Current Arena.csv",
      text: ["token_id,price_usd", "connected-core,125.00"].join("\n"),
    },
  ];

  return definitions.map((definition) => {
    const payload = new TextEncoder().encode(`${definition.text}\n`);
    return {
      ...definition,
      payload,
      sha256: createHash("sha256").update(payload).digest("hex"),
    };
  });
}

function stagedRow(file: ProbeFile): {
  schema: ReturnType<typeof stageSourceHeader>;
  row: DurablePreviewStagedRow;
} {
  const [header, data, ...extra] = file.text.split("\n");
  if (header === undefined || data === undefined || extra.length !== 0) {
    throw new Error(`Synthetic staging probe ${file.clientFileId} is malformed`);
  }
  const headerBytes = new TextEncoder().encode(`${header}\n`);
  const schema = stageSourceHeader({
    headerBytes,
    encodingProbeBytes: headerBytes,
    selectedSourceType: file.sourceFamily,
  });
  if (schema.status !== "ready") {
    throw new Error(`Synthetic staging schema is not ready for ${file.clientFileId}`);
  }
  const adapted = adaptSourceRow(schema, data.split(","));
  if (adapted.status !== "ready" || adapted.record === null) {
    throw new Error(`Synthetic staging row is not ready for ${file.clientFileId}`);
  }
  const naturalKey =
    adapted.record.sourceType === "race_merge"
      ? `${adapted.record.sourceEventId}:${adapted.record.sourceCoreId}`
      : adapted.record.sourceCoreId;
  return {
    schema,
    row: {
      sourceRowNumber: 1,
      naturalKey,
      fingerprintSha256: createHash("sha256")
        .update(JSON.stringify(adapted.record))
        .digest("hex"),
      row: adapted,
    },
  };
}

function safeError(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 500);
  return "unknown staging error";
}

describeConnected("hosted Preview least-privilege staging contract", () => {
  it(
    "stages the current nine-file synthetic contract directly under the runtime role",
    async () => {
      const ownerId = requiredEnvironment("AUTHORIZED_CLERK_USER_ID");
      const databaseUrl = requiredEnvironment("DATABASE_URL");
      const databaseOwnerId = requiredEnvironment("DNA_DATABASE_OWNER_ID");
      const runId = requiredEnvironment("GITHUB_RUN_ID");
      const runAttempt = requiredEnvironment("GITHUB_RUN_ATTEMPT");
      const files = probeFiles(runId, runAttempt);
      const requestFingerprint = createHash("sha256")
        .update(
          `connected-staging-probe:${runId}:${runAttempt}:${files
            .map((file) => file.sha256)
            .join(":")}`,
        )
        .digest("hex");
      const intake = createNeonImportUploadIntakeRepository({
        databaseUrl,
        databaseOwnerId,
        runtimeRole: "dna_app_runtime",
      });
      const completionRepository = createNeonImportUploadCompletionRepository({
        databaseUrl,
        databaseOwnerId,
        runtimeRole: "dna_app_runtime",
      });
      const processingRepository = createNeonImportPreviewProcessingRepository({
        databaseUrl,
        databaseOwnerId,
        runtimeRole: "dna_app_runtime",
      });
      const stagingRepository = createNeonDurableImportPreviewStagingRepository({
        databaseUrl,
        databaseOwnerId,
        runtimeRole: "dna_app_runtime",
      });
      const cleanup = createNeonImportPreActivationCleanupRepository({
        databaseUrl,
        databaseOwnerId,
        runtimeRole: "dna_app_runtime",
      });
      let uploadBatchId: string | null = null;
      let previewDispatchId: string | null = null;
      const workerId = `staging-probe-${runId}-${runAttempt}`;
      const fileByUploadId = new Map<string, ProbeFile>();

      try {
        const reservation = await intake.reserveUploadBatch({
          ownerId,
          idempotencyKey: `staging-probe-${runId}-${runAttempt}`,
          requestedAt: new Date().toISOString(),
          requestFingerprint,
          files: files.map((file) => ({
            clientFileId: file.clientFileId,
            sourceFamily: file.sourceFamily,
            originalFileName: file.originalFileName,
            contentType: "text/csv",
            byteLength: file.payload.byteLength,
            sha256: file.sha256,
          })),
        });
        uploadBatchId = reservation.uploadBatchId;
        const reservedByClientId = new Map(
          reservation.files.map((file) => [file.clientFileId, file.uploadFileId]),
        );
        for (const file of files) {
          const uploadFileId = reservedByClientId.get(file.clientFileId);
          if (uploadFileId === undefined) {
            throw new Error(`Staging probe omitted ${file.clientFileId}`);
          }
          fileByUploadId.set(uploadFileId, file);
        }
        await intake.markUploadTargetsReady({
          ownerId,
          uploadBatchId,
          uploadFileIds: reservation.files.map((file) => file.uploadFileId),
          requestFingerprint,
          expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        });

        const completion = await completePrivateImportUpload({
          authenticatedOwnerId: ownerId,
          configuredOwnerId: ownerId,
          uploadBatchId,
          idempotencyKey: `staging-probe-complete-${runId}-${runAttempt}`,
          uploadRequestFingerprint: requestFingerprint,
          now: new Date(),
          capabilities: {
            status: "ready",
            repository: completionRepository,
            objectInspector: {
              async inspectObject(input) {
                const file = fileByUploadId.get(input.uploadFileId);
                if (file === undefined) return { status: "missing" } as const;
                return {
                  status: "ready" as const,
                  scope: "private_owner" as const,
                  ownerId: input.ownerId,
                  uploadBatchId: input.uploadBatchId,
                  uploadFileId: input.uploadFileId,
                  objectId: input.objectId,
                  objectVersion: `staging-probe-${runId}-${runAttempt}`,
                  advertisedByteLength: file.payload.byteLength,
                  advertisedContentType: "text/csv",
                  providerSha256: file.sha256,
                };
              },
            },
            previewQueue: {
              async enqueue(input) {
                return {
                  disposition: "created" as const,
                  previewDispatchId: input.previewDispatchId,
                  uploadRequestFingerprint: input.uploadRequestFingerprint,
                };
              },
            },
          },
        });
        expect(completion.status).toBe("queued_for_preview");
        if (completion.status !== "queued_for_preview") {
          throw new Error("Staging probe did not create a Preview dispatch");
        }
        previewDispatchId = completion.previewDispatchId;
        const claimedAt = new Date();
        const claim = await processingRepository.claimPreviewDispatch({
          previewDispatchId,
          workerId,
          uploadRequestFingerprint: requestFingerprint,
          claimedAt: claimedAt.toISOString(),
          leaseExpiresAt: new Date(claimedAt.getTime() + 5 * 60 * 1000).toISOString(),
        });
        expect(claim.status).toBe("claimed");
        if (claim.status !== "claimed") {
          throw new Error("Staging probe could not claim the Preview dispatch");
        }

        for (const claimedFile of claim.files) {
          const file = fileByUploadId.get(claimedFile.uploadFileId);
          if (file === undefined) {
            throw new Error(`Staging probe cannot map ${claimedFile.uploadFileId}`);
          }
          const transaction = await stagingRepository.beginObject({
            ownerId,
            previewDispatchId,
            objectId: claimedFile.objectId,
            sourceFamily: claimedFile.sourceFamily,
            expectedByteLength: claimedFile.expectedByteLength,
            expectedSha256: claimedFile.expectedSha256,
          });
          try {
            const prepared = stagedRow(file);
            await transaction.stageSchema(prepared.schema);
            await transaction.stageRows([prepared.row]);
          } catch (error) {
            throw new Error(
              `Connected staging probe failed for ${file.sourceFamily}/${file.clientFileId}: ${safeError(error)}`,
            );
          } finally {
            await transaction.rollback({ reason: "sink_failed" });
          }
        }

        await processingRepository.recordPreviewFailure({
          ownerId,
          uploadBatchId,
          previewDispatchId,
          workerId,
          uploadRequestFingerprint: requestFingerprint,
          failedAt: new Date().toISOString(),
          reason: "preview_processor_failed",
        });
      } finally {
        if (uploadBatchId !== null) {
          await cleanup.cleanupBeforeActivation({
            ownerId,
            uploadBatchId,
            requestFingerprintSha256: requestFingerprint,
            reason: "Connected synthetic staging contract probe cleanup.",
            cleanedAt: new Date().toISOString(),
          });
        }
      }
    },
    60_000,
  );
});
