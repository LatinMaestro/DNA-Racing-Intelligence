import { describe, expect, it, vi } from "vitest";
import {
  authenticatedClerkOwnerId,
  resolveClerkOwnerSessionConfiguration,
} from "@/lib/clerk-owner-session";

const readyEnvironment = {
  publishableKey: "pk_test_synthetic",
  secretKey: "sk_test_synthetic",
} as const;

describe("fail-closed Clerk owner session", () => {
  it("stays unconfigured without either server-side value", async () => {
    const authReader = vi.fn(async () => ({ userId: "synthetic-owner" }));

    expect(
      resolveClerkOwnerSessionConfiguration({
        publishableKey: undefined,
        secretKey: undefined,
      }),
    ).toEqual({ status: "not_configured" });
    await expect(
      authenticatedClerkOwnerId({
        environment: {
          publishableKey: undefined,
          secretKey: undefined,
        },
        authReader,
      }),
    ).resolves.toBeNull();
    expect(authReader).not.toHaveBeenCalled();
  });

  it.each([
    {
      publishableKey: "pk_test_synthetic",
      secretKey: undefined,
    },
    {
      publishableKey: undefined,
      secretKey: "sk_test_synthetic",
    },
  ])("rejects partial Clerk configuration", async (environment) => {
    const authReader = vi.fn(async () => ({ userId: "synthetic-owner" }));

    await expect(
      authenticatedClerkOwnerId({ environment, authReader }),
    ).rejects.toThrow("configuration is incomplete");
    expect(authReader).not.toHaveBeenCalled();
  });

  it("returns null for a configured but signed-out request", async () => {
    await expect(
      authenticatedClerkOwnerId({
        environment: readyEnvironment,
        authReader: async () => ({ userId: null }),
      }),
    ).resolves.toBeNull();
  });

  it("returns a normalized authenticated Clerk user ID", async () => {
    await expect(
      authenticatedClerkOwnerId({
        environment: readyEnvironment,
        authReader: async () => ({ userId: "  synthetic-owner  " }),
      }),
    ).resolves.toBe("synthetic-owner");
  });

  it.each([undefined, "", "   ", 42, false])(
    "rejects malformed authenticated identity evidence",
    async (userId) => {
      await expect(
        authenticatedClerkOwnerId({
          environment: readyEnvironment,
          authReader: async () => ({ userId }),
        }),
      ).rejects.toThrow("invalid user ID");
    },
  );
});
