import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceSessionFactory,
} from "@/lib/neon-import-persistence-driver";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA_PATTERN = /^[a-f0-9]{64}$/u;
const SAFE_ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/u;
const SAFE_WORKER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;
const SET_OWNER_SCOPE_SQL =
  "SELECT set_config('app.owner_id', $1, true) AS owner_scope";
const VERIFY_ISOLATION_SQL = `
  SELECT owner.clerk_user_id AS authenticated_owner_id,
    bool_and(class.relrowsecurity) AS all_rls_enabled,
    bool_and(class.relforcerowsecurity) AS all_force_rls_enabled,
    bool_or(has_table_privilege(session_user, class.oid,
      'SELECT,INSERT,UPDATE,DELETE')) AS runtime_can_access_tables,
    has_function_privilege(session_user,
      'dna.begin_pro_league_evidence_generation(uuid,uuid,uuid,text,character,timestamp with time zone,bigint,bigint,bigint,bigint,bigint,bigint)',
      'EXECUTE') AS runtime_can_begin,
    has_function_privilege(session_user,
      'dna.stage_pro_league_evidence_rows(uuid,uuid,text,text,integer,jsonb)',
      'EXECUTE') AS runtime_can_stage,
    has_function_privilege(session_user,
      'dna.publish_pro_league_evidence_generation(uuid,uuid,text,integer,integer,bigint,character,timestamp with time zone)',
      'EXECUTE') AS runtime_can_publish,
    has_function_privilege(session_user,
      'dna.read_active_pro_league_evidence_generation(uuid)',
      'EXECUTE') AS runtime_can_read_generation,
    has_function_privilege(session_user,
      'dna.list_active_pro_league_evidence_rows(uuid,text,integer,integer)',
      'EXECUTE') AS runtime_can_read_rows,
    session_user::text AS session_user_name,
    current_user::text AS current_user_name,
    role.rolsuper AS runtime_is_superuser,
    role.rolbypassrls AS runtime_bypasses_rls,
    role.rolcreaterole AS runtime_can_create_roles,
    role.rolcreatedb AS runtime_can_create_databases,
    COALESCE(pg_has_role(session_user, (
      SELECT neon_role.oid FROM pg_catalog.pg_roles neon_role
      WHERE neon_role.rolname = 'neon_superuser'
    ), 'MEMBER'), false) AS runtime_is_neon_superuser_member
  FROM dna.app_owner owner
  CROSS JOIN LATERAL (
    SELECT relation.oid, relation.relrowsecurity, relation.relforcerowsecurity
    FROM pg_catalog.pg_class relation
    WHERE relation.oid IN (
      'dna.pro_league_evidence_generation'::regclass,
      'dna.pro_league_evidence_stage_row'::regclass,
      'dna.pro_league_evidence_row'::regclass,
      'dna.pro_league_evidence_active'::regclass
    )
  ) class
  JOIN pg_catalog.pg_roles role ON role.rolname = session_user
  WHERE owner.id = $1::uuid AND owner.clerk_user_id = $2
  GROUP BY owner.clerk_user_id, role.rolsuper, role.rolbypassrls,
    role.rolcreaterole, role.rolcreatedb
`;
const BEGIN_SQL = `SELECT dna.begin_pro_league_evidence_generation(
  $1::uuid,$2::uuid,$3::uuid,$4::text,$5::character(64),$6::timestamptz,
  $7::bigint,$8::bigint,$9::bigint,$10::bigint,$11::bigint,$12::bigint
) AS disposition`;
const STAGE_SQL = `SELECT dna.stage_pro_league_evidence_rows(
  $1::uuid,$2::uuid,$3::text,$4::text,$5::integer,$6::jsonb
) AS hashes`;
const PUBLISH_SQL = `SELECT * FROM dna.publish_pro_league_evidence_generation(
  $1::uuid,$2::uuid,$3::text,$4::integer,$5::integer,$6::bigint,
  $7::character(64),$8::timestamptz
)`;
const READ_GENERATION_SQL =
  "SELECT * FROM dna.read_active_pro_league_evidence_generation($1::uuid)";
const READ_ROWS_SQL = `SELECT * FROM dna.list_active_pro_league_evidence_rows(
  $1::uuid,$2::text,$3::integer,$4::integer
)`;

type QueryResult = Readonly<{ rows: readonly unknown[] }>;
type Row = Readonly<Record<string, unknown>>;

export type ProLeagueEvidenceFamily = "benchmark" | "profile";

export type ProLeagueEvidenceGenerationMetadata = Readonly<{
  generationId: string;
  raceDatasetVersionId: string;
  sourceVersionSetSha256: string;
  evidenceCutoffAt: string;
  inputObservationCount: number;
  acceptedEntryCount: number;
  nonBikeEntryCount: number;
  missingFormatEntryCount: number;
  unsupportedFormatEntryCount: number;
  unpublishedCellEntryCount: number;
}>;

export type ActiveProLeagueEvidenceGeneration =
  ProLeagueEvidenceGenerationMetadata &
    Readonly<{
      unbenchmarkedEntryCount: number;
      benchmarkCount: number;
      profileCount: number;
      payloadSha256: string;
      publishedAt: string;
    }>;

export type ActiveProLeagueEvidenceRow = Readonly<{
  generationId: string;
  family: ProLeagueEvidenceFamily;
  ordinal: number;
  naturalKey: string;
  rowSha256: string;
  payload: Readonly<Record<string, unknown>>;
}>;

export type NeonProLeagueEvidenceGenerationRepository = Readonly<{
  begin: (
    ownerId: string,
    input: ProLeagueEvidenceGenerationMetadata & Readonly<{ workerId: string }>,
  ) => Promise<"staging" | "published">;
  stageRows: (
    ownerId: string,
    input: Readonly<{
      generationId: string;
      workerId: string;
      family: ProLeagueEvidenceFamily;
      startOrdinal: number;
      rows: readonly Readonly<{
        naturalKey: string;
        payload: Readonly<Record<string, unknown>>;
      }>[];
    }>,
  ) => Promise<readonly Readonly<{ ordinal: number; sha256: string }>[]>;
  publish: (
    ownerId: string,
    input: Readonly<{
      generationId: string;
      workerId: string;
      expectedBenchmarkCount: number;
      expectedProfileCount: number;
      unbenchmarkedEntryCount: number;
      payloadSha256: string;
      publishedAt: string;
    }>,
  ) => Promise<
    Readonly<{
      disposition: "published" | "existing";
      benchmarkCount: number;
      profileCount: number;
    }>
  >;
  readActiveGeneration: (
    ownerId: string,
  ) => Promise<ActiveProLeagueEvidenceGeneration | null>;
  listActiveRows: (
    ownerId: string,
    family: ProLeagueEvidenceFamily,
    afterOrdinal: number,
    limit: number,
  ) => Promise<readonly ActiveProLeagueEvidenceRow[]>;
}>;

export type ProLeagueEvidenceReadRepository = Pick<
  NeonProLeagueEvidenceGenerationRepository,
  "readActiveGeneration" | "listActiveRows"
>;

function row(value: unknown, label: string): Row {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Pro League evidence ${label} row is invalid.`);
  }
  return value as Row;
}

function one(result: QueryResult, label: string): Row {
  if (result.rows.length !== 1) {
    throw new Error(`Pro League evidence ${label} must return one row.`);
  }
  return row(result.rows[0], label);
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Pro League evidence ${label} is invalid.`);
  }
  return value.trim();
}

function bool(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Pro League evidence ${label} is invalid.`);
  }
  return value;
}

function integer(value: unknown, label: string, maximum: number): number {
  const parsed =
    typeof value === "string" && /^\d+$/u.test(value) ? Number(value) : value;
  if (
    !Number.isSafeInteger(parsed) ||
    (parsed as number) < 0 ||
    (parsed as number) > maximum
  ) {
    throw new Error(`Pro League evidence ${label} is invalid.`);
  }
  return parsed as number;
}

function uuid(value: unknown, label: string): string {
  const normalized = text(value, label).toLowerCase();
  if (!UUID_PATTERN.test(normalized)) {
    throw new Error(`Pro League evidence ${label} is invalid.`);
  }
  return normalized;
}

function sha(value: unknown, label: string): string {
  const normalized = text(value, label);
  if (!SHA_PATTERN.test(normalized)) {
    throw new Error(`Pro League evidence ${label} is invalid.`);
  }
  return normalized;
}

function timestamp(value: unknown, label: string): string {
  const parsed = value instanceof Date ? value : new Date(text(value, label));
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Pro League evidence ${label} is invalid.`);
  }
  return parsed.toISOString();
}

function object(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  return row(parsed, label);
}

function worker(value: string): string {
  const normalized = value.trim();
  if (!SAFE_WORKER_PATTERN.test(normalized)) {
    throw new Error("Pro League evidence worker ID is invalid.");
  }
  return normalized;
}

function verifyIsolation(
  result: QueryResult,
  ownerId: string,
  runtimeRole: string,
) {
  const value = one(result, "isolation");
  if (
    text(value.authenticated_owner_id, "authenticated owner") !== ownerId ||
    !bool(value.all_rls_enabled, "RLS") ||
    !bool(value.all_force_rls_enabled, "forced RLS") ||
    bool(value.runtime_can_access_tables, "direct table privilege") ||
    !bool(value.runtime_can_begin, "begin privilege") ||
    !bool(value.runtime_can_stage, "stage privilege") ||
    !bool(value.runtime_can_publish, "publish privilege") ||
    !bool(value.runtime_can_read_generation, "generation read privilege") ||
    !bool(value.runtime_can_read_rows, "row read privilege") ||
    text(value.session_user_name, "session user") !== runtimeRole ||
    text(value.current_user_name, "current user") !== runtimeRole ||
    bool(value.runtime_is_superuser, "runtime superuser") ||
    bool(value.runtime_bypasses_rls, "runtime bypass RLS") ||
    bool(value.runtime_can_create_roles, "runtime create-role authority") ||
    bool(
      value.runtime_can_create_databases,
      "runtime create-database authority",
    ) ||
    bool(
      value.runtime_is_neon_superuser_member,
      "runtime Neon superuser membership",
    )
  ) {
    throw new Error(
      "Pro League evidence repository requires least-privilege owner isolation.",
    );
  }
}

function parseGeneration(value: unknown): ActiveProLeagueEvidenceGeneration {
  const stored = row(value, "generation");
  if (text(stored.state, "generation state") !== "published") {
    throw new Error("Pro League evidence active generation is not published.");
  }
  return {
    generationId: uuid(stored.generation_id, "generation ID"),
    raceDatasetVersionId: uuid(
      stored.race_dataset_version_id,
      "Race dataset version ID",
    ),
    sourceVersionSetSha256: sha(
      stored.source_version_set_sha256,
      "source SHA-256",
    ),
    evidenceCutoffAt: timestamp(stored.evidence_cutoff_at, "evidence cutoff"),
    inputObservationCount: integer(
      stored.input_observation_count,
      "input count",
      5_000_000,
    ),
    acceptedEntryCount: integer(
      stored.accepted_entry_count,
      "accepted count",
      5_000_000,
    ),
    nonBikeEntryCount: integer(
      stored.non_bike_entry_count,
      "non-Bike count",
      5_000_000,
    ),
    missingFormatEntryCount: integer(
      stored.missing_format_entry_count,
      "missing-format count",
      5_000_000,
    ),
    unsupportedFormatEntryCount: integer(
      stored.unsupported_format_entry_count,
      "unsupported-format count",
      5_000_000,
    ),
    unpublishedCellEntryCount: integer(
      stored.unpublished_cell_entry_count,
      "unpublished-cell count",
      5_000_000,
    ),
    unbenchmarkedEntryCount: integer(
      stored.unbenchmarked_entry_count,
      "unbenchmarked count",
      5_000_000,
    ),
    benchmarkCount: integer(stored.benchmark_count, "benchmark count", 100_000),
    profileCount: integer(stored.profile_count, "profile count", 500_000),
    payloadSha256: sha(stored.payload_sha256, "payload SHA-256"),
    publishedAt: timestamp(stored.published_at, "published timestamp"),
  };
}

export function createNeonProLeagueEvidenceGenerationRepository(
  input: Readonly<{
    databaseUrl: string;
    databaseOwnerId: string;
    ownerId: string;
    runtimeRole: string;
    sessionFactory?: NeonImportPersistenceSessionFactory;
  }>,
): NeonProLeagueEvidenceGenerationRepository {
  const databaseUrl = text(input.databaseUrl, "database URL");
  const databaseOwnerId = uuid(input.databaseOwnerId, "database owner ID");
  const configuredOwnerId = text(input.ownerId, "owner ID");
  const runtimeRole = text(input.runtimeRole, "runtime role");
  if (!SAFE_ROLE_PATTERN.test(runtimeRole)) {
    throw new Error("Pro League evidence runtime role is invalid.");
  }
  const sessionFactory =
    input.sessionFactory ?? createDefaultNeonImportPersistenceSession;

  async function transaction<T>(
    options: Readonly<{
      ownerId: string;
      readOnly: boolean;
      execute: (
        query: (
          statement: string,
          values?: readonly unknown[],
        ) => Promise<QueryResult>,
      ) => Promise<T>;
    }>,
  ): Promise<T> {
    const ownerId = text(options.ownerId, "authenticated owner ID");
    if (ownerId !== configuredOwnerId) {
      throw new Error("Pro League evidence access denied.");
    }
    const session = await sessionFactory(databaseUrl);
    try {
      await session.client.query(
        options.readOnly
          ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"
          : "BEGIN ISOLATION LEVEL SERIALIZABLE",
      );
      await session.client.query(SET_OWNER_SCOPE_SQL, [databaseOwnerId]);
      verifyIsolation(
        await session.client.query(VERIFY_ISOLATION_SQL, [
          databaseOwnerId,
          ownerId,
        ]),
        ownerId,
        runtimeRole,
      );
      const result = await options.execute(session.client.query);
      await session.client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await session.client.query("ROLLBACK");
      } catch {
        // Preserve the original failure.
      }
      throw error;
    } finally {
      await session.close();
    }
  }

  return {
    async begin(ownerId, value) {
      const metadata = value;
      return transaction({
        ownerId,
        readOnly: false,
        async execute(query) {
          const stored = one(
            await query(BEGIN_SQL, [
              databaseOwnerId,
              uuid(metadata.generationId, "generation ID"),
              uuid(metadata.raceDatasetVersionId, "Race dataset version ID"),
              worker(metadata.workerId),
              sha(metadata.sourceVersionSetSha256, "source SHA-256"),
              timestamp(metadata.evidenceCutoffAt, "evidence cutoff"),
              integer(metadata.inputObservationCount, "input count", 5_000_000),
              integer(metadata.acceptedEntryCount, "accepted count", 5_000_000),
              integer(metadata.nonBikeEntryCount, "non-Bike count", 5_000_000),
              integer(
                metadata.missingFormatEntryCount,
                "missing-format count",
                5_000_000,
              ),
              integer(
                metadata.unsupportedFormatEntryCount,
                "unsupported-format count",
                5_000_000,
              ),
              integer(
                metadata.unpublishedCellEntryCount,
                "unpublished-cell count",
                5_000_000,
              ),
            ]),
            "begin",
          );
          const disposition = text(stored.disposition, "begin disposition");
          if (disposition !== "staging" && disposition !== "published") {
            throw new Error(
              "Pro League evidence begin disposition is invalid.",
            );
          }
          return disposition;
        },
      });
    },

    async stageRows(ownerId, value) {
      if (value.rows.length < 1 || value.rows.length > 500) {
        throw new Error(
          "Pro League evidence stage batch is outside its bound.",
        );
      }
      const startOrdinal = integer(
        value.startOrdinal,
        "start ordinal",
        499_999,
      );
      if (startOrdinal + value.rows.length > 500_000) {
        throw new Error(
          "Pro League evidence stage ordinals exceed their bound.",
        );
      }
      const rows = value.rows.map((entry) => ({
        naturalKey: text(entry.naturalKey, "natural key"),
        payload: object(entry.payload, "payload"),
      }));
      return transaction({
        ownerId,
        readOnly: false,
        async execute(query) {
          const stored = one(
            await query(STAGE_SQL, [
              databaseOwnerId,
              uuid(value.generationId, "generation ID"),
              worker(value.workerId),
              value.family,
              startOrdinal,
              JSON.stringify(rows),
            ]),
            "stage",
          );
          const hashes =
            typeof stored.hashes === "string"
              ? JSON.parse(stored.hashes)
              : stored.hashes;
          if (!Array.isArray(hashes) || hashes.length !== rows.length) {
            throw new Error(
              "Pro League evidence staged hash coverage is incomplete.",
            );
          }
          return hashes.map((entry, index) => {
            const parsed = row(entry, "staged hash");
            const ordinal = integer(parsed.ordinal, "staged ordinal", 499_999);
            if (ordinal !== startOrdinal + index) {
              throw new Error("Pro League evidence staged hash order drifted.");
            }
            return {
              ordinal,
              sha256: sha(parsed.sha256, "staged row SHA-256"),
            };
          });
        },
      });
    },

    async publish(ownerId, value) {
      return transaction({
        ownerId,
        readOnly: false,
        async execute(query) {
          const stored = one(
            await query(PUBLISH_SQL, [
              databaseOwnerId,
              uuid(value.generationId, "generation ID"),
              worker(value.workerId),
              integer(value.expectedBenchmarkCount, "benchmark count", 100_000),
              integer(value.expectedProfileCount, "profile count", 500_000),
              integer(
                value.unbenchmarkedEntryCount,
                "unbenchmarked count",
                5_000_000,
              ),
              sha(value.payloadSha256, "payload SHA-256"),
              timestamp(value.publishedAt, "published timestamp"),
            ]),
            "publication",
          );
          const disposition = text(
            stored.disposition,
            "publication disposition",
          );
          if (disposition !== "published" && disposition !== "existing") {
            throw new Error(
              "Pro League evidence publication disposition is invalid.",
            );
          }
          return {
            disposition,
            benchmarkCount: integer(
              stored.benchmark_count,
              "published benchmark count",
              100_000,
            ),
            profileCount: integer(
              stored.profile_count,
              "published profile count",
              500_000,
            ),
          };
        },
      });
    },

    async readActiveGeneration(ownerId) {
      return transaction({
        ownerId,
        readOnly: true,
        async execute(query) {
          const result = await query(READ_GENERATION_SQL, [databaseOwnerId]);
          if (result.rows.length === 0) return null;
          if (result.rows.length !== 1) {
            throw new Error(
              "Pro League evidence has multiple active generations.",
            );
          }
          return parseGeneration(result.rows[0]);
        },
      });
    },

    async listActiveRows(ownerId, family, afterOrdinal, limit) {
      if (family !== "benchmark" && family !== "profile") {
        throw new Error("Pro League evidence family is invalid.");
      }
      if (
        !Number.isSafeInteger(afterOrdinal) ||
        afterOrdinal < -1 ||
        afterOrdinal > 499_999
      ) {
        throw new Error("Pro League evidence page cursor is invalid.");
      }
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 5_000) {
        throw new Error("Pro League evidence page limit is invalid.");
      }
      return transaction({
        ownerId,
        readOnly: true,
        async execute(query) {
          const result = await query(READ_ROWS_SQL, [
            databaseOwnerId,
            family,
            afterOrdinal,
            limit,
          ]);
          let previous = afterOrdinal;
          return result.rows.map((value) => {
            const stored = row(value, "active evidence");
            const ordinal = integer(
              stored.ordinal,
              "active row ordinal",
              499_999,
            );
            if (ordinal <= previous) {
              throw new Error("Pro League evidence page order drifted.");
            }
            previous = ordinal;
            const storedFamily = text(stored.family, "active row family");
            if (storedFamily !== family) {
              throw new Error("Pro League evidence family drifted.");
            }
            return {
              generationId: uuid(stored.generation_id, "active generation ID"),
              family,
              ordinal,
              naturalKey: text(stored.natural_key, "active natural key"),
              rowSha256: sha(stored.row_sha256, "active row SHA-256"),
              payload: object(stored.payload, "active payload"),
            };
          });
        },
      });
    },
  };
}

type ProLeagueEvidenceReadEnvironment = Readonly<{
  databaseUrl?: string;
  databaseOwnerId?: string;
  ownerId?: string;
  runtimeRole?: string;
}>;

function configured(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized === "" ? null : normalized;
}

export function neonProLeagueEvidenceReadRepositoryFromEnvironment(
  environment: ProLeagueEvidenceReadEnvironment,
  sessionFactory?: NeonImportPersistenceSessionFactory,
): ProLeagueEvidenceReadRepository | null {
  const databaseUrl = configured(environment.databaseUrl);
  const databaseOwnerId = configured(environment.databaseOwnerId);
  const ownerId = configured(environment.ownerId);
  const runtimeRole = configured(environment.runtimeRole);
  if (
    databaseUrl === null ||
    databaseOwnerId === null ||
    ownerId === null ||
    runtimeRole === null
  ) {
    return null;
  }
  const repository = createNeonProLeagueEvidenceGenerationRepository({
    databaseUrl,
    databaseOwnerId,
    ownerId,
    runtimeRole,
    ...(sessionFactory === undefined ? {} : { sessionFactory }),
  });
  return Object.freeze({
    readActiveGeneration: repository.readActiveGeneration,
    listActiveRows: repository.listActiveRows,
  });
}
