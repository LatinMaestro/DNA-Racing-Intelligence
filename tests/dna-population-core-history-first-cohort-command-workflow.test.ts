import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const workflowPath =
  ".github/workflows/dna-population-core-history-first-cohort-command.yml";

describe("DNA population Core-history first-cohort command workflow", () => {
  it("is dispatch-only, exact-main, singleton, Preview-only and fail-closed", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toMatch(/\b(push|pull_request|schedule):/u);
    expect(workflow).toContain("expected_main_sha:");
    expect(workflow).toContain("cohort_observed_at:");
    expect(workflow).toContain(
      "execute_first_private_preview_population_core_history:",
    );
    expect(workflow).toContain("default: false");
    expect(workflow).toContain('GITHUB_REF}" != "refs/heads/main"');
    expect(workflow).toContain(
      'inputs.expected_main_sha }}" != "${GITHUB_SHA}',
    );
    expect(workflow).toContain(
      '"$(git rev-parse origin/main)" != "${GITHUB_SHA}"',
    );
    expect(workflow).toContain("environment: preview");
    expect(workflow).toContain(
      'DNA_POPULATION_CORE_HISTORY_FIRST_COHORT_COMMAND: "1"',
    );
    expect(workflow).toContain("DNA_R2_STORAGE_CLASS: Standard");
    expect(workflow).toContain(
      "group: dna-population-core-history-first-cohort-persistence",
    );
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain(
      "hosted-preview-connected-population-core-history-first-cohort-command.test.ts",
    );
    expect(workflow).toContain("if: always()");
    expect(workflow).not.toMatch(/VERCEL|production/iu);
  });
});
