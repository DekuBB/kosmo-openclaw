import {
  fetchDiscordApplicationIdentity,
  patchInteractionsEndpoint,
} from "@/server/channels/discord/application";
import { registerAskCommand } from "@/server/channels/discord/commands";
import {
  buildDiscordPublicWebhookUrl,
  setDiscordChannelConfig,
} from "@/server/channels/state";
import { logInfo, logWarn } from "@/server/log";
import { discordReconcileKey } from "@/server/store/keyspace";
import { getInitializedMeta, getStore } from "@/server/store/store";

export const DISCORD_RECONCILE_INTERVAL_MS = 5 * 60 * 1000;

export type DiscordReconcileResult = {
  checkedAt: number;
  desiredUrl: string;
  currentUrl: string | null;
  endpointPatched: boolean;
  endpointDrift: boolean;
  commandRegistered: boolean;
};

export async function reconcileDiscordIntegration(options: {
  request?: Request;
  force?: boolean;
  ensureCommand?: boolean;
  forceOverwriteEndpoint?: boolean;
} = {}): Promise<DiscordReconcileResult | null> {
  const meta = await getInitializedMeta();
  const config = meta.channels.discord;
  if (!config) {
    return null;
  }

  if (!options.force) {
    const lastReconciledAt = await getStore().getValue<number>(
      discordReconcileKey(),
    );
    if (
      lastReconciledAt &&
      Date.now() - lastReconciledAt < DISCORD_RECONCILE_INTERVAL_MS
    ) {
      return null;
    }
  }

  const desiredUrl = buildDiscordPublicWebhookUrl(options.request);

  try {
    const identity = await fetchDiscordApplicationIdentity(config.botToken);

    const currentUrl = identity.currentInteractionsEndpointUrl ?? null;
    let endpointPatched = false;
    const endpointDrift = Boolean(currentUrl && currentUrl !== desiredUrl);
    if (endpointDrift && options.forceOverwriteEndpoint !== true) {
      const checkedAt = Date.now();
      await setDiscordChannelConfig({
        ...config,
        applicationId: identity.applicationId,
        publicKey: identity.publicKey,
        appName: identity.appName,
        botUsername: identity.botUsername,
        endpointConfigured: false,
        endpointUrl: currentUrl ?? undefined,
        endpointError:
          "Discord interactions endpoint points at a different deployment. Use explicit endpoint repair to overwrite it.",
      });
      await getStore().setValue(discordReconcileKey(), checkedAt);
      logWarn("channels.discord_endpoint_drift_detected", {
        desiredUrl,
        currentUrl,
        endpointPatched: false,
      });
      return {
        checkedAt,
        desiredUrl,
        currentUrl,
        endpointPatched: false,
        endpointDrift: true,
        commandRegistered: config.commandRegistered === true,
      };
    }

    if (currentUrl !== desiredUrl) {
      await patchInteractionsEndpoint(config.botToken, desiredUrl);
      endpointPatched = true;
    }

    let commandId = config.commandId;
    let commandRegistered =
      config.commandRegistered === true && Boolean(config.commandId);

    if (options.ensureCommand !== false && !commandRegistered) {
      const command = await registerAskCommand(
        identity.applicationId,
        config.botToken,
      );
      commandId = command.commandId ?? commandId;
      commandRegistered = true;
    }

    const checkedAt = Date.now();
    await setDiscordChannelConfig({
      ...config,
      applicationId: identity.applicationId,
      publicKey: identity.publicKey,
      appName: identity.appName,
      botUsername: identity.botUsername,
      endpointConfigured: true,
      endpointUrl: desiredUrl,
      endpointError: undefined,
      commandRegistered,
      commandId,
      commandRegisteredAt: commandRegistered
        ? config.commandRegisteredAt ?? checkedAt
        : config.commandRegisteredAt,
    });
    await getStore().setValue(discordReconcileKey(), checkedAt);

    logInfo("channels.discord_integration_reconciled", {
      desiredUrl,
      currentUrl,
      endpointPatched,
      endpointDrift: false,
      commandRegistered,
    });

    return {
      checkedAt,
      desiredUrl,
      currentUrl,
      endpointPatched,
      endpointDrift: false,
      commandRegistered,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await setDiscordChannelConfig({
      ...config,
      endpointConfigured: false,
      endpointError: message,
    });
    logWarn("channels.discord_reconcile_failed", { error: message });
    throw error;
  }
}
