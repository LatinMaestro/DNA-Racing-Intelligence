import { createHash } from "node:crypto";

import { rankBreedingPairs } from "@/domain/breeding-pair-ranking";
import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceSessionFactory,
} from "@/lib/neon-import-persistence-driver";
import type { AcceptedProLeagueBreedingAnalysisSource } from "@/lib/pro-league-breeding-ranking-publication-runner";
import {
  acceptedProLeagueBreedingAnalysisCanonicalJson,
  acceptedProLeagueBreedingAnalysisSha256,
  type AcceptedProLeagueBreedingAnalysis,
  type AcceptedProLeagueBreedingAnalysisSnapshot,
} from "@/lib/pro-league-breeding-ranking-publication-service";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SAFE_ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/u;
const MAXIMUM_RANKINGS = 200;
const MAXIMUM_CANDIDATES = 2_000;
const MAXIMUM_CANONICAL_BYTES = 4_718_592;
const SET_OWNER_SCOPE_SQL =
  "SELECT set_config('app.owner_id', $1, true) AS owner_scope";
const VERIFY_ISOLATION_SQL = `
  SELECT owner.clerk_user_id AS authenticated_owner_id,
    class.relrowsecurity AS rls_enabled,
    class.relforcerowsecurity AS force_rls_enabled,
    has_table_privilege(session_user, class.oid,
      'SELECT,INSERT,UPDATE,DELETE') AS runtime_can_access_table,
    has_function_privilege(session_user,
      'dna.record_accepted_pro_league_breeding_analysis(uuid,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone,integer,integer,character,text)',
      'EXECUTE') AS runtime_can_record,
    has_function_privilege(session_user,
      'dna.read_accepted_pro_league_breeding_analysis(uuid,text)',
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
  CROSS JOIN pg_catalog.pg_class class
  JOIN pg_catalog.pg_roles role ON role.rolname = session_user
  WHERE owner.id = $1::uuid AND owner.clerk_user_id = $2
    AND class.oid = 'dna.accepted_pro_league_breeding_analysis'::regclass
`;
const RECORD_SQL = `SELECT * FROM dna.record_accepted_pro_league_breeding_analysis(
  $1::uuid,$2::text,$3::timestamptz,$4::timestamptz,$5::timestamptz,
  $6::timestamptz,$7::integer,$8::integer,$9::character(64),$10::text
)`;
const READ_SQL =
  "SELECT * FROM dna.read_accepted_pro_league_breeding_analysis($1::uuid,$2::text)";

type Row = Readonly<Record<string, unknown>>;
type QueryResult = Readonly<{ rows: readonly unknown[] }>;

export type NeonAcceptedProLeagueBreedingAnalysisRepository = Readonly<{
  status: "ready";
  recordAcceptedAnalysis: (
    ownerId: string,
    snapshot: AcceptedProLeagueBreedingAnalysisSnapshot,
  ) => Promise<"recorded" | "existing">;
  loadAcceptedAnalysisByOwner: Extract<
    AcceptedProLeagueBreedingAnalysisSource,
    { status: "ready" }
  >["loadAcceptedAnalysisByOwner"];
}>;

function row(value: unknown, label: string): Row {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Accepted Pro League breeding ${label} is invalid.`);
  }
  return value as Row;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Accepted Pro League breeding ${label} is invalid.`);
  }
  return value;
}

function identity(value: unknown, label: string): string {
  const result = text(value, label).trim();
  if (result.length > 256 || /[\u0000-\u001f\u007f]/u.test(result)) {
    throw new Error(`Accepted Pro League breeding ${label} is invalid.`);
  }
  return result;
}

function bool(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Accepted Pro League breeding ${label} is invalid.`);
  }
  return value;
}

function integer(value: unknown, label: string, maximum: number): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (
    typeof parsed !== "number" ||
    !Number.isSafeInteger(parsed) ||
    parsed <= 0 ||
    parsed > maximum
  ) {
    throw new Error(`Accepted Pro League breeding ${label} is invalid.`);
  }
  return parsed;
}

function byteCount(value: unknown): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (
    typeof parsed !== "number" ||
    !Number.isSafeInteger(parsed) ||
    parsed < 2 ||
    parsed > MAXIMUM_CANONICAL_BYTES
  ) {
    throw new Error(
      "Accepted Pro League breeding canonical byte count is invalid.",
    );
  }
  return parsed;
}

function timestamp(value: unknown, label: string): string {
  if (value instanceof Date) return value.toISOString();
  const normalized = text(value, label);
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== normalized) {
    throw new Error(`Accepted Pro League breeding ${label} is invalid.`);
  }
  return normalized;
}

function optionalTimestamp(value: unknown, label: string): string | null {
  return value === null ? null : timestamp(value, label);
}

function sha256(value: unknown, label: string): string {
  const result = text(value, label).trim();
  if (!SHA256_PATTERN.test(result)) {
    throw new Error(`Accepted Pro League breeding ${label} is invalid.`);
  }
  return result;
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function withoutDigest(
  snapshot: AcceptedProLeagueBreedingAnalysisSnapshot,
): AcceptedProLeagueBreedingAnalysis {
  return Object.fromEntries(
    Object.entries(snapshot).filter(([key]) => key !== "contentSha256"),
  ) as AcceptedProLeagueBreedingAnalysis;
}

function prepareSnapshot(snapshot: AcceptedProLeagueBreedingAnalysisSnapshot) {
  row(snapshot, "snapshot");
  const analysisId = identity(snapshot.analysisId, "analysis ID");
  if (
    snapshot.acceptanceStatus !== "accepted" ||
    snapshot.completionStatus !== "complete" ||
    snapshot.proLeagueRaceTypeEvidence !== "unavailable"
  ) {
    throw new Error(
      "Accepted Pro League breeding snapshot authority is invalid.",
    );
  }
  const acceptedAt = timestamp(snapshot.acceptedAt, "acceptance time");
  const rosterEvidenceCutoffAt = timestamp(
    snapshot.rosterEvidenceCutoffAt,
    "roster evidence cutoff",
  );
  const latestAcceptedPerformanceImportAt = timestamp(
    snapshot.latestAcceptedPerformanceImportAt,
    "performance import",
  );
  const latestAcceptedArenaImportAt = optionalTimestamp(
    snapshot.latestAcceptedArenaImportAt,
    "Arena import",
  );
  if (
    [
      rosterEvidenceCutoffAt,
      latestAcceptedPerformanceImportAt,
      latestAcceptedArenaImportAt,
    ].some(
      (value) => value !== null && Date.parse(value) > Date.parse(acceptedAt),
    )
  ) {
    throw new Error(
      "Accepted Pro League breeding snapshot authority is chronologically invalid.",
    );
  }
  const expectedRankingCount = integer(
    snapshot.expectedRankingCount,
    "ranking count",
    MAXIMUM_RANKINGS,
  );
  const expectedCandidateCount = integer(
    snapshot.expectedCandidateCount,
    "candidate count",
    MAXIMUM_CANDIDATES,
  );
  if (
    !Array.isArray(snapshot.rankings) ||
    snapshot.rankings.length !== expectedRankingCount
  ) {
    throw new Error(
      "Accepted Pro League breeding ranking coverage is incomplete.",
    );
  }
  const rankingIds = new Set<string>();
  const rankingLabels = new Set<string>();
  let candidateCount = 0;
  for (const ranking of snapshot.rankings) {
    const validated = rankBreedingPairs(ranking);
    if (
      rankingIds.has(validated.rankingId) ||
      rankingLabels.has(validated.rankingLabel)
    ) {
      throw new Error(
        "Accepted Pro League breeding ranking identity is duplicated.",
      );
    }
    rankingIds.add(validated.rankingId);
    rankingLabels.add(validated.rankingLabel);
    candidateCount += ranking.candidates.length;
    if (
      ranking.lastImported !== latestAcceptedPerformanceImportAt ||
      ranking.arenaLastImported !== latestAcceptedArenaImportAt ||
      Date.parse(ranking.evaluatedAt) > Date.parse(acceptedAt) ||
      (ranking.dataCurrentThrough !== null &&
        Date.parse(ranking.dataCurrentThrough) >
          Date.parse(rosterEvidenceCutoffAt))
    ) {
      throw new Error(
        "Accepted Pro League breeding ranking authority is invalid.",
      );
    }
  }
  if (candidateCount !== expectedCandidateCount) {
    throw new Error(
      "Accepted Pro League breeding candidate coverage is incomplete.",
    );
  }
  const analysis = withoutDigest(snapshot);
  const canonicalPayload =
    acceptedProLeagueBreedingAnalysisCanonicalJson(analysis);
  const canonicalByteCount = Buffer.byteLength(canonicalPayload, "utf8");
  if (canonicalByteCount < 2 || canonicalByteCount > MAXIMUM_CANONICAL_BYTES) {
    throw new Error(
      "Accepted Pro League breeding canonical payload exceeds its bound.",
    );
  }
  const contentSha256 = sha256(snapshot.contentSha256, "content digest");
  if (
    contentSha256 !== acceptedProLeagueBreedingAnalysisSha256(analysis) ||
    contentSha256 !== hash(canonicalPayload)
  ) {
    throw new Error(
      "Accepted Pro League breeding snapshot digest does not match.",
    );
  }
  return Object.freeze({
    snapshot,
    analysisId,
    acceptedAt,
    rosterEvidenceCutoffAt,
    latestAcceptedPerformanceImportAt,
    latestAcceptedArenaImportAt,
    expectedRankingCount,
    expectedCandidateCount,
    canonicalPayload,
    canonicalByteCount,
    contentSha256,
  });
}

function verifyIsolation(
  value: unknown,
  ownerId: string,
  runtimeRole: string,
): void {
  const result = row(value, "isolation receipt");
  if (
    text(result.authenticated_owner_id, "authenticated owner") !== ownerId ||
    !bool(result.rls_enabled, "RLS state") ||
    !bool(result.force_rls_enabled, "forced RLS state") ||
    bool(result.runtime_can_access_table, "direct table privilege") ||
    !bool(result.runtime_can_record, "record privilege") ||
    !bool(result.runtime_can_read, "read privilege") ||
    text(result.session_user_name, "session role") !== runtimeRole ||
    text(result.current_user_name, "current role") !== runtimeRole ||
    bool(result.runtime_is_superuser, "superuser state") ||
    bool(result.runtime_bypasses_rls, "RLS bypass state") ||
    bool(result.runtime_can_create_roles, "role creation state") ||
    bool(result.runtime_can_create_databases, "database creation state") ||
    bool(result.runtime_is_neon_superuser_member, "Neon role membership")
  ) {
    throw new Error(
      "Accepted Pro League breeding runtime owner isolation failed.",
    );
  }
}

function configuration(input: {
  databaseUrl: string;
  databaseOwnerId: string;
  ownerId: string;
  runtimeRole: string;
}) {
  const result = {
    databaseUrl: input.databaseUrl.trim(),
    databaseOwnerId: input.databaseOwnerId.trim(),
    ownerId: input.ownerId.trim(),
    runtimeRole: input.runtimeRole.trim(),
  };
  if (
    result.databaseUrl === "" ||
    !UUID_PATTERN.test(result.databaseOwnerId) ||
    result.ownerId === "" ||
    !SAFE_ROLE_PATTERN.test(result.runtimeRole)
  ) {
    throw new Error(
      "Accepted Pro League breeding repository configuration is invalid.",
    );
  }
  return result;
}

export function createNeonAcceptedProLeagueBreedingAnalysisRepository(
  input: Readonly<{
    databaseUrl: string;
    databaseOwnerId: string;
    ownerId: string;
    runtimeRole: string;
    sessionFactory?: NeonImportPersistenceSessionFactory;
  }>,
): NeonAcceptedProLeagueBreedingAnalysisRepository {
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
      throw new Error("Accepted Pro League breeding owner scope denied.");
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
        throw new Error("Accepted Pro League breeding owner scope denied.");
      }
      verifyIsolation(verified.rows[0], ownerId, config.runtimeRole);
      const result = await operation(session.client);
      await session.client.query("COMMIT");
      started = false;
      return result;
    } catch (error) {
      if (started) {
        await session.client.query("ROLLBACK").catch(() => undefined);
      }
      throw error;
    } finally {
      await session.close();
    }
  }

  return Object.freeze({
    status: "ready",
    async recordAcceptedAnalysis(ownerId, snapshot) {
      const prepared = prepareSnapshot(snapshot);
      return transaction(ownerId, "SERIALIZABLE", async (client) => {
        const result = await client.query(RECORD_SQL, [
          config.databaseOwnerId,
          prepared.analysisId,
          prepared.acceptedAt,
          prepared.rosterEvidenceCutoffAt,
          prepared.latestAcceptedPerformanceImportAt,
          prepared.latestAcceptedArenaImportAt,
          prepared.expectedRankingCount,
          prepared.expectedCandidateCount,
          prepared.contentSha256,
          prepared.canonicalPayload,
        ]);
        if (result.rows.length !== 1) {
          throw new Error(
            "Accepted Pro League breeding record must return one receipt.",
          );
        }
        const receipt = row(result.rows[0], "record receipt");
        const disposition = text(receipt.disposition, "record disposition");
        if (
          !["recorded", "existing"].includes(disposition) ||
          identity(receipt.analysis_id, "stored analysis ID") !==
            prepared.analysisId ||
          integer(
            receipt.ranking_count,
            "stored ranking count",
            MAXIMUM_RANKINGS,
          ) !== prepared.expectedRankingCount ||
          integer(
            receipt.candidate_count,
            "stored candidate count",
            MAXIMUM_CANDIDATES,
          ) !== prepared.expectedCandidateCount ||
          byteCount(receipt.canonical_byte_count) !==
            prepared.canonicalByteCount ||
          sha256(receipt.content_sha256, "stored content digest") !==
            prepared.contentSha256
        ) {
          throw new Error(
            "Accepted Pro League breeding record receipt is invalid.",
          );
        }
        return disposition as "recorded" | "existing";
      });
    },
    async loadAcceptedAnalysisByOwner(ownerId, requestedAnalysisId) {
      const analysisId = identity(requestedAnalysisId, "analysis ID");
      return transaction(
        ownerId,
        "REPEATABLE READ READ ONLY",
        async (client) => {
          const result = await client.query(READ_SQL, [
            config.databaseOwnerId,
            analysisId,
          ]);
          if (result.rows.length === 0) {
            return Object.freeze({ status: "not_found" as const });
          }
          if (result.rows.length !== 1) {
            throw new Error(
              "Accepted Pro League breeding read returned multiple snapshots.",
            );
          }
          const stored = row(result.rows[0], "stored snapshot");
          const storedAnalysisId = identity(
            stored.analysis_id,
            "stored analysis ID",
          );
          const storedDigest = sha256(
            stored.content_sha256,
            "stored content digest",
          );
          const canonicalPayload = text(
            stored.canonical_payload,
            "canonical payload",
          );
          if (
            storedAnalysisId !== analysisId ||
            byteCount(stored.canonical_byte_count) !==
              Buffer.byteLength(canonicalPayload, "utf8") ||
            hash(canonicalPayload) !== storedDigest
          ) {
            throw new Error(
              "Accepted Pro League breeding stored snapshot digest drifted.",
            );
          }
          let analysis: AcceptedProLeagueBreedingAnalysis;
          try {
            analysis = JSON.parse(
              canonicalPayload,
            ) as AcceptedProLeagueBreedingAnalysis;
          } catch {
            throw new Error(
              "Accepted Pro League breeding stored snapshot is invalid JSON.",
            );
          }
          const snapshot = Object.freeze({
            ...analysis,
            contentSha256: storedDigest,
          });
          const prepared = prepareSnapshot(snapshot);
          if (
            prepared.analysisId !== storedAnalysisId ||
            prepared.acceptedAt !==
              timestamp(stored.accepted_at, "stored acceptance time") ||
            prepared.rosterEvidenceCutoffAt !==
              timestamp(
                stored.roster_evidence_cutoff_at,
                "stored roster cutoff",
              ) ||
            prepared.latestAcceptedPerformanceImportAt !==
              timestamp(
                stored.latest_performance_import_at,
                "stored performance import",
              ) ||
            prepared.latestAcceptedArenaImportAt !==
              optionalTimestamp(
                stored.latest_arena_import_at,
                "stored Arena import",
              ) ||
            prepared.expectedRankingCount !==
              integer(
                stored.ranking_count,
                "stored ranking count",
                MAXIMUM_RANKINGS,
              ) ||
            prepared.expectedCandidateCount !==
              integer(
                stored.candidate_count,
                "stored candidate count",
                MAXIMUM_CANDIDATES,
              )
          ) {
            throw new Error(
              "Accepted Pro League breeding stored authority drifted.",
            );
          }
          return Object.freeze({ status: "ready" as const, snapshot });
        },
      );
    },
  });
}

function configured(value: string | undefined): string | null {
  const result = value?.trim() ?? "";
  return result === "" ? null : result;
}

export function neonAcceptedProLeagueBreedingAnalysisSourceFromEnvironment(
  environment: Readonly<{
    databaseUrl?: string;
    databaseOwnerId?: string;
    ownerId?: string;
    runtimeRole?: string;
  }>,
  sessionFactory?: NeonImportPersistenceSessionFactory,
): AcceptedProLeagueBreedingAnalysisSource {
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
  const repository = createNeonAcceptedProLeagueBreedingAnalysisRepository({
    databaseUrl,
    databaseOwnerId,
    ownerId,
    runtimeRole,
    ...(sessionFactory === undefined ? {} : { sessionFactory }),
  });
  return Object.freeze({
    status: "ready",
    loadAcceptedAnalysisByOwner: repository.loadAcceptedAnalysisByOwner,
  });
}
