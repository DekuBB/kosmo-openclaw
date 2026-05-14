import assert from "node:assert/strict";
import test from "node:test";

import type { ChannelName } from "@/shared/channels";
import { ForwardClassification } from "@/server/channels/core/outcomes";

import { createChannelRegressionHarness } from "@/test-utils/channel-regression/channel-regression-harness";
import { channelGatewayPort, responseOutcome, sandboxNotListeningResponse } from "@/test-utils/channel-regression/fake-channel-gateway";
import { assertLastForward, assertNoRepeatedStaleUrl, assertOnePortInvalidation } from "@/test-utils/channel-regression/assertions";

const CHANNELS: ChannelName[] = ["slack", "telegram", "whatsapp", "discord"];

for (const channel of CHANNELS) {
  test(`SP-01 ${channel}: sandbox-not-listening invalidates cached port once per fast-path request`, async () => {
    const port = channelGatewayPort(channel);
    const staleUrl = `https://dead-${port}.example.test`;
    const h = createChannelRegressionHarness({
      portUrls: { [String(port)]: staleUrl },
    });
    h.gateway.enqueueChannel(channel, sandboxNotListeningResponse());

    await h.deliverFastPath({ channel });

    assertLastForward({
      store: h.store,
      channel,
      classification: ForwardClassification.SandboxNotListening,
      ok: false,
    });
    assertOnePortInvalidation({
      store: h.store,
      port,
      reason: "fast-path-not-listening",
    });
  });
}

for (const channel of CHANNELS) {
  test(`SP-02 ${channel}: workflow forwarding refreshes after stale URL and does not hammer the same URL`, async () => {
    const port = channelGatewayPort(channel);
    const staleUrl = `https://dead-${port}-${channel}.example.test`;
    const h = createChannelRegressionHarness({
      portUrls: { [String(port)]: staleUrl },
    });
    h.gateway.enqueueChannel(
      channel,
      sandboxNotListeningResponse(),
      responseOutcome(200, "accepted"),
    );

    await h.workflow.forwardWithRetry({ channel, maxAttempts: 2 });

    assertOnePortInvalidation({
      store: h.store,
      port,
      reason: "sandbox-not-listening",
    });
    assertNoRepeatedStaleUrl({
      urls: h.gateway.requestsFor(channel).map((request) => request.sandboxUrl),
      staleUrl,
    });
    assert.equal(h.store.meta.channelDiagnostics?.[channel]?.lastForward?.classification, "accepted");
    assert.equal(h.store.meta.channelDiagnostics?.[channel]?.lastForward?.attempts, 2);
  });
}

for (const channel of CHANNELS) {
  test(`SP-03 ${channel}: repeated sandbox-not-listening invalidates only once per workflow request`, async () => {
    const port = channelGatewayPort(channel);
    const h = createChannelRegressionHarness({
      portUrls: { [String(port)]: `https://dead-${port}-${channel}.example.test` },
    });
    h.gateway.enqueueChannel(
      channel,
      sandboxNotListeningResponse(),
      sandboxNotListeningResponse(),
      sandboxNotListeningResponse(),
    );

    await h.workflow.forwardWithRetry({ channel, maxAttempts: 3 });

    assertOnePortInvalidation({
      store: h.store,
      port,
      reason: "sandbox-not-listening",
    });
  });
}
