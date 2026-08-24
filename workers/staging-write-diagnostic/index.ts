import { createHash } from "node:crypto";
import { Pool } from "@neondatabase/serverless";

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

type Env = Readonly<{
  DATABASE_URL?: string;
  DNA_DATABASE_OWNER_ID?: string;
}>;

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

async function stagingWriteProbe(): Promise<void> {
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
  } finally {
    await active.abort({ reason: "sink_failed" });
  }
}

async function transactionAcrossFetchProbe(env: Env): Promise<void> {
  const databaseUrl = env.DATABASE_URL?.trim() ?? "";
  const databaseOwnerId = env.DNA_DATABASE_OWNER_ID?.trim() ?? "";
  if (databaseUrl === "" || databaseOwnerId === "") {
    throw new Error("diagnostic database configuration is unavailable");
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });
  const client = await pool.connect();
  let begun = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    begun = true;
    await client.query("SELECT set_config('app.owner_id', $1, true)", [
      databaseOwnerId,
    ]);
    const before = await client.query(
      "SELECT current_user::text AS current_user, dna.current_owner_id()::text AS owner_id",
    );
    if (
      before.rows[0]?.current_user !== "dna_app_runtime" ||
      before.rows[0]?.owner_id !== databaseOwnerId
    ) {
      throw new Error("diagnostic runtime identity is inconsistent before fetch");
    }

    const external = await fetch("https://example.com/");
    if (!external.ok) throw new Error("diagnostic external fetch failed");
    await external.arrayBuffer();

    const after = await client.query(
      "SELECT current_user::text AS current_user, dna.current_owner_id()::text AS owner_id",
    );
    if (
      after.rows[0]?.current_user !== "dna_app_runtime" ||
      after.rows[0]?.owner_id !== databaseOwnerId
    ) {
      throw new Error("diagnostic runtime identity is inconsistent after fetch");
    }
    await client.query("ROLLBACK");
    begun = false;
  } finally {
    if (begun) await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    await pool.end().catch(() => undefined);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const path = new URL(request.url).pathname;
      if (path === "/transaction") {
        await transactionAcrossFetchProbe(env);
        return new Response("workerd transaction across fetch passed", {
          status: 200,
        });
      }
      await stagingWriteProbe();
      return new Response("workerd staging write passed", { status: 200 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown failure";
      return new Response(`workerd diagnostic failed: ${message}`, {
        status: 500,
      });
    }
  },
};
