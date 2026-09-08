import {
  DNA_FINISHED_RACE_INCREMENTAL_PUBLICATION_VERSION,
  type DnaFinishedRaceIncrementalPublication,
  type DnaFinishedRaceIncrementalPublicationCandidate,
  type DnaFinishedRaceIncrementalPublicationRepository,
  type DnaFinishedRaceIncrementalWindowReceipt,
} from "./dna-open-lab-finished-race-incremental-publication";
import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceSessionFactory,
} from "./neon-import-persistence-driver";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;
const ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

type QueryResult = Readonly<{ rows: readonly unknown[] }>;
type DbRow = Record<string, unknown>;

const SET_OWNER_SCOPE_SQL =
  "SELECT set_config('app.owner_id', $1, true) AS owner_scope";

const VERIFY_ISOLATION_SQL = [
  "SELECT owner.id::text AS database_owner_id, owner.clerk_user_id AS authenticated_owner_id,",
  "  publication.relrowsecurity AS publication_rls,",
  "  publication.relforcerowsecurity AS publication_force_rls,",
  "  active.relrowsecurity AS active_rls, active.relforcerowsecurity AS active_force_rls,",
  "  (has_table_privilege(session_user, 'dna.dna_open_lab_finished_race_incremental_publication', 'SELECT')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_finished_race_incremental_publication', 'INSERT')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_finished_race_incremental_publication', 'UPDATE')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_finished_race_incremental_publication', 'DELETE')) AS runtime_can_access_publication,",
  "  (has_table_privilege(session_user, 'dna.dna_open_lab_finished_race_incremental_active', 'SELECT')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_finished_race_incremental_active', 'INSERT')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_finished_race_incremental_active', 'UPDATE')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_finished_race_incremental_active', 'DELETE')) AS runtime_can_access_active,",
  "  has_function_privilege(session_user, 'dna.read_dna_open_lab_finished_race_incremental_receipts(uuid,text,integer)', 'EXECUTE') AS runtime_can_read_receipts,",
  "  has_function_privilege(session_user, 'dna.publish_dna_open_lab_finished_race_incremental_cycle(uuid,text,integer,integer,bigint,bigint,character,timestamp with time zone,timestamp with time zone)', 'EXECUTE') AS runtime_can_publish,",
  "  has_function_privilege(session_user, 'dna.read_dna_open_lab_finished_race_incremental_last_good(uuid)', 'EXECUTE') AS runtime_can_read_last_good,",
  "  session_user::text AS session_user_name, current_user::text AS current_user_name,",
  "  role.rolsuper AS runtime_is_superuser, role.rolbypassrls AS runtime_bypasses_rls,",
  "  role.rolcreaterole AS runtime_can_create_roles, role.rolcreatedb AS runtime_can_create_databases,",
  "  COALESCE(pg_has_role(session_user, (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'neon_superuser'), 'MEMBER'), false) AS runtime_is_neon_superuser_member",
  "FROM dna.app_owner owner",
  "JOIN pg_catalog.pg_class publication ON publication.oid = 'dna.dna_open_lab_finished_race_incremental_publication'::regclass",
  "JOIN pg_catalog.pg_class active ON active.oid = 'dna.dna_open_lab_finished_race_incremental_active'::regclass",
  "JOIN pg_catalog.pg_roles role ON role.rolname = session_user",
  "WHERE owner.id = $1::uuid AND owner.clerk_user_id = $2",
].join("\n");

function record(value: unknown, field: string): DbRow {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be a database record`);
  }
  return value as DbRow;
}

function oneRow(result: QueryResult, field: string): DbRow {
  if (result.rows.length !== 1) {
    throw new Error(`${field} must return exactly one row`);
  }
  return record(result.rows[0], field);
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function nullableText(value: unknown, field: string): string | null {
  return value === null ? null : text(value, field);
}

function bool(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${field} must be boolean`);
  return value;
}

function integer(value: unknown, field: string): number {
  const normalized =
    typeof value === "bigint" || typeof value === "number"
      ? Number(value)
      : Number(text(value, field));
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new Error(`${field} must be a non-negative safe integer`);
  }
  return normalized;
}

function timestamp(value: unknown, field: string): string {
  const parsed =
    value instanceof Date ? value.getTime() : Date.parse(text(value, field));
  if (!Number.isFinite(parsed)) throw new Error(`${field} must be a timestamp`);
  return new Date(parsed).toISOString();
}

function sha256(value: unknown, field: string): string {
  const normalized = text(value, field).toLowerCase();
  if (!SHA_256_PATTERN.test(normalized)) throw new Error(`${field} is invalid`);
  return normalized;
}

function uuid(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized))
    throw new Error(`${field} must be a UUID`);
  return normalized;
}

function owner(value: string): string {
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > 512 ||
    CONTROL_PATTERN.test(normalized)
  ) {
    throw new Error("ownerId is invalid");
  }
  return normalized;
}

function verifyIsolation(
  result: QueryResult,
  input: { databaseOwnerId: string; ownerId: string; runtimeRole: string },
): void {
  const row = oneRow(result, "DNA finished-race publication isolation");
  if (
    text(row.database_owner_id, "database_owner_id") !==
      input.databaseOwnerId ||
    text(row.authenticated_owner_id, "authenticated_owner_id") !== input.ownerId
  ) {
    throw new Error("DNA finished-race publication owner scope denied.");
  }
  for (const field of [
    "publication_rls",
    "publication_force_rls",
    "active_rls",
    "active_force_rls",
    "runtime_can_read_receipts",
    "runtime_can_publish",
    "runtime_can_read_last_good",
  ]) {
    if (!bool(row[field], field)) {
      throw new Error("DNA finished-race publication isolation is incomplete.");
    }
  }
  if (
    bool(
      row.runtime_can_access_publication,
      "runtime_can_access_publication",
    ) ||
    bool(row.runtime_can_access_active, "runtime_can_access_active") ||
    text(row.session_user_name, "session_user_name") !== input.runtimeRole ||
    text(row.current_user_name, "current_user_name") !== input.runtimeRole ||
    bool(row.runtime_is_superuser, "runtime_is_superuser") ||
    bool(row.runtime_bypasses_rls, "runtime_bypasses_rls") ||
    bool(row.runtime_can_create_roles, "runtime_can_create_roles") ||
    bool(row.runtime_can_create_databases, "runtime_can_create_databases") ||
    bool(
      row.runtime_is_neon_superuser_member,
      "runtime_is_neon_superuser_member",
    )
  ) {
    throw new Error("DNA finished-race publication runtime role is unsafe.");
  }
}

function receipt(rowValue: unknown): DnaFinishedRaceIncrementalWindowReceipt {
  const row = record(rowValue, "finished-race receipt");
  return Object.freeze({
    cycleId: sha256(row.cycle_id, "cycle_id"),
    firstAttemptNumber: integer(
      row.first_attempt_number,
      "first_attempt_number",
    ),
    windowStartAt: timestamp(row.window_start_at, "window_start_at"),
    windowEndAt: timestamp(row.window_end_at, "window_end_at"),
    windowKey: sha256(row.window_key, "window_key"),
    contentSha256: sha256(row.content_sha256, "content_sha256"),
    documentCount: integer(row.document_count, "document_count"),
    manifestObjectKey: text(row.manifest_object_key, "manifest_object_key"),
    manifestBodySha256: sha256(
      row.manifest_body_sha256,
      "manifest_body_sha256",
    ),
    manifestByteLength: integer(
      row.manifest_byte_length,
      "manifest_byte_length",
    ),
  });
}

function publication(rowValue: unknown): DnaFinishedRaceIncrementalPublication {
  const row = record(rowValue, "finished-race publication");
  const previousPublishedCycleId = nullableText(
    row.previous_published_cycle_id,
    "previous_published_cycle_id",
  );
  return Object.freeze({
    version: integer(row.version, "version") as 1,
    cycleId: sha256(row.cycle_id, "cycle_id"),
    previousPublishedCycleId:
      previousPublishedCycleId === null
        ? null
        : sha256(previousPublishedCycleId, "previous_published_cycle_id"),
    attemptNumber: integer(row.attempt_number, "attempt_number"),
    lowerBoundAt: timestamp(row.lower_bound_at, "lower_bound_at"),
    upperBoundAt: timestamp(row.upper_bound_at, "upper_bound_at"),
    receiptCount: integer(row.receipt_count, "receipt_count"),
    documentCount: integer(row.document_count, "document_count"),
    manifestByteLength: integer(
      row.manifest_byte_length,
      "manifest_byte_length",
    ),
    receiptSetSha256: sha256(row.receipt_set_sha256, "receipt_set_sha256"),
    validatedAt: timestamp(row.validated_at, "validated_at"),
    publishedAt: timestamp(row.published_at, "published_at"),
  });
}

export function createNeonDnaFinishedRaceIncrementalPublicationRepository(input: {
  databaseUrl: string;
  databaseOwnerId: string;
  ownerId: string;
  runtimeRole: string;
  sessionFactory?: NeonImportPersistenceSessionFactory;
}): DnaFinishedRaceIncrementalPublicationRepository {
  const databaseUrl = input.databaseUrl.trim();
  const databaseOwnerId = uuid(input.databaseOwnerId, "databaseOwnerId");
  const ownerId = owner(input.ownerId);
  const runtimeRole = input.runtimeRole.trim();
  if (databaseUrl === "") throw new Error("databaseUrl is required");
  if (!ROLE_PATTERN.test(runtimeRole))
    throw new Error("runtimeRole is invalid");
  const sessionFactory =
    input.sessionFactory ?? createDefaultNeonImportPersistenceSession;

  async function transaction<T>(request: {
    readOnly: boolean;
    run: (
      client: Awaited<ReturnType<typeof sessionFactory>>["client"],
    ) => Promise<T>;
  }): Promise<T> {
    const session = await sessionFactory(databaseUrl);
    let begun = false;
    try {
      await session.client.query(
        request.readOnly
          ? "BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY"
          : "BEGIN ISOLATION LEVEL SERIALIZABLE",
      );
      begun = true;
      await session.client.query(SET_OWNER_SCOPE_SQL, [databaseOwnerId]);
      verifyIsolation(
        await session.client.query(VERIFY_ISOLATION_SQL, [
          databaseOwnerId,
          ownerId,
        ]),
        { databaseOwnerId, ownerId, runtimeRole },
      );
      const result = await request.run(session.client);
      await session.client.query("COMMIT");
      begun = false;
      return result;
    } catch (error) {
      if (begun) await session.client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      await session.close();
    }
  }

  return Object.freeze({
    async loadReceiptSet(request) {
      const cycleId = sha256(request.cycleId, "cycleId");
      const attemptNumber = integer(request.attemptNumber, "attemptNumber");
      if (attemptNumber < 1 || attemptNumber > 32) {
        throw new Error("attemptNumber is invalid");
      }
      return transaction({
        readOnly: true,
        async run(client) {
          const result = await client.query(
            "SELECT * FROM dna.read_dna_open_lab_finished_race_incremental_receipts($1::uuid,$2::text,$3::integer)",
            [databaseOwnerId, cycleId, attemptNumber],
          );
          return Object.freeze(result.rows.map(receipt));
        },
      });
    },

    async publish(request) {
      const candidate: DnaFinishedRaceIncrementalPublicationCandidate =
        request.candidate;
      if (
        candidate.version !== DNA_FINISHED_RACE_INCREMENTAL_PUBLICATION_VERSION
      ) {
        throw new Error("publication candidate version is invalid");
      }
      return transaction({
        readOnly: false,
        async run(client) {
          const result = await client.query(
            "SELECT * FROM dna.publish_dna_open_lab_finished_race_incremental_cycle($1::uuid,$2::text,$3::integer,$4::integer,$5::bigint,$6::bigint,$7::character(64),$8::timestamptz,$9::timestamptz)",
            [
              databaseOwnerId,
              candidate.cycleId,
              candidate.attemptNumber,
              candidate.receiptCount,
              candidate.documentCount,
              candidate.manifestByteLength,
              candidate.receiptSetSha256,
              candidate.validatedAt,
              request.publishedAt,
            ],
          );
          return publication(oneRow(result, "finished-race publication"));
        },
      });
    },
  });
}
