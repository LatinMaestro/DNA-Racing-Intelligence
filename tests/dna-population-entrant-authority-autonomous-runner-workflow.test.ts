import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const workflowPath =
  ".github/workflows/dna-population-entrant-authority-autonomous-runner.yml";

describe("DNA population entrant authority autonomous workflow", () => {
  it("is explicitly armed, bounded, exact-main, Preview-only and self-resuming", async () => {
    const [workflow, relay, hosted] = await Promise.all([
      readFile(workflowPath, "utf8"),
      readFile(".github/workflows/dna-owner-dispatch-relay.yml", "utf8"),
      readFile(
        "tests/hosted-preview-connected-population-entrant-authority-autonomous-runner.test.ts",
        "utf8",
      ),
    ]);

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toMatch(/\b(push|pull_request|schedule):/u);
    for (const input of [
      "expected_main_sha:",
      "accepted_boundary_status:",
      "expected_unresolved_race_count:",
      "expected_unresolved_race_set_sha256:",
      "expected_recovered_chunk_count:",
      "expected_recovered_race_count:",
      "expected_next_chunk_ordinal:",
      "expected_checkpoint_updated_at:",
      "readiness_capacity_observed_at:",
      "durable_boundary_sha256:",
      "execute_all_private_preview_entrant_authority:",
    ]) {
      expect(workflow).toContain(input);
    }
    expect(workflow).toContain("default: false");
    expect(workflow).toContain("actions: write");
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("issues: write");
    expect(workflow).toContain("DNA_STATUS_MODE: autonomous-running");
    expect(workflow).toContain("DNA_STATUS_MODE: autonomous-failure");
    expect(workflow).toContain("DNA_STATUS_MODE: autonomous-result");
    expect(workflow).toContain('DNA_STATUS_COMMENT_ID: "5866846740"');
    expect(hosted).toContain("dna-entrant-autonomous-failure.json");

    expect(workflow).toContain('GITHUB_REF" != "refs/heads/main"');
    expect(workflow).toContain(
      'DNA_POPULATION_ENTRANT_AUTHORITY_EXPECTED_MAIN_SHA" != "$GITHUB_SHA',
    );
    expect(workflow).toContain(
      '"$(git rev-parse origin/main)" != "$GITHUB_SHA"',
    );
    expect(workflow).toContain("environment: preview");
    expect(workflow).toContain(
      'DNA_POPULATION_ENTRANT_AUTHORITY_AUTONOMOUS_RUNNER: "1"',
    );
    expect(workflow).toContain(
      "DNA_POPULATION_ENTRANT_AUTHORITY_AUTONOMOUS_WRITE_ARM",
    );
    expect(workflow).toContain("DNA_R2_STORAGE_CLASS: Standard");
    expect(workflow).toContain(
      "group: dna-population-entrant-authority-cohort-persistence",
    );
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain(
      "tests/hosted-preview-connected-population-entrant-authority-autonomous-runner.test.ts",
    );
    expect(workflow).toContain("dna-entrant-autonomous-session.json");
    expect(workflow).toContain(
      "/actions/workflows/dna-population-entrant-authority-autonomous-runner.yml/dispatches",
    );
    expect(workflow).toContain("response.status !== 204");
    expect(workflow).toContain("if: always()");
    expect(workflow).not.toMatch(/VERCEL|production/iu);

    expect(hosted).toContain("const SESSION_COHORT_LIMIT = 8");
    expect(hosted).toContain("assertCurrentExactHead");
    expect(hosted).toContain("runBoundedSession");
    expect(relay).toContain(
      "dna-population-entrant-authority-autonomous-runner.yml",
    );
    expect(relay).toContain('"entrant-autonomous"');
    expect(relay).toContain(
      "payload.execute_all_private_preview_entrant_authority !== true",
    );
  });
});
