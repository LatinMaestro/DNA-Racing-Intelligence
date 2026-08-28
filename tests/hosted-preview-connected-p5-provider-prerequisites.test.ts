import { createHash } from "node:crypto";

import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { Pool } from "@neondatabase/serverless";
import { describe, expect, it } from "vitest";

import { createCloudflareR2DatasetEvidencePort } from "@/lib/cloudflare-r2-dataset-evidence-port";
import {
  assessDnaOpenLabP5ProviderPrerequisites,
  DNA_OPEN_LAB_P5_REQUIRED_FUNCTION_SIGNATURES,
} from "@/lib/dna-open-lab-p5-provider-prerequisites";
import { DNA_OPEN_LAB_P5_OWNER_RELATION_NAMES } from "@/lib/neon-dna-open-lab-p5-capacity-port";

const connected = process.env.DNA_OPEN_LAB_P5_PROVIDER_PREFLIGHT === "1";
const describeConnected = connected ? describe : describe.skip;

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim() ?? "";
  if (value === "" || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`${name} is missing or invalid`);
  }
  return value;
}

function boolean(value: unknown): boolean {
  if (typeof value !== "boolean")
    throw new Error("provider response is invalid");
  return value;
}

function integer(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("provider response is invalid");
  }
  return parsed;
}

describeConnected("hosted Preview P5 provider prerequisites", () => {
  it("proves the exact read-only provider boundary before synthetic capacity measurement", async () => {
    try {
      const databaseUrl = requiredEnvironment("DATABASE_URL");
      const databaseOwnerId = requiredEnvironment("DNA_DATABASE_OWNER_ID");
      const authorizedOwnerId = requiredEnvironment("AUTHORIZED_CLERK_USER_ID");
      const runtimeRole = "dna_app_runtime";
      const accountId = requiredEnvironment("CLOUDFLARE_ACCOUNT_ID");
      const apiToken = requiredEnvironment("CLOUDFLARE_API_TOKEN");
      const accessKeyId = requiredEnvironment("DNA_R2_ACCESS_KEY_ID");
      const secretAccessKey = requiredEnvironment("DNA_R2_SECRET_ACCESS_KEY");
      const bucketName = requiredEnvironment("DNA_R2_BUCKET_NAME");

      const pool = new Pool({
        connectionString: databaseUrl,
        max: 1,
        idleTimeoutMillis: 10_000,
        connectionTimeoutMillis: 10_000,
      });
      const client = await pool.connect();
      let postgres: Record<string, unknown>;
      try {
        await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY");
        const scope = await client.query(
          "SELECT set_config('app.owner_id', $1, true) AS owner_scope",
          [databaseOwnerId],
        );
        const probe = await client.query(
          `SELECT
          current_setting('server_version_num')::int / 10000 AS postgres_major_version,
          EXISTS (
            SELECT 1 FROM dna.app_owner
            WHERE id = $1::uuid AND clerk_user_id = $2
          ) AS owner_binding_valid,
          session_user::text = $3
            AND current_user::text = $3
            AND NOT role.rolsuper
            AND NOT role.rolbypassrls
            AND NOT role.rolcreaterole
            AND NOT role.rolcreatedb
            AND NOT has_database_privilege(session_user, current_database(), 'CREATE')
            AND NOT has_schema_privilege(session_user, 'dna', 'CREATE')
            AND NOT COALESCE(
              pg_has_role(session_user, (
                SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'neon_superuser'
              ), 'MEMBER'), false
            ) AS runtime_least_privilege_valid,
          (SELECT count(*) FROM unnest($4::text[]) name
            WHERE to_regclass('dna.' || name) IS NOT NULL) AS present_relation_count,
          (SELECT count(*) FROM unnest($5::text[]) signature
            WHERE to_regprocedure(signature) IS NOT NULL) AS present_function_count,
          CASE
            WHEN to_regprocedure(
              'dna.publish_dna_open_lab_sync_candidate(uuid,uuid,timestamp with time zone)'
            ) IS NULL THEN false
            ELSE NOT has_function_privilege(
              session_user,
              to_regprocedure(
                'dna.publish_dna_open_lab_sync_candidate(uuid,uuid,timestamp with time zone)'
              ),
              'EXECUTE'
            )
          END AS legacy_publish_revoked
        FROM pg_catalog.pg_roles role
        WHERE role.rolname = session_user`,
          [
            databaseOwnerId,
            authorizedOwnerId,
            runtimeRole,
            DNA_OPEN_LAB_P5_OWNER_RELATION_NAMES,
            DNA_OPEN_LAB_P5_REQUIRED_FUNCTION_SIGNATURES,
          ],
        );
        if (
          scope.rows.length !== 1 ||
          scope.rows[0]?.owner_scope !== databaseOwnerId ||
          probe.rows.length !== 1
        ) {
          throw new Error("provider response is invalid");
        }
        postgres = probe.rows[0] as Record<string, unknown>;
        await client.query("ROLLBACK");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
        await pool.end();
      }

      const r2 = createCloudflareR2DatasetEvidencePort({
        accountId,
        apiToken,
        accessKeyId,
        secretAccessKey,
      });
      const privacy = await r2.readBucketPrivacy({ bucketName });
      const ownerPrefix = createHash("sha256")
        .update(`dna-open-lab-owner\u0000${authorizedOwnerId}`)
        .digest("hex");
      const s3 = new S3Client({
        region: "auto",
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        forcePathStyle: true,
        credentials: { accessKeyId, secretAccessKey },
      });
      const residue = await s3.send(
        new ListObjectsV2Command({
          Bucket: bucketName,
          Prefix: `dna-open-lab/v1/${ownerPrefix}/p5-capacity/`,
          MaxKeys: 2,
        }),
      );

      const report = assessDnaOpenLabP5ProviderPrerequisites({
        postgresMajorVersion: integer(postgres.postgres_major_version),
        ownerBindingValid: boolean(postgres.owner_binding_valid),
        runtimeLeastPrivilegeValid: boolean(
          postgres.runtime_least_privilege_valid,
        ),
        presentRelationCount: integer(postgres.present_relation_count),
        presentFunctionCount: integer(postgres.present_function_count),
        legacyPublishRevoked: boolean(postgres.legacy_publish_revoked),
        r2Private:
          privacy.publicAccessDisabled === true &&
          privacy.r2DevDisabled === true &&
          privacy.customDomainCount === 0,
        r2OwnerPrefixReadable: true,
        syntheticResidueObjectCount: integer(residue.KeyCount ?? 0),
      });
      console.log(JSON.stringify(report));
      expect(report.readyForBoundedSyntheticMeasurement).toBe(true);
      expect(report.firstPersistentPrivatePreviewSyncAllowed).toBe(false);
      expect(report.productionChangesAllowed).toBe(false);
    } catch {
      throw new Error("DNA Open Lab P5 provider prerequisite probe failed");
    }
  }, 30_000);
});
