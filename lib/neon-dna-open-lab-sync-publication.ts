import {
  createInitialDnaLastGoodSyncState,
  inspectDnaCurrentStateCandidate,
  type DnaCurrentStateCandidate,
  type DnaLastGoodSyncState,
  type DnaSyncInterruptionReason,
} from "./dna-open-lab-last-good-publication";
import type { AdaptedCoreDetailsRow } from "../domain/source-adapters";
import type { DnaOpenLabEvidence } from "./dna-open-lab-v1-adapters";
import type {
  CanonicalActiveRaceSnapshot,
  CanonicalRaceFillSnapshot,
} from "./dna-open-lab-v1-adapters";
import {
  createDnaCurrentRaceMaterialization,
  type DnaCurrentRaceMaterializationRow,
} from "./dna-open-lab-current-race-materialization";
import { createDnaSupplementalCoreMaterialization } from "./dna-open-lab-core-current-state-materialization";
import { createDnaTokenSpliceMaterialization } from "./dna-open-lab-token-splice-materialization";
import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceSessionFactory,
} from "./neon-import-persistence-driver";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

type QueryResult = Readonly<{ rows: readonly unknown[] }>;
type DbRow = Record<string, unknown>;

export type NeonDnaOpenLabSyncPublicationRepository = Readonly<{
  publishCandidate: (input: {
    ownerId: string;
    candidate: DnaCurrentStateCandidate;
    ownedCores: readonly DnaOpenLabEvidence<AdaptedCoreDetailsRow>[];
    activeRaces: readonly DnaOpenLabEvidence<CanonicalActiveRaceSnapshot>[];
    raceFills: readonly DnaOpenLabEvidence<CanonicalRaceFillSnapshot>[];
    supplementalCore: Omit<
      Parameters<typeof createDnaSupplementalCoreMaterialization>[0],
      "candidate" | "sourceCoreIds"
    >;
    tokenSplice: Omit<
      Parameters<typeof createDnaTokenSpliceMaterialization>[0],
      "candidate"
    >;
    recordedAt: string;
    acceptedAt: string;
  }) => Promise<DnaLastGoodSyncState>;
  pause: (input: {
    ownerId: string;
    reason: DnaSyncInterruptionReason;
    attemptedAt: string;
    retryAfterSeconds?: number | null;
  }) => Promise<DnaLastGoodSyncState>;
  read: (input: { ownerId: string }) => Promise<DnaLastGoodSyncState>;
  readServingOwnedCores: (input: {
    ownerId: string;
  }) => Promise<readonly DnaOpenLabServingOwnedCore[]>;
  readServingCurrentRaces: (input: {
    ownerId: string;
  }) => Promise<DnaOpenLabServingCurrentRaces>;
}>;

export type DnaOpenLabServingOwnedCore = Readonly<{
  generationId: string;
  observedAt: string;
  rawEvidenceSha256: string;
  canonical: AdaptedCoreDetailsRow;
}>;

export type DnaOpenLabServingCurrentRaces = Readonly<{
  generationId: string | null;
  activeRaces: readonly DnaCurrentRaceMaterializationRow<CanonicalActiveRaceSnapshot>[];
  raceFills: readonly DnaCurrentRaceMaterializationRow<CanonicalRaceFillSnapshot>[];
}>;

const SET_OWNER_SCOPE_SQL =
  "SELECT set_config('app.owner_id', $1, true) AS owner_scope";

const VERIFY_ISOLATION_SQL = [
  "SELECT",
  "  owner.id::text AS database_owner_id,",
  "  owner.clerk_user_id AS authenticated_owner_id,",
  "  generation.relrowsecurity AS generation_rls,",
  "  generation.relforcerowsecurity AS generation_force_rls,",
  "  family.relrowsecurity AS family_rls,",
  "  family.relforcerowsecurity AS family_force_rls,",
  "  state.relrowsecurity AS state_rls,",
  "  state.relforcerowsecurity AS state_force_rls,",
  "  core.relrowsecurity AS core_rls,",
  "  core.relforcerowsecurity AS core_force_rls,",
  "  active.relrowsecurity AS active_rls,",
  "  active.relforcerowsecurity AS active_force_rls,",
  "  fill.relrowsecurity AS fill_rls,",
  "  fill.relforcerowsecurity AS fill_force_rls,",
  "  supplemental.relrowsecurity AS supplemental_rls,",
  "  supplemental.relforcerowsecurity AS supplemental_force_rls,",
  "  token.relrowsecurity AS token_rls,",
  "  token.relforcerowsecurity AS token_force_rls,",
  "  arena_mode.relrowsecurity AS arena_mode_rls,",
  "  arena_mode.relforcerowsecurity AS arena_mode_force_rls,",
  "  arena_page.relrowsecurity AS arena_page_rls,",
  "  arena_page.relforcerowsecurity AS arena_page_force_rls,",
  "  arena_listing.relrowsecurity AS arena_listing_rls,",
  "  arena_listing.relforcerowsecurity AS arena_listing_force_rls,",
  "  (has_table_privilege(session_user, 'dna.dna_open_lab_sync_generation', 'SELECT')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_sync_generation', 'INSERT')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_sync_generation', 'UPDATE')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_sync_generation', 'DELETE'))",
  "    AS runtime_can_access_generation,",
  "  (has_table_privilege(session_user, 'dna.dna_open_lab_sync_family', 'SELECT')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_sync_family', 'INSERT')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_sync_family', 'UPDATE')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_sync_family', 'DELETE'))",
  "    AS runtime_can_access_family,",
  "  (has_table_privilege(session_user, 'dna.dna_open_lab_sync_state', 'SELECT')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_sync_state', 'INSERT')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_sync_state', 'UPDATE')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_sync_state', 'DELETE'))",
  "    AS runtime_can_access_state,",
  "  (has_table_privilege(session_user, 'dna.dna_open_lab_owned_core_snapshot', 'SELECT')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_owned_core_snapshot', 'INSERT')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_owned_core_snapshot', 'UPDATE')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_owned_core_snapshot', 'DELETE'))",
  "    AS runtime_can_access_core,",
  "  (has_table_privilege(session_user, 'dna.dna_open_lab_active_race_snapshot', 'SELECT')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_active_race_snapshot', 'INSERT')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_active_race_snapshot', 'UPDATE')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_active_race_snapshot', 'DELETE'))",
  "    AS runtime_can_access_active,",
  "  (has_table_privilege(session_user, 'dna.dna_open_lab_race_fill_snapshot', 'SELECT')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_race_fill_snapshot', 'INSERT')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_race_fill_snapshot', 'UPDATE')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_race_fill_snapshot', 'DELETE'))",
  "    AS runtime_can_access_fill,",
  "  (has_table_privilege(session_user, 'dna.dna_open_lab_core_supplemental_snapshot', 'SELECT')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_core_supplemental_snapshot', 'INSERT')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_core_supplemental_snapshot', 'UPDATE')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_core_supplemental_snapshot', 'DELETE'))",
  "    AS runtime_can_access_supplemental,",
  "  (has_table_privilege(session_user, 'dna.dna_open_lab_token_prices_snapshot', 'SELECT')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_token_prices_snapshot', 'INSERT')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_token_prices_snapshot', 'UPDATE')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_token_prices_snapshot', 'DELETE'))",
  "    AS runtime_can_access_token,",
  "  (has_table_privilege(session_user, 'dna.dna_open_lab_splice_arena_mode_snapshot', 'SELECT')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_splice_arena_mode_snapshot', 'INSERT')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_splice_arena_mode_snapshot', 'UPDATE')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_splice_arena_mode_snapshot', 'DELETE'))",
  "    AS runtime_can_access_arena_mode,",
  "  (has_table_privilege(session_user, 'dna.dna_open_lab_splice_arena_page_snapshot', 'SELECT')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_splice_arena_page_snapshot', 'INSERT')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_splice_arena_page_snapshot', 'UPDATE')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_splice_arena_page_snapshot', 'DELETE'))",
  "    AS runtime_can_access_arena_page,",
  "  (has_table_privilege(session_user, 'dna.dna_open_lab_splice_arena_listing_snapshot', 'SELECT')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_splice_arena_listing_snapshot', 'INSERT')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_splice_arena_listing_snapshot', 'UPDATE')",
  "    OR has_table_privilege(session_user, 'dna.dna_open_lab_splice_arena_listing_snapshot', 'DELETE'))",
  "    AS runtime_can_access_arena_listing,",
  "  has_function_privilege(session_user,",
  "    'dna.stage_dna_open_lab_sync_candidate(uuid,uuid,timestamp with time zone,timestamp with time zone,jsonb)', 'EXECUTE')",
  "    AS runtime_can_stage_legacy,",
  "  has_function_privilege(session_user,",
  "    'dna.stage_dna_open_lab_materialized_candidate(uuid,uuid,timestamp with time zone,timestamp with time zone,jsonb,jsonb)', 'EXECUTE')",
  "    AS runtime_can_stage_cores_only,",
  "  has_function_privilege(session_user,",
  "    'dna.stage_dna_open_lab_current_race_candidate(uuid,uuid,timestamp with time zone,timestamp with time zone,jsonb,jsonb,jsonb,jsonb)', 'EXECUTE')",
  "    AS runtime_can_stage_current_race,",
  "  has_function_privilege(session_user,",
  "    'dna.stage_dna_open_lab_supplemental_core_candidate(uuid,uuid,timestamp with time zone,timestamp with time zone,jsonb,jsonb,jsonb,jsonb,jsonb)', 'EXECUTE')",
  "    AS runtime_can_stage_supplemental,",
  "  has_function_privilege(session_user,",
  "    'dna.stage_dna_open_lab_token_splice_candidate(uuid,uuid,timestamp with time zone,timestamp with time zone,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)', 'EXECUTE')",
  "    AS runtime_can_stage_complete,",
  "  has_function_privilege(session_user,",
  "    'dna.publish_dna_open_lab_sync_candidate(uuid,uuid,timestamp with time zone)', 'EXECUTE')",
  "    AS runtime_can_publish,",
  "  has_function_privilege(session_user,",
  "    'dna.pause_dna_open_lab_sync(uuid,text,timestamp with time zone,integer)', 'EXECUTE')",
  "    AS runtime_can_pause,",
  "  has_function_privilege(session_user,",
  "    'dna.read_dna_open_lab_sync_state(uuid)', 'EXECUTE') AS runtime_can_read,",
  "  has_function_privilege(session_user,",
  "    'dna.read_dna_open_lab_serving_owned_cores(uuid)', 'EXECUTE') AS runtime_can_read_cores,",
  "  has_function_privilege(session_user,",
  "    'dna.read_dna_open_lab_serving_active_races(uuid)', 'EXECUTE') AS runtime_can_read_active,",
  "  has_function_privilege(session_user,",
  "    'dna.read_dna_open_lab_serving_race_fills(uuid)', 'EXECUTE') AS runtime_can_read_fills,",
  "  has_function_privilege(session_user,",
  "    'dna.read_dna_open_lab_serving_supplemental_cores(uuid)', 'EXECUTE') AS runtime_can_read_supplemental,",
  "  has_function_privilege(session_user,",
  "    'dna.read_dna_open_lab_serving_token_prices(uuid)', 'EXECUTE') AS runtime_can_read_token,",
  "  has_function_privilege(session_user,",
  "    'dna.read_dna_open_lab_serving_splice_arena_pages(uuid)', 'EXECUTE') AS runtime_can_read_arena_pages,",
  "  has_function_privilege(session_user,",
  "    'dna.read_dna_open_lab_serving_splice_arena(uuid)', 'EXECUTE') AS runtime_can_read_arena,",
  "  session_user::text AS session_user_name, current_user::text AS current_user_name,",
  "  role.rolsuper AS runtime_is_superuser, role.rolbypassrls AS runtime_bypasses_rls,",
  "  role.rolcreaterole AS runtime_can_create_roles, role.rolcreatedb AS runtime_can_create_databases,",
  "  COALESCE(pg_has_role(session_user, (SELECT oid FROM pg_catalog.pg_roles",
  "    WHERE rolname = 'neon_superuser'), 'MEMBER'), false) AS runtime_is_neon_superuser_member",
  "FROM dna.app_owner owner",
  "JOIN pg_catalog.pg_class generation",
  "  ON generation.oid = 'dna.dna_open_lab_sync_generation'::regclass",
  "JOIN pg_catalog.pg_class family",
  "  ON family.oid = 'dna.dna_open_lab_sync_family'::regclass",
  "JOIN pg_catalog.pg_class state",
  "  ON state.oid = 'dna.dna_open_lab_sync_state'::regclass",
  "JOIN pg_catalog.pg_class core",
  "  ON core.oid = 'dna.dna_open_lab_owned_core_snapshot'::regclass",
  "JOIN pg_catalog.pg_class active",
  "  ON active.oid = 'dna.dna_open_lab_active_race_snapshot'::regclass",
  "JOIN pg_catalog.pg_class fill",
  "  ON fill.oid = 'dna.dna_open_lab_race_fill_snapshot'::regclass",
  "JOIN pg_catalog.pg_class supplemental",
  "  ON supplemental.oid = 'dna.dna_open_lab_core_supplemental_snapshot'::regclass",
  "JOIN pg_catalog.pg_class token",
  "  ON token.oid = 'dna.dna_open_lab_token_prices_snapshot'::regclass",
  "JOIN pg_catalog.pg_class arena_mode",
  "  ON arena_mode.oid = 'dna.dna_open_lab_splice_arena_mode_snapshot'::regclass",
  "JOIN pg_catalog.pg_class arena_page",
  "  ON arena_page.oid = 'dna.dna_open_lab_splice_arena_page_snapshot'::regclass",
  "JOIN pg_catalog.pg_class arena_listing",
  "  ON arena_listing.oid = 'dna.dna_open_lab_splice_arena_listing_snapshot'::regclass",
  "JOIN pg_catalog.pg_roles role ON role.rolname = session_user",
  "WHERE owner.id = $1::uuid AND owner.clerk_user_id = $2",
].join("\n");

const READ_STATE_SQL = [
  "SELECT accepted_generation_id::text, accepted_observed_at, accepted_at,",
  "  serving_generation_id::text, sync_status, catch_up_required, last_attempt_at,",
  "  last_interruption_reason, last_interruption_at, retry_after_seconds,",
  "  last_catch_up_completed_at",
  "FROM dna.read_dna_open_lab_sync_state($1::uuid)",
].join("\n");

const READ_SERVING_OWNED_CORES_SQL = [
  "SELECT generation_id::text, source_core_id::text, display_name, core_class,",
  "  element, f_number, sex, color_source_value, observed_at, raw_evidence_sha256",
  "FROM dna.read_dna_open_lab_serving_owned_cores($1::uuid)",
  "ORDER BY source_core_id",
].join("\n");

const READ_SERVING_ACTIVE_RACES_SQL = [
  "SELECT generation_id::text, source_race_id, observed_at, raw_evidence_sha256, canonical",
  "FROM dna.read_dna_open_lab_serving_active_races($1::uuid)",
  "ORDER BY source_race_id",
].join("\n");

const READ_SERVING_RACE_FILLS_SQL = [
  "SELECT generation_id::text, source_race_id, observed_at, raw_evidence_sha256, canonical",
  "FROM dna.read_dna_open_lab_serving_race_fills($1::uuid)",
  "ORDER BY source_race_id",
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

function optionalText(value: unknown, field: string): string | null {
  return value === null ? null : text(value, field);
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

function timestamp(value: unknown, field: string): string {
  const raw = value instanceof Date ? value.toISOString() : text(value, field);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${field} is invalid`);
  return parsed.toISOString();
}

function optionalTimestamp(value: unknown, field: string): string | null {
  return value === null ? null : timestamp(value, field);
}

function retryAfter(value: unknown): number | null {
  if (value === null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 86_400) {
    throw new Error("retry_after_seconds is invalid");
  }
  return parsed;
}

function optionalNullableText(value: unknown, field: string): string | null {
  if (value === null) return null;
  return text(value, field);
}

function positiveSafeIntegerText(value: unknown, field: string): string {
  const normalized = text(value, field);
  if (!/^[1-9][0-9]*$/u.test(normalized)) {
    throw new Error(`${field} must be a positive integer`);
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${field} exceeds the safe integer range`);
  }
  return normalized;
}

function servingOwnedCore(rowValue: unknown): DnaOpenLabServingOwnedCore {
  const row = record(rowValue, "DNA Open Lab serving owned Core");
  const sourceCoreId = positiveSafeIntegerText(
    row.source_core_id,
    "source_core_id",
  );
  const coreClass = text(row.core_class, "core_class");
  if (
    coreClass !== "Genesis" &&
    coreClass !== "Morphed" &&
    coreClass !== "Freak" &&
    coreClass !== "X-Class"
  ) {
    throw new Error("core_class is invalid");
  }
  const element = text(row.element, "element");
  if (
    element !== "Metal" &&
    element !== "Fire" &&
    element !== "Earth" &&
    element !== "Water"
  ) {
    throw new Error("element is invalid");
  }
  const sex = text(row.sex, "sex");
  if (sex !== "male" && sex !== "female") {
    throw new Error("sex is invalid");
  }
  const fNumber = Number(row.f_number);
  if (!Number.isSafeInteger(fNumber) || fNumber < 1) {
    throw new Error("f_number is invalid");
  }
  const rawEvidenceSha256 = text(
    row.raw_evidence_sha256,
    "raw_evidence_sha256",
  );
  if (!/^[a-f0-9]{64}$/u.test(rawEvidenceSha256)) {
    throw new Error("raw_evidence_sha256 is invalid");
  }
  return Object.freeze({
    generationId: uuid(
      text(row.generation_id, "generation_id"),
      "generation_id",
    ),
    observedAt: timestamp(row.observed_at, "observed_at"),
    rawEvidenceSha256,
    canonical: Object.freeze({
      sourceType: "core_details",
      sourceCoreId,
      displayName: text(row.display_name, "display_name"),
      coreClass,
      element,
      fNumber,
      sex,
      colorSourceValue: optionalNullableText(
        row.color_source_value,
        "color_source_value",
      ),
      fatherSourceCoreId: null,
      fatherNameSourceValue: null,
      motherSourceCoreId: null,
      motherNameSourceValue: null,
    }),
  });
}

function jsonRecord(value: unknown, field: string): DbRow {
  if (typeof value === "string") {
    try {
      return record(JSON.parse(value), field);
    } catch {
      throw new Error(`${field} must be valid JSON`);
    }
  }
  return record(value, field);
}

function servingRaceRow<
  T extends CanonicalActiveRaceSnapshot | CanonicalRaceFillSnapshot,
>(
  rowValue: unknown,
  expectedSourceType: T["sourceType"],
): DnaCurrentRaceMaterializationRow<T> & Readonly<{ generationId: string }> {
  const row = record(rowValue, "DNA Open Lab serving current race");
  const sourceRaceId = text(row.source_race_id, "source_race_id");
  const canonical = jsonRecord(row.canonical, "canonical");
  if (
    canonical.sourceType !== expectedSourceType ||
    canonical.sourceRaceId !== sourceRaceId
  ) {
    throw new Error("DNA Open Lab serving current-race authority is invalid");
  }
  const rawEvidenceSha256 = text(
    row.raw_evidence_sha256,
    "raw_evidence_sha256",
  );
  if (!/^[a-f0-9]{64}$/u.test(rawEvidenceSha256)) {
    throw new Error("raw_evidence_sha256 is invalid");
  }
  return Object.freeze({
    generationId: uuid(
      text(row.generation_id, "generation_id"),
      "generation_id",
    ),
    sourceRaceId,
    observedAt: timestamp(row.observed_at, "observed_at"),
    rawEvidenceSha256,
    canonical: canonical as T,
  });
}

function ownedCoreRows(input: {
  candidate: DnaCurrentStateCandidate;
  ownedCores: readonly DnaOpenLabEvidence<AdaptedCoreDetailsRow>[];
}): readonly Record<string, unknown>[] {
  if (input.ownedCores.length !== input.candidate.families.cores.itemCount) {
    throw new Error(
      "DNA Open Lab owned Core count must match the complete Core family count",
    );
  }
  const seen = new Set<string>();
  return Object.freeze(
    input.ownedCores.map((entry) => {
      if (
        entry.source !== "dna_open_lab" ||
        entry.sourceVersion !== "v1" ||
        entry.scope !== "vault" ||
        entry.endpoint !== "vault.cores_full" ||
        entry.canonical.sourceType !== "core_details"
      ) {
        throw new Error(
          "DNA Open Lab owned Core evidence authority is invalid",
        );
      }
      const sourceCoreId = positiveSafeIntegerText(
        entry.canonical.sourceCoreId,
        "owned Core sourceCoreId",
      );
      if (entry.entityKey !== `core:${sourceCoreId}`) {
        throw new Error("DNA Open Lab owned Core entity key is invalid");
      }
      if (seen.has(sourceCoreId)) {
        throw new Error("DNA Open Lab owned Core IDs must be unique");
      }
      seen.add(sourceCoreId);
      const observedAt = timestamp(entry.observedAt, "owned Core observedAt");
      if (Date.parse(observedAt) > Date.parse(input.candidate.observedAt)) {
        throw new Error(
          "DNA Open Lab owned Core observation cannot follow its generation",
        );
      }
      if (!/^[a-f0-9]{64}$/u.test(entry.rawEvidenceSha256)) {
        throw new Error("DNA Open Lab owned Core evidence checksum is invalid");
      }
      return Object.freeze({
        sourceCoreId,
        displayName: entry.canonical.displayName,
        coreClass: entry.canonical.coreClass,
        element: entry.canonical.element,
        fNumber: entry.canonical.fNumber,
        sex: entry.canonical.sex,
        colorSourceValue: entry.canonical.colorSourceValue,
        observedAt,
        rawEvidenceSha256: entry.rawEvidenceSha256,
      });
    }),
  );
}

function state(result: QueryResult): DnaLastGoodSyncState {
  if (result.rows.length === 0) return createInitialDnaLastGoodSyncState();
  const row = oneRow(result, "DNA Open Lab sync state");
  const syncStatus = text(row.sync_status, "sync_status");
  if (
    syncStatus !== "never_synced" &&
    syncStatus !== "current" &&
    syncStatus !== "paused" &&
    syncStatus !== "catching_up"
  ) {
    throw new Error("DNA Open Lab sync status is invalid");
  }
  const interruptionReason = optionalText(
    row.last_interruption_reason,
    "last_interruption_reason",
  );
  if (
    interruptionReason !== null &&
    interruptionReason !== "rate_limited" &&
    interruptionReason !== "api_ineligible" &&
    interruptionReason !== "api_unavailable" &&
    interruptionReason !== "partial_refresh" &&
    interruptionReason !== "invalid_payload"
  ) {
    throw new Error("DNA Open Lab interruption reason is invalid");
  }
  const interruptionAt = optionalTimestamp(
    row.last_interruption_at,
    "last_interruption_at",
  );
  if ((interruptionReason === null) !== (interruptionAt === null)) {
    throw new Error("DNA Open Lab interruption state is incomplete");
  }
  return Object.freeze({
    acceptedGenerationId: optionalText(
      row.accepted_generation_id,
      "accepted_generation_id",
    ),
    acceptedObservedAt: optionalTimestamp(
      row.accepted_observed_at,
      "accepted_observed_at",
    ),
    acceptedAt: optionalTimestamp(row.accepted_at, "accepted_at"),
    servingGenerationId: optionalText(
      row.serving_generation_id,
      "serving_generation_id",
    ),
    syncStatus,
    catchUpRequired: bool(row.catch_up_required, "catch_up_required"),
    lastAttemptAt: optionalTimestamp(row.last_attempt_at, "last_attempt_at"),
    lastInterruption:
      interruptionReason === null
        ? null
        : Object.freeze({
            reason: interruptionReason,
            at: interruptionAt!,
            retryAfterSeconds: retryAfter(row.retry_after_seconds),
          }),
    lastCatchUpCompletedAt: optionalTimestamp(
      row.last_catch_up_completed_at,
      "last_catch_up_completed_at",
    ),
  });
}

function verifyIsolation(
  result: QueryResult,
  input: { databaseOwnerId: string; ownerId: string; runtimeRole: string },
): void {
  const row = oneRow(result, "DNA Open Lab sync isolation");
  if (
    text(row.database_owner_id, "database_owner_id") !==
      input.databaseOwnerId ||
    text(row.authenticated_owner_id, "authenticated_owner_id") !== input.ownerId
  ) {
    throw new Error("DNA Open Lab sync owner scope denied.");
  }
  for (const field of [
    "generation_rls",
    "generation_force_rls",
    "family_rls",
    "family_force_rls",
    "state_rls",
    "state_force_rls",
    "core_rls",
    "core_force_rls",
    "active_rls",
    "active_force_rls",
    "fill_rls",
    "fill_force_rls",
    "supplemental_rls",
    "supplemental_force_rls",
    "token_rls",
    "token_force_rls",
    "arena_mode_rls",
    "arena_mode_force_rls",
    "arena_page_rls",
    "arena_page_force_rls",
    "arena_listing_rls",
    "arena_listing_force_rls",
  ]) {
    if (!bool(row[field], field)) {
      throw new Error(
        "DNA Open Lab sync publication requires forced owner RLS.",
      );
    }
  }
  if (
    bool(row.runtime_can_access_generation, "runtime_can_access_generation") ||
    bool(row.runtime_can_access_family, "runtime_can_access_family") ||
    bool(row.runtime_can_access_state, "runtime_can_access_state") ||
    bool(row.runtime_can_access_core, "runtime_can_access_core") ||
    bool(row.runtime_can_access_active, "runtime_can_access_active") ||
    bool(row.runtime_can_access_fill, "runtime_can_access_fill") ||
    bool(
      row.runtime_can_access_supplemental,
      "runtime_can_access_supplemental",
    ) ||
    bool(row.runtime_can_access_token, "runtime_can_access_token") ||
    bool(row.runtime_can_access_arena_mode, "runtime_can_access_arena_mode") ||
    bool(row.runtime_can_access_arena_page, "runtime_can_access_arena_page") ||
    bool(
      row.runtime_can_access_arena_listing,
      "runtime_can_access_arena_listing",
    )
  ) {
    throw new Error("DNA Open Lab sync table access is not bounded.");
  }
  for (const field of [
    "runtime_can_stage_complete",
    "runtime_can_publish",
    "runtime_can_pause",
    "runtime_can_read",
    "runtime_can_read_cores",
    "runtime_can_read_active",
    "runtime_can_read_fills",
    "runtime_can_read_supplemental",
    "runtime_can_read_token",
    "runtime_can_read_arena_pages",
    "runtime_can_read_arena",
  ]) {
    if (!bool(row[field], field)) {
      throw new Error("DNA Open Lab sync function privilege is incomplete.");
    }
  }
  if (bool(row.runtime_can_stage_legacy, "runtime_can_stage_legacy")) {
    throw new Error("DNA Open Lab legacy staging privilege is not bounded.");
  }
  if (bool(row.runtime_can_stage_cores_only, "runtime_can_stage_cores_only")) {
    throw new Error("DNA Open Lab Core-only staging privilege is not bounded.");
  }
  if (
    bool(
      row.runtime_can_stage_current_race,
      "runtime_can_stage_current_race",
    ) ||
    bool(row.runtime_can_stage_supplemental, "runtime_can_stage_supplemental")
  ) {
    throw new Error("DNA Open Lab partial staging privilege is not bounded.");
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
    throw new Error("DNA Open Lab sync runtime role is not least privileged.");
  }
}

export function createNeonDnaOpenLabSyncPublicationRepository(input: {
  databaseUrl: string;
  databaseOwnerId: string;
  runtimeRole: string;
  sessionFactory?: NeonImportPersistenceSessionFactory;
}): NeonDnaOpenLabSyncPublicationRepository {
  const databaseUrl = input.databaseUrl.trim();
  const databaseOwnerId = uuid(input.databaseOwnerId, "databaseOwnerId");
  const runtimeRole = input.runtimeRole.trim();
  if (!databaseUrl) throw new Error("databaseUrl is required");
  if (!ROLE_PATTERN.test(runtimeRole))
    throw new Error("runtimeRole is invalid");
  const sessionFactory =
    input.sessionFactory ?? createDefaultNeonImportPersistenceSession;

  async function transaction<T>(request: {
    ownerId: string;
    readOnly: boolean;
    run: (
      client: Awaited<ReturnType<typeof sessionFactory>>["client"],
    ) => Promise<T>;
  }): Promise<T> {
    const ownerId = owner(request.ownerId);
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
    async publishCandidate(request) {
      const readiness = inspectDnaCurrentStateCandidate(request.candidate);
      if (!readiness.ready) {
        throw new Error(
          `DNA Open Lab candidate is incomplete: ${readiness.incompleteFamilies.join(", ")}`,
        );
      }
      const generationId = uuid(request.candidate.generationId, "generationId");
      const recordedAt = timestamp(request.recordedAt, "recordedAt");
      const acceptedAt = timestamp(request.acceptedAt, "acceptedAt");
      const cores = ownedCoreRows({
        candidate: request.candidate,
        ownedCores: request.ownedCores,
      });
      const currentRaces = createDnaCurrentRaceMaterialization({
        candidate: request.candidate,
        activeRaces: request.activeRaces,
        raceFills: request.raceFills,
      });
      const activeRaces = currentRaces.activeRaces.map((row) => ({
        sourceRaceId: row.sourceRaceId,
        observedAt: row.observedAt,
        rawEvidenceSha256: row.rawEvidenceSha256,
        canonical: row.canonical,
      }));
      const raceFills = currentRaces.raceFills.map((row) => ({
        sourceRaceId: row.sourceRaceId,
        observedAt: row.observedAt,
        rawEvidenceSha256: row.rawEvidenceSha256,
        canonical: row.canonical,
      }));
      const supplemental = createDnaSupplementalCoreMaterialization({
        candidate: request.candidate,
        sourceCoreIds: cores.map((row) => String(row.sourceCoreId)),
        ...request.supplementalCore,
      });
      const supplementalPayload = {
        racingStats: supplemental.racingStats,
        power: supplemental.power,
        listings: supplemental.listings,
        attachedAssets: supplemental.attachedAssets,
        owners: supplemental.owners,
        stamina: supplemental.stamina,
        splicing: supplemental.splicing,
      };
      const tokenSplice = createDnaTokenSpliceMaterialization({
        candidate: request.candidate,
        ...request.tokenSplice,
      });
      const tokenSplicePayload = {
        tokenPrices: tokenSplice.tokenPrices,
        arenaModes: tokenSplice.arenaModes,
        arenaPages: tokenSplice.arenaPages,
        arenaListings: tokenSplice.arenaListings,
      };
      return transaction({
        ownerId: request.ownerId,
        readOnly: false,
        async run(client) {
          const staged = oneRow(
            await client.query(
              "SELECT dna.stage_dna_open_lab_token_splice_candidate($1::uuid,$2::uuid,$3::timestamptz,$4::timestamptz,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb) AS status",
              [
                databaseOwnerId,
                generationId,
                request.candidate.observedAt,
                recordedAt,
                JSON.stringify(request.candidate.families),
                JSON.stringify(cores),
                JSON.stringify(activeRaces),
                JSON.stringify(raceFills),
                JSON.stringify(supplementalPayload),
                JSON.stringify(tokenSplicePayload),
              ],
            ),
            "DNA Open Lab candidate staging",
          );
          const stageStatus = text(staged.status, "status");
          if (stageStatus !== "staged" && stageStatus !== "published") {
            throw new Error("DNA Open Lab candidate staging status is invalid");
          }
          const published = oneRow(
            await client.query(
              "SELECT dna.publish_dna_open_lab_sync_candidate($1::uuid,$2::uuid,$3::timestamptz) AS status",
              [databaseOwnerId, generationId, acceptedAt],
            ),
            "DNA Open Lab candidate publication",
          );
          if (text(published.status, "status") !== "published") {
            throw new Error("DNA Open Lab publication status is invalid");
          }
          return state(await client.query(READ_STATE_SQL, [databaseOwnerId]));
        },
      });
    },

    async pause(request) {
      const attemptedAt = timestamp(request.attemptedAt, "attemptedAt");
      const retry = request.retryAfterSeconds ?? null;
      if (
        retry !== null &&
        (!Number.isSafeInteger(retry) || retry < 0 || retry > 86_400)
      ) {
        throw new Error("retryAfterSeconds is invalid");
      }
      return transaction({
        ownerId: request.ownerId,
        readOnly: false,
        async run(client) {
          const paused = oneRow(
            await client.query(
              "SELECT dna.pause_dna_open_lab_sync($1::uuid,$2::text,$3::timestamptz,$4::integer) AS status",
              [databaseOwnerId, request.reason, attemptedAt, retry],
            ),
            "DNA Open Lab sync pause",
          );
          if (text(paused.status, "status") !== "paused") {
            throw new Error("DNA Open Lab pause status is invalid");
          }
          return state(await client.query(READ_STATE_SQL, [databaseOwnerId]));
        },
      });
    },

    async read(request) {
      return transaction({
        ownerId: request.ownerId,
        readOnly: true,
        run: async (client) =>
          state(await client.query(READ_STATE_SQL, [databaseOwnerId])),
      });
    },

    async readServingOwnedCores(request) {
      return transaction({
        ownerId: request.ownerId,
        readOnly: true,
        async run(client) {
          const result = await client.query(READ_SERVING_OWNED_CORES_SQL, [
            databaseOwnerId,
          ]);
          return Object.freeze(result.rows.map(servingOwnedCore));
        },
      });
    },

    async readServingCurrentRaces(request) {
      return transaction({
        ownerId: request.ownerId,
        readOnly: true,
        async run(client) {
          const stateResult = state(
            await client.query(READ_STATE_SQL, [databaseOwnerId]),
          );
          const activeResult = await client.query(
            READ_SERVING_ACTIVE_RACES_SQL,
            [databaseOwnerId],
          );
          const fillResult = await client.query(READ_SERVING_RACE_FILLS_SQL, [
            databaseOwnerId,
          ]);
          const parsedActiveRaces = activeResult.rows.map((row) =>
            servingRaceRow<CanonicalActiveRaceSnapshot>(
              row,
              "active_race_snapshot",
            ),
          );
          const parsedRaceFills = fillResult.rows.map((row) =>
            servingRaceRow<CanonicalRaceFillSnapshot>(
              row,
              "race_fill_snapshot",
            ),
          );
          for (const row of [...parsedActiveRaces, ...parsedRaceFills]) {
            if (row.generationId !== stateResult.servingGenerationId) {
              throw new Error(
                "DNA Open Lab current-race serving generation is inconsistent",
              );
            }
          }
          const activeRaces = parsedActiveRaces.map((row) =>
            Object.freeze({
              sourceRaceId: row.sourceRaceId,
              observedAt: row.observedAt,
              rawEvidenceSha256: row.rawEvidenceSha256,
              canonical: row.canonical,
            }),
          );
          const raceFills = parsedRaceFills.map((row) =>
            Object.freeze({
              sourceRaceId: row.sourceRaceId,
              observedAt: row.observedAt,
              rawEvidenceSha256: row.rawEvidenceSha256,
              canonical: row.canonical,
            }),
          );
          return Object.freeze({
            generationId: stateResult.servingGenerationId,
            activeRaces: Object.freeze(activeRaces),
            raceFills: Object.freeze(raceFills),
          });
        },
      });
    },
  });
}
