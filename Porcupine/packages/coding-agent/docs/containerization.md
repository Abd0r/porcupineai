# Containerization

Porcupine runs with all permissions by default, but in some cases, you will want to have more control over what directories Porcupine can write to and which accesses it has.

## Why sandboxing is not native

Porcupine is native-first on purpose. Sandboxing by default is one of the worst things you can do to an agent you actually want to use: it kills the agent's practical usage and turns it into a showpiece.

An agent you use every day does real work in your real environment. It installs packages with your package manager, runs your test suite against your databases, talks to your git remotes, reads your browser session, and calls your internal services with your credentials. Every one of those actions crosses a boundary that a default sandbox has to either allow or deny.

If the sandbox allows them, it is not a safety boundary, it is ceremony. If it denies them, the agent stops at the first real task and waits: mount this, configure that, approve this one exception. What you are left with is an agent that can read a project and edit files inside a cage, but cannot actually do the job. That is a showpiece, not a worker.

The safety model that keeps an agent practical is the permission dial, not the cage:

- **Ask / Normal / Auto** choose what may run without asking (see [security.md](security.md)).
- The **fail-closed safety gate** and the **hardline list** keep destructive actions blocked in every mode.
- The **native per-command write-fence** (Auto Mode) confines shell writes to the workspace and standard cache dirs without a VM or container.

Those guardrails run on the host, where the agent is useful. Real isolation stays available exactly where it belongs: untrusted or unmonitored work, with a one-command opt-in (`/sandbox on` for the Gondolin micro-VM) or a whole-process container when you want the strongest boundary.

Native-first is not an omission. It is the difference between an agent you use and an agent you show people.

There are two general options for when you do want isolation. You can either
1. run the the whole `porcupine` process inside an isolated environment, or
2. run `porcupine` on the host and route tool execution into an isolated environment.

## Choose a pattern

| Pattern | What is isolated | Best for | Notes |
| --- | --- | --- | --- |
| Gondolin extension | Built-in tools and `!` commands | Local micro-VM isolation while keeping auth on host | See [`examples/extensions/gondolin/`](../examples/extensions/gondolin/). |
| Plain Docker | Whole `porcupine` process in a local container | Simple local isolation | Provider API keys enter the container. |
| OpenShell | Whole `porcupine` process in a policy-controlled sandbox | Local or remote managed sandbox | Requires an OpenShell gateway |
| Native per-command write-fence | Shell file writes outside the workspace/temp (Auto Mode) | Lightweight OS-level write fence, no VM or container | On automatically in Auto Mode; see [security.md](security.md) |

Extensions run wherever the `porcupine` process runs. If you run host `porcupine` with a tool-routing extension, other custom extension tools still run on the host unless they also delegate their operations.

## Gondolin

[Gondolin](https://github.com/earendil-works/gondolin) is a local Linux micro-VM.
Use the [example extension](../examples/extensions/gondolin) when you want `porcupine` on the host but all built-in tools routed into the VM.

**One-command activation:** run `/sandbox on` inside the interactive TUI. It
copies the bundled Gondolin extension to `~/.porcupine/agent/extensions/gondolin`,
installs `@earendil-works/gondolin` there, registers it in settings, and
hot-reloads — no manual copying. `/sandbox status` checks requirements (Node
>= 23.6, QEMU, VM state) and `/sandbox off` unregisters it.

Manual setup (equivalent):

```bash
cp -R packages/coding-agent/examples/extensions/gondolin ~/.porcupine/agent/extensions/gondolin
cd ~/.porcupine/agent/extensions/gondolin
npm install --ignore-scripts
```

Run from the project you want mounted:

```bash
cd /path/to/project
porcupine -e ~/.porcupine/agent/extensions/gondolin
```

The extension mounts the host cwd at `/workspace` in the VM and overrides `read`, `write`, `edit`, `bash`, `grep`, `find`, and `ls`.
User `!` commands are routed into the VM, as well.
File changes under `/workspace` write through to the host.

Requirements: Node.js >= 23.6.0 for `@earendil-works/gondolin`, plus QEMU (requires installation through your package manager).

## Plain Docker

Run the the whole `porcupine` process in Docker when you want the simplest local container boundary.

`Dockerfile.porcupine`:

```dockerfile
FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates git ripgrep \
  && rm -rf /var/lib/apt/lists/*
RUN npm install -g --ignore-scripts @porcupineai/coding-agent

WORKDIR /workspace
ENTRYPOINT ["porcupine"]
```

Build and run:

```bash
docker build -t porcupine-sandbox -f Dockerfile.porcupine .

docker run --rm -it \
  -e ANTHROPIC_API_KEY \
  -v "$PWD:/workspace" \
  -v porcupine-agent-home:/root/.porcupine/agent \
  porcupine-sandbox
```

The `-v "$PWD:/workspace"` mounts your current directory into the container at /workspace such that reads and writes in `/workspace` inside Docker directly affect your host files, like in the Gondolin example.

Use a named volume for `/root/.porcupine/agent` if you want container-local settings and sessions. Mounting your host `~/.porcupine/agent` exposes host auth and session files to the container.

## OpenShell

Use [NVIDIA OpenShell](https://docs.nvidia.com/openshell/about/overview) when you want a policy-controlled sandbox with filesystem, process, network, credential, and inference controls.
OpenShell can run sandboxes through a local gateway backed by Docker, Podman, or a VM runtime, or through a remote Kubernetes gateway.

Every sandbox requires an active gateway.
Register and select one before creating a sandbox:

```bash
openshell gateway add <gateway-url> --name <name>
openshell gateway select <name>
```

Launch `porcupine` inside an OpenShell sandbox:

```bash
openshell sandbox create --name porcupine-sandbox --from porcupine -- porcupine
```

In this pattern, the the whole `porcupine` process runs inside the sandbox.
Built-in tools, `!` commands, and extension tools execute inside the OpenShell boundary.

If the gateway is remote, project files are not bind-mounted from the host, meaning writes in the sandbox are not reflected on your machine.
Clone the repository inside the sandbox or use OpenShell file transfer commands:

```bash
openshell sandbox upload porcupine-sandbox ./repo /workspace
openshell sandbox download porcupine-sandbox /workspace/repo ./repo-out
```

OpenShell providers can keep raw model API keys outside the sandbox.
When inference routing is configured, code inside the sandbox can call `https://inference.local`, and the gateway injects the configured provider credentials upstream.
Configure Porcupine to use the corresponding OpenAI-compatible or Anthropic-compatible endpoint if you want model traffic to use this route.
