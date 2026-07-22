import { NextResponse } from "next/server";
import { resolveDeploymentAccess } from "@/lib/deployment-access";

export function proxy() {
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

  const response = NextResponse.next();
  response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
