import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const workflowPath =
  ".github/workflows/dna-population-entrant-authority-completion-verification.yml";
const connectedTestPath =
  "tests/hosted-preview-connected-population-entrant-authority-completion-verification.test.ts";

describe("DNA population entrant authority completion-verification workflow", () => {
  it("is dispatch-only, exact-main, Preview-only and read-only", async () => {
    const [workflow, connectedTest] = await Promise.all([
      readFile(workflowPath, "utf8"),
      readFile(connectedTestPath, "utf8"),
    ]);

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toMatch(/\b(push|pull_request|schedule):/u);
    expect(workflow).toContain("expected_main_sha:");
    expect(workflow).toContain('GITHUB_REF" != "refs/heads/main"');
    expect(workflow).toContain(
      '"$(git rev-parse origin/main)" != "$GITHUB_SHA"',
    );
    expect(workflow).toContain("permissions:\n  contents: read");
    expect(workflow).toContain("environment: preview");
    expect(workflow).toContain(
      'DNA_POPULATION_ENTRANT_AUTHORITY_COMPLETION_VERIFICATION: "1"',
    );
    expect(workflow).toContain(
      "hosted-preview-connected-population-entrant-authority-completion-verification.test.ts",
    );
    expect(workflow).toContain("if: always()");
    expect(workflow).not.toMatch(/actions:\s*write|issues:\s*write/iu);
    expect(workflow).not.toMatch(
      /execute_first_private_preview_entrant_cohort|allow_persistent_write/iu,
    );
    expect(workflow).not.toMatch(/VERCEL|production/iu);

    expect(connectedTest).toContain("inspectResolvedAuthority");
    expect(connectedTest).toContain('status: "resolved_authority_complete"');
    expect(connectedTest).toContain("quarantinedRaceCount");
    expect(connectedTest).toContain("providerRequestPerformed: false");
    expect(connectedTest).toContain("persistentWritePerformed: false");
    expect(connectedTest).toContain("paidUsageAllowed: false");
  });
});
