import assert from "node:assert/strict";
import test from "node:test";

import type { ChannelName } from "@/shared/channels";
import { FastPathSkipReason, ForwardClassification } from "@/server/channels/core/outcomes";

import { createChannelRegressionHarness } from "@/test-utils/channel-regression/channel-regression-harness";
import { responseOutcome } from "@/test-utils/channel-regression/fake-channel-gateway";
import { assertLastForward, assertNoUserVisibleDelivery, assertStructuredSkip } from "@/test-utils/channel-regression/assertions";

async function runWakeSequence(channel: ChannelName, initialStatus: "snapshotting" | "suspended") {
  const h = createChannelRegressionHarness({ status: initialStatus as never });

  const skip = h.skipFastPath({ channel });
  h.workflow.resume(channel);
  h.gateway.enqueueChannel(
    channel,
    responseOutcome(404, "Handler not registered yet"),
    responseOutcome(200, "accepted"),
  );
  await h.workflow.forwardWithRetry({ channel, maxAttempts: 2 });

  return { h, skip };
}

test("WK-01 Slack wake from snapshotting skips fast path, sends boot message, starts workflow", async () => {
  const { h, skip } = await runWakeSequence("slack", "snapshotting");

  assertStructuredSkip(skip, FastPathSkipReason.SandboxStatusNotRunning);
  assert.equal(h.workflow.events.some((event) => event.type === "boot-message"), true);
  assert.equal(h.workflow.events.some((event) => event.type === "workflow-started"), true);
  assert.equal(h.workflow.events.some((event) => event.type === "sandbox-resume" && event.resume), true);
});

test("WK-02 Telegram wake from suspended resumes only on wake path", async () => {
  const { h, skip } = await runWakeSequence("telegram", "suspended");

  assertStructuredSkip(skip, FastPathSkipReason.SandboxStatusNotRunning);
  assert.equal(h.workflow.events.some((event) => event.type === "sandbox-resume" && event.channel === "telegram"), true);
});

for (const channel of ["slack", "telegram"] as const) {
  test(`WK-03 ${channel}: first 404 is not delivered, second 200 records accepted attempts=2`, async () => {
    const { h } = await runWakeSequence(channel, "snapshotting");
    const attempts = h.workflow.events.filter((event) => event.type === "forward-attempt");

    assert.deepEqual(
      attempts.map((event) => [event.status, event.classification]),
      [
        [404, "handler-not-ready"],
        [200, "accepted"],
      ],
    );
    assertLastForward({
      store: h.store,
      channel,
      classification: ForwardClassification.Accepted,
      ok: true,
      attempts: 2,
      userVisibleReplyStatus: "unknown",
    });
    assertNoUserVisibleDelivery({ store: h.store, channel });
  });
}

