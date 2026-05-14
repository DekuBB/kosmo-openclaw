import assert from "node:assert/strict";

import type { ChannelName } from "@/shared/channels";

export type GatewayRouteKey =
  | "root"
  | "slack"
  | "telegram"
  | "discord"
  | "whatsapp";

export type FakeGatewayResponse = {
  ok: boolean;
  status: number;
  bodyHead: string;
  bodyLength: number;
  durationMs: number;
};

export type FakeGatewayRequest = {
  channel: ChannelName | "root";
  route: GatewayRouteKey;
  url: string;
  port: number;
  sandboxUrl: string;
  attempt: number;
};

export type FakeGatewayResult = FakeGatewayResponse & {
  request: FakeGatewayRequest;
};

type QueuedOutcome =
  | { type: "response"; response: Partial<FakeGatewayResponse> }
  | { type: "throw"; error: unknown };

const CHANNEL_ROUTE: Record<ChannelName, GatewayRouteKey> = {
  slack: "slack",
  telegram: "telegram",
  discord: "discord",
  whatsapp: "whatsapp",
};

const CHANNEL_PATH: Record<GatewayRouteKey, string> = {
  root: "/",
  slack: "/slack/events",
  telegram: "/telegram-webhook",
  discord: "/discord-webhook",
  whatsapp: "/whatsapp-webhook",
};

export function channelGatewayPort(channel: ChannelName): number {
  return channel === "telegram" ? 8787 : 3000;
}

export function responseOutcome(
  status: number,
  bodyHead = "",
  durationMs = 25,
): FakeGatewayResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    bodyHead,
    bodyLength: bodyHead.length,
    durationMs,
  };
}

export function sandboxNotListeningResponse(): FakeGatewayResponse {
  return responseOutcome(502, "This sandbox is not listening on the requested port");
}

export class FakeChannelGateway {
  private readonly queues = new Map<GatewayRouteKey, QueuedOutcome[]>();
  private readonly requestsList: FakeGatewayRequest[] = [];

  enqueue(
    route: GatewayRouteKey,
    ...responses: Array<Partial<FakeGatewayResponse>>
  ): void {
    const queue = this.queues.get(route) ?? [];
    for (const response of responses) {
      queue.push({ type: "response", response });
    }
    this.queues.set(route, queue);
  }

  enqueueChannel(
    channel: ChannelName,
    ...responses: Array<Partial<FakeGatewayResponse>>
  ): void {
    this.enqueue(CHANNEL_ROUTE[channel], ...responses);
  }

  throwOnce(route: GatewayRouteKey, error: unknown): void {
    const queue = this.queues.get(route) ?? [];
    queue.push({ type: "throw", error });
    this.queues.set(route, queue);
  }

  throwChannelOnce(channel: ChannelName, error: unknown): void {
    this.throwOnce(CHANNEL_ROUTE[channel], error);
  }

  requests(): FakeGatewayRequest[] {
    return [...this.requestsList];
  }

  requestsFor(channel: ChannelName | "root"): FakeGatewayRequest[] {
    return this.requestsList.filter((request) => request.channel === channel);
  }

  async probeRoot(sandboxUrl: string): Promise<FakeGatewayResult> {
    return this.request("root", sandboxUrl, 3000);
  }

  async forward(channel: ChannelName, sandboxUrl: string): Promise<FakeGatewayResult> {
    return this.request(channel, sandboxUrl, channelGatewayPort(channel));
  }

  private async request(
    channel: ChannelName | "root",
    sandboxUrl: string,
    port: number,
  ): Promise<FakeGatewayResult> {
    const route = channel === "root" ? "root" : CHANNEL_ROUTE[channel];
    const attempt = this.requestsList.filter((request) => request.route === route).length + 1;
    const url = `${sandboxUrl}${CHANNEL_PATH[route]}`;
    const request: FakeGatewayRequest = { channel, route, url, port, sandboxUrl, attempt };
    this.requestsList.push(request);

    const queue = this.queues.get(route) ?? [];
    const next = queue.shift();
    assert.ok(next, `no fake gateway outcome queued for ${route}`);

    if (next.type === "throw") {
      throw next.error;
    }

    const response = {
      ...responseOutcome(next.response.status ?? 200),
      ...next.response,
    };
    return {
      ...response,
      request,
    };
  }
}

