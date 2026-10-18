import { createHash } from "node:crypto";

import type { ExactRaceProbabilityContext } from "@/domain/race-probability-baseline";
import {
  acceptedHistoricalRaceContextRowSha256,
  type AcceptedHistoricalRaceContextReadRepository,
  type AcceptedHistoricalRaceContextStoredSelection,
} from "@/lib/accepted-historical-race-context-authority";
import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceSessionFactory,
} from "@/lib/neon-import-persistence-driver";
import type {
  AcceptedHistoricalRaceContext,
  AcceptedHistoricalRaceContextPointer,
} from "@/lib/selected-core-open-race-history-boundary";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const HASH = /^[a-f0-9]{64}$/u;
const ROLE = /^[a-z_][a-z0-9_]{0,62}$/u;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;
const ERROR = "Historical Race context persistence unavailable.";
const MAXIMUM_CONTEXTS = 500_000;
const STAGE_BATCH_SIZE = 250;

type DbRecord = Readonly<Record<string, unknown>>;
type QueryResult = Readonly<{ rows: readonly unknown[] }>;

export type PreparedHistoricalRaceContextGeneration = Readonly<{
  contextSourceIdentitySha256: string;
  manifestJson: string;
  historyGenerationVersion: string;
  observationSetSha256: string;
  historicalAggregateVersion: string;
  evidenceCutoff: string;
  publicationState: "accepted" | "partial" | "unknown";
  expectedRowCount: number;
  rowSetSha256: string;
  materializedAt: string;
  rows: readonly Readonly<{
    ordinal: number;
    rowSha256: string;
    canonicalPayload: string;
    payload: AcceptedHistoricalRaceContext;
  }>[];
}>;

export type HistoricalRaceContextPersistenceRepository =
  AcceptedHistoricalRaceContextReadRepository &
    Readonly<{
      publishGenerationByOwner(
        ownerId: string,
        workerId: string,
        generation: PreparedHistoricalRaceContextGeneration,
        publishedAt: string,
      ): Promise<
        Readonly<{
          status: "published" | "unchanged" | "source_changed";
        }>
      >;
    }>;

function fail(): never {
  throw new Error(ERROR);
}

function record(value: unknown): DbRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    fail();
  return value as DbRecord;
}

function text(value: unknown, maximum = 512): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length < 1 ||
    value.length > maximum ||
    CONTROL.test(value)
  )
    fail();
  return value;
}

function hash(value: unknown): string {
  if (typeof value !== "string" || !HASH.test(value)) fail();
  return value;
}

function timestamp(value: unknown): string {
  const supplied = value instanceof Date ? value.toISOString() : text(value);
  const parsed = new Date(supplied);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== supplied)
    fail();
  return supplied;
}

function integer(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number {
  const parsed =
    typeof value === "string" && /^\d+$/u.test(value) ? Number(value) : value;
  if (
    typeof parsed !== "number" ||
    !Number.isSafeInteger(parsed) ||
    parsed < 0 ||
    parsed > maximum
  )
    fail();
  return parsed;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizeElement(
  value: ExactRaceProbabilityContext["element"],
): ExactRaceProbabilityContext["element"] {
  if (value.status === "known")
    return Object.freeze({ status: "known", value: text(value.value, 128) });
  if (
    (value.status === "not_applicable" || value.status === "unknown") &&
    value.value === null
  )
    return Object.freeze({ status: value.status, value: null });
  return fail();
}

function normalizeContext(value: AcceptedHistoricalRaceContext) {
  const competition = value.competition;
  if (competition !== "normal" && competition !== "esports") fail();
  return Object.freeze({
    eventId: text(value.eventId),
    competition,
    element: normalizeElement(value.element),
    evidenceSha256: hash(value.evidenceSha256),
  });
}

export function prepareHistoricalRaceContextGeneration(
  input: Readonly<{
    historyGenerationVersion: string;
    observationSetSha256: string;
    historicalAggregateVersion: string;
    evidenceCutoff: string;
    publicationState: "accepted" | "partial" | "unknown";
    materializedAt: string;
    contexts: readonly AcceptedHistoricalRaceContext[];
  }>,
): PreparedHistoricalRaceContextGeneration {
  const historyGenerationVersion = hash(input.historyGenerationVersion);
  const observationSetSha256 = hash(input.observationSetSha256);
  const historicalAggregateVersion = text(
    input.historicalAggregateVersion,
    128,
  );
  const evidenceCutoff = timestamp(input.evidenceCutoff);
  const materializedAt = timestamp(input.materializedAt);
  if (
    !["accepted", "partial", "unknown"].includes(input.publicationState) ||
    !Array.isArray(input.contexts) ||
    input.contexts.length > MAXIMUM_CONTEXTS ||
    (input.publicationState === "accepted" && input.contexts.length === 0) ||
    (input.publicationState === "unknown" && input.contexts.length !== 0)
  )
    fail();
  const normalized = input.contexts
    .map(normalizeContext)
    .sort((left, right) => left.eventId.localeCompare(right.eventId));
  if (
    new Set(normalized.map(({ eventId }) => eventId)).size !== normalized.length
  )
    fail();
  const rows = normalized.map((payload, ordinal) => {
    const canonicalPayload = JSON.stringify(payload);
    return Object.freeze({
      ordinal,
      rowSha256: acceptedHistoricalRaceContextRowSha256(payload),
      canonicalPayload,
      payload,
    });
  });
  const rowSetSha256 = sha256(
    rows
      .map(
        ({ ordinal, payload, rowSha256 }) =>
          `${ordinal}:${payload.eventId}:${rowSha256}\n`,
      )
      .join(""),
  );
  const manifestJson = JSON.stringify({
    version: 1,
    historyGenerationVersion,
    observationSetSha256,
    historicalAggregateVersion,
    evidenceCutoff,
    publicationState: input.publicationState,
    expectedRowCount: rows.length,
    rowSetSha256,
    materializedAt,
  });
  return Object.freeze({
    contextSourceIdentitySha256: sha256(manifestJson),
    manifestJson,
    historyGenerationVersion,
    observationSetSha256,
    historicalAggregateVersion,
    evidenceCutoff,
    publicationState: input.publicationState,
    expectedRowCount: rows.length,
    rowSetSha256,
    materializedAt,
    rows: Object.freeze(rows),
  });
}

function parsePointer(value: unknown) {
  const row = record(value);
  const pointer: AcceptedHistoricalRaceContextPointer = Object.freeze({
    historyGenerationVersion: hash(row.history_generation_version),
    observationSetSha256: hash(row.observation_set_sha256),
    historicalAggregateVersion: text(row.historical_aggregate_version, 128),
    contextSourceIdentitySha256: hash(row.context_source_identity_sha256),
  });
  const publicationState = row.publication_state;
  if (!["accepted", "partial", "unknown"].includes(String(publicationState)))
    fail();
  return Object.freeze({
    pointer,
    evidenceCutoff: timestamp(row.evidence_cutoff),
    publicationState: publicationState as "accepted" | "partial" | "unknown",
    expectedRowCount: integer(row.expected_row_count, MAXIMUM_CONTEXTS),
    rowSetSha256: hash(row.row_set_sha256),
    publishedAt: timestamp(row.published_at),
  });
}

function verifyIsolation(
  result: QueryResult,
  input: {
    databaseOwnerId: string;
    authenticatedOwnerId: string;
    runtimeRole: string;
  },
) {
  if (result.rows.length !== 1) fail();
  const row = record(result.rows[0]);
  if (
    row.database_owner_id !== input.databaseOwnerId ||
    row.authenticated_owner_id !== input.authenticatedOwnerId ||
    row.session_user_name !== input.runtimeRole ||
    row.current_user_name !== input.runtimeRole ||
    row.all_rls_enabled !== true ||
    row.all_force_rls_enabled !== true ||
    row.runtime_has_direct_table_access !== false ||
    row.runtime_is_superuser !== false ||
    row.runtime_bypasses_rls !== false ||
    row.runtime_can_create_roles !== false ||
    row.runtime_can_create_databases !== false ||
    row.runtime_can_create_database_objects !== false ||
    row.runtime_can_create_schema_objects !== false ||
    row.runtime_is_neon_superuser_member !== false ||
    row.runtime_can_read_pointer !== true ||
    row.runtime_can_read_rows !== true ||
    row.runtime_can_begin !== true ||
    row.runtime_can_stage !== true ||
    row.runtime_can_publish !== true
  )
    fail();
}

const VERIFY_SQL = `
SELECT owner.id::text AS database_owner_id, owner.clerk_user_id AS authenticated_owner_id,
  bool_and(relation.relrowsecurity) AS all_rls_enabled,
  bool_and(relation.relforcerowsecurity) AS all_force_rls_enabled,
  bool_or(has_table_privilege(session_user, relation.oid,
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) AS runtime_has_direct_table_access,
  session_user::text AS session_user_name, current_user::text AS current_user_name,
  role.rolsuper AS runtime_is_superuser, role.rolbypassrls AS runtime_bypasses_rls,
  role.rolcreaterole AS runtime_can_create_roles, role.rolcreatedb AS runtime_can_create_databases,
  has_database_privilege(session_user,current_database(),'CREATE') AS runtime_can_create_database_objects,
  has_schema_privilege(session_user,'dna','CREATE') AS runtime_can_create_schema_objects,
  COALESCE(pg_has_role(session_user,(SELECT oid FROM pg_roles WHERE rolname='neon_superuser'),'MEMBER'),false)
    AS runtime_is_neon_superuser_member,
  has_function_privilege(session_user,'dna.read_active_open_race_history_context_pointer(uuid)','EXECUTE') AS runtime_can_read_pointer,
  has_function_privilege(session_user,'dna.read_open_race_history_contexts(uuid,text,text[],integer)','EXECUTE') AS runtime_can_read_rows,
  has_function_privilege(session_user,'dna.begin_open_race_history_context_generation(uuid,text,text,text)','EXECUTE') AS runtime_can_begin,
  has_function_privilege(session_user,'dna.stage_open_race_history_context_rows(uuid,text,text,integer,jsonb)','EXECUTE') AS runtime_can_stage,
  has_function_privilege(session_user,'dna.publish_open_race_history_context_generation(uuid,text,text,timestamptz)','EXECUTE') AS runtime_can_publish
FROM dna.app_owner owner CROSS JOIN LATERAL unnest(ARRAY[
  'dna.open_race_history_context_generation'::regclass,
  'dna.open_race_history_context_generation_row'::regclass,
  'dna.open_race_history_context_generation_active'::regclass]) target(oid)
JOIN pg_class relation ON relation.oid=target.oid
JOIN pg_roles role ON role.rolname=session_user
WHERE owner.id=$1::uuid AND owner.clerk_user_id=$2::text
GROUP BY owner.id, owner.clerk_user_id, role.rolsuper, role.rolbypassrls,
 role.rolcreaterole, role.rolcreatedb`;

export function createNeonAcceptedHistoricalRaceContextRepository(input: {
  databaseUrl: string;
  databaseOwnerId: string;
  authenticatedOwnerId: string;
  runtimeRole: string;
  sessionFactory?: NeonImportPersistenceSessionFactory;
}): HistoricalRaceContextPersistenceRepository {
  const databaseUrl = text(input.databaseUrl, 4096);
  const databaseOwnerId = text(input.databaseOwnerId);
  if (!UUID.test(databaseOwnerId)) fail();
  const authenticatedOwnerId = text(input.authenticatedOwnerId);
  const runtimeRole = text(input.runtimeRole, 63);
  if (!ROLE.test(runtimeRole)) fail();
  const sessionFactory =
    input.sessionFactory ?? createDefaultNeonImportPersistenceSession;

  async function transaction<T>(
    requestOwnerId: string,
    readOnly: boolean,
    run: (
      client: Awaited<ReturnType<typeof sessionFactory>>["client"],
    ) => Promise<T>,
  ) {
    if (text(requestOwnerId) !== authenticatedOwnerId) fail();
    const session = await sessionFactory(databaseUrl);
    let begun = false;
    try {
      await session.client.query(
        readOnly
          ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"
          : "BEGIN ISOLATION LEVEL SERIALIZABLE",
      );
      begun = true;
      await session.client.query(
        "SELECT set_config('app.owner_id',$1,true) AS owner_scope",
        [databaseOwnerId],
      );
      verifyIsolation(
        await session.client.query(VERIFY_SQL, [
          databaseOwnerId,
          authenticatedOwnerId,
        ]),
        { databaseOwnerId, authenticatedOwnerId, runtimeRole },
      );
      await session.client.query("SET LOCAL statement_timeout = '5s'");
      const value = await run(session.client);
      await session.client.query("COMMIT");
      begun = false;
      return value;
    } catch {
      if (begun) await session.client.query("ROLLBACK").catch(() => undefined);
      return fail();
    } finally {
      await session.close();
    }
  }

  async function pointer(
    client: Awaited<ReturnType<typeof sessionFactory>>["client"],
  ) {
    const result = await client.query(
      "SELECT * FROM dna.read_active_open_race_history_context_pointer($1::uuid)",
      [databaseOwnerId],
    );
    if (result.rows.length > 1) fail();
    return result.rows.length === 0 ? null : parsePointer(result.rows[0]);
  }

  return Object.freeze({
    readActivePointerByOwner(ownerId) {
      return transaction(
        ownerId,
        true,
        async (client) => (await pointer(client))?.pointer ?? null,
      );
    },

    readPublishedContextsByOwner(ownerId, request) {
      const requestedEventIds = request.requestedEventIds.map((value) =>
        text(value),
      );
      if (
        requestedEventIds.length < 1 ||
        requestedEventIds.length > 10_000 ||
        new Set(requestedEventIds).size !== requestedEventIds.length ||
        !Number.isSafeInteger(request.maximumRows) ||
        request.maximumRows < 1 ||
        request.maximumRows > 10_000
      )
        fail();
      const expected = {
        historyGenerationVersion: hash(request.historyGenerationVersion),
        observationSetSha256: hash(request.observationSetSha256),
        historicalAggregateVersion: text(
          request.historicalAggregateVersion,
          128,
        ),
        evidenceCutoff: timestamp(request.evidenceCutoff),
      };
      return transaction(ownerId, true, async (client) => {
        const active = await pointer(client);
        if (
          active === null ||
          active.pointer.historyGenerationVersion !==
            expected.historyGenerationVersion ||
          active.pointer.observationSetSha256 !==
            expected.observationSetSha256 ||
          active.pointer.historicalAggregateVersion !==
            expected.historicalAggregateVersion ||
          active.evidenceCutoff !== expected.evidenceCutoff
        )
          return null;
        const result = await client.query(
          "SELECT * FROM dna.read_open_race_history_contexts($1::uuid,$2::text,$3::text[],$4::integer)",
          [
            databaseOwnerId,
            active.pointer.contextSourceIdentitySha256,
            requestedEventIds,
            request.maximumRows + 1,
          ],
        );
        const truncated = result.rows.length > request.maximumRows;
        const returnedEventIds = new Set<string>();
        const rows = truncated
          ? []
          : result.rows.map((value) => {
              const row = record(value);
              const payload = normalizeContext(
                record(row.payload) as unknown as AcceptedHistoricalRaceContext,
              );
              const rowSha256 = hash(row.row_sha256);
              if (
                integer(row.ordinal, MAXIMUM_CONTEXTS - 1) >=
                  active.expectedRowCount ||
                row.event_id !== payload.eventId ||
                returnedEventIds.has(payload.eventId) ||
                rowSha256 !== acceptedHistoricalRaceContextRowSha256(payload)
              )
                fail();
              returnedEventIds.add(payload.eventId);
              return Object.freeze({ ...payload, rowSha256 });
            });
        const selection: AcceptedHistoricalRaceContextStoredSelection =
          Object.freeze({
            authenticatedOwnerId,
            ...active.pointer,
            evidenceCutoff: active.evidenceCutoff,
            publicationState: active.publicationState,
            requestedEventIds: Object.freeze([...requestedEventIds]),
            truncated,
            rows: Object.freeze(rows),
          });
        return selection;
      });
    },

    publishGenerationByOwner(
      ownerId,
      workerIdValue,
      generation,
      publishedAtValue,
    ) {
      const workerId = text(workerIdValue, 128);
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u.test(workerId)) fail();
      const publishedAt = timestamp(publishedAtValue);
      if (
        generation.contextSourceIdentitySha256 !==
          sha256(generation.manifestJson) ||
        generation.rows.length !== generation.expectedRowCount ||
        generation.rows.some(
          (row, ordinal) =>
            row.ordinal !== ordinal ||
            row.rowSha256 !==
              acceptedHistoricalRaceContextRowSha256(row.payload) ||
            row.canonicalPayload !== JSON.stringify(row.payload),
        )
      )
        fail();
      return transaction(ownerId, false, async (client) => {
        const begun = await client.query(
          "SELECT dna.begin_open_race_history_context_generation($1::uuid,$2::text,$3::text,$4::text) AS status",
          [
            databaseOwnerId,
            workerId,
            generation.contextSourceIdentitySha256,
            generation.manifestJson,
          ],
        );
        const beginStatus = text(record(begun.rows[0]).status);
        if (beginStatus === "source_changed")
          return { status: "source_changed" as const };
        if (beginStatus === "unchanged")
          return { status: "unchanged" as const };
        if (beginStatus !== "staging") fail();
        for (
          let offset = 0;
          offset < generation.rows.length;
          offset += STAGE_BATCH_SIZE
        ) {
          const batch = generation.rows.slice(
            offset,
            offset + STAGE_BATCH_SIZE,
          );
          await client.query(
            "SELECT dna.stage_open_race_history_context_rows($1::uuid,$2::text,$3::text,$4::integer,$5::jsonb) AS staged",
            [
              databaseOwnerId,
              workerId,
              generation.contextSourceIdentitySha256,
              offset,
              JSON.stringify(batch),
            ],
          );
        }
        const result = await client.query(
          "SELECT dna.publish_open_race_history_context_generation($1::uuid,$2::text,$3::text,$4::timestamptz) AS status",
          [
            databaseOwnerId,
            workerId,
            generation.contextSourceIdentitySha256,
            publishedAt,
          ],
        );
        const status = text(record(result.rows[0]).status);
        if (!["published", "unchanged", "source_changed"].includes(status))
          fail();
        return {
          status: status as "published" | "unchanged" | "source_changed",
        };
      });
    },
  });
}
