import { requireJsonRouteAuth } from "@/server/auth/route-auth";
import { buildWhyNotReady } from "@/server/admin/why-not-ready";
import { logError } from "@/server/log";
import { jsonError } from "@/shared/http";

export async function GET(request: Request): Promise<Response> {
  const auth = await requireJsonRouteAuth(request);
  if (auth instanceof Response) {
    return auth;
  }

  try {
    const report = await buildWhyNotReady();
    const response = Response.json(report);
    if (auth.setCookieHeader) {
      response.headers.append("Set-Cookie", auth.setCookieHeader);
    }
    return response;
  } catch (error) {
    logError("admin.why_not_ready_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError(error);
  }
}
