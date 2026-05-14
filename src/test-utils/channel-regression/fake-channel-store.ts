import {
  normalizeChannelLastForward,
  type ChannelLastForwardInput,
  type ChannelName,
} from "@/shared/channels";
import type { ChannelDeliverySnapshot } from "@/shared/channel-delivery";
import type { SingleMeta, SingleStatus } from "@/shared/types";
import { createDefaultMeta } from "@/shared/types";

export type ChannelRegressionStoreSeed = {
  now?: number;
  status?: SingleStatus;
  sandboxId?: string | null;
  portUrls?: Record<string, string> | null;
};

export class FakeChannelStore {
  meta: SingleMeta;
  readonly stalePortCalls: Array<{
    sandboxId: string | null;
    port: number;
    reason: string;
    previousUrl: string | null;
  }> = [];

  constructor(seed: ChannelRegressionStoreSeed = {}) {
    const now = seed.now ?? Date.now();
    this.meta = createDefaultMeta(now, "test-gateway-token");
    this.meta.status = seed.status ?? "running";
    this.meta.sandboxId = seed.sandboxId ?? "sbx-channel-regression";
    this.meta.portUrls = seed.portUrls ?? {
      "3000": "https://stale-3000.example.test",
      "8787": "https://stale-8787.example.test",
    };
  }

  getMeta(): SingleMeta {
    return structuredClone(this.meta) as SingleMeta;
  }

  mutate(mutator: (meta: SingleMeta) => void): SingleMeta {
    mutator(this.meta);
    this.meta.updatedAt = Date.now();
    return this.getMeta();
  }

  configureChannel(channel: ChannelName): void {
    const now = Date.now();
    this.mutate((meta) => {
      if (channel === "slack") {
        meta.channels.slack = {
          signingSecret: "test-slack-signing-secret",
          botToken: "xoxb-test",
          configuredAt: now,
        };
      } else if (channel === "telegram") {
        meta.channels.telegram = {
          botToken: "123456:test",
          webhookSecret: "test-telegram-secret",
          webhookUrl: "https://app.example.test/api/channels/telegram/webhook",
          botUsername: "test_bot",
          configuredAt: now,
        };
      } else if (channel === "discord") {
        meta.channels.discord = {
          publicKey: "0".repeat(64),
          applicationId: "discord-app-id",
          botToken: "discord-token",
          configuredAt: now,
          endpointConfigured: true,
          endpointUrl: "https://app.example.test/api/channels/discord/webhook",
          commandRegistered: true,
          commandId: "cmd-1",
        };
      } else if (channel === "whatsapp") {
        meta.channels.whatsapp = {
          enabled: true,
          configuredAt: now,
          phoneNumberId: "phone-1",
          accessToken: "wa-token",
          verifyToken: "verify-token",
          lastKnownLinkState: "linked",
        };
      }
    });
  }

  configureAllChannels(): void {
    this.configureChannel("slack");
    this.configureChannel("telegram");
    this.configureChannel("discord");
    this.configureChannel("whatsapp");
  }

  setLastForward(channel: ChannelName, lastForward: ChannelLastForwardInput): void {
    const normalized = normalizeChannelLastForward(lastForward);
    if (!normalized) {
      throw new Error(`invalid lastForward fixture for ${channel}`);
    }
    this.mutate((meta) => {
      if (!meta.channelDiagnostics) meta.channelDiagnostics = {};
      meta.channelDiagnostics[channel] = {
        ...meta.channelDiagnostics[channel],
        lastForward: normalized,
      };
    });
  }

  setLastDeliveryState(
    channel: ChannelName,
    lastDeliveryState: ChannelDeliverySnapshot,
  ): void {
    this.mutate((meta) => {
      if (!meta.channelDiagnostics) meta.channelDiagnostics = {};
      meta.channelDiagnostics[channel] = {
        ...meta.channelDiagnostics[channel],
        lastDeliveryState,
      };
    });
  }

  getPortUrl(port: number): string {
    const url = this.meta.portUrls?.[String(port)];
    if (!url) {
      const refreshed = `https://fresh-${port}-${this.stalePortCalls.length}.example.test`;
      this.mutate((meta) => {
        meta.portUrls = { ...(meta.portUrls ?? {}), [String(port)]: refreshed };
      });
      return refreshed;
    }
    return url;
  }

  markPortStale(sandboxId: string | null, port: number, reason: string): void {
    const previousUrl = this.meta.portUrls?.[String(port)] ?? null;
    this.stalePortCalls.push({ sandboxId, port, reason, previousUrl });
    this.mutate((meta) => {
      const next = { ...(meta.portUrls ?? {}) };
      delete next[String(port)];
      meta.portUrls = Object.keys(next).length > 0 ? next : null;
    });
  }
}
