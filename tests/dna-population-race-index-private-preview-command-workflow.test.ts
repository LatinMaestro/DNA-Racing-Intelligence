import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const workflowPath =
  ".github/workflows/dna-population-race-index-private-preview-command.yml";

describe("DNA population race index private Preview command workflow", () => {
  it("is scheduled, exact-main, bounded, Preview-only and fail-closed", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("schedule:");
    expect(workflow).toContain('cron: "23 * * * *"');
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("expected_main_sha:");
    expect(workflow).toContain("execute_bounded_private_preview_index:");
    expect(workflow).toContain('GITHUB_REF}" != "refs/heads/main"');
    expect(workflow).toContain(
      'inputs.expected_main_sha }}" != "${GITHUB_SHA}',
    );
    expect(workflow).toContain("git rev-parse origin/main");
    expect(workflow).toContain("environment: preview");
    expect(workflow).toContain('default: "100"');
    expect(workflow).toContain("DNA_POPULATION_RACE_INDEX_MAXIMUM_RECEIPTS");
    expect(workflow).toContain(
      "github.event_name == 'schedule' && '100' || inputs.maximum_receipts",
    );
    expect(workflow).toContain(
      "0112_dna_population_race_index_generation.up.sql",
    );
    expect(workflow).toContain(
      "0112_dna_population_race_index_generation.smoke.sql",
    );
    expect(workflow).toContain("--set skip_runtime_role=1");
    expect(workflow).toContain("neon@6.0.0 connection-string");
    expect(workflow).toContain('"/projects/${NEON_PROJECT_ID}/endpoints"');
    expect(workflow).toContain("DNA_RUNTIME_ENDPOINT_ID");
    expect(workflow).toContain('connection-string "${branch_id}"');
    expect(workflow).toContain("--role-name neondb_owner");
    expect(workflow).toContain('echo "::add-mask::${migration_url}"');
    expect(workflow).toContain('psql "${DNA_MIGRATION_DATABASE_URL}"');
    expect(workflow).toContain(
      "Remove migration binding from subsequent steps",
    );
    expect(workflow).toContain(
      "tests/hosted-preview-connected-population-race-index-command.test.ts",
    );
    expect(workflow).toContain("DNA_R2_STORAGE_CLASS: Standard");
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain("actions: write");
    expect(workflow).toContain(
      "terminal_status: ${{ steps.advance.outputs.status }}",
    );
    expect(workflow).toContain("deadline_epoch");
    expect(workflow).toContain("+ 1200");
    expect(workflow).toContain('status}" == "complete"');
    expect(workflow).toContain('status}" == "held"');
    expect(workflow).toContain("provider_capacity_[a-z0-9_]+");
    expect(workflow).toContain("held safely at the free-capacity guard");
    expect(workflow).toContain('echo "status=${status}" >> "${GITHUB_OUTPUT}"');
    expect(workflow).toContain(
      "Main changed between durable population-index slices",
    );
    expect(workflow).toContain("if: always()");
    expect(workflow).toContain("requeue-private-preview-index:");
    expect(workflow).toContain("result == 'success'");
    expect(workflow).toContain("outputs.terminal_status == 'advanced'");
    expect(workflow).toContain("outputs.terminal_status == 'held'");
    expect(workflow).toContain("sleep_seconds=300");
    expect(workflow).toContain("sleep_seconds=60");
    expect(workflow).toContain('.status != \\"completed\\"');
    expect(workflow).toContain("no duplicate continuation was dispatched");
    expect(workflow).toContain("Main changed before continuation");
    expect(workflow).toContain(
      "dna-population-race-index-private-preview-command.yml/dispatches",
    );
    expect(workflow).toContain("execute_bounded_private_preview_index");
    expect(workflow).not.toMatch(/\b(push|pull_request):/u);
    expect(workflow).not.toMatch(/DNA_OPEN_LAB_API_KEY|VERCEL|production/iu);
  });
});
