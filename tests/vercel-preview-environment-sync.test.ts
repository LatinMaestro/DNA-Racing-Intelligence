import { describe, expect, it, vi } from "vitest";

import {
  previewEnvironmentSpecification,
  syncPreviewEnvironment,
} from "../scripts/vercel-preview-environment-sync.mjs";
import type {
  PreviewEnvironmentFetcher,
  PreviewEnvironmentRunner,
} from "../scripts/vercel-preview-environment-sync.mjs";

const validEnvironment = {
  AUTHORIZED_CLERK_USER_ID: "user_owner-value",
  DATABASE_URL:
    "postgresql://dna_app_runtime:private@ep-example-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require",
  DNA_DATABASE_OWNER_ID: "database-owner-id",
  DNA_DATABASE_RUNTIME_ROLE: "dna_app_runtime",
  ENABLE_PHASE0_REVIEW: "1",
  VERCEL_TOKEN: "vercel-private-token",
  VERCEL_ORG_ID: "team_example",
  VERCEL_PROJECT_ID: "prj_example",
};

const inheritedEntries = [
  {
    id: "env_publishable",
    key: "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    target: ["production"],
    gitBranch: null,
  },
  {
    id: "env_secret",
    key: "CLERK_SECRET_KEY",
    target: ["production"],
    gitBranch: null,
  },
];

function response(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Vercel Preview environment synchronization", () => {
  it("keeps direct Preview bindings bounded and secret where required", () => {
    expect(previewEnvironmentSpecification(validEnvironment)).toEqual([
      expect.objectContaining({
        name: "AUTHORIZED_CLERK_USER_ID",
        visibility: "secret",
      }),
      expect.objectContaining({ name: "DATABASE_URL", visibility: "secret" }),
      expect.objectContaining({
        name: "DNA_DATABASE_OWNER_ID",
        visibility: "secret",
      }),
      expect.objectContaining({
        name: "DNA_DATABASE_RUNTIME_ROLE",
        visibility: "config",
      }),
      expect.objectContaining({
        name: "ENABLE_PHASE0_REVIEW",
        visibility: "config",
      }),
    ]);
  });

  it("extends existing Clerk bindings without reading their values and transfers Preview-only values over stdin", async () => {
    const runner = vi.fn<PreviewEnvironmentRunner>(() => ({
      status: 0,
      stdout: "",
      stderr: "",
    }));
    let metadataReads = 0;
    const fetcher = vi.fn<PreviewEnvironmentFetcher>(async (_input, init) => {
      if (init?.method === "PATCH") {
        const body = JSON.parse(String(init.body)) as { target: string[] };
        expect(body).toEqual({ target: ["production", "preview"] });
        expect(body).not.toHaveProperty("value");
        return response({});
      }
      metadataReads += 1;
      if (metadataReads === 1) {
        return response({ envs: inheritedEntries });
      }
      return response({
        envs: [
          ...inheritedEntries.map((entry) => ({
            ...entry,
            target: ["production", "preview"],
          })),
          ...previewEnvironmentSpecification(validEnvironment).map(
            ({ name }, index) => ({
              id: `preview_${index}`,
              key: name,
              target: ["preview"],
              gitBranch: null,
            }),
          ),
        ],
      });
    });

    const result = await syncPreviewEnvironment({
      environment: validEnvironment,
      runner,
      fetcher,
    });

    expect(result).toHaveLength(7);
    expect(runner).toHaveBeenCalledTimes(5);
    expect(fetcher).toHaveBeenCalledTimes(4);
    for (const [index, call] of runner.mock.calls.entries()) {
      expect(call[0]).toBe("vercel");
      expect(call[1]).toContain("preview");
      expect(call[1]).toContain("--force");
      expect(call[1]).not.toContain("--yes");
      if (index < 3) {
        expect(call[1]).toContain("--sensitive");
      } else {
        expect(call[1]).not.toContain("--sensitive");
      }
      expect(call[1]).not.toContain("--visibility");
      expect(call[1]).not.toContain("production");
      expect(call[1].join(" ")).not.toContain(call[2].input);
    }
    for (const call of fetcher.mock.calls) {
      expect(JSON.stringify(call)).not.toContain("pk_live_");
      expect(JSON.stringify(call)).not.toContain("sk_live_");
    }
  });

  it("validates Preview metadata without modifying provider state", async () => {
    const runner = vi.fn<PreviewEnvironmentRunner>();
    const fetcher = vi.fn<PreviewEnvironmentFetcher>(async () =>
      response({
        envs: [
          ...inheritedEntries.map((entry) => ({
            ...entry,
            target: ["production", "preview"],
          })),
          ...previewEnvironmentSpecification(validEnvironment).map(
            ({ name }, index) => ({
              id: `preview_${index}`,
              key: name,
              target: ["preview"],
              gitBranch: null,
            }),
          ),
        ],
      }),
    );

    await expect(
      syncPreviewEnvironment({
        environment: validEnvironment,
        runner,
        fetcher,
        validateOnly: true,
      }),
    ).resolves.toHaveLength(7);
    expect(runner).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[1]?.method).toBeUndefined();
  });

  it("fails closed for a Production database, missing owner, or disabled Preview", () => {
    expect(() =>
      previewEnvironmentSpecification({
        ...validEnvironment,
        DATABASE_URL:
          "postgresql://production_admin:private@ep-example.us-east-2.aws.neon.tech/neondb?sslmode=require",
      }),
    ).toThrow("runtime role");
    expect(() =>
      previewEnvironmentSpecification({
        ...validEnvironment,
        DNA_DATABASE_OWNER_ID: "",
      }),
    ).toThrow("DNA_DATABASE_OWNER_ID");
    expect(() =>
      previewEnvironmentSpecification({
        ...validEnvironment,
        ENABLE_PHASE0_REVIEW: "0",
      }),
    ).toThrow("explicitly enable Preview");
  });

  it("redacts every direct environment value if Vercel rejects a transfer", async () => {
    const runner = vi.fn<PreviewEnvironmentRunner>(() => ({
      status: 1,
      stdout: "",
      stderr: `rejected ${validEnvironment.DATABASE_URL} ${validEnvironment.VERCEL_TOKEN}`,
    }));
    const fetcher = vi.fn<PreviewEnvironmentFetcher>(async () =>
      response({
        envs: inheritedEntries.map((entry) => ({
          ...entry,
          target: ["production", "preview"],
        })),
      }),
    );

    await expect(
      syncPreviewEnvironment({
        environment: validEnvironment,
        runner,
        fetcher,
      }),
    ).rejects.toThrow(/rejected \[REDACTED\] \[REDACTED\]/u);
  });
});
