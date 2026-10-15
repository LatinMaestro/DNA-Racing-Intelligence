import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  inspectNeonTransfer,
  NEON_TRANSFER_OPERATING_CEILING_BYTES,
} from "@/scripts/neon-transfer-preflight";
import { DNA_OPEN_LAB_ZERO_COST_NEON_BUDGETS } from "@/lib/dna-open-lab-zero-cost-provider-capacity";

const projectId = "synthetic-project-123";
const now = new Date("2026-10-15T00:00:00Z");
const project = {
  id: projectId,
  data_transfer_bytes: 1_000_000_000,
  consumption_period_start: "2026-10-01T00:00:00Z",
  consumption_period_end: "2026-11-01T00:00:00Z",
};

async function inspect(row: unknown = project, time = now) {
  const fetcher = vi.fn(async () => Response.json({ project: row }));
  const receipt = await inspectNeonTransfer({
    apiKey: "synthetic-key",
    projectId,
    now: time,
    fetcher,
  });
  return { receipt, fetcher };
}

describe("early Neon transfer metadata preflight", () => {
  it("uses the approved operating ceiling and one bounded control-plane GET", async () => {
    expect(NEON_TRANSFER_OPERATING_CEILING_BYTES).toBe(
      DNA_OPEN_LAB_ZERO_COST_NEON_BUDGETS.dataTransferBytes,
    );
    const { receipt, fetcher } = await inspect();
    expect(receipt).toEqual({
      ready: true,
      reason: "ready",
      dataTransferBytes: 1_000_000_000,
      billingWindowEndAt: "2026-11-01T00:00:00.000Z",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      `https://console.neon.tech/api/v2/projects/${projectId}`,
      expect.objectContaining({
        method: "GET",
        cache: "no-store",
        redirect: "error",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("holds at the ceiling and at this month's recorded usage without a database request", async () => {
    for (const data_transfer_bytes of [
      NEON_TRANSFER_OPERATING_CEILING_BYTES,
      5_695_839_591,
    ]) {
      const { receipt, fetcher } = await inspect({
        ...project,
        data_transfer_bytes,
      });
      expect(receipt).toMatchObject({
        ready: false,
        reason: "transfer_exhausted",
        dataTransferBytes: data_transfer_bytes,
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
    expect(
      (
        await inspect({
          ...project,
          data_transfer_bytes: NEON_TRANSFER_OPERATING_CEILING_BYTES - 1,
        })
      ).receipt.ready,
    ).toBe(true);
  });

  it("does not treat the calendar reset as fresh allowance proof", async () => {
    const nextMonth = new Date("2026-11-01T00:00:00Z");
    expect((await inspect(project, nextMonth)).receipt.ready).toBe(false);
    expect(
      (
        await inspect(
          {
            ...project,
            data_transfer_bytes: 0,
            consumption_period_start: "2026-11-01T00:00:00Z",
            consumption_period_end: "2026-12-01T00:00:00Z",
          },
          nextMonth,
        )
      ).receipt.ready,
    ).toBe(true);
  });

  it("fails closed on missing/invalid usage, wrong project and stale or future windows", async () => {
    const { data_transfer_bytes: removed, ...missing } = project;
    void removed;
    for (const row of [
      null,
      [],
      missing,
      { ...project, id: "another-project" },
      { ...project, data_transfer_bytes: "0" },
      { ...project, data_transfer_bytes: -1 },
      { ...project, data_transfer_bytes: Number.MAX_SAFE_INTEGER + 1 },
      { ...project, consumption_period_start: "2026-11-01T00:00:00Z" },
      { ...project, consumption_period_end: "2026-10-01T00:00:00Z" },
      { ...project, consumption_period_start: "yesterday" },
    ]) {
      expect((await inspect(row)).receipt).toMatchObject({
        ready: false,
        reason: "measurement_invalid",
      });
    }
  });

  it("does not request metadata with malformed configuration", async () => {
    const fetcher = vi.fn();
    for (const configuration of [
      { apiKey: undefined, projectId },
      { apiKey: "synthetic-key\n", projectId },
      { apiKey: "synthetic-key", projectId: "../another-project" },
    ]) {
      expect(
        (await inspectNeonTransfer({ ...configuration, fetcher, now })).ready,
      ).toBe(false);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("never retries or emits provider responses, credentials or errors on failed measurements", async () => {
    for (const response of [
      new Response("synthetic-private-provider-body", { status: 429 }),
      new Response("not-json"),
    ]) {
      const fetcher = vi.fn(async () => response);
      const receipt = await inspectNeonTransfer({
        apiKey: "synthetic-private-key",
        projectId,
        now,
        fetcher,
      });
      expect(receipt.ready).toBe(false);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(receipt)).not.toContain("synthetic-private");
    }
    const fetcher = vi.fn(async () => {
      throw new Error("synthetic-private-error");
    });
    expect(
      await inspectNeonTransfer({
        apiKey: "synthetic-key",
        projectId,
        now,
        fetcher,
      }),
    ).toEqual({
      ready: false,
      reason: "measurement_unavailable",
      dataTransferBytes: null,
      billingWindowEndAt: null,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["dna-race-merge-core-outcome-continuation-command.yml", "continuation"],
    [
      "dna-population-race-index-private-preview-command.yml",
      "exact-main-bounded-private-preview-index",
    ],
  ])("gates the connected job in %s before database setup", (file, job) => {
    const workflow = readFileSync(`.github/workflows/${file}`, "utf8");
    const early = workflow.split(`  ${job}:`)[0]!;
    expect(early).toContain(
      "vars.DNA_ENABLE_DEFERRED_HISTORY_SCHEDULE == 'true'",
    );
    expect(early).toContain(
      "node --experimental-strip-types scripts/neon-transfer-preflight.ts",
    );
    expect(early).not.toMatch(/DATABASE_URL|psql|npm ci|DNA_R2_ACCESS_KEY_ID/);
    const connected = workflow.split(`  ${job}:`)[1]!;
    expect(connected).toMatch(
      /^\n    needs: transfer-capacity\n    if: \$\{\{ needs\['transfer-capacity'\].outputs.ready == 'true' \}\}/,
    );
    expect(connected).toContain("Prove");
    expect(connected).toContain("expected_main_sha");
  });

  it("keeps pull requests away from Preview credentials and gates manual exact-main provider access", () => {
    const workflow = readFileSync(
      ".github/workflows/cloudflare-preview-preflight.yml",
      "utf8",
    );
    const early = workflow.split("  preflight:")[0]!;
    expect(early).toContain(
      "github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'",
    );
    expect(early).toContain("Prove metadata gate is exact current main");
    expect(early).toContain(
      "node --experimental-strip-types scripts/neon-transfer-preflight.ts",
    );
    expect(early).not.toMatch(
      /DATABASE_URL|DNA_R2_ACCESS_KEY_ID|CLOUDFLARE_API_TOKEN|psql|npm ci/,
    );

    const connected = workflow.split("  preflight:")[1]!;
    expect(connected).toMatch(
      /^\n    needs: transfer-capacity\n    if: \$\{\{ needs\['transfer-capacity'\]\.outputs\.ready == 'true' \}\}/,
    );
    expect(connected).toContain("DATABASE_URL");
    expect(connected).toContain("Verify least-privilege Neon runtime");
  });
});
