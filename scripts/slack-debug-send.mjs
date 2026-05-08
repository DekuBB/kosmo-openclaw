#!/usr/bin/env node

import crypto from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";

const SLACK_API = "https://slack.com/api";

const COMMANDS = new Set(["auth", "list", "open-dm", "send"]);

function printHelp() {
  process.stderr.write(`slack-debug-send — send real Slack debug messages with a user token

USAGE
  SLACK_USER_TOKEN=xoxp-... node scripts/slack-debug-send.mjs auth [options]
  SLACK_USER_TOKEN=xoxp-... node scripts/slack-debug-send.mjs list --team-id T... [options]
  SLACK_USER_TOKEN=xoxp-... node scripts/slack-debug-send.mjs open-dm --user U... [options]
  SLACK_USER_TOKEN=xoxp-... node scripts/slack-debug-send.mjs send --channel C... [options]

COMMANDS
  auth      Verify token identity with auth.test.
  list      List accessible conversations by ID.
  open-dm   Open or reuse a DM with another user, usually the OpenClaw bot.
  send      Post one user-authored debug message and emit sanitized correlation JSON.

OPTIONS
  --channel <id>             Slack channel/DM ID for send. Env: SLACK_CHANNEL_ID
  --user <id>                User ID for open-dm. Env: OPENCLAW_BOT_USER_ID
  --team-id <id>             Workspace team ID for org-level tokens. Env: SLACK_TEAM_ID
  --expect-user <id>         Guardrail for auth.test user_id. Env: SLACK_EXPECT_USER_ID
  --expect-team <id>         Guardrail for auth.test team_id. Env: SLACK_EXPECT_TEAM_ID
  --expect-enterprise <id>   Guardrail for auth.test enterprise_id. Env: SLACK_EXPECT_ENTERPRISE_ID
  --bot-user <id>            Mention this bot in default send text. Env: OPENCLAW_BOT_USER_ID
  --thread-ts <ts>           Optional thread timestamp. Env: SLACK_THREAD_TS
  --text <text>              Exact message text. Env: SLACK_TEXT
  --debug-id <id>            Correlation marker. Env: DEBUG_ID
  --artifact-root <dir>      Write sanitized JSON to <dir>/channel/slack-send.sanitized.json.
  --limit <n>                List page size, default 200.
  --types <list>             Conversation types for list, default public_channel,private_channel,im,mpim.
  --json-only                Suppress progress logs.
  --help                     Show this help.

SECURITY
  The Slack token is accepted only from SLACK_USER_TOKEN. Do not pass tokens as
  command arguments, do not run with shell tracing, and do not save raw env vars
  in .agent-runs artifacts.
`);
}

function parseCli() {
  const argv = process.argv.slice(2);
  const command = argv[0] && COMMANDS.has(argv[0]) ? argv[0] : null;
  const args = command ? argv.slice(1) : argv;

  const parsed = parseArgs({
    args,
    options: {
      channel: { type: "string" },
      user: { type: "string" },
      "team-id": { type: "string" },
      "expect-user": { type: "string" },
      "expect-team": { type: "string" },
      "expect-enterprise": { type: "string" },
      "bot-user": { type: "string" },
      "thread-ts": { type: "string" },
      text: { type: "string" },
      "debug-id": { type: "string" },
      "artifact-root": { type: "string" },
      limit: { type: "string", default: "200" },
      types: { type: "string", default: "public_channel,private_channel,im,mpim" },
      "json-only": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  if (parsed.values.help || !command) {
    printHelp();
    process.exit(parsed.values.help ? 0 : 2);
  }

  return { command, values: parsed.values };
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name}; read it from a secret manager into the environment`);
  }
  return value;
}

function valueOrEnv(value, envName) {
  return value?.trim() || process.env[envName]?.trim() || "";
}

function makeDebugId() {
  const stamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15);
  return `ocdbg-${stamp}Z-${crypto.randomBytes(4).toString("hex")}`;
}

function log(values, message) {
  if (!values["json-only"]) {
    process.stderr.write(`[slack-debug-send] ${message}\n`);
  }
}

async function slack(token, method, body = null, query = null) {
  const url = new URL(`${SLACK_API}/${method}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value != null && value !== "") url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { "content-type": "application/json; charset=utf-8" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const json = await response.json().catch(() => ({}));
  if (response.status === 429) {
    json.retry_after = response.headers.get("retry-after");
  }
  return { status: response.status, json };
}

function sanitizedAuth(auth) {
  return {
    ok: Boolean(auth.ok),
    url: auth.url ?? null,
    team: auth.team ?? null,
    team_id: auth.team_id ?? null,
    enterprise_id: auth.enterprise_id ?? null,
    user: auth.user ?? null,
    user_id: auth.user_id ?? null,
    bot_id: auth.bot_id ?? null,
  };
}

function assertExpectedAuth(auth, values) {
  const expectedUser = valueOrEnv(values["expect-user"], "SLACK_EXPECT_USER_ID");
  const expectedTeam = valueOrEnv(values["expect-team"], "SLACK_EXPECT_TEAM_ID");
  const expectedEnterprise = valueOrEnv(values["expect-enterprise"], "SLACK_EXPECT_ENTERPRISE_ID");

  if (expectedUser && auth.user_id !== expectedUser) {
    throw new Error(`Wrong Slack user token: got ${auth.user_id ?? "null"}, expected ${expectedUser}`);
  }
  if (expectedTeam && auth.team_id !== expectedTeam) {
    throw new Error(`Wrong Slack workspace token: got ${auth.team_id ?? "null"}, expected ${expectedTeam}`);
  }
  if (expectedEnterprise && auth.enterprise_id !== expectedEnterprise) {
    throw new Error(`Wrong Slack Enterprise token: got ${auth.enterprise_id ?? "null"}, expected ${expectedEnterprise}`);
  }
}

async function authTest(token, values) {
  const result = await slack(token, "auth.test");
  if (!result.json.ok) {
    throw new Error(`auth.test failed: ${JSON.stringify(result.json)}`);
  }
  assertExpectedAuth(result.json, values);
  return result.json;
}

async function writeArtifact(root, payload) {
  if (!root) return null;
  const channelDir = path.join(root, "channel");
  await mkdir(channelDir, { recursive: true, mode: 0o700 });
  const outputPath = path.join(channelDir, "slack-send.sanitized.json");
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  return outputPath;
}

async function commandAuth(token, values) {
  const auth = await authTest(token, values);
  process.stdout.write(`${JSON.stringify({ method: "auth.test", auth: sanitizedAuth(auth) }, null, 2)}\n`);
}

async function commandList(token, values) {
  const auth = await authTest(token, values);
  const teamId = valueOrEnv(values["team-id"], "SLACK_TEAM_ID");
  const limit = Number.parseInt(values.limit, 10);
  if (!Number.isFinite(limit) || limit < 1 || limit > 1000) {
    throw new Error("--limit must be between 1 and 1000");
  }

  const result = await slack(token, "conversations.list", null, {
    types: values.types,
    exclude_archived: "true",
    limit,
    team_id: teamId,
  });
  if (!result.json.ok) {
    throw new Error(`conversations.list failed: ${JSON.stringify(result.json)}`);
  }

  const channels = (result.json.channels ?? []).map((channel) => ({
    id: channel.id,
    name: channel.name ?? null,
    is_channel: Boolean(channel.is_channel),
    is_group: Boolean(channel.is_group),
    is_im: Boolean(channel.is_im),
    is_mpim: Boolean(channel.is_mpim),
    is_private: Boolean(channel.is_private),
    is_member: Boolean(channel.is_member),
    user: channel.user ?? null,
  }));
  process.stdout.write(`${JSON.stringify({ method: "conversations.list", auth: sanitizedAuth(auth), channels }, null, 2)}\n`);
}

async function commandOpenDm(token, values) {
  const auth = await authTest(token, values);
  const user = valueOrEnv(values.user, "OPENCLAW_BOT_USER_ID");
  if (!user) throw new Error("--user or OPENCLAW_BOT_USER_ID is required");

  const result = await slack(token, "conversations.open", { users: user, return_im: true });
  if (!result.json.ok) {
    throw new Error(`conversations.open failed: ${JSON.stringify(result.json)}`);
  }
  process.stdout.write(`${JSON.stringify({
    method: "conversations.open",
    auth: sanitizedAuth(auth),
    channel: {
      id: result.json.channel?.id ?? null,
      already_open: Boolean(result.json.already_open),
      no_op: Boolean(result.json.no_op),
    },
  }, null, 2)}\n`);
}

async function commandSend(token, values) {
  const auth = await authTest(token, values);
  const channel = valueOrEnv(values.channel, "SLACK_CHANNEL_ID");
  if (!channel) throw new Error("--channel or SLACK_CHANNEL_ID is required");

  const debugId = valueOrEnv(values["debug-id"], "DEBUG_ID") || makeDebugId();
  const botUserId = valueOrEnv(values["bot-user"], "OPENCLAW_BOT_USER_ID");
  const threadTs = valueOrEnv(values["thread-ts"], "SLACK_THREAD_TS");
  const text = valueOrEnv(values.text, "SLACK_TEXT")
    || `${botUserId ? `<@${botUserId}> ` : ""}debug ${debugId}: please reply with this marker so we can correlate Slack -> Vercel -> workflow -> sandbox.`;

  const body = {
    channel,
    text,
    unfurl_links: false,
    unfurl_media: false,
    ...(threadTs ? { thread_ts: threadTs } : {}),
  };
  const result = await slack(token, "chat.postMessage", body);
  if (!result.json.ok) {
    throw new Error(`chat.postMessage failed: ${JSON.stringify(result.json)}`);
  }

  const payload = {
    method: "slack_web_api.chat.postMessage",
    tokenKind: "user",
    auth: sanitizedAuth(auth),
    post: {
      ok: Boolean(result.json.ok),
      channel: result.json.channel ?? null,
      ts: result.json.ts ?? null,
      message_user: result.json.message?.user ?? null,
      message_bot_id: result.json.message?.bot_id ?? null,
      message_subtype: result.json.message?.subtype ?? null,
    },
    correlation: {
      debugId,
      searchText: debugId,
      channelTs: result.json.channel && result.json.ts ? `${result.json.channel}:${result.json.ts}` : null,
      expectedRepoDeliveryId: "Find Slack event_id in channels.slack_webhook_accepted; repo deliveryId is usually slack:<event_id>.",
    },
    warnings: [
      "Do not store SLACK_USER_TOKEN in artifacts.",
      "If message_bot_id is non-null, this did not behave like a user-authored message; use Slack UI fallback.",
    ],
  };

  const artifactPath = await writeArtifact(values["artifact-root"], payload);
  if (artifactPath) log(values, `wrote sanitized artifact ${artifactPath}`);
  process.stdout.write(`${JSON.stringify({ ...payload, artifactPath }, null, 2)}\n`);
}

async function main() {
  const { command, values } = parseCli();
  const token = requiredEnv("SLACK_USER_TOKEN");

  switch (command) {
    case "auth":
      await commandAuth(token, values);
      break;
    case "list":
      await commandList(token, values);
      break;
    case "open-dm":
      await commandOpenDm(token, values);
      break;
    case "send":
      await commandSend(token, values);
      break;
    default:
      throw new Error(`Unsupported command ${command}`);
  }
}

main().catch((error) => {
  process.stderr.write(`[slack-debug-send] error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
