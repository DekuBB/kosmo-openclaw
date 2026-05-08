# Slack Debug Sender Setup Guide

This guide helps a new operator set up the Slack debug sender for any Slack workspace or Enterprise Grid org.

The debug sender posts one real Slack message as an explicitly authorized user. It is for channel incident debugging, where the message must travel through Slack Events API into `/api/channels/slack/webhook` and then through OpenClaw's normal Slack delivery path.

## What You Need

- Permission to create or request approval for an internal Slack app.
- A Slack user who is allowed to send debug messages in the target workspace.
- A secret manager for the OAuth user token, such as 1Password, Vault, Doppler, or Keychain.
- The target channel ID or DM target user ID.
- The OpenClaw bot user ID when testing app mentions or DMs.

Do not use Slack browser cookies, Slack desktop local storage, incoming webhooks, bot tokens, or admin URLs as credentials for this workflow.

## 1. Identify Workspace and Org Context

Slack IDs matter:

- `E...` is an Enterprise Grid org ID. Example: `E0AU3DH8RFT`.
- `T...` is a workspace/team ID.
- `C...` is a public channel ID.
- `G...` is a private channel or MPIM ID.
- `D...` is a DM ID.
- `U...` is a user ID.

Enterprise admin URLs such as `https://app.slack.com/manage/E...` prove org management context, but they are not message targets. Web API message sends still need a valid OAuth user token and a real channel or DM ID in a workspace.

Record the expected IDs before setup:

```bash
export SLACK_EXPECT_ENTERPRISE_ID="E..."  # optional for non-Grid workspaces
export SLACK_EXPECT_TEAM_ID="T..."
export SLACK_EXPECT_USER_ID="U..."
export OPENCLAW_BOT_USER_ID="U..."
```

## 2. Create the Debug Sender Slack App

Create a small internal app named `OpenClaw Debug Sender` in the target workspace or Enterprise Grid org. You can use the template at `docs/slack-debug-sender.manifest.json` as a starting point.

Required user scope:

- `chat:write`

Useful discovery scopes:

- `channels:read`
- `groups:read`
- `im:read`
- `mpim:read`
- `im:write`
- `users:read`

Keep this separate from the production OpenClaw receiver app unless you intentionally want the receiver app reinstalled or reapproved with user-token scopes.

## 3. Authorize the User Token

Have the intended sending user authorize the app through Slack OAuth. The resulting token must be a user token for that user, not a bot token.

Store the token immediately in a secret manager. Do not paste it into `.env.45`, `.agent-runs`, docs, terminal logs, or Slack messages.

Example with 1Password:

```bash
op item create \
  --category api_credential \
  --title "OpenClaw Slack Debug Sender" \
  credential="xoxp-..."
```

Load it for a session without shell tracing:

```bash
set +x
umask 077
export SLACK_USER_TOKEN="$(op read 'op://OpenClaw/OpenClaw Slack Debug Sender/credential')"
```

## 4. Verify Token Identity

From the repo root:

```bash
pnpm slack:debug-send auth \
  --expect-user "$SLACK_EXPECT_USER_ID" \
  --expect-team "$SLACK_EXPECT_TEAM_ID" \
  --expect-enterprise "$SLACK_EXPECT_ENTERPRISE_ID"
```

For a non-Enterprise workspace, omit `--expect-enterprise`.

If this fails, stop. A wrong user or wrong workspace token creates misleading incident evidence.

## 5. Find a Channel or DM

List conversations visible to the authorized user:

```bash
pnpm slack:debug-send list \
  --team-id "$SLACK_EXPECT_TEAM_ID" \
  --expect-user "$SLACK_EXPECT_USER_ID"
```

Pick a channel where the sending user is a member and the OpenClaw app is installed or invited.

For DM-specific incidents, open or reuse a DM with the OpenClaw bot:

```bash
pnpm slack:debug-send open-dm \
  --user "$OPENCLAW_BOT_USER_ID" \
  --expect-user "$SLACK_EXPECT_USER_ID"
```

Use the returned `D...` ID as `SLACK_CHANNEL_ID`.

## 6. Send a First Debug Message

Create a channel-debug artifact root and send one message:

```bash
CHANNEL=slack
RUN_TS="$(date -u +%Y%m%dT%H%M%SZ)"
ART=".agent-runs/channel-debug/$RUN_TS/$CHANNEL"
mkdir -p "$ART"/{admin,vercel,sandbox,workflow,channel}

export SLACK_CHANNEL_ID="C..."

pnpm slack:debug-send send \
  --channel "$SLACK_CHANNEL_ID" \
  --bot-user "$OPENCLAW_BOT_USER_ID" \
  --expect-user "$SLACK_EXPECT_USER_ID" \
  --expect-team "$SLACK_EXPECT_TEAM_ID" \
  --artifact-root "$ART" \
  | tee "$ART/channel/slack-send.stdout.json"
```

The script writes sanitized output to:

```text
.agent-runs/channel-debug/<timestamp>/slack/channel/slack-send.sanitized.json
```

That file contains IDs, message timestamp, and a `debugId`. It must not contain `SLACK_USER_TOKEN`.

## 7. Correlate With OpenClaw Evidence

Use the `debugId` to find the webhook event:

```bash
DEBUG_ID="$(jq -r '.correlation.debugId' "$ART/channel/slack-send.sanitized.json")"

curl -sS $APP_AUTH_HEADERS "$URL/api/admin/logs" \
  | tee "$ART/admin/admin-logs-after-send.json" \
  | jq --arg marker "$DEBUG_ID" '.logs[] | select(tostring | contains($marker))'
```

After `channels.slack_webhook_accepted` appears, extract the Slack `event_id` or dedup ID. The native-forward delivery ID is usually `slack:<event_id>`.

Follow it through:

```bash
curl -sS $APP_AUTH_HEADERS "$URL/api/channels/summary" \
  | tee "$ART/admin/channels-summary-after-send.json" \
  | jq '.slack.lastForward, .slack.readiness'

curl -sS $APP_AUTH_HEADERS "$URL/api/admin/why-not-ready" \
  | tee "$ART/admin/why-not-ready-after-send.json" \
  | jq '.channels.slack'

curl -sS $APP_AUTH_HEADERS "$URL/api/admin/sandbox-diag" \
  | tee "$ART/admin/sandbox-diag-after-send.json" \
  | jq '.sandboxStatus, .ports'
```

## 8. Add It To the Handoff

Record only sanitized details:

```json
{
  "debugMessage": {
    "method": "slack_web_api.chat.postMessage",
    "tokenKind": "user",
    "authUserId": "U...",
    "teamId": "T...",
    "enterpriseId": "E...",
    "channelId": "C...",
    "slackMessageTs": "1712345678.123456",
    "debugId": "ocdbg-...",
    "artifact": ".agent-runs/channel-debug/<timestamp>/slack/channel/slack-send.sanitized.json"
  }
}
```

## Workspace Checklist

- Slack app exists in the target workspace or org.
- App has `chat:write` user scope and only the discovery scopes needed.
- Intended sending user explicitly authorized the app.
- Token is stored in a secret manager.
- `pnpm slack:debug-send auth` confirms expected user and workspace.
- Target channel/DM ID is known.
- OpenClaw bot is in the target channel or DM.
- First debug send produced a sanitized artifact.
- OpenClaw logs contain the same `debugId`.

## Troubleshooting

`not_in_channel`: Invite the sending user and, for app mention tests, the OpenClaw app to the channel.

`missing_scope`: Add the missing user scope to the debug sender app and reinstall/reauthorize it.

`invalid_auth`: Reload the token from the secret manager. If it still fails, rotate or reauthorize the user token.

`channel_not_found`: Use a workspace `T...` team ID for Enterprise Grid discovery, then pick a real `C...`, `G...`, or `D...` conversation ID.

`message_bot_id` appears in output: This was not a user-authored message. Use the OAuth user token path or manual Slack UI fallback.

HTTP 429: Wait for Slack's `Retry-After` before sending another message. Do not retry in a tight loop.
