import assert from "node:assert/strict";
import test from "node:test";

import { ForwardClassification } from "@/server/channels/core/outcomes";

import { createChannelRegressionHarness } from "@/test-utils/channel-regression/channel-regression-harness";
import { responseOutcome } from "@/test-utils/channel-regression/fake-channel-gateway";
import { assertLastForward, assertSlackRouteReadiness, assertTelegramNativeReadiness } from "@/test-utils/channel-regression/assertions";

test("SL-01 Slack readiness: root 200 plus /slack/events 404 is not route-ready", async () => {
  const h = createChannelRegressionHarness();
  h.gateway.enqueue("root", responseOutcome(200, "openclaw root"));
  h.gateway.enqueueChannel("slack", responseOutcome(404, "Handler not registered yet"));

  const root = await h.gateway.probeRoot("https://sandbox-3000.example.test");
  const route = await h.gateway.forward("slack", "https://sandbox-3000.example.test");

  assertSlackRouteReadiness({
    rootStatus: root.status,
    routeStatus: route.status,
    expectedRouteReady: false,
  });
});

for (const status of [400, 401, 403]) {
  test(`SL readiness: /slack/events ${status} is route-ready but not delivered`, async () => {
    const h = createChannelRegressionHarness();
    h.gateway.enqueue("root", responseOutcome(200, "openclaw root"));
    h.gateway.enqueueChannel("slack", responseOutcome(status, "signature required"));

    const root = await h.gateway.probeRoot("https://sandbox-3000.example.test");
    const route = await h.gateway.forward("slack", "https://sandbox-3000.example.test");

    assertSlackRouteReadiness({
      rootStatus: root.status,
      routeStatus: route.status,
      expectedRouteReady: true,
    });
    assert.notEqual(route.ok, true, "route readiness is not user-visible delivery");
  });
}

test("GW-02 Slack delivery: route 404 after config sync records handler-not-ready and no delivery-ready flip", async () => {
  const h = createChannelRegressionHarness();
  h.store.configureChannel("slack");
  h.store.mutate((meta) => {
    if (meta.channels.slack) {
      meta.channels.slack.liveConfigSync = {
        outcome: "applied",
        reason: "config_written_and_restarted",
        liveConfigFresh: true,
        checkedAt: Date.now(),
      };
    }
  });
  h.gateway.enqueueChannel("slack", responseOutcome(404, "Handler not registered yet"));

  await h.deliverFastPath({ channel: "slack" });

  assertLastForward({
    store: h.store,
    channel: "slack",
    classification: ForwardClassification.HandlerNotReady,
    ok: false,
    userVisibleReplyStatus: "unknown",
  });
});

test("TG-01 Telegram readiness: webhook accepted and root 200 are insufficient while 8787 route is 404", async () => {
  assertTelegramNativeReadiness({
    webhookAccepted: true,
    rootStatus: 200,
    nativeStatus: 404,
    expectedNativeReady: false,
  });
});

for (const nativeStatus of [200, 401, 403]) {
  test(`TG-02 Telegram readiness: native 8787 status ${nativeStatus} is native-ready`, () => {
    assertTelegramNativeReadiness({
      webhookAccepted: true,
      rootStatus: 200,
      nativeStatus,
      expectedNativeReady: true,
    });
  });
}

test("TG-03 Telegram workflow delivery: first 8787 404 is not delivered, second 200 records accepted", async () => {
  const h = createChannelRegressionHarness();
  h.gateway.enqueueChannel(
    "telegram",
    responseOutcome(404, "Handler not registered yet"),
    responseOutcome(200, "accepted"),
  );

  await h.workflow.forwardWithRetry({ channel: "telegram", maxAttempts: 2 });

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
    channel: "telegram",
    classification: ForwardClassification.Accepted,
    ok: true,
    attempts: 2,
    userVisibleReplyStatus: "unknown",
  });
});

