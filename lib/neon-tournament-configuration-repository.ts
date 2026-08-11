import type { TournamentCandidateRankingInput } from "@/domain/tournament-candidate-ranking";
import type { TournamentRuleConfiguration } from "@/domain/tournament-configuration";
import type { TournamentCandidateRepository } from "@/lib/tournament-workspace-service";
import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceSessionFactory,
} from "@/lib/neon-import-persistence-driver";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_RUNTIME_ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;

const SET_OWNER_SCOPE_SQL = `SELECT set_config('app.owner_id', $1, true) AS owner_scope`;
const VERIFY_OWNER_SQL = `
  SELECT owner.clerk_user_id AS authenticated_owner_id,
    tournament_table.relrowsecurity AS tournament_row_security_enabled,
    tournament_table.relforcerowsecurity AS tournament_force_row_security_enabled,
    vault_table.relrowsecurity AS vault_row_security_enabled,
    vault_table.relforcerowsecurity AS vault_force_row_security_enabled,
    session_user::text AS session_user_name,
    current_user::text AS current_user_name,
    role.rolsuper AS runtime_is_superuser,
    role.rolbypassrls AS runtime_bypasses_rls
  FROM dna.app_owner owner
  JOIN pg_catalog.pg_class tournament_table
    ON tournament_table.oid = 'dna.tournament_configuration'::regclass
  JOIN pg_catalog.pg_class vault_table
    ON vault_table.oid = 'dna.owner_vault_core'::regclass
  JOIN pg_catalog.pg_roles role ON role.rolname = session_user
  WHERE owner.id = $1::uuid AND owner.clerk_user_id = $2
`;
const LIST_CONFIGURATIONS_SQL = `SELECT * FROM dna.list_complete_tournament_configurations($1::uuid)`;
const LIST_ACTIVE_VAULT_CORES_SQL = `
  SELECT core.source_core_id, vault.me_eligible
  FROM dna.owner_vault_core vault
  JOIN dna.core core
    ON core.owner_id = vault.owner_id
    AND core.id = vault.core_id
  WHERE vault.owner_id = $1::uuid
    AND vault.in_my_vault
  ORDER BY core.source_core_id
`;

type Environment = Readonly<{
  databaseUrl: string | undefined;
  databaseOwnerId: string | undefined;
  runtimeRole: string | undefined;
}>;

type QueryResult = Readonly<{ rows: readonly unknown[] }>;

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Tournament configuration row is invalid.");
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} is invalid.`);
  }
  return value.trim();
}

function bool(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} is invalid.`);
  return value;
}

function normalized(value: string | undefined): string | null {
  const result = value?.trim() ?? "";
  return result === "" ? null : result;
}

function verifyOwner(
  result: QueryResult,
  authenticatedOwnerId: string,
  runtimeRole: string,
): void {
  if (result.rows.length !== 1) {
    throw new Error("Tournament configuration owner scope denied.");
  }
  const row = record(result.rows[0]);
  if (
    text(row.authenticated_owner_id, "authenticated owner") !==
      authenticatedOwnerId ||
    !bool(row.tournament_row_security_enabled, "Tournament RLS") ||
    !bool(row.tournament_force_row_security_enabled, "Tournament forced RLS") ||
    !bool(row.vault_row_security_enabled, "Vault RLS") ||
    !bool(row.vault_force_row_security_enabled, "Vault forced RLS") ||
    text(row.session_user_name, "session user") !== runtimeRole ||
    text(row.current_user_name, "current user") !== runtimeRole ||
    bool(row.runtime_is_superuser, "runtime superuser") ||
    bool(row.runtime_bypasses_rls, "runtime bypass RLS")
  ) {
    throw new Error(
      "Tournament configuration repository requires least-privilege owner isolation.",
    );
  }
}

function distances(value: unknown): readonly number[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Tournament eligible distances are invalid.");
  }
  const parsed = value.map((item) =>
    typeof item === "string" && /^\d+$/.test(item) ? Number(item) : item,
  );
  if (
    parsed.some((item) => !Number.isSafeInteger(item) || (item as number) <= 0)
  ) {
    throw new Error("Tournament eligible distances are invalid.");
  }
  return parsed as number[];
}

function optionalText(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new Error(`${label} is invalid.`);
  return value.trim();
}

function integer(value: unknown, label: string): number {
  const parsed =
    typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label} is invalid.`);
  return parsed as number;
}

function optionalInteger(value: unknown, label: string): number | null {
  return value === null ? null : integer(value, label);
}

function decimal(value: unknown, label: string): string {
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    String(value).trim() === ""
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return String(value);
}

function timestamp(value: unknown, label: string): string {
  const parsed = value instanceof Date ? value : new Date(text(value, label));
  if (Number.isNaN(parsed.getTime())) throw new Error(`${label} is invalid.`);
  return parsed.toISOString();
}

function optionalTimestamp(value: unknown, label: string): string | null {
  return value === null ? null : timestamp(value, label);
}

function jsonValue(value: unknown, label: string): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${label} is invalid.`);
  }
}

function jsonArray(value: unknown, label: string): readonly unknown[] {
  const parsed = jsonValue(value, label);
  if (!Array.isArray(parsed)) throw new Error(`${label} is invalid.`);
  return parsed;
}

function jsonRecord(value: unknown, label: string): Record<string, unknown> {
  const parsed = jsonValue(value, label);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${label} is invalid.`);
  }
  return parsed as Record<string, unknown>;
}

function stringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value)) throw new Error(`${label} is invalid.`);
  return value.map((item) => text(item, label));
}

function integerArray(value: unknown, label: string): readonly number[] {
  if (!Array.isArray(value)) throw new Error(`${label} is invalid.`);
  return value.map((item) => integer(item, label));
}

export function createNeonTournamentConfigurationRepository(
  input: Readonly<{
    databaseUrl: string;
    databaseOwnerId: string;
    runtimeRole: string;
    sessionFactory?: NeonImportPersistenceSessionFactory;
  }>,
): TournamentCandidateRepository {
  const databaseUrl = text(input.databaseUrl, "databaseUrl");
  const databaseOwnerId = text(input.databaseOwnerId, "databaseOwnerId");
  const runtimeRole = text(input.runtimeRole, "runtimeRole");
  if (!UUID_PATTERN.test(databaseOwnerId)) {
    throw new Error("databaseOwnerId must be a UUID.");
  }
  if (!SAFE_RUNTIME_ROLE_PATTERN.test(runtimeRole)) {
    throw new Error("runtimeRole is invalid.");
  }
  const sessionFactory =
    input.sessionFactory ?? createDefaultNeonImportPersistenceSession;

  return {
    status: "ready",
    async listCandidateEvidenceByOwner(ownerId) {
      const authenticatedOwnerId = text(ownerId, "ownerId");
      const session = await sessionFactory(databaseUrl);
      try {
        await session.client.query("BEGIN READ ONLY");
        await session.client.query(SET_OWNER_SCOPE_SQL, [databaseOwnerId]);
        verifyOwner(
          await session.client.query(VERIFY_OWNER_SQL, [
            databaseOwnerId,
            authenticatedOwnerId,
          ]),
          authenticatedOwnerId,
          runtimeRole,
        );
        const result = await session.client.query(LIST_CONFIGURATIONS_SQL, [
          databaseOwnerId,
        ]);
        const vaultResult = await session.client.query(
          LIST_ACTIVE_VAULT_CORES_SQL,
          [databaseOwnerId],
        );
        const activeVaultCores = vaultResult.rows.map((value) => {
          const row = record(value);
          const meEligible = row.me_eligible;
          if (typeof meEligible !== "boolean") {
            throw new Error("Tournament Vault ME eligibility is invalid.");
          }
          return {
            coreId: text(row.source_core_id, "Tournament Vault Core ID"),
            meEligible,
          };
        });
        const brackets: TournamentCandidateRankingInput[] = result.rows.map(
          (value) => {
            const row = record(value);
            const mode = text(row.mode, "Tournament mode");
            const relevance = text(
              row.discovery_relevance,
              "Tournament Discovery relevance",
            );
            const rankingMetric = text(
              row.ranking_metric,
              "Tournament ranking metric",
            );
            if (!["bike", "car", "horse"].includes(mode)) {
              throw new Error("Tournament mode is invalid.");
            }
            if (!["eligible", "priority"].includes(relevance)) {
              throw new Error("Tournament Discovery relevance is invalid.");
            }
            const configurationVersion = text(
              row.configuration_version,
              "Configuration version",
            );
            const candidateSnapshotVersion = text(
              row.candidate_snapshot_version,
              "Candidate snapshot version",
            );
            const qualificationCount = optionalInteger(
              row.qualification_count,
              "Tournament qualification count",
            );
            const qualificationPercentage =
              row.qualification_percentage === null
                ? null
                : decimal(
                    row.qualification_percentage,
                    "Tournament qualification percentage",
                  );
            if (
              (qualificationCount === null) ===
              (qualificationPercentage === null)
            ) {
              throw new Error("Tournament qualification target is invalid.");
            }
            const ruleConfiguration: TournamentRuleConfiguration = {
              tournamentId: text(row.tournament_id, "Tournament ID"),
              tournamentLabel: text(
                row.tournament_label,
                "Tournament label",
              ),
              seasonLabel: text(row.season_label, "Tournament season"),
              qualificationStartsAt: optionalTimestamp(
                row.qualification_starts_at,
                "Tournament qualification start",
              ),
              qualificationEndsAt: optionalTimestamp(
                row.qualification_ends_at,
                "Tournament qualification end",
              ),
              bracketId: text(row.bracket_id, "Bracket ID"),
              splitLabel: text(row.split_label, "Split label"),
              mode: mode as TournamentRuleConfiguration["mode"],
              eligibleDistancesMetres: distances(
                row.eligible_distances_metres,
              ),
              gateCount: integer(row.gate_count, "Tournament gate count"),
              entryFee: {
                amount: decimal(
                  row.entry_fee_amount,
                  "Tournament entry fee amount",
                ),
                asset: text(
                  row.entry_fee_asset,
                  "Tournament entry fee asset",
                ),
              },
              raceFormat: text(row.race_format, "Tournament race format"),
              eligibility: {
                breeds: stringArray(
                  row.eligible_breeds,
                  "Tournament eligible breeds",
                ),
                classes: stringArray(
                  row.eligible_classes,
                  "Tournament eligible classes",
                ),
                elements: stringArray(
                  row.eligible_elements,
                  "Tournament eligible elements",
                ),
                fNumbers: integerArray(
                  row.eligible_f_numbers,
                  "Tournament eligible F-numbers",
                ),
                fNumberRanges: jsonArray(
                  row.eligible_f_number_ranges,
                  "Tournament eligible F-number ranges",
                ) as TournamentRuleConfiguration["eligibility"]["fNumberRanges"],
                groups: jsonArray(
                  row.eligibility_groups,
                  "Tournament eligibility groups",
                ) as TournamentRuleConfiguration["eligibility"]["groups"],
              },
              leaderboard: {
                splitDimension: text(
                  row.leaderboard_split_dimension,
                  "Tournament leaderboard split dimension",
                ),
                groups: jsonArray(
                  row.leaderboard_groups,
                  "Tournament leaderboard groups",
                ) as TournamentRuleConfiguration["leaderboard"]["groups"],
                qualifyingRaceSemantics: text(
                  row.qualifying_race_semantics,
                  "Tournament qualifying-race semantics",
                ) as TournamentRuleConfiguration["leaderboard"]["qualifyingRaceSemantics"],
              },
              qualification: {
                minimumRaceCount: integer(
                  row.minimum_race_count,
                  "Tournament minimum race count",
                ),
                target:
                  qualificationCount === null
                    ? {
                        kind: "percentage",
                        value: qualificationPercentage!,
                      }
                    : { kind: "count", value: qualificationCount },
                rankingMetric:
                  rankingMetric as TournamentRuleConfiguration["qualification"]["rankingMetric"],
                topFinishPosition: optionalInteger(
                  row.top_finish_position,
                  "Tournament top finish position",
                ),
                pointsTable: jsonRecord(
                  row.points_table,
                  "Tournament points table",
                ) as TournamentRuleConfiguration["qualification"]["pointsTable"],
                customScoringConfiguration: jsonRecord(
                  row.custom_scoring_configuration,
                  "Tournament custom scoring configuration",
                ) as TournamentRuleConfiguration["qualification"]["customScoringConfiguration"],
              },
              discoveryRelevance:
                relevance as TournamentRuleConfiguration["discoveryRelevance"],
              evidence: {
                status: text(
                  row.rule_evidence_status,
                  "Tournament rule evidence status",
                ) as TournamentRuleConfiguration["evidence"]["status"],
                notes: optionalText(
                  row.rule_notes,
                  "Tournament rule notes",
                ) ?? "",
                sourceEvidence:
                  optionalText(
                    row.source_evidence,
                    "Tournament source evidence",
                  ) ?? "",
                provenance: jsonRecord(
                  row.provenance,
                  "Tournament provenance",
                ) as TournamentRuleConfiguration["evidence"]["provenance"],
              },
              campaignAction:
                row.campaign_action === null
                  ? null
                  : (jsonValue(
                      row.campaign_action,
                      "Tournament campaign action",
                    ) as TournamentRuleConfiguration["campaignAction"]),
              configurationVersion,
              candidateSnapshotVersion,
              updatedAt: timestamp(row.updated_at, "Tournament updated at"),
            };
            return {
              tournamentId: ruleConfiguration.tournamentId,
              tournamentLabel: ruleConfiguration.tournamentLabel,
              bracketId: ruleConfiguration.bracketId,
              splitLabel: ruleConfiguration.splitLabel,
              mode: ruleConfiguration.mode,
              eligibleDistancesMetres:
                ruleConfiguration.eligibleDistancesMetres,
              discoveryRelevance: ruleConfiguration.discoveryRelevance,
              qualificationMetricLabel:
                ruleConfiguration.qualification.rankingMetric,
              configurationVersion,
              candidateSnapshotVersion,
              ruleConfiguration,
              candidates: activeVaultCores.map((core) => ({
                coreId: core.coreId,
                leaderboardGroupId: "unassigned",
                leaderboardGroupLabel: "Eligibility review required",
                configurationVersion,
                candidateSnapshotVersion,
                eligibility: "review_required",
                metricStatus: "unavailable",
                metricRank: null,
                metricEvidenceLabel: null,
                timeEvidence: "unknown",
                historicalStarSupport: "unavailable",
                evidenceConfidence: "unknown",
                maidenState: core.meEligible ? "eligible" : "not_eligible",
                maidenModeDisposition: core.meEligible
                  ? "unresolved"
                  : "not_applicable",
                dataCurrentThrough: null,
                lastImported: null,
                freshness: "unknown",
              })),
            };
          },
        );
        await session.client.query("COMMIT");
        return { brackets, lastImportedAt: null };
      } catch (error) {
        await session.client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        await session.close();
      }
    },
  };
}

export function neonTournamentConfigurationRepositoryFromEnvironment(
  environment: Environment,
  sessionFactory?: NeonImportPersistenceSessionFactory,
): TournamentCandidateRepository {
  const databaseUrl = normalized(environment.databaseUrl);
  const databaseOwnerId = normalized(environment.databaseOwnerId);
  const runtimeRole = normalized(environment.runtimeRole);
  if (
    databaseUrl === null ||
    databaseOwnerId === null ||
    runtimeRole === null
  ) {
    return { status: "not_configured" };
  }
  return createNeonTournamentConfigurationRepository({
    databaseUrl,
    databaseOwnerId,
    runtimeRole,
    ...(sessionFactory ? { sessionFactory } : {}),
  });
}
