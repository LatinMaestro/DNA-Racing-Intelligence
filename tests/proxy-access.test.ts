import { afterEach, describe, expect, it } from "vitest";
import { NextRequest, type NextFetchEvent } from "next/server";
import { proxy } from "../proxy";

const originalEnvironment = {
  vercelEnv: process.env.VERCEL_ENV,
  phase0ReviewEnabled: process.env.ENABLE_PHASE0_REVIEW,
  productionApproved: process.env.ALLOW_PRODUCTION_DEPLOYMENT,
  publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  secretKey: process.env.CLERK_SECRET_KEY,
};

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  restore("VERCEL_ENV", originalEnvironment.vercelEnv);
  restore("ENABLE_PHASE0_REVIEW", originalEnvironment.phase0ReviewEnabled);
  restore(
    "ALLOW_PRODUCTION_DEPLOYMENT",
    originalEnvironment.productionApproved,
  );
  restore(
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    originalEnvironment.publishableKey,
  );
  restore("CLERK_SECRET_KEY", originalEnvironment.secretKey);
});

const request = new NextRequest("https://synthetic.invalid/imports");
const event = {
  waitUntil() {},
  passThroughOnException() {},
} as unknown as NextFetchEvent;

describe("deployment and Clerk proxy composition", () => {
  it("preserves the Production 404 before Clerk configuration is evaluated", async () => {
    process.env.VERCEL_ENV = "production";
    delete process.env.ALLOW_PRODUCTION_DEPLOYMENT;
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_partial";
    delete process.env.CLERK_SECRET_KEY;

    const response = await proxy(request, event);

    expect(response?.status).toBe(404);
    expect(response?.headers.get("X-Robots-Tag")).toContain("noindex");
  });

  it("denies an otherwise allowed request while Clerk is unconfigured", async () => {
    delete process.env.VERCEL_ENV;
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    delete process.env.CLERK_SECRET_KEY;

    const response = await proxy(request, event);

    expect(response?.status).toBe(404);
    expect(response?.headers.get("X-Robots-Tag")).toContain("noindex");
  });

  it("returns a non-indexable 404 for partial Clerk configuration", async () => {
    delete process.env.VERCEL_ENV;
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_partial";
    delete process.env.CLERK_SECRET_KEY;

    const response = await proxy(request, event);

    expect(response?.status).toBe(404);
    expect(response?.headers.get("X-Robots-Tag")).toContain("noindex");
  });
});
