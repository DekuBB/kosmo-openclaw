import { authJsonError, authJsonOk, requireJsonRouteAuth } from "@/server/auth/route-auth";
import { buildSlackManifest } from "@/server/channels/slack/app-definition";
import { getProjectIdentity } from "@/server/channels/slack/project-identity";
import { buildPublicDisplayUrl } from "@/server/public-url";

export async function GET(request: Request): Promise<Response> {
  const auth = await requireJsonRouteAuth(request);
  if (auth instanceof Response) {
    return auth;
  }

  try {
    // This route returns operator-visible JSON. Keep it display-safe; the
    // server-side Slack app creation path uses the bypass-capable registration
    // URL when it calls Slack directly.
    const webhookUrl = buildPublicDisplayUrl("/api/channels/slack/webhook", request);
    const identity = getProjectIdentity();
    const manifest = buildSlackManifest({ webhookUrl, identity });
    const manifestJson = JSON.stringify(manifest);
    const createAppUrl =
      `https://api.slack.com/apps?new_app=1&manifest_json=${encodeURIComponent(manifestJson)}`;

    return authJsonOk(
      {
        manifest,
        createAppUrl,
      },
      auth,
    );
  } catch (error) {
    return authJsonError(error, auth);
  }
}
