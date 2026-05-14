import { getChannelCommandDefinitions } from "@/shared/channel-commands";
import { ApiError } from "@/shared/http";

const DISCORD_API_BASE = "https://discord.com/api/v10";

async function readDiscordErrorBody(response: Response): Promise<string> {
  return (await response.text().catch(() => "")).slice(0, 200);
}

function mapDiscordCommandError(status: number, body: string): ApiError {
  if (status === 401 || status === 403) {
    return new ApiError(
      400,
      "DISCORD_COMMAND_INVALID_TOKEN",
      "Discord rejected this bot token while registering /ask. Check the token and application access.",
    );
  }
  if (status === 404) {
    return new ApiError(
      400,
      "DISCORD_COMMAND_APPLICATION_ACCESS_MISSING",
      "Discord could not find this application for the bot token. Check that the token belongs to the saved application.",
    );
  }
  if (status === 429) {
    return new ApiError(
      429,
      "DISCORD_COMMAND_RATE_LIMITED",
      "Discord rate limited /ask registration. Retry in a few seconds.",
    );
  }
  if (status === 400) {
    return new ApiError(
      400,
      "DISCORD_COMMAND_MALFORMED_DEFINITION",
      `Discord rejected the /ask command definition.${body ? ` ${body}` : ""}`,
    );
  }
  return new ApiError(
    status >= 500 ? 502 : 400,
    "DISCORD_COMMAND_UPSTREAM_ERROR",
    `Discord command registration failed with status ${status}.${body ? ` ${body}` : ""}`,
  );
}

export async function registerAskCommand(
  applicationId: string,
  botToken: string,
  fetchFn?: typeof fetch,
): Promise<{ commandId?: string }> {
  const fetcher = fetchFn ?? globalThis.fetch;
  if (typeof fetcher !== "function") {
    throw new Error("Fetch is unavailable in this runtime");
  }

  const askCommand = getChannelCommandDefinitions().find(
    (command) => command.name === "ask" && command.discord,
  );
  if (!askCommand?.discord) {
    throw new ApiError(
      500,
      "DISCORD_COMMAND_MALFORMED_DEFINITION",
      "Shared /ask Discord command definition is missing.",
    );
  }

  const normalizedToken = botToken.trim().replace(/^Bot\s+/i, "").trim();
  const response = await fetcher(
    `${DISCORD_API_BASE}/applications/${encodeURIComponent(applicationId)}/commands`,
    {
      method: "POST",
      headers: {
        Authorization: `Bot ${normalizedToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: askCommand.name,
        description: askCommand.description,
        type: askCommand.discord.type,
        options: askCommand.discord.options,
      }),
    },
  );

  if (!response.ok) {
    throw mapDiscordCommandError(
      response.status,
      await readDiscordErrorBody(response),
    );
  }

  const payload = (await response.json()) as Record<string, unknown>;
  return {
    commandId: typeof payload.id === "string" ? payload.id : undefined,
  };
}
