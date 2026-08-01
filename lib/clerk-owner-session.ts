export type ClerkOwnerSessionEnvironment = Readonly<{
  publishableKey: string | undefined;
  secretKey: string | undefined;
}>;

export type ClerkOwnerSessionConfiguration =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      publishableKey: string;
      secretKey: string;
    }>;

export type ClerkAuthReader = () => Promise<Readonly<{ userId: unknown }>>;

function normalized(value: string | undefined): string | null {
  const result = value?.trim() ?? "";
  return result === "" ? null : result;
}

export function resolveClerkOwnerSessionConfiguration(
  environment: ClerkOwnerSessionEnvironment,
): ClerkOwnerSessionConfiguration {
  const publishableKey = normalized(environment.publishableKey);
  const secretKey = normalized(environment.secretKey);

  if (publishableKey === null && secretKey === null) {
    return Object.freeze({ status: "not_configured" });
  }
  if (publishableKey === null || secretKey === null) {
    throw new Error("Clerk owner session configuration is incomplete.");
  }
  return {
    status: "ready",
    publishableKey,
    secretKey,
  };
}

async function defaultAuthReader(): Promise<Readonly<{ userId: unknown }>> {
  const { auth } = await import("@clerk/nextjs/server");
  const { userId } = await auth();
  return { userId };
}

export async function authenticatedClerkOwnerId(
  input: Readonly<{
    environment: ClerkOwnerSessionEnvironment;
    authReader?: ClerkAuthReader;
  }>,
): Promise<string | null> {
  const configuration = resolveClerkOwnerSessionConfiguration(
    input.environment,
  );
  if (configuration.status === "not_configured") return null;

  const session = await (input.authReader ?? defaultAuthReader)();
  if (session.userId === null) return null;
  if (typeof session.userId !== "string" || session.userId.trim() === "") {
    throw new Error("Clerk owner session returned an invalid user ID.");
  }
  return session.userId.trim();
}
