import type {
  ManualTournamentPayoutAssetRegistry,
  ManualTournamentPayoutPersistenceResult,
  ManualTournamentPayoutWriteRepository,
  StoredManualTournamentPayout,
  TournamentPayoutCandidateSet,
} from "@/lib/manual-tournament-payout-write-service";
import type { TournamentPayoutCampaignBinding } from "@/domain/manual-tournament-payout";
import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceClient,
  type NeonImportPersistenceSessionFactory,
} from "@/lib/neon-import-persistence-driver";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ROLE = /^[a-z_][a-z0-9_]{0,62}$/;
const HASH = /^[a-f0-9]{64}$/;

const VERIFY_SQL = `
  SELECT owner.id::text AS database_owner_id,
    owner.clerk_user_id AS authenticated_owner_id,
    payout.relrowsecurity AS payout_rls,
    payout.relforcerowsecurity AS payout_force_rls,
    session_user::text AS session_user_name,
    current_user::text AS current_user_name,
    role.rolsuper AS runtime_is_superuser,
    role.rolbypassrls AS runtime_bypasses_rls,
    role.rolcreaterole AS runtime_can_create_roles,
    role.rolcreatedb AS runtime_can_create_databases,
    COALESCE(pg_has_role(session_user,
      (SELECT oid FROM pg_catalog.pg_roles WHERE rolname='neon_superuser'),
      'MEMBER'), false) AS runtime_is_neon_superuser_member,
    has_table_privilege(session_user, payout.oid,
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      AS runtime_has_direct_payout_access
  FROM dna.app_owner owner
  JOIN pg_catalog.pg_class payout
    ON payout.oid='dna.manual_tournament_payout_state'::regclass
  JOIN pg_catalog.pg_roles role ON role.rolname=session_user
  WHERE owner.id=$1::uuid AND owner.clerk_user_id=$2::text
`;
const CONTEXT_SQL = `
  SELECT asset_registry_version, assets_json, ledger_version
  FROM dna.read_manual_tournament_payout_write_context($1::uuid)
`;
const CAMPAIGN_SQL = `
  SELECT tournament_id, evidence_id, configuration_version,
    owner_acknowledged_at
  FROM dna.read_manual_economic_tournament_binding($1::uuid,$2::text)
`;
const CANDIDATES_SQL = `
  SELECT active_import_snapshot_hash, candidate_set_hash, candidates_json
  FROM dna.read_manual_tournament_payout_candidates(
    $1::uuid,$2::text,$3::timestamptz,$4::text,$5::text,$6::integer
  )
`;
const SAVE_PAYOUT_SQL = `
  SELECT disposition, fingerprint, ledger_version, reconciliation_revision,
    candidate_set_json
  FROM dna.write_manual_tournament_payout(
    $1::uuid,$2::text,$3::character(64),$4::text,$5::text,$6::text,
    $7::text,$8::text
  )
`;
const READ_PAYOUT_SQL = `
  SELECT payout_json, state_fingerprint, reconciliation_json,
    reconciliation_evidence_json, reconciliation_revision, ledger_version,
    last_operation_fingerprint
  FROM dna.read_manual_tournament_payout($1::uuid,$2::text)
`;
const SAVE_DECISION_SQL = `
  SELECT disposition, fingerprint, ledger_version, reconciliation_revision,
    candidate_set_json
  FROM dna.write_manual_tournament_payout_reconciliation(
    $1::uuid,$2::text,$3::bigint,$4::character(64),$5::text,$6::text,$7::text,
    false
  )
`;
const REOPEN_SQL = `
  SELECT disposition, fingerprint, ledger_version, reconciliation_revision,
    candidate_set_json
  FROM dna.write_manual_tournament_payout_reconciliation(
    $1::uuid,$2::text,$3::bigint,$4::character(64),$5::text,$6::text,$7::text,
    true
  )
`;

type Environment = Readonly<{
  databaseUrl: string | undefined;
  databaseOwnerId: string | undefined;
  runtimeRole: string | undefined;
}>;

export type ManualTournamentPayoutWriteContext = Readonly<{
  assetRegistry: Extract<
    ManualTournamentPayoutAssetRegistry,
    { status: "ready" }
  >;
  ledgerVersion: string;
}>;

export type NeonManualTournamentPayoutPersistence =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      repository: Extract<
        ManualTournamentPayoutWriteRepository,
        { status: "ready" }
      >;
      loadContextByOwner: (
        ownerId: string,
      ) => Promise<ManualTournamentPayoutWriteContext>;
    }>;

function fail(): never {
  throw new Error("Manual tournament payout persistence unavailable.");
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return fail();
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") return fail();
  return value;
}

function nullableText(value: unknown): string | null {
  if (value === null) return null;
  return text(value);
}

function timestamp(value: unknown): string {
  const parsed = new Date(text(value));
  if (Number.isNaN(parsed.getTime())) return fail();
  return parsed.toISOString();
}

function integer(value: unknown): number {
  const parsed =
    typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || (parsed as number) < 0) return fail();
  return parsed as number;
}

function json<T>(value: unknown): T {
  if (typeof value !== "string") return fail();
  try {
    return JSON.parse(value) as T;
  } catch {
    return fail();
  }
}

function normalized(value: string | undefined): string | null {
  const result = value?.trim() ?? "";
  return result === "" ? null : result;
}

function verify(
  rowValue: unknown,
  input: Readonly<{
    databaseOwnerId: string;
    authenticatedOwnerId: string;
    runtimeRole: string;
  }>,
): void {
  const row = object(rowValue);
  if (
    row.database_owner_id !== input.databaseOwnerId ||
    row.authenticated_owner_id !== input.authenticatedOwnerId ||
    row.session_user_name !== input.runtimeRole ||
    row.current_user_name !== input.runtimeRole ||
    row.payout_rls !== true ||
    row.payout_force_rls !== true ||
    [
      "runtime_is_superuser",
      "runtime_bypasses_rls",
      "runtime_can_create_roles",
      "runtime_can_create_databases",
      "runtime_is_neon_superuser_member",
      "runtime_has_direct_payout_access",
    ].some((field) => row[field] !== false)
  )
    fail();
}

function persistenceResult(
  rowValue: unknown,
): ManualTournamentPayoutPersistenceResult {
  const row = object(rowValue);
  const status = text(row.disposition);
  const ledgerVersion = text(row.ledger_version);
  const reconciliationRevision = integer(row.reconciliation_revision);
  if (status === "created") {
    return { status, ledgerVersion, reconciliationRevision };
  }
  if (["already_exists", "conflict"].includes(status)) {
    const fingerprint = text(row.fingerprint);
    if (!HASH.test(fingerprint)) return fail();
    return {
      status: status as "already_exists" | "conflict",
      fingerprint,
      ledgerVersion,
      reconciliationRevision,
    };
  }
  if (
    status === "version_conflict" ||
    status === "revision_conflict" ||
    status === "evidence_conflict"
  ) {
    return {
      status,
      ledgerVersion,
      reconciliationRevision,
    } as ManualTournamentPayoutPersistenceResult;
  }
  if (status === "review_reopened") {
    return {
      status,
      ledgerVersion,
      reconciliationRevision,
      candidateSet: json<TournamentPayoutCandidateSet>(row.candidate_set_json),
    };
  }
  return fail();
}

function validateConfiguration(input: {
  databaseUrl: string;
  databaseOwnerId: string;
  runtimeRole: string;
}): void {
  if (
    !input.databaseUrl.trim() ||
    !UUID.test(input.databaseOwnerId) ||
    !ROLE.test(input.runtimeRole)
  )
    fail();
}

export function createNeonManualTournamentPayoutPersistence(input: {
  databaseUrl: string;
  databaseOwnerId: string;
  runtimeRole: string;
  sessionFactory?: NeonImportPersistenceSessionFactory;
}): Extract<NeonManualTournamentPayoutPersistence, { status: "ready" }> {
  validateConfiguration(input);
  const factory =
    input.sessionFactory ?? createDefaultNeonImportPersistenceSession;
  const configuration = Object.freeze({
    databaseUrl: input.databaseUrl,
    databaseOwnerId: input.databaseOwnerId,
    runtimeRole: input.runtimeRole,
  });

  async function transaction<T>(
    ownerId: string,
    operation: (client: NeonImportPersistenceClient) => Promise<T>,
  ): Promise<T> {
    if (!ownerId.trim()) return fail();
    const session = await factory(configuration.databaseUrl).catch(() =>
      fail(),
    );
    let started = false;
    try {
      await session.client.query(
        "BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE",
      );
      started = true;
      await session.client.query(
        "SELECT set_config('statement_timeout','10000',true), set_config('lock_timeout','1000',true)",
      );
      const scope = await session.client.query(
        "SELECT set_config('app.owner_id',$1,true) AS owner_scope",
        [configuration.databaseOwnerId],
      );
      if (
        scope.rows.length !== 1 ||
        object(scope.rows[0]).owner_scope !== configuration.databaseOwnerId
      )
        fail();
      const evidence = await session.client.query(VERIFY_SQL, [
        configuration.databaseOwnerId,
        ownerId,
      ]);
      if (evidence.rows.length !== 1) fail();
      verify(evidence.rows[0], {
        databaseOwnerId: configuration.databaseOwnerId,
        authenticatedOwnerId: ownerId,
        runtimeRole: configuration.runtimeRole,
      });
      const result = await operation(session.client);
      await session.client.query("COMMIT");
      started = false;
      return result;
    } catch {
      if (started)
        await session.client.query("ROLLBACK").catch(() => undefined);
      return fail();
    } finally {
      await session.close().catch(() => fail());
    }
  }

  const repository: Extract<
    ManualTournamentPayoutWriteRepository,
    { status: "ready" }
  > = {
    status: "ready",
    async loadTournamentCampaignBindingByOwner(ownerId, tournamentId) {
      return transaction(ownerId, async (client) => {
        const result = await client.query(CAMPAIGN_SQL, [
          configuration.databaseOwnerId,
          tournamentId,
        ]);
        if (result.rows.length > 1) return fail();
        if (result.rows.length === 0) return null;
        const row = object(result.rows[0]);
        return Object.freeze({
          tournamentId: text(row.tournament_id),
          evidenceId: text(row.evidence_id),
          configurationVersion: text(row.configuration_version),
          ownerAcknowledgedAt: timestamp(row.owner_acknowledged_at),
        } satisfies TournamentPayoutCampaignBinding);
      });
    },
    async loadImportedCandidateSetByOwner(ownerId, query) {
      return transaction(ownerId, async (client) => {
        const result = await client.query(CANDIDATES_SQL, [
          configuration.databaseOwnerId,
          query.tournamentId,
          query.occurredAt,
          query.assetCode,
          query.amount,
          query.maximumCandidates,
        ]);
        if (result.rows.length !== 1) return fail();
        const row = object(result.rows[0]);
        const activeImportSnapshotHash = text(row.active_import_snapshot_hash);
        const candidateSetHash = text(row.candidate_set_hash);
        if (
          !HASH.test(activeImportSnapshotHash) ||
          !HASH.test(candidateSetHash)
        )
          return fail();
        const candidates = json<unknown[]>(row.candidates_json);
        if (
          !Array.isArray(candidates) ||
          candidates.length > query.maximumCandidates
        )
          return fail();
        return Object.freeze({
          activeImportSnapshotHash,
          candidateSetHash,
          candidates: Object.freeze(candidates),
        }) as TournamentPayoutCandidateSet;
      });
    },
    async savePayoutByOwner(
      ownerId,
      payout,
      reconciliation,
      evidence,
      fingerprint,
      expectedLedgerVersion,
    ) {
      return transaction(ownerId, async (client) => {
        const result = await client.query(SAVE_PAYOUT_SQL, [
          configuration.databaseOwnerId,
          payout.payoutId,
          fingerprint,
          JSON.stringify(payout),
          JSON.stringify(reconciliation),
          JSON.stringify(evidence),
          expectedLedgerVersion,
          fingerprint,
        ]);
        if (result.rows.length !== 1) return fail();
        return persistenceResult(result.rows[0]);
      });
    },
    async loadPayoutByOwner(ownerId, payoutId) {
      return transaction(ownerId, async (client) => {
        const result = await client.query(READ_PAYOUT_SQL, [
          configuration.databaseOwnerId,
          payoutId,
        ]);
        if (result.rows.length > 1) return fail();
        if (result.rows.length === 0) return null;
        const row = object(result.rows[0]);
        const stateFingerprint = text(row.state_fingerprint);
        const lastOperationFingerprint = nullableText(
          row.last_operation_fingerprint,
        );
        if (
          !HASH.test(stateFingerprint) ||
          (lastOperationFingerprint !== null &&
            !HASH.test(lastOperationFingerprint))
        )
          return fail();
        return Object.freeze({
          payout: json(row.payout_json),
          stateFingerprint,
          reconciliation: json(row.reconciliation_json),
          reconciliationEvidence: json(row.reconciliation_evidence_json),
          revision: integer(row.reconciliation_revision),
          ledgerVersion: text(row.ledger_version),
          lastOperationFingerprint,
        }) as StoredManualTournamentPayout;
      });
    },
    async saveReconciliationDecisionByOwner(ownerId, decision, fingerprint) {
      return transaction(ownerId, async (client) => {
        const result = await client.query(SAVE_DECISION_SQL, [
          configuration.databaseOwnerId,
          decision.payoutId,
          decision.expectedRevision,
          fingerprint,
          JSON.stringify(decision.decision),
          JSON.stringify(decision.reconciliation),
          JSON.stringify(decision.reconciliationEvidence),
        ]);
        if (result.rows.length !== 1) return fail();
        return persistenceResult(result.rows[0]);
      });
    },
    async reopenReconciliationReviewByOwner(ownerId, review, fingerprint) {
      return transaction(ownerId, async (client) => {
        const result = await client.query(REOPEN_SQL, [
          configuration.databaseOwnerId,
          review.payoutId,
          review.expectedRevision,
          fingerprint,
          JSON.stringify({ kind: review.reason }),
          JSON.stringify(review.reconciliation),
          JSON.stringify(review.reconciliationEvidence),
        ]);
        if (result.rows.length !== 1) return fail();
        return persistenceResult(result.rows[0]);
      });
    },
  };

  return {
    status: "ready",
    repository,
    async loadContextByOwner(ownerId) {
      return transaction(ownerId, async (client) => {
        const result = await client.query(CONTEXT_SQL, [
          configuration.databaseOwnerId,
        ]);
        if (result.rows.length !== 1) return fail();
        const row = object(result.rows[0]);
        const version = text(row.asset_registry_version);
        if (!HASH.test(version)) return fail();
        const assets = json<unknown[]>(row.assets_json);
        if (!Array.isArray(assets) || assets.length === 0) return fail();
        return Object.freeze({
          assetRegistry: Object.freeze({
            status: "ready" as const,
            version,
            assets: Object.freeze(
              assets.map((value) => {
                const asset = object(value);
                const kind = text(asset.kind);
                if (!["crypto", "fiat", "game_credit"].includes(kind))
                  return fail();
                return Object.freeze({
                  code: text(asset.code),
                  kind: kind as "crypto" | "fiat" | "game_credit",
                  precision: integer(asset.precision),
                });
              }),
            ),
          }),
          ledgerVersion: text(row.ledger_version),
        });
      });
    },
  };
}

export function neonManualTournamentPayoutPersistenceFromEnvironment(
  environment: Environment,
  sessionFactory?: NeonImportPersistenceSessionFactory,
): NeonManualTournamentPayoutPersistence {
  const databaseUrl = normalized(environment.databaseUrl);
  const databaseOwnerId = normalized(environment.databaseOwnerId);
  const runtimeRole = normalized(environment.runtimeRole);
  if (databaseUrl === null || databaseOwnerId === null || runtimeRole === null)
    return Object.freeze({ status: "not_configured" });
  return createNeonManualTournamentPayoutPersistence({
    databaseUrl,
    databaseOwnerId,
    runtimeRole,
    ...(sessionFactory ? { sessionFactory } : {}),
  });
}
