import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const workflowPath =
  ".github/workflows/dna-open-lab-p5-first-backfill-persistent.yml";

describe("DNA Open Lab P5 persistent first-backfill workflow", () => {
  it("is exact-main, dispatch-only, bounded, recovery-first and non-publishing", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toMatch(/\b(push|pull_request|schedule):/u);
    expect(workflow).toContain('default: "33574168582"');
    expect(workflow).toContain('default: "33680976426"');
    expect(workflow).toContain('default: "0.50"');
    expect(workflow).toContain('default: "150"');
    expect(workflow).toContain("execute_approved_private_preview_backfill:");
    expect(workflow).toContain(
      '"${{ inputs.amendment_measurement_run }}" !== "33680976426"',
    );
    expect(workflow).toContain('GITHUB_REF}" != "refs/heads/main"');
    expect(workflow).toContain(
      '"$(git rev-parse origin/main)" != "${GITHUB_SHA}"',
    );
    expect(workflow).toContain(
      "tests/hosted-preview-connected-p5-crash-replay-recovery.test.ts",
    );
    expect(workflow).toContain(
      "tests/hosted-preview-connected-p5-first-backfill-persistent.test.ts",
    );
    expect(workflow).toContain("steps.preflight.outcome == 'success'");
    expect(workflow).toContain("steps.inspect.outcome == 'success'");
    expect(workflow).toContain("steps.exact_main.outcome == 'success'");
    expect(workflow).toContain(
      "DNA_OPEN_LAB_P5_PERSISTENT_FIRST_BACKFILL_REQUESTS_PER_MINUTE:",
    );
    expect(workflow).toContain(
      "DNA_OPEN_LAB_P5_PERSISTENT_FIRST_BACKFILL_TEMPORARY_150_RPM_APPROVED:",
    );
    expect(workflow).toContain("retention-days: 7");
    expect(workflow).not.toMatch(/VERCEL|production deployment/iu);
  });
});
