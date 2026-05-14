import type { DiscordChannelConfig } from "@/shared/channels";
import { ApiError } from "@/shared/http";
import { createChannelAdminRouteHandlers } from "@/server/channels/admin/route-factory";
import {
  fetchDiscordApplicationIdentity,
  patchInteractionsEndpoint,
} from "@/server/channels/discord/application";
import { registerAskCommand } from "@/server/channels/discord/commands";
import {
  buildDiscordPublicWebhookUrl,
  setDiscordChannelConfig,
} from "@/server/channels/state";
import { buildChannelDisplayWebhookUrl } from "@/server/channels/webhook-urls";

function toDisplaySafeEndpointUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    url.searchParams.delete("x-vercel-protection-bypass");
    return url.toString();
  } catch {
    return value;
  }
}

function normalizeBotToken(value: unknown): string {
  if (typeof value !== "string") {
    throw new ApiError(400, "INVALID_DISCORD_BOT_TOKEN", "Discord botToken must be a string");
  }

  const normalized = value.trim().replace(/^Bot\s+/i, "").trim();
  if (normalized.length === 0) {
    throw new ApiError(400, "INVALID_DISCORD_BOT_TOKEN", "Discord botToken is required");
  }

  return normalized;
}

function parseOptionalBoolean(value: unknown, fieldName: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new ApiError(400, "INVALID_REQUEST_BODY", `${fieldName} must be a boolean`);
  }

  return value;
}

function endpointConflictResponse(
  auth: { setCookieHeader: string | null },
  currentUrl: string,
  desiredUrl: string,
): Response {
  const currentEndpointUrl = toDisplaySafeEndpointUrl(currentUrl);
  const desiredEndpointUrl = toDisplaySafeEndpointUrl(desiredUrl);
  const response = Response.json(
    {
      error: {
        code: "DISCORD_ENDPOINT_CONFLICT",
        message:
          "Discord interactions endpoint is already set to a different URL. Set forceOverwriteEndpoint=true to replace it.",
      },
      currentUrl: currentEndpointUrl,
      desiredUrl: desiredEndpointUrl,
      endpointConflict: {
        currentEndpointUrl,
        desiredEndpointUrl,
        endpointDrift: true,
        canRepairEndpoint: true,
        repairHint: {
          method: "PUT",
          forceOverwriteEndpoint: true,
        },
      },
    },
    { status: 409 },
  );
  if (auth.setCookieHeader) {
    response.headers.append("Set-Cookie", auth.setCookieHeader);
  }
  return response;
}

export const { GET, PUT, DELETE } = createChannelAdminRouteHandlers({
  channel: "discord",

  selectState(fullState) {
    return fullState.discord;
  },

  async get({ state, url, meta, request }) {
    if (url.searchParams.get("diagnostics") !== "1" || !meta.channels.discord?.botToken) {
      return state;
    }

    const desiredEndpointUrl = buildChannelDisplayWebhookUrl("discord", request)!;
    const diagnostics = await fetchDiscordApplicationIdentity(meta.channels.discord.botToken)
      .then((identity) => {
        const currentEndpointUrl = toDisplaySafeEndpointUrl(
          identity.currentInteractionsEndpointUrl ?? null,
        );
        const endpointDrift = Boolean(
          currentEndpointUrl && currentEndpointUrl !== desiredEndpointUrl,
        );
        return {
          applicationId: identity.applicationId,
          currentEndpointUrl,
          desiredEndpointUrl,
          endpointDrift,
          endpointConfigured: currentEndpointUrl === desiredEndpointUrl,
          commandRegistered: meta.channels.discord?.commandRegistered === true,
          commandId: meta.channels.discord?.commandId ?? null,
          canRepairEndpoint: endpointDrift,
          repairHint: endpointDrift
            ? { method: "PUT", forceOverwriteEndpoint: true }
            : null,
        };
      })
      .catch((error) => ({
        desiredEndpointUrl,
        currentEndpointUrl: null,
        endpointDrift: false,
        endpointConfigured: state.endpointConfigured,
        commandRegistered: state.commandRegistered,
        commandId: state.commandId,
        canRepairEndpoint: false,
        error: error instanceof Error ? error.message : String(error),
      }));

    return { ...state, diagnostics };
  },

  async put({ request, auth }) {
    const body = (await request.json()) as {
      botToken?: unknown;
      autoConfigureEndpoint?: unknown;
      autoRegisterCommand?: unknown;
      forceOverwriteEndpoint?: unknown;
    };

    const normalizedBotToken = normalizeBotToken(body.botToken);
    const autoConfigureEndpoint = parseOptionalBoolean(
      body.autoConfigureEndpoint,
      "autoConfigureEndpoint",
    );
    const autoRegisterCommand = parseOptionalBoolean(
      body.autoRegisterCommand,
      "autoRegisterCommand",
    );
    const forceOverwriteEndpoint = parseOptionalBoolean(
      body.forceOverwriteEndpoint,
      "forceOverwriteEndpoint",
    );

    const identity = await fetchDiscordApplicationIdentity(normalizedBotToken);
    const webhookUrl = buildDiscordPublicWebhookUrl(request);

    let updatedConfig: DiscordChannelConfig = {
      applicationId: identity.applicationId,
      publicKey: identity.publicKey,
      botToken: normalizedBotToken,
      configuredAt: Date.now(),
      appName: identity.appName,
      botUsername: identity.botUsername,
      endpointConfigured: false,
      endpointUrl: identity.currentInteractionsEndpointUrl ?? undefined,
      endpointError: undefined,
      commandRegistered: false,
      commandId: undefined,
      commandRegisteredAt: undefined,
    };

    if (autoConfigureEndpoint !== false) {
      const currentUrl = identity.currentInteractionsEndpointUrl ?? null;
      const currentDisplayUrl = toDisplaySafeEndpointUrl(currentUrl);
      const webhookDisplayUrl = toDisplaySafeEndpointUrl(webhookUrl);
      if (
        currentUrl &&
        currentDisplayUrl !== webhookDisplayUrl &&
        forceOverwriteEndpoint !== true
      ) {
        await setDiscordChannelConfig({
          ...updatedConfig,
          endpointConfigured: false,
          endpointUrl: currentUrl,
          endpointError:
            "Discord interactions endpoint points at a different deployment. Choose explicit endpoint repair before overwriting it.",
        });
        return endpointConflictResponse(auth, currentUrl, webhookUrl);
      }

      try {
        await patchInteractionsEndpoint(normalizedBotToken, webhookUrl);
        updatedConfig = {
          ...updatedConfig,
          endpointConfigured: true,
          endpointUrl: webhookUrl,
        };
      } catch (error) {
        updatedConfig = {
          ...updatedConfig,
          endpointConfigured: false,
          endpointError: error instanceof Error ? error.message : String(error),
        };
      }
    }

    if (autoRegisterCommand !== false) {
      const command = await registerAskCommand(identity.applicationId, normalizedBotToken);
      updatedConfig = {
        ...updatedConfig,
        commandRegistered: true,
        commandId: command.commandId,
        commandRegisteredAt: Date.now(),
      };
    }

    await setDiscordChannelConfig(updatedConfig);
  },

  async delete({ meta }) {
    if (meta.channels.discord?.botToken) {
      try {
        await patchInteractionsEndpoint(meta.channels.discord.botToken, "");
      } catch {
        // Best-effort cleanup only.
      }
    }

    await setDiscordChannelConfig(null);
  },
});
