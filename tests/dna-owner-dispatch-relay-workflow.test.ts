import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const workflowPath = ".github/workflows/dna-owner-dispatch-relay.yml";

describe("DNA owner dispatch relay workflow", () => {
  it("is owner-only, Issue #120-only and restricts dispatch to accepted entrant commissioning boundaries", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("issue_comment:");
    expect(workflow).toContain("github.event.issue.number == 120");
    expect(workflow).toContain("github.actor == github.repository_owner");
    expect(workflow).toContain(
      "github.event.comment.author_association == 'OWNER'",
    );
    expect(workflow).toContain(
      "startsWith(github.event.comment.body, '/dna-dispatch ')",
    );
    expect(workflow).toContain("actions: write");
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain(
      "dna-population-race-index-private-preview-command.yml",
    );
    expect(workflow).toContain('"population-index-maintenance"');
    expect(workflow).toContain("dna-population-core-history-readiness.yml");
    expect(workflow).toContain('"population-core-history-readiness"');
    expect(workflow).toContain("execute_read_only_readiness: true");
    expect(workflow).toContain(
      "dna-population-core-history-first-cohort-command.yml",
    );
    expect(workflow).toContain('"population-core-history-first-cohort"');
    expect(workflow).toContain(
      "payload.execute_first_private_preview_population_core_history !== true",
    );
    expect(workflow).toContain(
      "dna-population-core-history-authority-preview-migration.yml",
    );
    expect(workflow).toContain('"population-core-history-authority-migration"');
    expect(workflow).toContain(
      "dna-open-lab-daily-refresh-provider-preflight.yml",
    );
    expect(workflow).toContain('"provider-capacity-preflight"');
    expect(workflow).toContain("dna-open-lab-r2-budget-ledger-diagnostic.yml");
    expect(workflow).toContain('"r2-budget-ledger-diagnostic"');
    expect(workflow).toContain(
      "dna-open-lab-r2-expired-budget-recovery-preview-migration.yml",
    );
    expect(workflow).toContain('"r2-expired-budget-recovery-migration"');
    expect(workflow).toContain("dna-open-lab-r2-expired-budget-recovery.yml");
    expect(workflow).toContain('"r2-expired-budget-recovery"');
    expect(workflow).toContain(
      "payload.execute_expired_r2_budget_recovery !== true",
    );
    expect(workflow).toContain("expected_reserved_storage_bytes");
    expect(workflow).toContain("expected_reserved_class_a_operations");
    expect(workflow).toContain("expected_reserved_class_b_operations");
    expect(workflow).toContain(
      "dna-population-entrant-authority-readiness.yml",
    );
    expect(workflow).toContain(
      "dna-population-entrant-authority-cohort-command.yml",
    );
    expect(workflow).toContain(
      "dna-population-entrant-authority-remediation-command.yml",
    );
    expect(workflow).toContain(
      "dna-population-entrant-authority-remediation-verification.yml",
    );
    expect(workflow).toContain(
      "dna-population-entrant-authority-remediation-continuation-readiness.yml",
    );
    expect(workflow).toContain(
      "dna-population-entrant-authority-remediation-continuation-command.yml",
    );
    expect(workflow).toContain(
      "dna-population-entrant-authority-remediation-continuation-verification.yml",
    );
    expect(workflow).toContain(
      "dna-population-entrant-authority-remediation-cohort-3-readiness.yml",
    );
    expect(workflow).toContain(
      "dna-population-entrant-authority-remediation-cohort-3-command.yml",
    );
    expect(workflow).toContain(
      "dna-population-entrant-authority-remediation-cohort-3-verification.yml",
    );
    expect(workflow).toContain('"entrant-remediation-first"');
    expect(workflow).toContain('"entrant-remediation-verify"');
    expect(workflow).toContain('"entrant-remediation-continuation-readiness"');
    expect(workflow).toContain('"entrant-remediation-continuation"');
    expect(workflow).toContain('"entrant-remediation-continuation-verify"');
    expect(workflow).toContain('"entrant-remediation-cohort-3-readiness"');
    expect(workflow).toContain('"entrant-remediation-cohort-3"');
    expect(workflow).toContain('"entrant-remediation-cohort-3-verify"');
    expect(workflow).toContain(
      "payload.execute_private_preview_entrant_remediation_cohort_3 !== true",
    );
    expect(workflow).toContain(
      "payload.execute_next_private_preview_entrant_remediation !== true",
    );
    expect(workflow).toContain(
      "payload.execute_first_private_preview_entrant_remediation !== true",
    );
    expect(workflow).toContain(
      "dna-population-entrant-authority-first-cohort-verification.yml",
    );
    expect(workflow).toContain(
      "payload.execute_first_private_preview_entrant_cohort !== true",
    );
    expect(workflow).toContain("main?.sha !== payload.expected_main_sha");
    expect(workflow).toContain(
      "dna-population-entrant-authority-continuation-command.yml",
    );
    expect(workflow).toContain(
      "dna-population-entrant-authority-continuation-readiness.yml",
    );
    expect(workflow).toContain(
      "payload.execute_next_private_preview_entrant_cohort !== true",
    );
    expect(workflow).toContain("expected_recovered_chunk_count");
    expect(workflow).toContain("expected_recovered_race_count");
    expect(workflow).toContain("expected_next_chunk_ordinal");
    expect(workflow).toContain("expected_checkpoint_updated_at");
    expect(workflow).toContain("durable_boundary_sha256");
    expect(workflow).toContain(
      "dna-population-entrant-authority-autonomous-runner.yml",
    );
    expect(workflow).toContain(
      "payload.execute_all_private_preview_entrant_authority !== true",
    );
    expect(workflow).toContain(
      'payload.accepted_boundary_status !== "ready_for_continuation"',
    );
    expect(workflow).toContain("protected-private-preview-deployment.yml");
    expect(workflow).toContain('"protected-preview-deployment"');
    expect(workflow).toContain(
      "payload.deploy_protected_preview !== true",
    );
    expect(workflow).toContain(
      "payload.synchronize_preview_runtime !== true",
    );
    expect(workflow).not.toMatch(/VERCEL|production/iu);
    expect(workflow).not.toContain("secrets.");
  });
});
