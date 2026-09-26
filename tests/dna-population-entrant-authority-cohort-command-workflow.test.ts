import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const workflowPath =
  ".github/workflows/dna-population-entrant-authority-cohort-command.yml";

describe("DNA population entrant authority cohort commissioning workflow", () => {
  it("is dispatch-only, exact-main, first-cohort-only, Preview-only and fail-closed", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toMatch(/\b(push|pull_request|schedule):/u);
    expect(workflow).toContain("expected_main_sha:");
    expect(workflow).toContain("cohort_observed_at:");
    expect(workflow).toContain("expected_unresolved_race_count:");
    expect(workflow).toContain("expected_unresolved_race_set_sha256:");
    expect(workflow).toContain("readiness_capacity_observed_at:");
    expect(workflow).toContain("readiness_receipt_sha256:");
    expect(workflow).toContain("execute_first_private_preview_entrant_cohort:");
    expect(workflow).not.toContain(
      "execute_one_private_preview_entrant_cohort:",
    );
    expect(workflow).toContain("default: false");
    expect(workflow).toContain('GITHUB_REF" != "refs/heads/main"');
    expect(workflow).toContain(
      'inputs.expected_main_sha }}\" != \"$GITHUB_SHA',
    );
    expect(workflow).toContain(
      '"$(git rev-parse origin/main)" != "$GITHUB_SHA"',
    );
    expect(workflow).toContain("environment: preview");
    expect(workflow).toContain(
      'DNA_POPULATION_ENTRANT_AUTHORITY_COHORT_COMMAND: "1"',
    );
    expect(workflow).toContain(
      "DNA_POPULATION_ENTRANT_AUTHORITY_EXPECTED_UNRESOLVED_RACE_COUNT",
    );
    expect(workflow).toContain(
      "DNA_POPULATION_ENTRANT_AUTHORITY_EXPECTED_UNRESOLVED_RACE_SET_SHA256",
    );
    expect(workflow).toContain(
      "DNA_POPULATION_ENTRANT_AUTHORITY_READINESS_CAPACITY_OBSERVED_AT",
    );
    expect(workflow).toContain(
      "DNA_POPULATION_ENTRANT_AUTHORITY_READINESS_RECEIPT_SHA256",
    );
    expect(workflow).toContain("DNA_R2_STORAGE_CLASS: Standard");
    expect(workflow).toContain(
      "group: dna-population-entrant-authority-first-cohort",
    );
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain(
      "tests/hosted-preview-connected-population-entrant-authority-cohort-command.test.ts",
    );
    expect(
      workflow.match(
        /hosted-preview-connected-population-entrant-authority-cohort-command/g,
      ),
    ).toHaveLength(1);
    expect(workflow).toContain("if: always()");
    expect(workflow).not.toMatch(/VERCEL|production/iu);
  });
});
