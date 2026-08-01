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

const clerkProxy = clerkMiddleware(() => {
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

  if (!decision.allowed) {
    return new NextResponse("Not Found", {
      status: 404,
      headers: { "X-Robots-Tag": "noindex, nofollow, noarchive" },
    });
  }

  let clerkConfiguration: ClerkOwnerSessionConfiguration;
  try {
    clerkConfiguration = resolveClerkOwnerSessionConfiguration({
      publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
      secretKey: process.env.CLERK_SECRET_KEY,
    });
  } catch {
    return new NextResponse("Not Found", {
      status: 404,
      headers: { "X-Robots-Tag": "noindex, nofollow, noarchive" },
    });
  }
  if (clerkConfiguration.status === "not_configured") {
    return new NextResponse("Not Found", {
      status: 404,
      headers: { "X-Robots-Tag": "noindex, nofollow, noarchive" },
    });
  }

  return clerkProxy(request, event);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
