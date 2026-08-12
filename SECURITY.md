# Security Policy

Porcupine is a native-first terminal AI agent. By default, it runs with the permissions of the user account that starts it and treats files writable by that account as part of the same local trust boundary.

## Supported versions

Security fixes are made against the latest release and `main`. Before reporting a vulnerability, reproduce it on the latest available version when practical.

## Report a vulnerability privately

**Do not open a public Issue for a suspected vulnerability.**

Use GitHub's private vulnerability reporting form:

**[Report a vulnerability privately](https://github.com/Abd0r/porcupineai/security/advisories/new)**

Include:

- the affected version, commit, package, platform, and configuration;
- a concise description of the impact and security boundary crossed;
- minimal reproduction steps or a proof of concept;
- relevant logs with credentials and personal information removed;
- known mitigations, if any.

Never include API keys, tokens, passwords, private session content, or other secrets. A maintainer will review the report and continue the discussion privately through GitHub.

## Security model

### Local permissions

Porcupine's built-in tools and TypeScript extensions run with the permissions of the Porcupine process. Shell commands, package managers, language servers, test commands, and other developer tools behave like ordinary local processes.

### Project trust

Project trust controls whether project-local settings, packages, extensions, skills, prompts, themes, and related resources may load. It is an input-loading guard, not an operating-system sandbox.

Repository files and generated output can contain prompt injection. Use trusted repositories, review project instructions, and treat third-party skills, extensions, MCP servers, and packages as untrusted until reviewed.

### Interaction modes

Ask, Normal, and Auto define Porcupine's approval boundary:

- **Ask** confirms every shell command and file mutation.
- **Normal** permits safe operations and confirms flagged operations.
- **Auto** permits safe operations while flagged shell actions pass through a fail-closed safety gate.

Hardline destructive actions remain blocked in every mode. Reasoning depth does not grant additional permissions.

### Native computer interaction

Native computer input is confirmation-gated. Porcupine observes before acting, treats screen content as untrusted, performs one approved input action, and observes again. Publishing, sending, buying, deleting, changing credentials or security settings, and accepting legal terms require fresh explicit approval.

### Optional isolation

Porcupine is native-first and does not claim that project trust is a sandbox. When stronger isolation is required, use an operating-system or virtualization boundary:

- `/sandbox on` routes built-in tools into a Gondolin micro-VM;
- run Porcupine or the target workload in Docker, a VM, or OpenShell;
- expose only the required workspace paths, network access, and credentials.

A writable bind mount still allows the isolated process to modify the mounted host files.

### Remote and programmatic access

Telegram, Discord, and iMessage bridges are allowlist-gated and run inside the shared attended session. `porcupine serve`, RPC, and JSONL modes can expose powerful agent operations; bind and authorize them according to their documentation and do not expose them publicly without an appropriate security boundary.

## In scope

Reports are generally in scope when they demonstrate a reproducible vulnerability in the current Porcupine release or `main`, including:

- bypassing an approval, hardline-denial, allowlist, trust, or authentication boundary;
- gaining access beyond the permissions and inputs intentionally provided by the user;
- leaking Porcupine-managed credentials or private data without user approval;
- remotely invoking tools or controlling a session without authorization;
- exploitable vulnerabilities in distributed packages, CLI behavior, APIs, or repository code;
- dependency vulnerabilities that are reachable through shipped Porcupine functionality.

## Generally out of scope

Unless a report demonstrates that Porcupine itself crosses a documented boundary, these are generally out of scope:

- actions explicitly approved or initiated by the user;
- behavior that requires prior write access to the user's home directory, workspace, shell startup files, environment, or Porcupine configuration;
- malicious behavior from user-installed extensions, skills, packages, tools, or MCP servers;
- prompt injection or malicious model output without a separate boundary bypass;
- risks inherent in running untrusted repositories or generated code without isolation;
- intentionally weakened configuration or publicly exposed local services;
- denial-of-service claims requiring trusted local input or configuration;
- third-party credentials or infrastructure not owned or controlled by Porcupine.

The most useful reports identify the exact boundary that was expected to hold and show how current Porcupine code bypasses it.

## Additional guidance

Read the detailed [security documentation](Porcupine/packages/coding-agent/docs/security.md) and [containerization guide](Porcupine/packages/coding-agent/docs/containerization.md) for operational guidance.
