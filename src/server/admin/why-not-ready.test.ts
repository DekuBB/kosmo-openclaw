import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { buildWhyNotReady } from "@/server/admin/why-not-ready";
import { createDefaultMeta, type SingleMeta } from "@/shared/types";
import type { ChannelLastForward } from "@/shared/channels";

function metaFixture(): SingleMeta {
  return createDefaultMeta(1_000_000, "test-token", "test-instance");
}

function slackForward(
  overrides: Partial<ChannelLastForward> = {},
): ChannelLastForward {
  return {
    ok: true,
    status: 200,
    classification: "accepted",
    attempts: 1,
    totalMs: 50,
    transport: "public",
    sandboxUrl: "https://sb-test.vercel.run",
    sandboxId: "sb-test",
    finalReasonHead: null,
    startedAt: Date.now() - 1000,
    completedAt: Date.now() - 500,
    deliveryId: "delivery-1",
    ...overrides,
  };
}

describe("buildWhyNotReady", () => {
  test("flags slack with no credentials as not ready", async () => {
    const meta = metaFixture();
    meta.channels.slack = null;

    const report = await buildWhyNotReady(meta);

    assert.equal(report.channels.slack.ready, false);
    const kinds = report.channels.slack.blockers.map((b) => b.kind);
    assert.ok(
      kinds.includes("no_credentials"),
      `expected no_credentials blocker, got ${kinds.join(",")}`,
    );
  });

  test("slack with creds and recent ok forward is ready", async () => {
    const meta = metaFixture();
    meta.channels.slack = {
      signingSecret: "secret",
      botToken: "xoxb-test",
      configuredAt: Date.now(),
    };
    meta.channelDiagnostics = {
      slack: { lastForward: slackForward() },
    };

    const report = await buildWhyNotReady(meta);

    assert.equal(report.channels.slack.ready, true);
    assert.deepEqual(report.channels.slack.blockers, []);
  });

  test("slack lastForward sandbox-not-listening yields blocker with sandboxUrl", async () => {
    const meta = metaFixture();
    meta.channels.slack = {
      signingSecret: "secret",
      botToken: "xoxb-test",
      configuredAt: Date.now(),
    };
    meta.channelDiagnostics = {
      slack: {
        lastForward: slackForward({
          ok: false,
          status: 502,
          classification: "sandbox-not-listening",
          sandboxUrl: "https://sb-stale.vercel.run",
        }),
      },
    };

    const report = await buildWhyNotReady(meta);

    assert.equal(report.channels.slack.ready, false);
    const blocker = report.channels.slack.blockers.find(
      (b) => b.kind === "sandbox_not_listening",
    );
    assert.ok(blocker, "expected sandbox_not_listening blocker");
    assert.equal(blocker.evidence.sandboxUrl, "https://sb-stale.vercel.run");
  });
});
