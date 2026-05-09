# vercel-openclaw Docs

Start here if you want to understand how the app works in practice.

## Core docs

- [Getting Started Guide](getting-started/README.md)
- [Architecture](architecture.md)
- [Sandbox Lifecycle and Restore](lifecycle-and-restore.md)
- [Preflight and Launch Verification](preflight-and-launch-verification.md)
- [Channels and Webhooks](channels-and-webhooks.md)
- [Environment Variables](environment-variables.md)
- [Deployment Protection](deployment-protection.md)
- [API Reference](api-reference.md)
- [Architecture Tradeoffs](architecture-tradeoffs.md)

## Reading order

1. **Getting Started Guide** — main handoff for the three-repo system, operational paths, `vclaw create`, release, and reliability contracts
2. **Architecture** — what the app is, what it is not, and how requests flow through it
3. **Sandbox Lifecycle and Restore** — how the sandbox is created, resumed, stopped, and woken by cron (persistent sandboxes with auto-snapshot)
4. **Preflight and Launch Verification** — how config readiness and runtime readiness are checked
5. **Channels and Webhooks** — how channel setup (Slack, Telegram, WhatsApp, Discord), readiness, and protection behavior fit together
6. **Environment Variables** — every variable the app reads and when each one matters
7. **Deployment Protection** — how Vercel Deployment Protection interacts with channel webhooks
8. **API Reference** — request and response shapes for the admin and automation surfaces
9. **Architecture Tradeoffs** — why the codebase is shaped the way it is, alternatives explored, and what you give up with each approach
