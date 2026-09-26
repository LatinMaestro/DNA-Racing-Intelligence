import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const workflowPath =
  ".github/workflows/dna-population-entrant-authority-continuation-command.yml";

describe("DNA population entrant authority single-next-cohort continuation workflow", () => {
  it("is dispatch-only, exact-main, one-next-cohort-only, Preview-only and explicitly armed", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toMatch(/\b(push|pull_request|schedule):/u);
    expect(workflow).toContain("expected_main_sha:");
    expect(workflow).toContain("cohort_observed_at:");
    expect(workflow).toContain("expected_unresolved_race_count:");
    expect(workflow).toContain("expected_unresolved_race_set_sha256:");
    expect(workflow).toContain("expected_recovered_chunk_count:");
    expect(workflow).toContain("expected_recovered_race_count:");
    expect(workflow).toContain("expected_next_chunk_ordinal:");
    expect(workflow).toContain("expected_checkpoint_updated_at:");
    expect(workflow).toContain("continuation_capacity_observed_at:");
    expect(workflow).toContain("durable_boundary_sha256:");
    expect(workflow).toContain(
      "execute_one_next_private_preview_entrant_cohort:",
    );
    expect(workflow).toContain("default: false");
    expect(workflow).toContain('GITHUB_REF" != "refs/heads/main"');
    expect(workflow).toContain('inputs.expected_main_sha }}" != "$GITHUB_SHA');
    expect(workflow).toContain(
      '"$(git rev-parse origin/main)" != "$GITHUB_SHA"',
    );
    expect(workflow).toContain("environment: preview");
    expect(workflow).toContain(
      'DNA_POPULATION_ENTRANT_AUTHORITY_CONTINUATION_COMMAND: "1"',
    );
    expect(workflow).toContain(
      "DNA_POPULATION_ENTRANT_AUTHORITY_EXPECTED_RECOVERED_CHUNK_COUNT",
    );
    expect(workflow).toContain(
      "DNA_POPULATION_ENTRANT_AUTHORITY_EXPECTED_RECOVERED_RACE_COUNT",
    );
    expect(workflow).toContain(
      "DNA_POPULATION_ENTRANT_AUTHORITY_EXPECTED_NEXT_CHUNK_ORDINAL",
    );
    expect(workflow).toContain(
      "DNA_POPULATION_ENTRANT_AUTHORITY_EXPECTED_CHECKPOINT_UPDATED_AT",
    );
    expect(workflow).toContain(
      "DNA_POPULATION_ENTRANT_AUTHORITY_CONTINUATION_CAPACITY_OBSERVED_AT",
    );
    expect(workflow).toContain(
      "DNA_POPULATION_ENTRANT_AUTHORITY_DURABLE_BOUNDARY_SHA256",
    );
    expect(workflow).toContain("DNA_R2_STORAGE_CLASS: Standard");
    expect(workflow).toContain(
      "group: dna-population-entrant-authority-single-next-cohort",
    );
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain(
      "tests/hosted-preview-connected-population-entrant-authority-continuation-command.test.ts",
    );
    expect(
      workflow.match(
        /hosted-preview-connected-population-entrant-authority-continuation-command/g,
      ),
    ).toHaveLength(1);
    expect(workflow).toContain("if: always()");
    expect(workflow).not.toMatch(/VERCEL|production/iu);
  });
});
