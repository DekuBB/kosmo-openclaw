import type { ChannelLastForward, ChannelName } from "@/shared/channels";
import type { LogEntry, SingleMeta } from "@/shared/types";
import { filterLogEntries, getServerLogs } from "@/server/log";
import { getInitializedMeta } from "@/server/store/store";

const RECENT_FORWARD_WINDOW_MS = 5 * 60 * 1000;
const RECENT_LOG_LIMIT = 50;
const RELEVANT_LOG_PREFIXES = ["channels.", "sandbox.", "gateway.", "proxy."] as const;

export type Blocker = {
  kind:
    | "no_credentials"
    | "config_sync_failed"
    | "stale_port_url"
    | "handler_not_ready"
    | "sandbox_not_listening"
    | "gateway_restarting"
    | "sandbox_not_running"
    | "lock_held";
  detail: string;
  evidence: Record<string, unknown>;
  firstObservedAt: number;
  suggestedAction: string | null;
};

export type ChannelReport = {
  ready: boolean;
  blockers: Blocker[];
  readinessSnapshot: {
    liveConfigSync: unknown;
    lastForward: unknown;
    sandboxId: string | null;
    portUrls: Record<string, string> | null;
  };
};

export type WhyNotReadyResponse = {
  asOf: number;
  channels: {
    slack: ChannelReport;
    telegram: ChannelReport;
    discord: ChannelReport;
    whatsapp: ChannelReport;
  };
  sandbox: {
    status: string;
    sandboxId: string | null;
    portUrls: Record<string, string> | null;
  };
  locks: Record<string, unknown>;
  recentLogs: unknown[];
};

function isRecentForwardOk(
  forward: ChannelLastForward | null | undefined,
  now: number,
): boolean {
  if (!forward) return false;
  if (!forward.ok) return false;
  if (forward.classification !== "accepted") return false;
  return now - forward.completedAt < RECENT_FORWARD_WINDOW_MS;
}

function buildChannelReport(
  channel: ChannelName,
  meta: SingleMeta,
  now: number,
): ChannelReport {
  const config = meta.channels[channel];
  const lastForward = meta.channelDiagnostics?.[channel]?.lastForward ?? null;
  const slackConfig = channel === "slack" ? meta.channels.slack : null;
  const liveConfigSync = slackConfig?.liveConfigSync ?? null;

  const blockers: Blocker[] = [];

  if (config === null || config === undefined) {
    blockers.push({
      kind: "no_credentials",
      detail: `${channel} is not configured.`,
      evidence: {},
      firstObservedAt: now,
      suggestedAction: `Configure ${channel} credentials.`,
    });
  } else {
    if (lastForward?.classification === "sandbox-not-listening") {
      blockers.push({
        kind: "sandbox_not_listening",
        detail: `Last ${channel} forward hit a sandbox tunnel that isn't listening.`,
        evidence: {
          sandboxUrl: lastForward.sandboxUrl,
          sandboxId: lastForward.sandboxId,
          attempts: lastForward.attempts,
          completedAt: lastForward.completedAt,
        },
        firstObservedAt: lastForward.completedAt,
        suggestedAction:
          "Refresh the sandbox port URL or wait for the watchdog to reconcile.",
      });
    }

    const finalReasonHead = lastForward?.finalReasonHead ?? "";
    const isHandlerNotReady =
      lastForward?.classification === "handler-not-ready" ||
      (lastForward?.classification === "exhausted" &&
        typeof finalReasonHead === "string" &&
        finalReasonHead.includes("Not Found"));
    if (isHandlerNotReady) {
      const evidence: Record<string, unknown> = {
        classification: lastForward?.classification,
        finalReasonHead,
        attempts: lastForward?.attempts,
      };
      if (channel === "slack") {
        evidence.sandboxPath = "/slack/events";
      }
      blockers.push({
        kind: "handler_not_ready",
        detail: `${channel} native handler did not respond ok after retries.`,
        evidence,
        firstObservedAt: lastForward?.completedAt ?? now,
        suggestedAction:
          "Wait for the gateway to mount the channel route, or trigger a config-sync.",
      });
    }

    const recentlyAccepted = isRecentForwardOk(lastForward, now);
    if (
      liveConfigSync?.outcome === "failed" &&
      !recentlyAccepted
    ) {
      blockers.push({
        kind: "config_sync_failed",
        detail: "Last config-sync attempt failed.",
        evidence: {
          reason: liveConfigSync.reason,
          checkedAt: liveConfigSync.checkedAt,
          operatorMessage: liveConfigSync.operatorMessage ?? null,
        },
        firstObservedAt: liveConfigSync.checkedAt,
        suggestedAction:
          "Re-run config-sync after the underlying error is addressed.",
      });
    }

    const portUrls = meta.portUrls;
    const portUrlsEmpty =
      portUrls === null ||
      portUrls === undefined ||
      Object.keys(portUrls).length === 0;
    if (
      portUrlsEmpty &&
      meta.sandboxId !== null &&
      meta.status === "running"
    ) {
      blockers.push({
        kind: "stale_port_url",
        detail: "Sandbox is running but no port URLs are cached.",
        evidence: {
          sandboxId: meta.sandboxId,
          status: meta.status,
        },
        firstObservedAt: now,
        suggestedAction: "A forward will refresh the cache; informational only.",
      });
    }
  }

  const recentlyAccepted = isRecentForwardOk(lastForward, now);
  const configSyncApplied = liveConfigSync?.outcome === "applied";
  const ready =
    blockers.length === 0 && (recentlyAccepted || configSyncApplied);

  return {
    ready,
    blockers,
    readinessSnapshot: {
      liveConfigSync,
      lastForward,
      sandboxId: meta.sandboxId,
      portUrls: meta.portUrls,
    },
  };
}

function collectRecentLogs(): LogEntry[] {
  const all = getServerLogs();
  // Filter to channel/lifecycle/proxy/gateway events.
  const relevant = filterLogEntries(all, {}).filter((entry) =>
    RELEVANT_LOG_PREFIXES.some((prefix) => entry.message.startsWith(prefix)),
  );
  return relevant.slice(-RECENT_LOG_LIMIT);
}

export async function buildWhyNotReady(
  metaArg?: SingleMeta,
): Promise<WhyNotReadyResponse> {
  const meta = metaArg ?? (await getInitializedMeta());
  const now = Date.now();

  const channels = {
    slack: buildChannelReport("slack", meta, now),
    telegram: buildChannelReport("telegram", meta, now),
    discord: buildChannelReport("discord", meta, now),
    whatsapp: buildChannelReport("whatsapp", meta, now),
  };

  return {
    asOf: now,
    channels,
    sandbox: {
      status: meta.status,
      sandboxId: meta.sandboxId,
      portUrls: meta.portUrls,
    },
    locks: {},
    recentLogs: collectRecentLogs(),
  };
}
