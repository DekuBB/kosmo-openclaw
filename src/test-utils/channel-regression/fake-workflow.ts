import type { ChannelName } from "@/shared/channels";
import { ForwardClassification } from "@/server/channels/core/outcomes";

import type { FakeChannelGateway } from "./fake-channel-gateway";
import { channelGatewayPort } from "./fake-channel-gateway";
import type { FakeChannelStore } from "./fake-channel-store";
import { lastForwardFromFastPath, classifyGatewayResult } from "./scenarios";

export type FakeWorkflowEvent =
  | { type: "boot-message"; channel: ChannelName; reason: string }
  | { type: "workflow-started"; channel: ChannelName; reason: string }
  | { type: "sandbox-resume"; channel: ChannelName; resume: true }
  | { type: "forward-attempt"; channel: ChannelName; attempt: number; status: number; classification: string };

export class FakeWorkflow {
  readonly events: FakeWorkflowEvent[] = [];

  constructor(
    private readonly store: FakeChannelStore,
    private readonly gateway: FakeChannelGateway,
  ) {}

  sendBootMessage(channel: ChannelName, reason: string): void {
    this.events.push({ type: "boot-message", channel, reason });
  }

  start(channel: ChannelName, reason: string): void {
    this.events.push({ type: "workflow-started", channel, reason });
  }

  resume(channel: ChannelName): void {
    this.events.push({ type: "sandbox-resume", channel, resume: true });
    this.store.mutate((meta) => {
      meta.status = "running";
      meta.sandboxId = meta.sandboxId ?? "sbx-channel-regression";
    });
  }

  async forwardWithRetry(input: {
    channel: ChannelName;
    maxAttempts?: number;
    deliveryId?: string | null;
  }): Promise<void> {
    const maxAttempts = input.maxAttempts ?? 20;
    const startedAt = Date.now();
    let finalOutcome: ReturnType<typeof classifyGatewayResult> | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const port = channelGatewayPort(input.channel);
      const sandboxUrl = this.store.getPortUrl(port);
      const result = await this.gateway.forward(input.channel, sandboxUrl);
      const outcome = classifyGatewayResult({
        channel: input.channel,
        result,
        sandboxId: this.store.meta.sandboxId,
      });
      finalOutcome = outcome;
      const classification = "classification" in outcome
        ? outcome.classification
        : "not-attempted";
      this.events.push({
        type: "forward-attempt",
        channel: input.channel,
        attempt,
        status: result.status,
        classification,
      });

      if (
        outcome.kind === "fallback-to-workflow" &&
        outcome.classification === ForwardClassification.SandboxNotListening &&
        outcome.stalePort != null &&
        attempt === 1
      ) {
        this.store.markPortStale(
          this.store.meta.sandboxId,
          outcome.stalePort,
          "sandbox-not-listening",
        );
      }

      if (outcome.kind === "accepted") {
        this.store.setLastForward(
          input.channel,
          lastForwardFromFastPath({
            channel: input.channel,
            outcome,
            attempts: attempt,
            startedAt,
            deliveryId: input.deliveryId ?? null,
          }),
        );
        return;
      }
    }

    if (finalOutcome && finalOutcome.kind !== "not-attempted") {
      this.store.setLastForward(
        input.channel,
        lastForwardFromFastPath({
          channel: input.channel,
          outcome: finalOutcome,
          attempts: maxAttempts,
          startedAt,
          deliveryId: input.deliveryId ?? null,
        }),
      );
    }
  }
}
