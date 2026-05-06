import assert from "node:assert/strict";
import test from "node:test";

import { buildPublicUrl, buildPublicDisplayUrl, getPublicOrigin } from "@/server/public-url";

function withEnv<T>(
  patch: Record<string, string | undefined>,
  fn: () => T,
): T {
  const previous = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(patch)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("getPublicOrigin uses request headers when no override is set", () => {
  withEnv(
    {
      NEXT_PUBLIC_APP_URL: undefined,
      NEXT_PUBLIC_BASE_DOMAIN: undefined,
      BASE_DOMAIN: undefined,
      VERCEL_PROJECT_PRODUCTION_URL: undefined,
      VERCEL_BRANCH_URL: undefined,
      VERCEL_URL: undefined,
    },
    () => {
      const request = new Request("https://ignored.example/admin", {
        headers: {
          host: "openclaw.example.com",
          "x-forwarded-proto": "https",
        },
      });

      assert.equal(getPublicOrigin(request), "https://openclaw.example.com");
    },
  );
});

test("getPublicOrigin prefers NEXT_PUBLIC_APP_URL over request headers", () => {
  withEnv(
    {
      NEXT_PUBLIC_APP_URL: "https://custom.example.com",
      NEXT_PUBLIC_BASE_DOMAIN: undefined,
      BASE_DOMAIN: undefined,
    },
    () => {
      const request = new Request("https://ignored.example/admin", {
        headers: { host: "other.example.com" },
      });

      assert.equal(getPublicOrigin(request), "https://custom.example.com");
    },
  );
});

test("getPublicOrigin falls back to VERCEL_URL", () => {
  withEnv(
    {
      NEXT_PUBLIC_APP_URL: undefined,
      NEXT_PUBLIC_BASE_DOMAIN: undefined,
      BASE_DOMAIN: undefined,
      VERCEL_PROJECT_PRODUCTION_URL: undefined,
      VERCEL_BRANCH_URL: undefined,
      VERCEL_URL: "my-app-abc123.vercel.app",
    },
    () => {
      assert.equal(getPublicOrigin(), "https://my-app-abc123.vercel.app");
    },
  );
});

test("getPublicOrigin throws when no env vars and no request", () => {
  withEnv(
    {
      NEXT_PUBLIC_APP_URL: undefined,
      NEXT_PUBLIC_BASE_DOMAIN: undefined,
      BASE_DOMAIN: undefined,
      VERCEL_PROJECT_PRODUCTION_URL: undefined,
      VERCEL_BRANCH_URL: undefined,
      VERCEL_URL: undefined,
    },
    () => {
      assert.throws(() => getPublicOrigin(), /Unable to determine public origin/);
    },
  );
});

test("getPublicOrigin handles bare hostname in BASE_DOMAIN", () => {
  withEnv(
    {
      NEXT_PUBLIC_APP_URL: undefined,
      NEXT_PUBLIC_BASE_DOMAIN: undefined,
      BASE_DOMAIN: "myapp.example.com",
    },
    () => {
      assert.equal(getPublicOrigin(), "https://myapp.example.com");
    },
  );
});

test("buildPublicUrl appends protection bypass secret in admin-secret mode", () => {
  withEnv(
    {
      VERCEL_AUTH_MODE: "admin-secret",
      VERCEL_AUTOMATION_BYPASS_SECRET: "bypass-secret",
      NEXT_PUBLIC_APP_URL: "https://openclaw.example.com",
    },
    () => {
      assert.equal(
        buildPublicUrl("/api/channels/slack/webhook"),
        "https://openclaw.example.com/api/channels/slack/webhook?x-vercel-protection-bypass=bypass-secret",
      );
    },
  );
});

test("buildPublicUrl includes bypass secret in sign-in-with-vercel mode when secret is set", () => {
  withEnv(
    {
      VERCEL_AUTH_MODE: "sign-in-with-vercel",
      VERCEL_AUTOMATION_BYPASS_SECRET: "bypass-secret",
      NEXT_PUBLIC_APP_URL: "https://openclaw.example.com",
    },
    () => {
      assert.equal(
        buildPublicUrl("/api/channels/telegram/webhook"),
        "https://openclaw.example.com/api/channels/telegram/webhook?x-vercel-protection-bypass=bypass-secret",
      );
    },
  );
});

test("buildPublicUrl does not append bypass when secret is missing", () => {
  withEnv(
    {
      VERCEL_AUTH_MODE: "admin-secret",
      VERCEL_AUTOMATION_BYPASS_SECRET: undefined,
      NEXT_PUBLIC_APP_URL: "https://openclaw.example.com",
    },
    () => {
      assert.equal(
        buildPublicUrl("/api/channels/discord/webhook"),
        "https://openclaw.example.com/api/channels/discord/webhook",
      );
    },
  );
});

test("getPublicOrigin falls back to VERCEL_PROJECT_PRODUCTION_URL", () => {
  withEnv(
    {
      NEXT_PUBLIC_APP_URL: undefined,
      NEXT_PUBLIC_BASE_DOMAIN: undefined,
      BASE_DOMAIN: undefined,
      VERCEL_PROJECT_PRODUCTION_URL: "prod.example.com",
      VERCEL_BRANCH_URL: "branch.example.com",
      VERCEL_URL: "random.example.com",
    },
    () => {
      assert.equal(getPublicOrigin(), "https://prod.example.com");
    },
  );
});

test("getPublicOrigin pins to VERCEL_PROJECT_PRODUCTION_URL over request host on Vercel", () => {
  // Regression: with multiple Vercel aliases the install request can land on
  // the deployment-hash host while the OAuth callback lands on the project
  // alias. Cookies set on host A aren't sent to host B → `state_mismatch`.
  // When no explicit origin is configured and we are on Vercel, prefer the
  // canonical project production URL so both OAuth legs share an origin.
  withEnv(
    {
      NEXT_PUBLIC_APP_URL: undefined,
      NEXT_PUBLIC_BASE_DOMAIN: undefined,
      BASE_DOMAIN: undefined,
      VERCEL: "1",
      VERCEL_PROJECT_PRODUCTION_URL:
        "vercel-openclaw-35.playground-vercel.tools",
      VERCEL_BRANCH_URL: undefined,
      VERCEL_URL: undefined,
    },
    () => {
      const request = new Request("https://ignored.example/api/install", {
        headers: {
          host: "vercel-openclaw-35-nefh7fjzh.playground-vercel.tools",
          "x-forwarded-host":
            "vercel-openclaw-35-nefh7fjzh.playground-vercel.tools",
          "x-forwarded-proto": "https",
        },
      });

      assert.equal(
        getPublicOrigin(request),
        "https://vercel-openclaw-35.playground-vercel.tools",
      );
    },
  );
});

test("getPublicOrigin still uses request host when not on Vercel", () => {
  withEnv(
    {
      NEXT_PUBLIC_APP_URL: undefined,
      NEXT_PUBLIC_BASE_DOMAIN: undefined,
      BASE_DOMAIN: undefined,
      VERCEL: undefined,
      VERCEL_PROJECT_PRODUCTION_URL: undefined,
      VERCEL_BRANCH_URL: undefined,
      VERCEL_URL: undefined,
    },
    () => {
      const request = new Request("https://ignored.example/admin", {
        headers: {
          "x-forwarded-host": "preview.example.com",
          "x-forwarded-proto": "https",
        },
      });

      assert.equal(getPublicOrigin(request), "https://preview.example.com");
    },
  );
});

test("getPublicOrigin falls back to x-forwarded-host header", () => {
  withEnv(
    {
      NEXT_PUBLIC_APP_URL: undefined,
      NEXT_PUBLIC_BASE_DOMAIN: undefined,
      BASE_DOMAIN: undefined,
      VERCEL_PROJECT_PRODUCTION_URL: undefined,
      VERCEL_BRANCH_URL: undefined,
      VERCEL_URL: undefined,
    },
    () => {
      const request = new Request("https://ignored.example.com/admin", {
        headers: {
          "x-forwarded-host": "preview.example.com",
          "x-forwarded-proto": "https",
        },
      });

      assert.equal(getPublicOrigin(request), "https://preview.example.com");
    },
  );
});

// ---------------------------------------------------------------------------
// buildPublicDisplayUrl — never exposes bypass secret
// ---------------------------------------------------------------------------

test("buildPublicDisplayUrl omits bypass secret even when configured", () => {
  withEnv(
    {
      VERCEL_AUTH_MODE: "admin-secret",
      VERCEL_AUTOMATION_BYPASS_SECRET: "bypass-secret",
      NEXT_PUBLIC_APP_URL: "https://openclaw.example.com",
    },
    () => {
      const url = buildPublicDisplayUrl("/api/channels/slack/webhook");
      assert.equal(
        url,
        "https://openclaw.example.com/api/channels/slack/webhook",
      );
      assert.ok(
        !url.includes("bypass-secret"),
        "display URL must not contain the bypass secret",
      );
    },
  );
});

test("buildPublicDisplayUrl returns same origin as buildPublicUrl", () => {
  withEnv(
    {
      VERCEL_AUTOMATION_BYPASS_SECRET: "bypass-secret",
      NEXT_PUBLIC_APP_URL: "https://openclaw.example.com",
    },
    () => {
      const display = buildPublicDisplayUrl("/api/channels/slack/webhook");
      const delivery = buildPublicUrl("/api/channels/slack/webhook");
      const displayOrigin = new URL(display).origin;
      const deliveryOrigin = new URL(delivery).origin;
      assert.equal(displayOrigin, deliveryOrigin);
    },
  );
});

test("buildPublicDisplayUrl works when no bypass secret is set", () => {
  withEnv(
    {
      VERCEL_AUTOMATION_BYPASS_SECRET: undefined,
      NEXT_PUBLIC_APP_URL: "https://openclaw.example.com",
    },
    () => {
      assert.equal(
        buildPublicDisplayUrl("/api/channels/discord/webhook"),
        "https://openclaw.example.com/api/channels/discord/webhook",
      );
    },
  );
});
