import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const path = ".github/workflows/dna-open-lab-p5-crash-replay-recovery.yml";
const workflow = readFileSync(path, "utf8");

describe("DNA Open Lab P5 ordered recovery workflow", () => {
  it("is an exact-main, opt-in, cleanup-mandatory provider workflow", () => {
    expect(workflow).toContain("workflow_dispatch: {}");
    expect(workflow).toContain('GITHUB_REF}" != "refs/heads/main"');
    expect(workflow).toContain('git rev-parse origin/main)" != "${GITHUB_SHA}');
    expect(workflow).toContain(
      "DNA_OPEN_LAB_P5_CONNECTED_RECOVERY_ORDERED_SUITE",
    );
    expect(workflow).toContain("DNA_OPEN_LAB_P5_RECOVERY_CLEANUP_ONLY");
    expect(workflow).toContain("if: always()");
    expect(workflow).toContain("if-no-files-found: error");
    expect(workflow).toContain("retention-days: 7");
    expect(workflow).toContain("ordered recovery suite");
    expect(workflow).toContain("recovery-ordered-suite.jsonl");
  });

  it("does not require a DNA API key or authorize deployment and Production", () => {
    expect(workflow).not.toMatch(/DNA_OPEN_LAB_API_KEY/u);
    expect(workflow).not.toMatch(/vercel|wrangler deploy|production/i);
    expect(workflow).not.toMatch(/push:|schedule:/u);
  });
});
