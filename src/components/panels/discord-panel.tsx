import { useState } from "react";
import { ConfirmDialog, useConfirm } from "@/components/ui/confirm-dialog";
import type {
  StatusPayload,
  RunAction,
  RequestJson,
} from "@/components/admin-types";
import type { ChannelPillModel } from "@/components/panels/channel-panel-shared";
import {
  ChannelCardFrame,
  ChannelCopyValue,
  ChannelInfoRow,
  ChannelSecretField,
  getChannelActionLabel,
} from "@/components/panels/channel-panel-shared";

type DiscordPanelProps = {
  status: StatusPayload;
  busy: boolean;
  runAction: RunAction;
  requestJson: RequestJson;
  preflightBlockerIds?: Set<string> | null;
};

type DiscordEndpointConflict = {
  currentEndpointUrl: string | null;
  desiredEndpointUrl: string | null;
  endpointDrift: boolean;
  canRepairEndpoint: boolean;
  repairHint?: {
    method: "PUT";
    forceOverwriteEndpoint: true;
  } | null;
};

function getDiscordPill(configured: boolean): ChannelPillModel {
  return {
    label: configured ? "connected" : "offline",
    variant: configured ? "good" : "idle",
  };
}

function hasDistinctDiscordEndpoint(
  endpointUrl: string | null | undefined,
  webhookUrl: string,
): boolean {
  return Boolean(
    endpointUrl &&
      endpointUrl.trim().length > 0 &&
      endpointUrl !== webhookUrl,
  );
}

function endpointConflictFromData(value: unknown): DiscordEndpointConflict | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { endpointConflict?: unknown };
  const conflict = raw.endpointConflict;
  if (!conflict || typeof conflict !== "object") return null;
  const entry = conflict as Partial<DiscordEndpointConflict>;
  if (entry.endpointDrift !== true) return null;
  return {
    currentEndpointUrl:
      typeof entry.currentEndpointUrl === "string" ? entry.currentEndpointUrl : null,
    desiredEndpointUrl:
      typeof entry.desiredEndpointUrl === "string" ? entry.desiredEndpointUrl : null,
    endpointDrift: true,
    canRepairEndpoint: entry.canRepairEndpoint === true,
    repairHint: entry.repairHint ?? null,
  };
}

function getDiscordHealth(args: {
  endpointConfigured?: boolean;
  commandRegistered?: boolean;
  distinctEndpoint?: boolean;
}): string {
  const endpoint = args.endpointConfigured
    ? args.distinctEndpoint
      ? "Endpoint drift"
      : "Endpoint configured"
    : "Endpoint pending";
  const command = args.commandRegistered
    ? "/ask registered"
    : "/ask pending";
  return `${endpoint} · ${command}`;
}

export function DiscordPanel({
  status,
  busy,
  runAction,
  requestJson,
  preflightBlockerIds,
}: DiscordPanelProps) {
  const [botToken, setBotToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [autoEndpoint, setAutoEndpoint] = useState(true);
  const [autoCommand, setAutoCommand] = useState(true);
  const [forceOverwrite, setForceOverwrite] = useState(false);
  const [editing, setEditing] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [endpointConflict, setEndpointConflict] = useState<DiscordEndpointConflict | null>(null);
  const [saving, setSaving] = useState(false);
  const [copiedField, setCopiedField] = useState<"webhook" | "endpoint" | null>(null);

  const { confirm, dialogProps } = useConfirm();
  const dc = status.channels.discord;
  const pending = busy || saving;

  function clearDrafts(): void {
    setBotToken("");
    setShowToken(false);
    setAutoEndpoint(true);
    setAutoCommand(true);
    setForceOverwrite(false);
    setPanelError(null);
    setEndpointConflict(null);
    setSaving(false);
  }

  async function handleConnect(options: { forceOverwriteEndpoint?: boolean } = {}): Promise<void> {
    if (!botToken.trim() || pending) return;
    setPanelError(null);
    setEndpointConflict(null);
    setSaving(true);

    const result = await requestJson<unknown>("/api/channels/discord", {
      label: getChannelActionLabel("discord", editing ? "update" : "connect"),
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        botToken: botToken.trim(),
        autoConfigureEndpoint: autoEndpoint,
        autoRegisterCommand: autoCommand,
        forceOverwriteEndpoint: options.forceOverwriteEndpoint === true || forceOverwrite,
      }),
    });

    if (result.ok) {
      setEditing(false);
      clearDrafts();
    } else {
      setSaving(false);
      const conflict = endpointConflictFromData(result.data);
      if (conflict) {
        setEndpointConflict(conflict);
      }
      setPanelError(result.error);
    }
  }

  async function handleRepairEndpoint(): Promise<void> {
    await handleConnect({ forceOverwriteEndpoint: true });
  }

  function handleKeepExistingEndpoint(): void {
    setEndpointConflict(null);
    setPanelError(null);
    setAutoEndpoint(false);
  }

  async function handleRegisterCommand(): Promise<void> {
    setPanelError(null);
    await runAction("/api/channels/discord/register-command", {
      label: "Register Discord command",
      method: "POST",
    });
  }

  async function handleDisconnect(): Promise<void> {
    const ok = await confirm({
      title: "Disconnect Discord?",
      description:
        "This will remove the bot token and stop processing interactions from this Discord application.",
      confirmLabel: "Disconnect",
      variant: "danger",
    });
    if (!ok) return;

    setPanelError(null);
    const success = await runAction("/api/channels/discord", {
      label: getChannelActionLabel("discord", "disconnect"),
      method: "DELETE",
    });
    if (success) {
      clearDrafts();
      setEditing(false);
    }
  }

  function handleCopyValue(
    value: string | null | undefined,
    field: "webhook" | "endpoint",
  ): void {
    if (!value) return;
    void navigator.clipboard.writeText(value);
    setCopiedField(field);
    setTimeout(() => setCopiedField((current) => (current === field ? null : current)), 2000);
  }

  return (
    <ChannelCardFrame
      channel="discord"
      configured={dc.configured}
      channelClassName="channel-discord"
      title="Discord (experimental)"
      summary={
        dc.configured
          ? `Connected${dc.appName ? ` · ${dc.appName}` : ""}`
          : "Not configured"
      }
      pill={getDiscordPill(dc.configured)}
      errors={[panelError, dc.endpointError]}
      connectability={dc.connectability}
      suppressedIds={preflightBlockerIds}
    >
      {dc.configured && !editing ? (
        <div className="channel-connected-view">
          <ChannelInfoRow label="Application">
            <code className="inline-code">
              {dc.appName ?? dc.applicationId ?? "—"}
            </code>
          </ChannelInfoRow>
          <ChannelCopyValue
            label="Webhook URL"
            value={dc.webhookUrl}
            copied={copiedField === "webhook"}
            onCopy={() => handleCopyValue(dc.webhookUrl, "webhook")}
          />
          <ChannelInfoRow
            label="Health"
            action={
              <span style={{ display: "inline-flex", gap: 8 }}>
                {dc.endpointDrift && dc.canRepairEndpoint ? (
                  <button
                    type="button"
                    className="button ghost channel-inline-action"
                    disabled={pending}
                    onClick={() => {
                      setEditing(true);
                      setAutoEndpoint(true);
                      setForceOverwrite(true);
                      setPanelError("Paste the bot token, then use this deployment endpoint to repair Discord endpoint drift.");
                    }}
                  >
                    Repair endpoint
                  </button>
                ) : hasDistinctDiscordEndpoint(dc.endpointUrl, dc.webhookUrl) ? (
                  <button
                    type="button"
                    className="button ghost channel-inline-action"
                    disabled={pending}
                    onClick={() => handleCopyValue(dc.endpointUrl, "endpoint")}
                  >
                    {copiedField === "endpoint" ? "Copied endpoint" : "Copy endpoint"}
                  </button>
                ) : null}
                {!dc.commandRegistered ? (
                  <button
                    type="button"
                    className="button ghost channel-inline-action"
                    disabled={pending}
                    onClick={() => void handleRegisterCommand()}
                  >
                    Register
                  </button>
                ) : null}
              </span>
            }
          >
            <code className="inline-code">
              {getDiscordHealth({
                endpointConfigured: dc.endpointConfigured,
                commandRegistered: dc.commandRegistered,
                distinctEndpoint: dc.endpointDrift || hasDistinctDiscordEndpoint(dc.endpointUrl, dc.webhookUrl),
              })}
            </code>
          </ChannelInfoRow>
          <div className="inline-actions">
            <button
              className="button secondary"
              disabled={pending}
              onClick={() => {
                setPanelError(null);
                setEditing(true);
              }}
            >
              Update credentials
            </button>
            {dc.inviteUrl ? (
              <a
                className="button secondary"
                href={dc.inviteUrl}
                target="_blank"
                rel="noreferrer"
              >
                Invite bot
              </a>
            ) : null}
            {dc.endpointConfigured && dc.commandRegistered ? (
              <span className="muted-copy" style={{ alignSelf: "center" }}>
                Run /ask in Discord, then confirm the visible reply here.
              </span>
            ) : null}
            <button
              className="button ghost"
              disabled={pending}
              onClick={() => void handleDisconnect()}
            >
              Disconnect
            </button>
          </div>
        </div>
      ) : (
        <form className="channel-wizard" onSubmit={(e) => { e.preventDefault(); void handleConnect(); }}>
          <p className="channel-wizard-title">
            {editing ? "Update Credentials" : "Connect Discord"}
          </p>

          {!editing ? (
            <p className="muted-copy">
              Paste the bot token from{" "}
              <a
                href="https://discord.com/developers/applications?new_application=true"
                target="_blank"
                rel="noreferrer"
                className="channel-link"
              >
                Discord Developer Portal
              </a>{" "}
              → Bot → Reset Token.
            </p>
          ) : null}

          <ChannelSecretField
            label="Bot token"
            value={botToken}
            onChange={setBotToken}
            placeholder="Paste bot token"
            shown={showToken}
            onToggleShown={() => setShowToken((v) => !v)}
          />

          <label className="check-row">
            <input
              type="checkbox"
              checked={autoEndpoint}
              onChange={(event) => setAutoEndpoint(event.target.checked)}
              disabled={pending}
            />
            <span>Auto-configure interactions endpoint</span>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={autoCommand}
              onChange={(event) => setAutoCommand(event.target.checked)}
              disabled={pending}
            />
            <span>Register /ask command</span>
          </label>
          {endpointConflict ? (
            <div className="channel-inline-warning" role="alert">
              <p className="channel-wizard-title">Endpoint conflict</p>
              <p className="muted-copy">
                Discord is configured for a different interactions endpoint. Overwriting it changes which deployment owns this Discord application.
              </p>
              <ChannelInfoRow label="Current">
                <code className="inline-code">
                  {endpointConflict.currentEndpointUrl ?? "Not set"}
                </code>
              </ChannelInfoRow>
              <ChannelInfoRow label="This deployment">
                <code className="inline-code">
                  {endpointConflict.desiredEndpointUrl ?? dc.webhookUrl}
                </code>
              </ChannelInfoRow>
              <div className="inline-actions">
                <button
                  type="button"
                  className="button primary"
                  disabled={pending || !botToken.trim()}
                  onClick={() => void handleRepairEndpoint()}
                >
                  Use this deployment endpoint
                </button>
                <button
                  type="button"
                  className="button ghost"
                  disabled={pending}
                  onClick={handleKeepExistingEndpoint}
                >
                  Keep existing endpoint
                </button>
              </div>
            </div>
          ) : null}
          {editing ? (
            <label className="check-row">
              <input
                type="checkbox"
                checked={forceOverwrite}
                onChange={(event) =>
                  setForceOverwrite(event.target.checked)
                }
                disabled={pending}
              />
              <span>Force overwrite existing endpoint</span>
            </label>
          ) : null}

          <div className="inline-actions">
            <button
              type="submit"
              className="button primary"
              disabled={pending || !dc.connectability.canConnect || !botToken.trim()}
            >
              {saving ? "Saving\u2026" : editing ? "Update" : "Connect"}
            </button>
            {editing ? (
              <button
                type="button"
                className="button ghost"
                disabled={pending}
                onClick={() => {
                  clearDrafts();
                  setEditing(false);
                }}
              >
                Cancel
              </button>
            ) : null}
          </div>
        </form>
      )}
      <ConfirmDialog {...dialogProps} />
    </ChannelCardFrame>
  );
}
