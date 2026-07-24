import type {
  HistoricalImportSource,
  ImportBatchStatus,
  ImportIssueCount,
  PrivateImportBatch,
} from "@/domain/import-workflow";
import type { ImportBatchRepository } from "@/lib/import-workspace-service";

const ownerIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const supportedSources = new Set<HistoricalImportSource>([
  "race_merge",
  "core_details",
  "current_vault",
  "current_arena",
]);

const supportedStatuses = new Set<ImportBatchStatus>([
  "uploaded",
  "validating",
  "quarantined",
  "accepted",
  "rolled_back",
]);

const supportedSeverities = new Set<ImportIssueCount["severity"]>([
  "info",
  "warning",
  "error",
]);

const setOwnerScopeSql = `
  SELECT set_config('app.owner_id', $1, true) AS owner_scope
`;

const verifyOwnerSql = `
  SELECT id::text AS owner_id
  FROM dna.app_owner
  WHERE id = $1::uuid AND clerk_user_id = $2
`;

const listImportBatchesSql = `
  WITH selected_batches AS (
    SELECT recent.id
    FROM (
      SELECT batch.id
      FROM dna.import_batch batch
      WHERE
        batch.owner_id = $1::uuid
        AND batch.source_type IN (
          'race_merge',
          'core_details',
          'current_vault',
          'current_arena'
        )
      ORDER BY batch.uploaded_at DESC, batch.id
      LIMIT 200
    ) recent

    UNION

    SELECT version.import_batch_id
    FROM dna.dataset_version version
    WHERE version.owner_id = $1::uuid AND version.is_active
  ),
  issue_rollup AS (
    SELECT
      warning.import_batch_id,
      warning.warning_code,
      warning.severity,
      sum(warning.occurrence_count)::text AS occurrence_count
    FROM dna.import_warning warning
    JOIN selected_batches selected ON selected.id = warning.import_batch_id
    WHERE warning.owner_id = $1::uuid
    GROUP BY
      warning.import_batch_id,
      warning.warning_code,
      warning.severity
  ),
  issue_counts AS (
    SELECT
      issue.import_batch_id,
      jsonb_agg(
        jsonb_build_object(
          'code', issue.warning_code,
          'severity', issue.severity,
          'occurrenceCount', issue.occurrence_count
        )
        ORDER BY issue.severity, issue.warning_code
      ) AS issues
    FROM issue_rollup issue
    GROUP BY issue.import_batch_id
  ),
  identity_counts AS (
    SELECT
      review.import_batch_id,
      count(*) AS review_count
    FROM dna.identity_review review
    JOIN selected_batches selected ON selected.id = review.import_batch_id
    WHERE
      review.owner_id = $1::uuid
      AND review.match_status IN ('ambiguous', 'unmatched')
    GROUP BY review.import_batch_id
  ),
  reconciliation_count AS (
    SELECT count(*) AS review_count
    FROM dna.manual_star_observation observation
    WHERE
      observation.owner_id = $1::uuid
      AND observation.reconciliation_status IN ('pending', 'review_required')
  )
  SELECT
    batch.id::text AS batch_id,
    batch.source_type,
    batch.status,
    to_char(
      timezone('UTC', batch.uploaded_at),
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ) AS uploaded_at,
    CASE
      WHEN batch.import_completed_at IS NULL THEN NULL
      ELSE to_char(
        timezone('UTC', batch.import_completed_at),
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      )
    END AS import_completed_at,
    CASE
      WHEN version.data_current_through IS NULL THEN NULL
      ELSE to_char(
        timezone('UTC', version.data_current_through),
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      )
    END AS data_current_through,
    CASE
      WHEN version.aggregate_refreshed_at IS NULL THEN NULL
      ELSE to_char(
        timezone('UTC', version.aggregate_refreshed_at),
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      )
    END AS aggregate_refreshed_at,
    batch.source_rows,
    batch.accepted_rows,
    batch.rejected_rows,
    batch.warning_rows,
    coalesce(version.is_active, false) AS is_active,
    coalesce(
      EXISTS (
        SELECT 1
        FROM dna.dataset_version prior
        WHERE
          prior.owner_id = batch.owner_id
          AND prior.source_type = batch.source_type
          AND prior.version_number < version.version_number
          AND prior.rolled_back_at IS NULL
      ),
      false
    ) AS prior_version_available,
    coalesce(identity_counts.review_count, 0) AS identity_review_count,
    CASE
      WHEN version.is_active AND batch.source_type = 'race_merge'
        THEN reconciliation_count.review_count
      ELSE 0
    END AS reconciliation_review_count,
    coalesce(issue_counts.issues, '[]'::jsonb) AS issue_counts
  FROM selected_batches selected
  JOIN dna.import_batch batch
    ON batch.owner_id = $1::uuid
    AND batch.id = selected.id
  LEFT JOIN dna.dataset_version version
    ON version.owner_id = batch.owner_id
    AND version.import_batch_id = batch.id
  LEFT JOIN identity_counts
    ON identity_counts.import_batch_id = batch.id
  LEFT JOIN issue_counts
    ON issue_counts.import_batch_id = batch.id
  CROSS JOIN reconciliation_count
  WHERE EXISTS (
    SELECT 1
    FROM dna.app_owner owner
    WHERE
      owner.id = batch.owner_id
      AND owner.clerk_user_id = $2
  )
  ORDER BY batch.uploaded_at DESC, batch.id
`;

type TransactionExecutor = (
  input: Readonly<{
    databaseOwnerId: string;
    authenticatedOwnerId: string;
  }>,
) => Promise<
  readonly [readonly unknown[], readonly unknown[], readonly unknown[]]
>;

export type TransactionExecutorFactory = (
  databaseUrl: string,
) => Promise<TransactionExecutor>;

export type ImportRepositoryEnvironment = Readonly<{
  databaseUrl: string | undefined;
  databaseOwnerId: string | undefined;
}>;

function normalized(value: string | undefined): string | null {
  const result = value?.trim() ?? "";
  return result === "" ? null : result;
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be a database record`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function optionalTimestamp(value: unknown, field: string): string | null {
  if (value === null) return null;
  const timestamp = requiredString(value, field);
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== timestamp) {
    throw new Error(`${field} must be a canonical ISO-8601 timestamp`);
  }
  return timestamp;
}

function requiredTimestamp(value: unknown, field: string): string {
  const timestamp = optionalTimestamp(value, field);
  if (timestamp === null) throw new Error(`${field} is required`);
  return timestamp;
}

function nonNegativeInteger(value: unknown, field: string): number {
  let parsed: number;
  if (typeof value === "bigint") parsed = Number(value);
  else if (typeof value === "number") parsed = value;
  else if (typeof value === "string" && /^\d+$/.test(value)) {
    parsed = Number(value);
  } else {
    throw new Error(`${field} must be a non-negative integer`);
  }
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${field} must be a non-negative safe integer`);
  }
  return parsed;
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${field} must be a boolean`);
  }
  return value;
}

function issueCounts(value: unknown): readonly ImportIssueCount[] {
  const parsed =
    typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (!Array.isArray(parsed)) {
    throw new Error("issue_counts must be an array");
  }

  return parsed.map((item, index) => {
    const issue = record(item, `issue_counts[${index}]`);
    const code = requiredString(issue.code, `issue_counts[${index}].code`);
    const severity = requiredString(
      issue.severity,
      `issue_counts[${index}].severity`,
    );
    if (!supportedSeverities.has(severity as ImportIssueCount["severity"])) {
      throw new Error(`issue_counts[${index}].severity is unsupported`);
    }
    const occurrenceCount = nonNegativeInteger(
      issue.occurrenceCount,
      `issue_counts[${index}].occurrenceCount`,
    );
    if (occurrenceCount === 0) {
      throw new Error(
        `issue_counts[${index}].occurrenceCount must be positive`,
      );
    }
    return {
      code,
      severity: severity as ImportIssueCount["severity"],
      occurrenceCount,
    };
  });
}

function importBatch(value: unknown): PrivateImportBatch {
  const row = record(value, "import batch");
  const sourceType = requiredString(row.source_type, "source_type");
  const status = requiredString(row.status, "status");
  if (!supportedSources.has(sourceType as HistoricalImportSource)) {
    throw new Error("source_type is unsupported");
  }
  if (!supportedStatuses.has(status as ImportBatchStatus)) {
    throw new Error("status is unsupported");
  }

  return {
    batchId: requiredString(row.batch_id, "batch_id"),
    sourceType: sourceType as HistoricalImportSource,
    status: status as ImportBatchStatus,
    uploadedAt: requiredTimestamp(row.uploaded_at, "uploaded_at"),
    importCompletedAt: optionalTimestamp(
      row.import_completed_at,
      "import_completed_at",
    ),
    dataCurrentThrough: optionalTimestamp(
      row.data_current_through,
      "data_current_through",
    ),
    aggregateRefreshedAt: optionalTimestamp(
      row.aggregate_refreshed_at,
      "aggregate_refreshed_at",
    ),
    sourceRows: nonNegativeInteger(row.source_rows, "source_rows"),
    acceptedRows: nonNegativeInteger(row.accepted_rows, "accepted_rows"),
    rejectedRows: nonNegativeInteger(row.rejected_rows, "rejected_rows"),
    warningRows: nonNegativeInteger(row.warning_rows, "warning_rows"),
    isActive: boolean(row.is_active, "is_active"),
    priorVersionAvailable: boolean(
      row.prior_version_available,
      "prior_version_available",
    ),
    identityReviewCount: nonNegativeInteger(
      row.identity_review_count,
      "identity_review_count",
    ),
    reconciliationReviewCount: nonNegativeInteger(
      row.reconciliation_review_count,
      "reconciliation_review_count",
    ),
    issueCounts: issueCounts(row.issue_counts),
  };
}

function verifiedDatabaseOwner(
  rows: readonly unknown[],
  expectedOwnerId: string,
): void {
  if (rows.length !== 1) {
    throw new Error("Import repository owner scope denied.");
  }
  const owner = record(rows[0], "database owner");
  if (requiredString(owner.owner_id, "owner_id") !== expectedOwnerId) {
    throw new Error("Import repository owner scope denied.");
  }
}

async function defaultExecutorFactory(
  databaseUrl: string,
): Promise<TransactionExecutor> {
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(databaseUrl);

  return async ({ databaseOwnerId, authenticatedOwnerId }) => {
    const result = await sql.transaction(
      (transaction) => [
        transaction.query(setOwnerScopeSql, [databaseOwnerId]),
        transaction.query(verifyOwnerSql, [
          databaseOwnerId,
          authenticatedOwnerId,
        ]),
        transaction.query(listImportBatchesSql, [
          databaseOwnerId,
          authenticatedOwnerId,
        ]),
      ],
      {
        isolationLevel: "RepeatableRead",
        readOnly: true,
        fetchOptions: { signal: AbortSignal.timeout(10_000) },
      },
    );
    return result as unknown as readonly [
      readonly unknown[],
      readonly unknown[],
      readonly unknown[],
    ];
  };
}

export function createNeonImportBatchRepository(
  input: Readonly<{
    databaseUrl: string;
    databaseOwnerId: string;
    executorFactory?: TransactionExecutorFactory;
  }>,
): ImportBatchRepository {
  const databaseUrl = input.databaseUrl.trim();
  const databaseOwnerId = input.databaseOwnerId.trim();
  if (databaseUrl === "") throw new Error("databaseUrl is required");
  if (!ownerIdPattern.test(databaseOwnerId)) {
    throw new Error("databaseOwnerId must be a UUID");
  }

  const executorFactory = input.executorFactory ?? defaultExecutorFactory;
  let executor: Promise<TransactionExecutor> | null = null;

  return {
    status: "ready",
    async listBatchesByOwner(authenticatedOwnerId) {
      const normalizedOwnerId = authenticatedOwnerId.trim();
      if (normalizedOwnerId === "") {
        throw new Error("authenticatedOwnerId is required");
      }
      executor ??= executorFactory(databaseUrl).catch((error: unknown) => {
        executor = null;
        throw error;
      });
      const [, ownerRows, batchRows] = await (
        await executor
      )({
        databaseOwnerId,
        authenticatedOwnerId: normalizedOwnerId,
      });
      verifiedDatabaseOwner(ownerRows, databaseOwnerId);
      return batchRows.map(importBatch);
    },
  };
}

export function importBatchRepositoryFromEnvironment(
  environment: ImportRepositoryEnvironment,
  executorFactory?: TransactionExecutorFactory,
): ImportBatchRepository {
  const databaseUrl = normalized(environment.databaseUrl);
  const databaseOwnerId = normalized(environment.databaseOwnerId);
  if (databaseUrl === null || databaseOwnerId === null) {
    return Object.freeze({ status: "not_configured" });
  }
  return createNeonImportBatchRepository({
    databaseUrl,
    databaseOwnerId,
    ...(executorFactory ? { executorFactory } : {}),
  });
}
