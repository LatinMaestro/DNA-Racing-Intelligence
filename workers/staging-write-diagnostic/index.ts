import { createHash } from "node:crypto";

import { createDurableImportPreviewStagingSink } from "../../lib/durable-import-preview-staging-sink";
import type { DurableImportPreviewStagingRepository } from "../../lib/durable-import-preview-staging-sink";

const ownerId = "user_workerd_diagnostic";
const previewDispatchId = "22222222-2222-4222-8222-222222222222";
const importBatchId = "33333333-3333-4333-8333-333333333333";
const payload = new TextEncoder().encode(
  "event_id,rstart_time,rmode,rcb,token_id,rgate_count,gold_star,blue_star,pos,time,rfee,prize,toke_curr\n" +
    "workerd-event,2026-08-24T00:00:00.000Z,bike,1000,workerd-core,4,false,false,1,50.1,0.01,0.02,DEZ\n",
);
const sha256 = createHash("sha256").update(payload).digest("hex");

function repository(): DurableImportPreviewStagingRepository {
  return {
    async beginObject() {
      return {
        importBatchId,
        async stageSchema(schema) {
          if (schema.status !== "ready" || schema.sourceType !== "race_merge") {
            throw new Error("diagnostic schema did not resolve");
          }
        },
        async stageRows(rows) {
          if (
            rows.length !== 1 ||
            rows[0]?.row.status !== "ready" ||
            rows[0].row.record?.sourceType !== "race_merge"
          ) {
            throw new Error("diagnostic row did not adapt");
          }
        },
        async commitVerified() {
          return {
            importBatchId,
            sourceRowCount: 1,
            readyRowCount: 1,
            quarantinedRowCount: 0,
            warningRowCount: 0,
            blockingIssueCount: 0,
          };
        },
        async rollback() {},
      };
    },
    async assertPreviewObjects() {},
    async abortPreview() {},
  };
}

export default {
  async fetch(): Promise<Response> {
    const sink = createDurableImportPreviewStagingSink({ repository: repository() });
    const active = await sink.beginObject({
      ownerId,
      updateSessionId: previewDispatchId,
      objectId: importBatchId,
      sourceFamily: "race_merge",
      expectedByteLength: payload.byteLength,
      expectedSha256: sha256,
    });
    try {
      await active.write(payload);
      await active.abort({ reason: "sink_failed" });
      return new Response("workerd staging write passed", { status: 200 });
    } catch (error) {
      await active.abort({ reason: "sink_failed" }).catch(() => undefined);
      const message = error instanceof Error ? error.message : "unknown failure";
      return new Response(`workerd staging write failed: ${message}`, {
        status: 500,
      });
    }
  },
};
