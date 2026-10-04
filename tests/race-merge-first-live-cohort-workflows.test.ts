import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationWorkflow =
  ".github/workflows/dna-race-merge-core-outcome-r2-preview-migration.yml";
const cohortWorkflow =
  ".github/workflows/dna-race-merge-core-outcome-first-cohort-command.yml";
const continuationWorkflow =
  ".github/workflows/dna-race-merge-core-outcome-continuation-command.yml";

describe("Race Merge first live cohort workflows", () => {
  it("keeps the R2 manifest migration exact-main, Preview-only and reversible", async () => {
    const workflow = await readFile(migrationWorkflow, "utf8");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("exact_main_sha:");
    expect(workflow).toContain("apply_private_preview_migration:");
    expect(workflow).toContain("environment: preview");
    expect(workflow).toContain("git rev-parse origin/main");
    expect(workflow).toContain(
      "0123_race_merge_core_outcome_r2_manifest.up.sql",
    );
    expect(workflow).toContain(
      "0123_race_merge_core_outcome_r2_manifest.smoke.sql",
    );
    expect(workflow).toContain(
      "0123_race_merge_core_outcome_r2_manifest.down.sql",
    );
    expect(workflow).toContain(
      "0123_race_merge_core_outcome_r2_manifest.removal.sql",
    );
    expect(workflow).toContain("--role-name neondb_owner");
    expect(workflow).toContain("set -euo pipefail");
    expect(workflow).not.toMatch(/VERCEL|production/iu);
    expect(workflow).not.toMatch(/DNA_OPEN_LAB_API_KEY/u);
  });

  it("keeps the first cohort local-evidence-only and capacity-gated", async () => {
    const workflow = await readFile(cohortWorkflow, "utf8");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("expected_main_sha:");
    expect(workflow).toContain(
      "execute_first_private_preview_race_merge_cohort:",
    );
    expect(workflow).toContain("environment: preview");
    expect(workflow).toContain("git rev-parse origin/main");
    expect(workflow).toContain(
      "hosted-preview-connected-race-merge-core-outcome-first-cohort.test.ts",
    );
    for (const setting of [
      "CLOUDFLARE_ANALYTICS_API_TOKEN",
      "CLOUDFLARE_API_TOKEN",
      "DNA_R2_ACCESS_KEY_ID",
      "DNA_R2_SECRET_ACCESS_KEY",
      "NEON_API_KEY",
      "NEON_PROJECT_ID",
    ]) {
      expect(workflow).toContain(setting);
    }
    expect(workflow).not.toMatch(/DNA_OPEN_LAB_API_KEY(?:_|:|\s)/u);
    expect(workflow).not.toMatch(/VERCEL|production/iu);
  });

  it("keeps continuation autonomous, durable, bounded and capacity-gated", async () => {
    const workflow = await readFile(continuationWorkflow, "utf8");
    expect(workflow).toContain("schedule:");
    expect(workflow).toContain('cron: "41 * * * *"');
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("expected_main_sha:");
    expect(workflow).toContain("previous_cohort_ordinal:");
    expect(workflow).toContain(
      "execute_next_private_preview_race_merge_cohort:",
    );
    expect(workflow).toContain("environment: preview");
    expect(workflow).toContain("git rev-parse origin/main");
    expect(workflow).toContain(
      "hosted-preview-connected-race-merge-core-outcome-continuation.test.ts",
    );
    expect(workflow).toContain(
      "DNA_RACE_MERGE_CORE_OUTCOME_PREVIOUS_COHORT_ORDINAL",
    );
    expect(workflow).toContain(
      "Acquire masked short-lived Preview owner binding",
    );
    expect(workflow).toContain("neon@6.0.0 connection-string");
    expect(workflow).toContain("--role-name neondb_owner");
    expect(workflow).toContain('echo "::add-mask::${migration_url}"');
    expect(workflow).toContain("Resolve durable predecessor cohort");
    expect(workflow).toContain(
      "dna.race_merge_core_outcome_r2_generation",
    );
    expect(workflow).toContain(
      "generation_id = 'owner-race-merge-outcomes-v1'",
    );
    expect(workflow).toContain("state = 'complete'");
    expect(workflow).toContain("state = 'writing'");
    expect(workflow).toContain(
      "The durable Race Merge writing checkpoint drifted.",
    );
    expect(workflow).toContain(
      "The dispatched predecessor is no longer the durable latest cohort.",
    );
    expect(workflow).toContain("Verify durable continuation result");
    expect(workflow).toContain(
      "The durable Race Merge continuation result is inconsistent.",
    );
    expect(workflow).toContain("coreCount < 100");
    expect(workflow).toContain("completeCoreCount < 100");
    expect(workflow).toContain("terminal_status:");
    expect(workflow).toContain("latest_cohort_ordinal:");
    expect(workflow).toContain("requeue-continuation:");
    expect(workflow).toContain("actions: write");
    expect(workflow).toContain("sleep 60");
    expect(workflow).toContain("outputs.terminal_status == 'advanced'");
    expect(workflow).toContain(
      "no duplicate continuation was dispatched",
    );
    expect(workflow).toContain(
      "dna-race-merge-core-outcome-continuation-command.yml/dispatches",
    );
    expect(workflow).toContain(
      "execute_next_private_preview_race_merge_cohort",
    );
    expect(workflow).toContain("Remove owner binding from subsequent steps");
    expect(workflow).toContain("cancel-in-progress: false");
    for (const setting of [
      "CLOUDFLARE_ANALYTICS_API_TOKEN",
      "CLOUDFLARE_API_TOKEN",
      "DNA_R2_ACCESS_KEY_ID",
      "DNA_R2_SECRET_ACCESS_KEY",
      "NEON_API_KEY",
      "NEON_PROJECT_ID",
    ]) {
      expect(workflow).toContain(setting);
    }
    expect(workflow).not.toMatch(/\b(push|pull_request):/u);
    expect(workflow).not.toMatch(/DNA_OPEN_LAB_API_KEY(?:_|:|\s)/u);
    expect(workflow).not.toMatch(/VERCEL|production/iu);
  });
});
