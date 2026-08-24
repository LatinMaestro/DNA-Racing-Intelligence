import { Pool } from "@neondatabase/serverless";
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

async function assertEmptyImportRoots(input: {
  databaseUrl: string;
  databaseOwnerId: string;
}): Promise<void> {
  const pool = new Pool({
    connectionString: input.databaseUrl,
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query("SELECT set_config('app.owner_id', $1, true)", [
      input.databaseOwnerId,
    ]);
    const result = await client.query(
      `SELECT
        (SELECT count(*) FROM dna.import_upload_batch WHERE owner_id = $1::uuid) AS upload_batches,
        (SELECT count(*) FROM dna.import_batch WHERE owner_id = $1::uuid) AS import_batches`,
      [input.databaseOwnerId],
    );
    const row = result.rows[0] as
      { upload_batches?: unknown; import_batches?: unknown } | undefined;
    const uploadBatches = Number(row?.upload_batches);
    const importBatches = Number(row?.import_batches);
    if (
      !Number.isSafeInteger(uploadBatches) ||
      !Number.isSafeInteger(importBatches) ||
      uploadBatches !== 0 ||
      importBatches !== 0
    ) {
      throw new Error(
        "Preview import roots are not empty; evidence recovery is blocked",
      );
    }
    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

describeConnected("hosted Preview orphan evidence recovery", () => {
  it("removes only exact unregistered owner evidence before commissioning", async () => {
    const databaseUrl = requiredEnvironment("DATABASE_URL");
    const databaseOwnerId = requiredEnvironment("DNA_DATABASE_OWNER_ID");
    await assertEmptyImportRoots({ databaseUrl, databaseOwnerId });

    const result = await recoverHostedPreviewEvidenceResidue({
      ownerId: requiredEnvironment("AUTHORIZED_CLERK_USER_ID"),
      databaseUrl,
      databaseOwnerId,
      runtimeRole: "dna_app_runtime",
      accountId: requiredEnvironment("CLOUDFLARE_ACCOUNT_ID"),
      apiToken: requiredEnvironment("CLOUDFLARE_API_TOKEN"),
      bucketName: requiredEnvironment("DNA_R2_BUCKET_NAME"),
      accessKeyId: requiredEnvironment("DNA_R2_ACCESS_KEY_ID"),
      secretAccessKey: requiredEnvironment("DNA_R2_SECRET_ACCESS_KEY"),
    });
    expect(result.retained).toBe(0);
    console.log(
      `Recovered ${result.deleted} unregistered Preview evidence object(s); ${result.missing} were already missing.`,
    );
  }, 30_000);
});
