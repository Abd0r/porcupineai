# Home Assistant MCP integration example

Control a Home Assistant instance through Porcupine's MCP client. Home Assistant
exposes an official **Model Context Protocol Server** integration: enable it in
Home Assistant (Settings → Devices & services → *Model Context Protocol
Server*), expose the entities you want the agent to manage, and connect Porcupine
as an MCP client.

The server is served by Home Assistant over **Streamable HTTP** at `/api/mcp`
and authenticates with a Home Assistant **long-lived access token**
(Profile → Security → Long-lived access tokens).

## Prerequisites

- A Home Assistant instance running the official *Model Context Protocol
  Server* integration, with at least one exposed entity.
- A long-lived access token. Treat it as a secret — grant least privilege and
  never commit it.

## Environment variables

Set these before starting Porcupine (or put them in your shell profile / the
Porcupine settings env file):

```bash
export HASS_URL="http://homeassistant.local:8123"   # your instance base URL
export HOME_ASSISTANT_TOKEN="eyJhbGciOi..."          # long-lived access token
```

The example configs reference both via `${VAR}` expansion. Porcupine also lets
you inline values directly in the project `mcp.json`, but env vars keep secrets
out of files.

## Option 1 — Streamable HTTP (direct)

This is the simplest path since Porcupine natively supports Streamable HTTP v2
remote servers. Copy `mcp.json` into your project as `.porcupine/mcp.json` (or
merge into `<cwd>/.porcupine/mcp.json`):

```bash
mkdir -p .porcupine
cp examples/mcp-home-assistant/mcp.json .porcupine/mcp.json
```

## Option 2 — stdio via a local gateway

If you would rather run the server as a local stdio process (for example behind
an MCP gateway), Porcupine can launch `mcp-proxy` with `npx` and forward the
Streamable HTTP endpoint through it. Copy `mcp.stdio.json` similarly:

```bash
cp examples/mcp-home-assistant/mcp.stdio.json .porcupine/mcp.json
```

This requires a Node runtime with network access to your Home Assistant
instance (it runs `npx -y mcp-proxy …` on demand).

## Configure the allowlist

Porcupine's MCP model is **fail-closed**: an MCP tool does nothing until it is
allowed. The `allow` arrays in the examples are a starting point for common
Home Assistant tool names (`assist`, `get_states`, `get_state`, `call_service`).
Exact tool names differ by server and version — run `/mcp status` after
connecting to list the live tools, then tighten `allow` to exactly what you
need.

Security guidance:

- **Start read-only**: allow only query tools (`get_states`, `get_state`) first.
- **Add control tools deliberately**: `call_service` can change device state —
  only allow it after you are comfortable, and keep destructive operations
  interactively confirmed.
- **Respect permission modes**: Porcupine confirms non-allowlisted MCP calls in
  Normal mode and asks in Ask mode. Destructive actions remain blocked in all
  modes unless explicitly allowed.

## Verify

```text
/mcp status          → server shows connected, tool/resource counts nonzero
/mcp reload          → re-read config / re-approve after changes
```

## Also see

- [MCP support docs](../../docs/mcp.md)
- [Home Assistant MCP Server skill](../../skills/web/home-assistant/SKILL.md)
