import {
  validateDnaFinishedRaceBackfillCheckpoint,
  validateDnaFinishedRaceWindowPublicationReceipt,
  type DnaFinishedRaceBackfillCheckpoint,
  type DnaFinishedRaceBackfillCheckpointRepository,
  type DnaFinishedRaceWindowPublicationReceipt,
  type StoredDnaFinishedRaceBackfillCheckpoint,
} from "./dna-open-lab-finished-race-backfill";
import type { DnaFinishedRaceWindow } from "./dna-open-lab-finished-race-window-crawler";
import { dnaOpenLabRawEvidenceSha256 } from "./dna-open-lab-v1-adapters";
import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceSessionFactory,
} from "./neon-import-persistence-driver";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/u;
const REVISION_PATTERN = /^[1-9][0-9]*$/u;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

type QueryResult = Readonly<{ rows: readonly unknown[] }>;
type DbRow = Record<string, unknown>;

export type StoredDnaFinishedRaceWindowPublicationReceipt = Readonly<{
  window: DnaFinishedRaceWindow;
  receipt: DnaFinishedRaceWindowPublicationReceipt;
  recordedAt: string;
}>;

export type NeonDnaFinishedRaceBackfillCheckpointRepository =
  DnaFinishedRaceBackfillCheckpointRepository &
    Readonly<{
      readReceipt: (
        windowKey: string,
      ) => Promise<StoredDnaFinishedRaceWindowPublicationReceipt | null>;
    }>;

const SET_OWNER_SCOPE_SQL =
  "SELECT set_config('app.owner_id', $1, true) AS owner_scope";

const VERIFY_ISOLATION_SQL = [
  "SELECT",
  "  owner.id::text AS database_owner_id,",
  "  owner.clerk_user_id AS authenticated_owner_id,",
  "  checkpoint.relrowsecurity AS checkpoint_rls,",
  "  checkpoint.relforcerowsecurity AS checkpoint_force_rls,",
  "  receipt.relrowsecurity AS receipt_rls,",
  "  receipt.relforcerowsecurity AS receipt_force_rls,",
  "  (has_table_privilege(session_user, 'dna.dna_open_lab_finished_race_backfill_checkpoint', 'SELECT')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_finished_race_backfill_checkpoint', 'INSERT')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_finished_race_backfill_checkpoint', 'UPDATE')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_finished_race_backfill_checkpoint', 'DELETE'))",
  "    AS runtime_can_access_checkpoint,",
  "  (has_table_privilege(session_user, 'dna.dna_open_lab_finished_race_window_receipt', 'SELECT')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_finished_race_window_receipt', 'INSERT')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_finished_race_window_receipt', 'UPDATE')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_finished_race_window_receipt', 'DELETE'))",
  "    AS runtime_can_access_receipt,",
  "  has_function_privilege(session_user,",
  "    'dna.save_dna_open_lab_finished_race_backfill_checkpoint(uuid,bigint,jsonb,jsonb)', 'EXECUTE')",
  "    AS runtime_can_save,",
  "  has_function_privilege(session_user,",
  "    'dna.read_dna_open_lab_finished_race_backfill_checkpoint(uuid)', 'EXECUTE')",
  "    AS runtime_can_read_checkpoint,",
  "  has_function_privilege(session_user,",
  "    'dna.read_dna_open_lab_finished_race_window_receipt(uuid,text)', 'EXECUTE')",
  "    AS runtime_can_read_receipt,",
  "  session_user::text AS session_user_name, current_user::text AS current_user_name,",
  "  role.rolsuper AS runtime_is_superuser, role.rolbypassrls AS runtime_bypasses_rls,",
  "  role.rolcreaterole AS runtime_can_create_roles, role.rolcreatedb AS runtime_can_create_databases,",
  "  COALESCE(pg_has_role(session_user, (SELECT oid FROM pg_catalog.pg_roles",
  "    WHERE rolname = 'neon_superuser'), 'MEMBER'), false) AS runtime_is_neon_superuser_member",
  "FROM dna.app_owner owner",
  "JOIN pg_catalog.pg_class checkpoint",
  "  ON checkpoint.oid = 'dna.dna_open_lab_finished_race_backfill_checkpoint'::regclass",
  "JOIN pg_catalog.pg_class receipt",
  "  ON receipt.oid = 'dna.dna_open_lab_finished_race_window_receipt'::regclass",
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

function bool(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${field} must be boolean`);
  return value;
}

function uuid(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) {
    throw new Error(`${field} must be a UUID`);
  }
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

function revision(value: unknown, field: string): string {
  const normalized =
    typeof value === "bigint" || typeof value === "number"
      ? String(value)
      : text(value, field);
  if (!REVISION_PATTERN.test(normalized)) {
    throw new Error(`${field} is invalid`);
  }
  return normalized;
}

function sha256(value: unknown, field: string): string {
  const normalized = text(value, field);
  if (!SHA_256_PATTERN.test(normalized)) {
    throw new Error(`${field} is invalid`);
  }
  return normalized;
}

function timestamp(value: unknown, field: string): string {
  const raw = value instanceof Date ? value.toISOString() : text(value, field);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${field} is invalid`);
  return parsed.toISOString();
}

function json(value: unknown, field: string): unknown {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      throw new Error(`${field} must be valid JSON`);
    }
  }
  return value;
}

function checkpoint(value: unknown): DnaFinishedRaceBackfillCheckpoint {
  return validateDnaFinishedRaceBackfillCheckpoint(
    json(value, "checkpoint") as DnaFinishedRaceBackfillCheckpoint,
  );
}

function window(value: unknown): DnaFinishedRaceWindow {
  const row = record(json(value, "window"), "window");
  const startTime = timestamp(row.startTime, "window.startTime");
  const endTime = timestamp(row.endTime, "window.endTime");
  if (Date.parse(startTime) > Date.parse(endTime)) {
    throw new Error("window start cannot be after end");
  }
  return Object.freeze({ startTime, endTime });
}

function receipt(row: DbRow): StoredDnaFinishedRaceWindowPublicationReceipt {
  const publicationReceipt = validateDnaFinishedRaceWindowPublicationReceipt({
    windowKey: text(row.window_key, "window_key"),
    contentSha256: text(row.content_sha256, "content_sha256"),
    documentCount: Number(text(row.document_count, "document_count")),
    manifestObjectKey: text(row.manifest_object_key, "manifest_object_key"),
    manifestBodySha256: text(row.manifest_body_sha256, "manifest_body_sha256"),
    manifestByteLength: Number(
      text(row.manifest_byte_length, "manifest_byte_length"),
    ),
  });
  return Object.freeze({
    window: Object.freeze({
      startTime: timestamp(row.window_start_at, "window_start_at"),
      endTime: timestamp(row.window_end_at, "window_end_at"),
    }),
    receipt: publicationReceipt,
    recordedAt: timestamp(row.recorded_at, "recorded_at"),
  });
}

function storedCheckpoint(row: DbRow): StoredDnaFinishedRaceBackfillCheckpoint {
  return Object.freeze({
    revision: revision(row.revision, "revision"),
    checkpoint: checkpoint(row.checkpoint),
  });
}

function verifyIsolation(
  result: QueryResult,
  input: { databaseOwnerId: string; ownerId: string; runtimeRole: string },
): void {
  const row = oneRow(result, "DNA finished-race backfill isolation");
  if (
    text(row.database_owner_id, "database_owner_id") !==
      input.databaseOwnerId ||
    text(row.authenticated_owner_id, "authenticated_owner_id") !== input.ownerId
  ) {
    throw new Error("DNA finished-race backfill owner scope denied.");
  }
  for (const field of [
    "checkpoint_rls",
    "checkpoint_force_rls",
    "receipt_rls",
    "receipt_force_rls",
  ]) {
    if (!bool(row[field], field)) {
      throw new Error("DNA finished-race backfill requires forced owner RLS.");
    }
  }
  if (
    bool(row.runtime_can_access_checkpoint, "runtime_can_access_checkpoint") ||
    bool(row.runtime_can_access_receipt, "runtime_can_access_receipt")
  ) {
    throw new Error("DNA finished-race backfill table access is not bounded.");
  }
  for (const field of [
    "runtime_can_save",
    "runtime_can_read_checkpoint",
    "runtime_can_read_receipt",
  ]) {
    if (!bool(row[field], field)) {
      throw new Error(
        "DNA finished-race backfill function privilege is incomplete.",
      );
    }
  }
  if (
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
    throw new Error(
      "DNA finished-race backfill runtime role is not least privileged.",
    );
  }
}

export function createNeonDnaFinishedRaceBackfillCheckpointRepository(input: {
  databaseUrl: string;
  databaseOwnerId: string;
  ownerId: string;
  runtimeRole: string;
  sessionFactory?: NeonImportPersistenceSessionFactory;
}): NeonDnaFinishedRaceBackfillCheckpointRepository {
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
    async load() {
      return transaction({
        readOnly: true,
        async run(client) {
          const result = await client.query(
            "SELECT revision::text, checkpoint FROM dna.read_dna_open_lab_finished_race_backfill_checkpoint($1::uuid)",
            [databaseOwnerId],
          );
          if (result.rows.length === 0) return null;
          return storedCheckpoint(
            oneRow(result, "DNA finished-race backfill checkpoint"),
          );
        },
      });
    },

    async save(request) {
      const normalizedCheckpoint = validateDnaFinishedRaceBackfillCheckpoint(
        request.checkpoint,
      );
      const expectedRevision =
        request.expectedRevision === null
          ? null
          : revision(request.expectedRevision, "expectedRevision");
      const publication =
        request.publication === undefined
          ? null
          : Object.freeze({
              window: window(request.publication.window),
              receipt: validateDnaFinishedRaceWindowPublicationReceipt(
                request.publication.receipt,
              ),
            });
      return transaction({
        readOnly: false,
        async run(client) {
          const result = await client.query(
            "SELECT revision::text, checkpoint FROM dna.save_dna_open_lab_finished_race_backfill_checkpoint($1::uuid,$2::bigint,$3::jsonb,$4::jsonb)",
            [
              databaseOwnerId,
              expectedRevision,
              JSON.stringify(normalizedCheckpoint),
              publication === null ? null : JSON.stringify(publication),
            ],
          );
          const stored = storedCheckpoint(
            oneRow(result, "DNA finished-race backfill checkpoint save"),
          );
          if (
            dnaOpenLabRawEvidenceSha256(stored.checkpoint) !==
            dnaOpenLabRawEvidenceSha256(normalizedCheckpoint)
          ) {
            throw new Error(
              "DNA finished-race backfill checkpoint response drifted.",
            );
          }
          return stored;
        },
      });
    },

    async readReceipt(windowKey) {
      const normalized = sha256(windowKey, "windowKey");
      return transaction({
        readOnly: true,
        async run(client) {
          const result = await client.query(
            [
              "SELECT window_key, content_sha256, document_count::text,",
              "  manifest_object_key, manifest_body_sha256, manifest_byte_length::text,",
              "  window_start_at, window_end_at, recorded_at",
              "FROM dna.read_dna_open_lab_finished_race_window_receipt($1::uuid,$2::text)",
            ].join("\n"),
            [databaseOwnerId, normalized],
          );
          if (result.rows.length === 0) return null;
          return receipt(
            oneRow(result, "DNA finished-race window publication receipt"),
          );
        },
      });
    },
  });
}
