import { createHash } from "node:crypto";

import {
  rankBreedingPairs,
  type BreedingPairRankingInput,
} from "@/domain/breeding-pair-ranking";
import type { BreedingRankingRepository } from "@/lib/breeding-workspace-service";
import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceSessionFactory,
} from "@/lib/neon-import-persistence-driver";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA_PATTERN = /^[a-f0-9]{64}$/u;
const SAFE_ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/u;
const MAXIMUM_RANKINGS = 200;
const MAXIMUM_CANDIDATES = 2_000;
const MAXIMUM_CANONICAL_BYTES = 4_194_304;
const SET_OWNER_SCOPE_SQL =
  "SELECT set_config('app.owner_id', $1, true) AS owner_scope";
const VERIFY_ISOLATION_SQL = `
  SELECT owner.clerk_user_id AS authenticated_owner_id,
    bool_and(class.relrowsecurity) AS all_rls_enabled,
    bool_and(class.relforcerowsecurity) AS all_force_rls_enabled,
    bool_or(has_table_privilege(session_user, class.oid,
      'SELECT,INSERT,UPDATE,DELETE')) AS runtime_can_access_tables,
    has_function_privilege(session_user,
      'dna.publish_pro_league_breeding_ranking_generation(uuid,uuid,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,integer,integer,character,jsonb,timestamp with time zone)',
      'EXECUTE') AS runtime_can_publish,
    has_function_privilege(session_user,
      'dna.read_active_pro_league_breeding_ranking_generation(uuid)',
      'EXECUTE') AS runtime_can_read,
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
      'dna.pro_league_breeding_ranking_generation'::regclass,
      'dna.pro_league_breeding_ranking_row'::regclass,
      'dna.pro_league_breeding_ranking_active'::regclass
    )
  ) class
  JOIN pg_catalog.pg_roles role ON role.rolname = session_user
  WHERE owner.id = $1::uuid AND owner.clerk_user_id = $2
  GROUP BY owner.clerk_user_id, role.rolsuper, role.rolbypassrls,
    role.rolcreaterole, role.rolcreatedb
`;
const PUBLISH_SQL = `SELECT * FROM dna.publish_pro_league_breeding_ranking_generation(
  $1::uuid,$2::uuid,$3::text,$4::timestamptz,$5::timestamptz,$6::timestamptz,
  $7::integer,$8::integer,$9::character(64),$10::jsonb,$11::timestamptz
)`;
const READ_SQL =
  "SELECT * FROM dna.read_active_pro_league_breeding_ranking_generation($1::uuid)";

type Row = Readonly<Record<string, unknown>>;
type QueryResult = Readonly<{ rows: readonly unknown[] }>;
type RankingAuthority = Readonly<{
  rosterEvidenceCutoffAt: string;
  latestAcceptedPerformanceImportAt: string | null;
  latestAcceptedArenaImportAt: string | null;
  publishedAt: string;
}>;

export type ProLeagueBreedingRankingPublication = Readonly<{
  generationId: string;
  workerId: string;
  rosterEvidenceCutoffAt: string;
  latestAcceptedPerformanceImportAt: string | null;
  latestAcceptedArenaImportAt: string | null;
  publishedAt: string;
  rankings: readonly BreedingPairRankingInput[];
}>;

export type NeonProLeagueBreedingRankingRepository = Readonly<{
  status: "ready";
  publish: (
    ownerId: string,
    publication: ProLeagueBreedingRankingPublication,
  ) => Promise<"published" | "existing">;
  loadRankingEvidenceByOwner: Exclude<
    BreedingRankingRepository,
    { status: "not_configured" }
  >["loadRankingEvidenceByOwner"];
}>;

function record(value: unknown, label: string): Row {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Pro League breeding ${label} must be a database row.`);
  }
  return value as Row;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Pro League breeding ${label} is invalid.`);
  }
  return value;
}

function bool(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Pro League breeding ${label} is invalid.`);
  }
  return value;
}

function integer(value: unknown, label: string, maximum: number): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (
    typeof parsed !== "number" ||
    !Number.isSafeInteger(parsed) ||
    parsed < 0 ||
    parsed > maximum
  ) {
    throw new Error(`Pro League breeding ${label} is invalid.`);
  }
  return parsed;
}

function timestamp(value: unknown, label: string): string {
  const parsed = value instanceof Date ? value : new Date(text(value, label));
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Pro League breeding ${label} is invalid.`);
  }
  return parsed.toISOString();
}

function optionalTimestamp(value: unknown, label: string): string | null {
  return value === null ? null : timestamp(value, label);
}

function canonicalJson(value: unknown): string {
  if (value === undefined) {
    throw new Error("Pro League breeding canonical payload is invalid.");
  }
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) {
      throw new Error("Pro League breeding canonical payload is invalid.");
    }
    return encoded;
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function verifyGenerationAuthority(authority: RankingAuthority): void {
  if (
    [
      authority.rosterEvidenceCutoffAt,
      authority.latestAcceptedPerformanceImportAt,
      authority.latestAcceptedArenaImportAt,
    ].some(
      (value) =>
        value !== null && Date.parse(value) > Date.parse(authority.publishedAt),
    )
  ) {
    throw new Error(
      "Pro League breeding generation authority cannot postdate publication.",
    );
  }
}

function verifyRankingAuthority(
  ranking: BreedingPairRankingInput,
  authority: RankingAuthority,
): void {
  rankBreedingPairs(ranking);
  if (
    ranking.lastImported !== authority.latestAcceptedPerformanceImportAt ||
    ranking.arenaLastImported !== authority.latestAcceptedArenaImportAt ||
    Date.parse(ranking.evaluatedAt) > Date.parse(authority.publishedAt) ||
    (ranking.dataCurrentThrough !== null &&
      Date.parse(ranking.dataCurrentThrough) >
        Date.parse(authority.rosterEvidenceCutoffAt))
  ) {
    throw new Error(
      "Pro League breeding ranking authority does not match its generation.",
    );
  }
}

function publicationRows(
  rankings: readonly BreedingPairRankingInput[],
  authority: RankingAuthority,
) {
  if (rankings.length > MAXIMUM_RANKINGS) {
    throw new Error(
      "Pro League breeding ranking count exceeds the compact bound.",
    );
  }
  let candidateCount = 0;
  let canonicalByteCount = 0;
  const rows = rankings.map((ranking, ordinal) => {
    verifyRankingAuthority(ranking, authority);
    const canonicalPayload = canonicalJson(ranking);
    const rowSha256 = sha256(canonicalPayload);
    candidateCount += Array.isArray(ranking.candidates)
      ? ranking.candidates.length
      : MAXIMUM_CANDIDATES + 1;
    canonicalByteCount += Buffer.byteLength(canonicalPayload, "utf8");
    return {
      ordinal,
      rankingId: ranking.rankingId,
      canonicalPayload,
      rowSha256,
    };
  });
  if (
    candidateCount > MAXIMUM_CANDIDATES ||
    canonicalByteCount > MAXIMUM_CANONICAL_BYTES
  ) {
    throw new Error(
      "Pro League breeding compact generation bound was exceeded.",
    );
  }
  return {
    rows,
    candidateCount,
    canonicalByteCount,
    payloadSha256: sha256(
      rows
        .map(({ ordinal, rowSha256 }) => `${ordinal}:${rowSha256}\n`)
        .join(""),
    ),
  };
}

function verifyIsolation(
  value: unknown,
  ownerId: string,
  runtimeRole: string,
): void {
  const row = record(value, "isolation");
  if (
    text(row.authenticated_owner_id, "authenticated owner") !== ownerId ||
    !bool(row.all_rls_enabled, "RLS state") ||
    !bool(row.all_force_rls_enabled, "forced RLS state") ||
    bool(row.runtime_can_access_tables, "direct table privilege") ||
    !bool(row.runtime_can_publish, "publication privilege") ||
    !bool(row.runtime_can_read, "read privilege") ||
    text(row.session_user_name, "session role") !== runtimeRole ||
    text(row.current_user_name, "current role") !== runtimeRole ||
    bool(row.runtime_is_superuser, "superuser state") ||
    bool(row.runtime_bypasses_rls, "RLS bypass state") ||
    bool(row.runtime_can_create_roles, "role creation state") ||
    bool(row.runtime_can_create_databases, "database creation state") ||
    bool(row.runtime_is_neon_superuser_member, "Neon superuser membership")
  ) {
    throw new Error("Pro League breeding runtime owner isolation failed.");
  }
}

function configuration(input: {
  databaseUrl: string;
  databaseOwnerId: string;
  ownerId: string;
  runtimeRole: string;
}) {
  const value = {
    databaseUrl: input.databaseUrl.trim(),
    databaseOwnerId: input.databaseOwnerId.trim(),
    ownerId: input.ownerId.trim(),
    runtimeRole: input.runtimeRole.trim(),
  };
  if (
    value.databaseUrl === "" ||
    !UUID_PATTERN.test(value.databaseOwnerId) ||
    value.ownerId === "" ||
    !SAFE_ROLE_PATTERN.test(value.runtimeRole)
  ) {
    throw new Error("Pro League breeding repository configuration is invalid.");
  }
  return value;
}

export function createNeonProLeagueBreedingRankingRepository(
  input: Readonly<{
    databaseUrl: string;
    databaseOwnerId: string;
    ownerId: string;
    runtimeRole: string;
    sessionFactory?: NeonImportPersistenceSessionFactory;
  }>,
): NeonProLeagueBreedingRankingRepository {
  const config = configuration(input);
  const sessionFactory =
    input.sessionFactory ?? createDefaultNeonImportPersistenceSession;

  async function transaction<T>(
    ownerId: string,
    isolation: "SERIALIZABLE" | "REPEATABLE READ READ ONLY",
    operation: (client: {
      query: (
        statement: string,
        values?: readonly unknown[],
      ) => Promise<QueryResult>;
    }) => Promise<T>,
  ): Promise<T> {
    if (ownerId !== config.ownerId) {
      throw new Error("Pro League breeding owner scope denied.");
    }
    const session = await sessionFactory(config.databaseUrl);
    let started = false;
    try {
      await session.client.query(
        `BEGIN TRANSACTION ISOLATION LEVEL ${isolation}`,
      );
      started = true;
      await session.client.query(SET_OWNER_SCOPE_SQL, [config.databaseOwnerId]);
      const verified = await session.client.query(VERIFY_ISOLATION_SQL, [
        config.databaseOwnerId,
        ownerId,
      ]);
      if (verified.rows.length !== 1) {
        throw new Error("Pro League breeding owner scope denied.");
      }
      verifyIsolation(verified.rows[0], ownerId, config.runtimeRole);
      const result = await operation(session.client);
      await session.client.query("COMMIT");
      started = false;
      return result;
    } catch (error) {
      if (started)
        await session.client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      await session.close();
    }
  }

  return Object.freeze({
    status: "ready",
    async publish(ownerId, publication) {
      if (!UUID_PATTERN.test(publication.generationId)) {
        throw new Error("Pro League breeding generation ID is invalid.");
      }
      const authority = {
        rosterEvidenceCutoffAt: timestamp(
          publication.rosterEvidenceCutoffAt,
          "roster cutoff",
        ),
        latestAcceptedPerformanceImportAt: optionalTimestamp(
          publication.latestAcceptedPerformanceImportAt,
          "performance import",
        ),
        latestAcceptedArenaImportAt: optionalTimestamp(
          publication.latestAcceptedArenaImportAt,
          "Arena import",
        ),
        publishedAt: timestamp(publication.publishedAt, "publication time"),
      };
      verifyGenerationAuthority(authority);
      const prepared = publicationRows(publication.rankings, authority);
      return transaction(ownerId, "SERIALIZABLE", async (client) => {
        const result = await client.query(PUBLISH_SQL, [
          config.databaseOwnerId,
          publication.generationId,
          publication.workerId,
          authority.rosterEvidenceCutoffAt,
          authority.latestAcceptedPerformanceImportAt,
          authority.latestAcceptedArenaImportAt,
          prepared.rows.length,
          prepared.candidateCount,
          prepared.payloadSha256,
          JSON.stringify(
            prepared.rows.map((row) => ({
              rankingId: row.rankingId,
              canonicalPayload: row.canonicalPayload,
              rowSha256: row.rowSha256,
            })),
          ),
          authority.publishedAt,
        ]);
        if (result.rows.length !== 1) {
          throw new Error(
            "Pro League breeding publication must return one row.",
          );
        }
        const stored = record(result.rows[0], "publication");
        const disposition = text(stored.disposition, "publication disposition");
        if (
          !["published", "existing"].includes(disposition) ||
          text(stored.generation_id, "stored generation ID") !==
            publication.generationId ||
          integer(
            stored.ranking_count,
            "stored ranking count",
            MAXIMUM_RANKINGS,
          ) !== prepared.rows.length ||
          integer(
            stored.candidate_count,
            "stored candidate count",
            MAXIMUM_CANDIDATES,
          ) !== prepared.candidateCount ||
          integer(
            stored.canonical_byte_count,
            "stored canonical byte count",
            MAXIMUM_CANONICAL_BYTES,
          ) !== prepared.canonicalByteCount ||
          text(stored.payload_sha256, "stored payload digest") !==
            prepared.payloadSha256
        ) {
          throw new Error(
            "Pro League breeding publication receipt is invalid.",
          );
        }
        return disposition as "published" | "existing";
      });
    },
    async loadRankingEvidenceByOwner(ownerId) {
      return transaction(
        ownerId,
        "REPEATABLE READ READ ONLY",
        async (client) => {
          const result = await client.query(READ_SQL, [config.databaseOwnerId]);
          if (result.rows.length === 0) {
            return {
              rankings: [],
              latestAcceptedPerformanceImportAt: null,
              latestAcceptedArenaImportAt: null,
            };
          }
          if (result.rows.length !== 1) {
            throw new Error(
              "Pro League breeding has multiple active generations.",
            );
          }
          const generation = record(result.rows[0], "active generation");
          if (
            !UUID_PATTERN.test(
              text(generation.generation_id, "active generation ID"),
            )
          ) {
            throw new Error(
              "Pro League breeding active generation ID is invalid.",
            );
          }
          const authority = {
            rosterEvidenceCutoffAt: timestamp(
              generation.roster_evidence_cutoff_at,
              "roster cutoff",
            ),
            latestAcceptedPerformanceImportAt: optionalTimestamp(
              generation.latest_performance_import_at,
              "performance import",
            ),
            latestAcceptedArenaImportAt: optionalTimestamp(
              generation.latest_arena_import_at,
              "Arena import",
            ),
            publishedAt: timestamp(generation.published_at, "publication time"),
          };
          verifyGenerationAuthority(authority);
          const rankingCount = integer(
            generation.ranking_count,
            "ranking count",
            MAXIMUM_RANKINGS,
          );
          const expectedCandidateCount = integer(
            generation.candidate_count,
            "candidate count",
            MAXIMUM_CANDIDATES,
          );
          const expectedByteCount = integer(
            generation.canonical_byte_count,
            "canonical byte count",
            MAXIMUM_CANONICAL_BYTES,
          );
          const expectedDigest = text(
            generation.payload_sha256,
            "payload digest",
          );
          if (
            !SHA_PATTERN.test(expectedDigest) ||
            !Array.isArray(generation.rows)
          ) {
            throw new Error(
              "Pro League breeding active generation is invalid.",
            );
          }
          if (generation.rows.length !== rankingCount) {
            throw new Error(
              "Pro League breeding active ranking count drifted.",
            );
          }
          let candidateCount = 0;
          let byteCount = 0;
          const hashLines: string[] = [];
          const rankings = generation.rows.map((value, expectedOrdinal) => {
            const row = record(value, "active ranking");
            const ordinal = integer(row.ordinal, "ranking ordinal", 199);
            const rankingId = text(row.rankingId, "ranking ID");
            const canonicalPayload = text(
              row.canonicalPayload,
              "canonical payload",
            );
            const rowSha256 = text(row.rowSha256, "row digest");
            if (
              ordinal !== expectedOrdinal ||
              !SHA_PATTERN.test(rowSha256) ||
              sha256(canonicalPayload) !== rowSha256
            ) {
              throw new Error(
                "Pro League breeding active ranking integrity drifted.",
              );
            }
            const payload = JSON.parse(canonicalPayload) as unknown;
            const ranking = record(payload, "ranking payload");
            if (
              ranking.rankingId !== rankingId ||
              !Array.isArray(ranking.candidates)
            ) {
              throw new Error(
                "Pro League breeding ranking payload shape drifted.",
              );
            }
            verifyRankingAuthority(
              ranking as unknown as BreedingPairRankingInput,
              authority,
            );
            candidateCount += ranking.candidates.length;
            byteCount += Buffer.byteLength(canonicalPayload, "utf8");
            hashLines.push(`${ordinal}:${rowSha256}\n`);
            return ranking as unknown as BreedingPairRankingInput;
          });
          if (
            candidateCount !== expectedCandidateCount ||
            byteCount !== expectedByteCount ||
            sha256(hashLines.join("")) !== expectedDigest
          ) {
            throw new Error(
              "Pro League breeding active generation digest drifted.",
            );
          }
          return {
            rankings,
            latestAcceptedPerformanceImportAt:
              authority.latestAcceptedPerformanceImportAt,
            latestAcceptedArenaImportAt: authority.latestAcceptedArenaImportAt,
          };
        },
      );
    },
  });
}

function configured(value: string | undefined): string | null {
  const result = value?.trim() ?? "";
  return result === "" ? null : result;
}

export function neonProLeagueBreedingRankingReadRepositoryFromEnvironment(
  environment: Readonly<{
    databaseUrl?: string;
    databaseOwnerId?: string;
    ownerId?: string;
    runtimeRole?: string;
  }>,
  sessionFactory?: NeonImportPersistenceSessionFactory,
): BreedingRankingRepository {
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
    return Object.freeze({ status: "not_configured" });
  }
  const repository = createNeonProLeagueBreedingRankingRepository({
    databaseUrl,
    databaseOwnerId,
    ownerId,
    runtimeRole,
    ...(sessionFactory === undefined ? {} : { sessionFactory }),
  });
  return Object.freeze({
    status: "ready",
    loadRankingEvidenceByOwner: repository.loadRankingEvidenceByOwner,
  });
}
