import type { ChannelName } from "@/shared/channels";
import { FastPathOutcomeKind, type FastPathOutcome } from "@/server/channels/core/outcomes";
import { planWebhookAfterFastPath } from "@/server/channels/core/webhook-planner";

import { FakeChannelGateway, channelGatewayPort } from "./fake-channel-gateway";
import { FakeChannelStore, type ChannelRegressionStoreSeed } from "./fake-channel-store";
import { FakeWorkflow } from "./fake-workflow";
import {
  classifyGatewayException,
  classifyGatewayResult,
  lastForwardFromFastPath,
  notAttemptedFastPath,
  shouldInvalidateStalePort,
} from "./scenarios";

export type ChannelRegressionHarness = {
  store: FakeChannelStore;
  gateway: FakeChannelGateway;
  workflow: FakeWorkflow;
  deliverFastPath(input: {
    channel: ChannelName;
    canSendUserNotice?: boolean;
    deliveryId?: string | null;
  }): Promise<FastPathOutcome>;
  skipFastPath(input: {
    channel: ChannelName;
    reason?: Parameters<typeof notAttemptedFastPath>[0]["reason"];
    canSendUserNotice?: boolean;
  }): FastPathOutcome;
};

export function createChannelRegressionHarness(
  seed: ChannelRegressionStoreSeed = {},
): ChannelRegressionHarness {
  const store = new FakeChannelStore(seed);
  const gateway = new FakeChannelGateway();
  const workflow = new FakeWorkflow(store, gateway);

  function handlePostFastPath(
    channel: ChannelName,
    outcome: FastPathOutcome,
    canSendUserNotice = true,
  ): void {
    const plan = planWebhookAfterFastPath({
      channel,
      fastPath: outcome,
      effectiveStatus: store.meta.status,
      canSendUserNotice,
      policy: { noticeOnWorkflowStart: true },
    });
    if (plan.userNotice.kind === "send-before-workflow") {
      workflow.sendBootMessage(channel, plan.userNotice.reason);
    }
    if (plan.workflow.kind === "start") {
      workflow.start(channel, plan.workflow.reason);
    }
  }

  return {
    store,
    gateway,
    workflow,
    async deliverFastPath(input) {
      const channel = input.channel;
      const port = channelGatewayPort(channel);
      if (store.meta.status !== "running" || !store.meta.sandboxId) {
        const outcome = notAttemptedFastPath({
          status: store.meta.status,
          sandboxId: store.meta.sandboxId,
        });
        handlePostFastPath(channel, outcome, input.canSendUserNotice ?? true);
        return outcome;
      }

      const sandboxUrl = store.getPortUrl(port);
      try {
        const result = await gateway.forward(channel, sandboxUrl);
        const outcome = classifyGatewayResult({
          channel,
          result,
          sandboxId: store.meta.sandboxId,
        });
        if (outcome.kind !== FastPathOutcomeKind.NotAttempted) {
          store.setLastForward(
            channel,
            lastForwardFromFastPath({
              channel,
              outcome,
              deliveryId: input.deliveryId ?? null,
            }),
          );
        }
        if (
          shouldInvalidateStalePort(outcome) &&
          "stalePort" in outcome &&
          outcome.stalePort != null
        ) {
          store.markPortStale(
            store.meta.sandboxId,
            outcome.stalePort,
            "stalePortReason" in outcome
              ? outcome.stalePortReason ?? "fast-path-not-listening"
              : "fast-path-not-listening",
          );
        }
        handlePostFastPath(channel, outcome, input.canSendUserNotice ?? true);
        return outcome;
      } catch (error) {
        const outcome = classifyGatewayException({
          channel,
          error,
          sandboxId: store.meta.sandboxId,
          sandboxUrl,
        });
        store.setLastForward(
          channel,
          lastForwardFromFastPath({
            channel,
            outcome,
            deliveryId: input.deliveryId ?? null,
          }),
        );
        handlePostFastPath(channel, outcome, input.canSendUserNotice ?? true);
        return outcome;
      }
    },
    skipFastPath(input) {
      const outcome = notAttemptedFastPath({
        status: store.meta.status,
        sandboxId: store.meta.sandboxId,
        reason: input.reason,
      });
      handlePostFastPath(input.channel, outcome, input.canSendUserNotice ?? true);
      return outcome;
    },
  };
}
