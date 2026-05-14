import type { ChannelLastForwardInput, ChannelName } from "@/shared/channels";
import {
  FastPathFallbackReason,
  FastPathOutcomeKind,
  FastPathSkipReason,
  ForwardClassification,
  type FastPathOutcome,
} from "@/server/channels/core/outcomes";
import { classifyFastPathException, classifyFastPathHttpResult } from "@/server/channels/core/fast-path-classifier";

import { channelGatewayPort, type FakeGatewayResult } from "./fake-channel-gateway";

export function defaultDeliveryId(channel: ChannelName): string {
  return `${channel}:regression-delivery`;
}

export function notAttemptedFastPath(input: {
  status: string;
  sandboxId: string | null;
  reason?: FastPathSkipReason;
}): FastPathOutcome {
  return {
    kind: FastPathOutcomeKind.NotAttempted,
    reason: input.reason ??
      (input.status === "running"
        ? FastPathSkipReason.MissingSandboxId
        : FastPathSkipReason.SandboxStatusNotRunning),
    initialStatus: input.status,
    sandboxId: input.sandboxId,
  };
}

export function classifyGatewayResult(input: {
  channel: ChannelName;
  result: FakeGatewayResult;
  sandboxId: string | null;
}): FastPathOutcome {
  return classifyFastPathHttpResult({
    policy: {
      channel: input.channel,
      nativeResponsePolicy:
        input.channel === "whatsapp"
          ? "gateway-errors-start-workflow-non-gateway-handled"
          : "non-ok-starts-workflow",
      classifySuspiciousEmpty200: input.channel === "telegram",
      stalePortOnSandboxNotListening: channelGatewayPort(input.channel),
    },
    status: input.result.status,
    ok: input.result.ok,
    bodyHead: input.result.bodyHead,
    bodyLength: input.result.bodyLength,
    durationMs: input.result.durationMs,
    transport: "public",
    sandboxUrl: input.result.request.sandboxUrl,
    sandboxId: input.sandboxId,
  });
}

export function classifyGatewayException(input: {
  channel: ChannelName;
  error: unknown;
  sandboxId: string | null;
  sandboxUrl: string | null;
  durationMs?: number;
}): Extract<FastPathOutcome, { kind: "fallback-to-workflow" }> {
  return classifyFastPathException({
    policy: {
      channel: input.channel,
      nativeResponsePolicy: "non-ok-starts-workflow",
      stalePortOnSandboxNotListening: channelGatewayPort(input.channel),
    },
    error: input.error,
    durationMs: input.durationMs ?? 1_000,
    transport: "public",
    sandboxUrl: input.sandboxUrl,
    sandboxId: input.sandboxId,
  });
}

export function lastForwardFromFastPath(input: {
  channel: ChannelName;
  outcome: Exclude<FastPathOutcome, { kind: "not-attempted" }>;
  deliveryId?: string | null;
  startedAt?: number;
  attempts?: number;
}): ChannelLastForwardInput {
  const completedAt = Date.now();
  const startedAt = input.startedAt ?? completedAt - input.outcome.durationMs;
  return {
    ok: input.outcome.classification === ForwardClassification.Accepted,
    status: input.outcome.status,
    classification: input.outcome.classification,
    attempts: input.attempts ?? 1,
    totalMs: Math.max(0, completedAt - startedAt),
    transport: input.outcome.transport,
    sandboxUrl: input.outcome.sandboxUrl,
    sandboxId: input.outcome.sandboxId,
    finalReasonHead: input.outcome.bodyHead,
    startedAt,
    completedAt,
    deliveryId: input.deliveryId ?? defaultDeliveryId(input.channel),
  };
}

export function shouldInvalidateStalePort(outcome: FastPathOutcome): boolean {
  return (
    outcome.kind === FastPathOutcomeKind.FallbackToWorkflow &&
    outcome.reason === FastPathFallbackReason.SandboxNotListening &&
    outcome.stalePort !== null &&
    outcome.stalePort !== undefined
  );
}

