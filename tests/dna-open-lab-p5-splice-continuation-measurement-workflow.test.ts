import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const workflowPath =
  ".github/workflows/dna-open-lab-p5-splice-continuation-measurement.yml";

describe("DNA Open Lab P5 splice continuation measurement workflow", () => {
  it("is exact-main, dispatch-only, fixed at 30 rpm and non-persistent", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toMatch(/\b(push|pull_request|schedule):/u);
    expect(workflow).toContain('default: "33574168582"');
    expect(workflow).toContain("acknowledge_read_only_continuation:");
    expect(workflow).toContain('GITHUB_REF}" != "refs/heads/main"');
    expect(workflow).toContain(
      '"$(git rev-parse origin/main)" != "${GITHUB_SHA}"',
    );
    expect(workflow).toContain(
      "tests/hosted-preview-connected-p5-splice-continuation-measurement.test.ts",
    );
    expect(workflow).toContain("steps.measurement.outcome == 'success'");
    expect(workflow).toContain("steps.exact_main.outcome == 'success'");
    expect(workflow).toContain("retention-days: 7");
    expect(workflow).not.toMatch(/CLOUDFLARE|DNA_R2|VERCEL|150/iu);
  });
});
