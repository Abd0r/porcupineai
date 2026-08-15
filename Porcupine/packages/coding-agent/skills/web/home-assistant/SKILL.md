---
name: home-assistant
description: Control a Home Assistant smart home through its MCP server. Query sensor and entity states read-only, then act on devices (lights, switches, climate) via call_service with explicit user approval. Use for "turn off the living room lights", "what is the thermostat set to", "set bedroom temp", or any Home Assistant entity/device task.
stack: web
---

# Home Assistant Control

Connect to a Home Assistant instance via the **Model Context Protocol** and drive
its entities through the MCP tools. The server runs over **Streamable HTTP** at
`/api/mcp` (or through a local `mcp-proxy` gateway) and authenticates with a
long-lived access token. Configure it as an MCP server (see
`examples/mcp-home-assistant/`) before using this skill; environment hooks only
make sense once the tools are actually connected.

## When to use

- Query home state: light/sensor/climate/switch status, entity attributes.
- Operate devices: "turn on/off", set a temperature, adjust a fan, run a service.
- NOT for local coding, filesystem work, or anything unrelated to the home.

## Tool discovery

- Home Assistant MCP tools register namespaced as `server_toolname` (e.g.
  `homeassistant_get_states`). Exact names differ by server — run `/mcp status`
  to list the live tools before relying on a specific one.
- Common operations map to `get_states`, `get_state`, `get_services`,
  `call_service`, and the `assist` chat tool.

## Safe workflow (fail-closed)

1. **Read first.** Start with `get_states` / `get_state` / `get_services` to
   learn the current state and the available entities/domains before touching
   anything. Never assume an entity id, domain, or attribute.
2. **Prefer least-privilege.** Query the exact entity or domain you need; do not
   pull every state and dump it into context.
3. **Confirm before controlling.** `call_service` changes device state, so it is
   the only inherently-stateful MCP path here. Do not invoke an `on`/`off`,
   `set_temperature`, or `turn_on`/`turn_off` service without explicit user
   approval unless the user pre-authorized it. In Porcupine terms this means the
   tool must be on the server `allow` list (Normal/Auto) or confirmed in Ask
   mode — never bypass the gate.
4. **Respect permission modes.** Ask confirms every call, Normal confirms
   non-allowlisted calls, Auto routes through the fail-closed classifier.
   Destructive actions remain blocked in all modes unless explicitly allowed.
5. **Verify after acting.** Confirm the desired state change actually happened
   (re-query the entity) and report the result.

## Common tasks

- **Turn on/off a light:** `get_state` on `light.<entity>` to confirm the id, then
  `call_service` with domain `light`, service `turn_on`/`turn_off`, and the
  matching entity_id. Re-query to verify.
- **Read a sensor:** `get_state` on `sensor.<entity>`; report the numeric value,
  unit, and timestamp.
- **Climate:** query `climate.<thermostat>` for `current_temperature` and
  `temperature`; to change it, `call_service` domain `climate`, service
  `set_temperature`, with the target `temperature` and the entity_id.
- **Bulky problems:** a light not responding → check the entity's `state` and
  `availability` attribute before assuming a hardware fault.

## Pitfalls

- **Guessing entity ids** — always `get_states`/probe first; ids are
  instance-specific and never predictable.
- **Unapproved writes** — `call_service` mutates your home; confirm before every
  control action you were not explicitly told to do.
- **Dumping context** — pulling every entity state bloats the window and slows
  the agent; query narrowly.

## Verification

- The action was authorized (allowlisted or confirmed) and executed.
- The entity re-queried into the expected state (e.g. `light` from `off` to `on`;
  `climate.temperature` equals the requested value).
- The user was told what changed, with no promise made that the query could not
  support (e.g. an entity id you never confirmed).
