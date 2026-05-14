import type { ChannelName } from "@/shared/channels";
import { buildPublicDisplayUrl, buildPublicUrl } from "@/server/public-url";

export type WebhookProxiedChannel = ChannelName;

/**
 * Canonical webhook path map for app-owned webhook ingress.
 * This is the single source of truth — no other file should hardcode these paths.
 */
export const CHANNEL_WEBHOOK_PATHS: Record<WebhookProxiedChannel, string> = {
  slack: "/api/channels/slack/webhook",
  telegram: "/api/channels/telegram/webhook",
  discord: "/api/channels/discord/webhook",
  whatsapp: "/api/channels/whatsapp/webhook",
};

/**
 * Build a display-safe webhook URL (no bypass secret) for admin-visible surfaces.
 */
export function buildChannelDisplayWebhookUrl(
  channel: ChannelName,
  request?: Request,
): string | null {
  return buildPublicDisplayUrl(
    CHANNEL_WEBHOOK_PATHS[channel as WebhookProxiedChannel],
    request,
  );
}

/**
 * Build a webhook URL for platform registration and delivery.
 *
 * All channels use `buildPublicUrl` which appends the bypass secret
 * when available, allowing webhooks to pass through Vercel Deployment
 * Protection.
 */
export function buildChannelWebhookUrl(
  channel: ChannelName,
  request?: Request,
): string | null {
  return buildPublicUrl(
    CHANNEL_WEBHOOK_PATHS[channel as WebhookProxiedChannel],
    request,
  );
}

/**
 * Normalize a webhook URL for admin display and drift comparisons.
 * Registered provider URLs may include Vercel's deployment-protection bypass
 * query; display URLs intentionally strip it, so the bypass alone must not
 * count as endpoint drift.
 */
export function toDisplaySafeWebhookUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    url.searchParams.delete("x-vercel-protection-bypass");
    return url.toString();
  } catch {
    return value;
  }
}
