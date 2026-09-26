import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const workflowPath =
  ".github/workflows/dna-population-entrant-authority-continuation-command.yml";

describe("DNA population entrant authority continuation workflow", () => {
  it("is dispatch-only, exact-main, single-cohort, Preview-only and fail-closed", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toMatch(/\b(push|pull_request|schedule):/u);
    for (const input of [
      "expected_main_sha:",
      "cohort_observed_at:",
      "expected_unresolved_race_count:",
      "expected_unresolved_race_set_sha256:",
      "expected_recovered_chunk_count:",
      "expected_recovered_race_count:",
      "expected_next_chunk_ordinal:",
      "expected_checkpoint_updated_at:",
      "readiness_capacity_observed_at:",
      "durable_boundary_sha256:",
      "execute_next_private_preview_entrant_cohort:",
    ]) {
      expect(workflow).toContain(input);
    }
    expect(workflow).toContain("default: false");
    expect(workflow).toContain('GITHUB_REF" != "refs/heads/main"');
    expect(workflow).toContain(
      'DNA_POPULATION_ENTRANT_AUTHORITY_EXPECTED_MAIN_SHA" != "$GITHUB_SHA',
    );
    expect(workflow).toContain(
      '"$(git rev-parse origin/main)" != "$GITHUB_SHA"',
    );
    expect(workflow).toContain("environment: preview");
    expect(workflow).toContain(
      'DNA_POPULATION_ENTRANT_AUTHORITY_CONTINUATION_COMMAND: "1"',
    );
    expect(workflow).toContain(
      "DNA_POPULATION_ENTRANT_AUTHORITY_DURABLE_BOUNDARY_SHA256",
    );
    expect(workflow).toContain("DNA_R2_STORAGE_CLASS: Standard");
    expect(workflow).toContain(
      "group: dna-population-entrant-authority-cohort-persistence",
    );
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain(
      "tests/hosted-preview-connected-population-entrant-authority-continuation-command.test.ts",
    );
    expect(workflow).toContain("if: always()");
    expect(workflow).not.toMatch(/VERCEL|production/iu);
  });
});
