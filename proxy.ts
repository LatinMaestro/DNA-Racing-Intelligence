import { clerkMiddleware } from "@clerk/nextjs/server";
import {
  NextResponse,
  type NextFetchEvent,
  type NextRequest,
} from "next/server";
import {
  resolveClerkOwnerSessionConfiguration,
  type ClerkOwnerSessionConfiguration,
} from "@/lib/clerk-owner-session";
import { resolveDeploymentAccess } from "@/lib/deployment-access";

type ProxyOwnerAccessDecision = "allowed" | "sign_in_required" | "not_found";

function privateNotFound(): NextResponse {
  return new NextResponse("Not Found", {
    status: 404,
    headers: { "X-Robots-Tag": "noindex, nofollow, noarchive" },
  });
}

function configuredOwnerId(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  if (
    normalized === "" ||
    normalized.length > 512 ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

export function resolveProxyOwnerAccess(input: Readonly<{
  isAuthenticated: unknown;
  userId: unknown;
  configuredOwnerId: string | undefined;
}>): ProxyOwnerAccessDecision {
  const ownerId = configuredOwnerId(input.configuredOwnerId);
  if (ownerId === null) return "not_found";
  if (input.isAuthenticated !== true) return "sign_in_required";
  if (
    typeof input.userId !== "string" ||
    input.userId.trim() === "" ||
    input.userId.trim() !== ownerId
  ) {
    return "not_found";
  }
  return "allowed";
}

const clerkProxy = clerkMiddleware(async (auth, request) => {
  const session = await auth();
  const decision = resolveProxyOwnerAccess({
    isAuthenticated: session.isAuthenticated,
    userId: session.userId,
    configuredOwnerId: process.env.AUTHORIZED_CLERK_USER_ID,
  });
  if (decision === "sign_in_required") {
    return session.redirectToSignIn({ returnBackUrl: request.url });
  }
  if (decision === "not_found") return privateNotFound();

  const response = NextResponse.next();
  response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  return response;
});

export function proxy(request: NextRequest, event: NextFetchEvent) {
  const decision = resolveDeploymentAccess({
    vercelEnv: process.env.VERCEL_ENV,
    phase0ReviewEnabled: process.env.ENABLE_PHASE0_REVIEW,
    productionApproved: process.env.ALLOW_PRODUCTION_DEPLOYMENT,
  });

  if (!decision.allowed) return privateNotFound();

  let clerkConfiguration: ClerkOwnerSessionConfiguration;
  try {
    clerkConfiguration = resolveClerkOwnerSessionConfiguration({
      publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
      secretKey: process.env.CLERK_SECRET_KEY,
    });
  } catch {
    return privateNotFound();
  }
  if (
    clerkConfiguration.status === "not_configured" ||
    configuredOwnerId(process.env.AUTHORIZED_CLERK_USER_ID) === null
  ) {
    return privateNotFound();
  }

  return clerkProxy(request, event);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
