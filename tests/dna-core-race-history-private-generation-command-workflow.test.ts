import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const workflowPath =
  ".github/workflows/dna-core-race-history-private-generation-command.yml";

describe("DNA Core race-history private generation command workflow", () => {
  it("is one-shot or manual, exact-main, Preview-only and fail-closed", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("push:");
    expect(workflow).toContain(
      '".github/workflows/dna-core-race-history-private-generation-command.yml"',
    );
    expect(workflow).not.toMatch(/\b(pull_request|schedule):/u);
    expect(workflow).toContain('GITHUB_REF}" != "refs/heads/main"');
    expect(workflow).toContain(
      '"$(git rev-parse origin/main)" != "${GITHUB_SHA}"',
    );
    expect(workflow).toContain("execute_bounded_private_preview_generation");
    expect(workflow).toContain(
      "DNA_CORE_RACE_HISTORY_PRIVATE_GENERATION_MAXIMUM_STEPS",
    );
    expect(workflow).toContain(
      "tests/hosted-preview-connected-core-race-history-private-generation-command.test.ts",
    );
    expect(workflow).toContain("DNA_R2_STORAGE_CLASS: Standard");
    expect(workflow).not.toContain(
      "DNA_CORE_RACE_HISTORY_PRIVATE_GENERATION_REQUIRE_COMPLETE",
    );
    expect(workflow).toContain("Advance one bounded Core result slice");
    expect(
      workflow.match(/hosted-preview-connected-core-race-history/g),
    ).toHaveLength(1);
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain("if: always()");
    expect(workflow).not.toMatch(/VERCEL|production/iu);
  });
});
