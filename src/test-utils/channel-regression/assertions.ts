import assert from "node:assert/strict";

import type { ChannelName } from "@/shared/channels";
import { FastPathOutcomeKind, type FastPathOutcome } from "@/server/channels/core/outcomes";

import type { FakeChannelStore } from "./fake-channel-store";

export function assertLastForward(input: {
  store: FakeChannelStore;
  channel: ChannelName;
  classification: string;
  ok: boolean;
  attempts?: number;
  userVisibleReplyStatus?: "unknown" | "observed" | "timed-out";
}): void {
  const lastForward = input.store.meta.channelDiagnostics?.[input.channel]?.lastForward;
  assert.ok(lastForward, `${input.channel} should record lastForward`);
  assert.equal(lastForward.classification, input.classification);
  assert.equal(lastForward.ok, input.ok);
  if (input.attempts !== undefined) {
    assert.equal(lastForward.attempts, input.attempts);
  }
  if (input.userVisibleReplyStatus !== undefined) {
    assert.equal(lastForward.userVisibleReply.status, input.userVisibleReplyStatus);
  }
}

export function assertNoUserVisibleDelivery(input: {
  store: FakeChannelStore;
  channel: ChannelName;
}): void {
  const lastForward = input.store.meta.channelDiagnostics?.[input.channel]?.lastForward;
  assert.ok(lastForward, `${input.channel} should record lastForward`);
  assert.notEqual(lastForward.userVisibleReply.status, "observed");
}

export function assertStructuredSkip(outcome: FastPathOutcome, expectedReason: string): void {
  assert.equal(outcome.kind, FastPathOutcomeKind.NotAttempted);
  assert.equal(outcome.reason, expectedReason);
}

export function assertOnePortInvalidation(input: {
  store: FakeChannelStore;
  port: number;
  reason?: string;
}): void {
  const calls = input.store.stalePortCalls.filter((call) => call.port === input.port);
  assert.equal(calls.length, 1, `port ${input.port} should be invalidated exactly once`);
  if (input.reason) {
    assert.equal(calls[0].reason, input.reason);
  }
}

export function assertNoRepeatedStaleUrl(input: {
  urls: string[];
  staleUrl: string;
}): void {
  const staleHits = input.urls.filter((url) => url === input.staleUrl);
  assert.equal(staleHits.length, 1, `stale URL ${input.staleUrl} should be used once`);
}

export function assertSlackRouteReadiness(input: {
  rootStatus: number;
  routeStatus: number;
  expectedRouteReady: boolean;
}): void {
  const routeReady = [400, 401, 403].includes(input.routeStatus);
  assert.equal(input.rootStatus, 200, "gateway root should be independently ready");
  assert.equal(routeReady, input.expectedRouteReady);
}

export function assertTelegramNativeReadiness(input: {
  webhookAccepted: boolean;
  rootStatus: number;
  nativeStatus: number;
  expectedNativeReady: boolean;
}): void {
  const nativeReady = [200, 401, 403].includes(input.nativeStatus);
  assert.equal(input.webhookAccepted, true, "host webhook acceptance is independent");
  assert.equal(input.rootStatus, 200, "gateway root should be independently ready");
  assert.equal(nativeReady, input.expectedNativeReady);
}

