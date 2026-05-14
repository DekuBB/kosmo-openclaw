import assert from "node:assert/strict";
import test from "node:test";

import { _setAiGatewayTokenOverrideForTesting } from "@/server/env";
import { withHarness } from "@/test-utils/harness";
import {
  buildAuthPostRequest,
  callRoute,
  getSlackAppRoute,
} from "@/test-utils/route-caller";

type SlackManifestCall = {
  manifest: Record<string, unknown>;
};

function installSlackManifestFetch(): {
  calls: SlackManifestCall[];
  restore: () => void;
} {
  const originalFetch = globalThis.fetch;
  const calls: SlackManifestCall[] = [];

  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.body;
    assert.ok(body instanceof URLSearchParams, "Slack manifest call must use form body");
    const manifestJson = body.get("manifest");
    assert.ok(manifestJson, "Slack manifest call must include manifest");
    calls.push({ manifest: JSON.parse(manifestJson) as Record<string, unknown> });

    return Response.json({
      ok: true,
      app_id: "A123",
      credentials: {
        client_id: "client-id",
        client_secret: "client-secret",
        signing_secret: "signing-secret",
        verification_token: "verification-token",
      },
      oauth_authorize_url: "https://slack.com/oauth/v2/authorize?client_id=client-id",
    });
  }) as typeof fetch;

  return {
    calls,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

test("POST /api/channels/slack/app blocks on connectability before calling Slack", async () => {
  await withHarness(async () => {
    _setAiGatewayTokenOverrideForTesting("oidc-token");
    delete process.env.NEXT_PUBLIC_APP_URL;

    const fake = installSlackManifestFetch();
    try {
      const route = getSlackAppRoute();
      const result = await callRoute(
        route.POST!,
        buildAuthPostRequest(
          "/api/channels/slack/app",
          JSON.stringify({ configToken: "xoxe-valid-config-token" }),
        ),
      );

      assert.equal(result.status, 409);
      const body = result.json as {
        error: { code: string };
        connectability: { channel: string; canConnect: boolean };
      };
      assert.equal(body.error.code, "CHANNEL_CONNECT_BLOCKED");
      assert.equal(body.connectability.channel, "slack");
      assert.equal(body.connectability.canConnect, false);
      assert.equal(fake.calls.length, 0, "blocked setup must not call Slack");
    } finally {
      fake.restore();
      _setAiGatewayTokenOverrideForTesting(null);
    }
  });
});



test("POST /api/channels/slack/app forwards distinct app and bot names into manifest", async () => {
  await withHarness(async () => {
    _setAiGatewayTokenOverrideForTesting("oidc-token");
    process.env.NEXT_PUBLIC_APP_URL = "https://openclaw.example.com";

    const fake = installSlackManifestFetch();
    try {
      const route = getSlackAppRoute();
      const result = await callRoute(
        route.POST!,
        buildAuthPostRequest(
          "/api/channels/slack/app",
          JSON.stringify({
            configToken: "xoxe-valid-config-token",
            appName: "OpenClaw Support",
            botName: "support-bot",
          }),
          {
            host: "openclaw.example.com",
            "x-forwarded-host": "openclaw.example.com",
            "x-forwarded-proto": "https",
          },
        ),
      );

      assert.equal(result.status, 200);
      assert.equal(fake.calls.length, 1);
      const manifest = fake.calls[0].manifest as {
        display_information: { name: string };
        features: { bot_user: { display_name: string } };
      };
      assert.equal(manifest.display_information.name, "OpenClaw Support");
      assert.equal(manifest.features.bot_user.display_name, "support-bot");
    } finally {
      fake.restore();
      _setAiGatewayTokenOverrideForTesting(null);
      delete process.env.NEXT_PUBLIC_APP_URL;
    }
  });
});

test("POST /api/channels/slack/app sends bypass-capable registration URL only to Slack", async () => {
  await withHarness(async () => {
    _setAiGatewayTokenOverrideForTesting("oidc-token");
    process.env.NEXT_PUBLIC_APP_URL = "https://openclaw.example.com";
    process.env.VERCEL_AUTOMATION_BYPASS_SECRET = "super-secret-bypass";

    const fake = installSlackManifestFetch();
    try {
      const route = getSlackAppRoute();
      const result = await callRoute(
        route.POST!,
        buildAuthPostRequest(
          "/api/channels/slack/app",
          JSON.stringify({ configToken: "xoxe-valid-config-token" }),
          {
            host: "openclaw.example.com",
            "x-forwarded-host": "openclaw.example.com",
            "x-forwarded-proto": "https",
          },
        ),
      );

      assert.equal(result.status, 200);
      assert.ok(
        !result.text.includes("super-secret-bypass"),
        "Slack app setup response must not expose the bypass secret",
      );
      assert.equal(fake.calls.length, 1);

      const settings = fake.calls[0].manifest.settings as {
        event_subscriptions: { request_url: string };
      };
      assert.equal(
        settings.event_subscriptions.request_url,
        "https://openclaw.example.com/api/channels/slack/webhook?x-vercel-protection-bypass=super-secret-bypass",
      );
    } finally {
      fake.restore();
      _setAiGatewayTokenOverrideForTesting(null);
      delete process.env.NEXT_PUBLIC_APP_URL;
      delete process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    }
  });
});
