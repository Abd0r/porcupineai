# Browser use

Porcupine ships a native browser-use module built on **Playwright** (the OSS
automation engine). The agent can open a real Chromium page, inspect its ARIA
semantics, navigate, click, type, wait for page state, resize the viewport,
extract text, capture diagnostics and screenshots, and run JavaScript against
it. This supports rendered-SPA inspection, responsive and accessibility checks,
form workflows, and visual proof.

## Setup (one-time)

Playwright is an optional, lazily-loaded dependency. Install it and download the
Chromium binary once:

```sh
npx playwright install chromium
```

No browser is installed at package-install time, so daily use of Porcupine never
pulls in a browser unless you want one.

## Headed vs headless

- By default the browser runs **headless** (no visible window).
- To watch what the agent is doing in real time, set `PORCUPINE_BROWSER_VISIBLE=1`.
  When set, the browser window stays open so you can see navigations and clicks.
- This also works from the terminal:

```sh
PORCUPINE_BROWSER_VISIBLE=1 porcupine
```

## Safety

Agent-controlled browsing is scoped to be conservative by default:

- **Dedicated profile.** Each headless/headed session uses an isolated Chromium
  context, so browsing never touches your personal profile, saved passwords, or
  extension state.
- **Sessions close after idle.** The shared browser session is closed and reset
  when the app exits or reloads; long-lived pages are never kept around between
  sessions.
- **No credential auto-fill.** Authentication fields are never auto-filled. The
  agent reaches a login page only because the code asked for it, and credentials
  are never injected silently.
- **Timeouts.** Every navigation and network-touching call gets a timeout
  (15 seconds by default), so a hung page can never stall the agent forever.

## Tool reference

All tools operate on a single shared browser session. Call `browser_navigate`
first to open a page; everything else acts on that open page.

| Tool | Arguments | Description |
| --- | --- | --- |
| `browser_navigate` | `url`, optional `timeoutMs` | Open a URL; launches Chromium on first use and returns URL + title. |
| `browser_snapshot` | optional `depth`, `boxes` | Capture an AI-oriented ARIA snapshot with roles, names, states, and stable refs. |
| `browser_click` | `selector` | Click a CSS or Playwright selector. Prefer an `aria-ref` from a snapshot when available. |
| `browser_type` | `selector`, `text` | Fill an input selected by CSS or an ARIA ref. |
| `browser_wait` | `selector`, optional `state`, `timeoutMs` | Wait for visible/hidden/attached/detached state without arbitrary sleeps. |
| `browser_extract` | optional `selector` | Extract rendered text from a selector or the whole body. |
| `browser_resize` | `width`, `height` | Set an exact CSS-pixel viewport for responsive verification. |
| `browser_diagnostics` | none | Report bounded console messages, page errors, failed requests, and HTTP failures since navigation. |
| `browser_screenshot` | optional `path` | Save a full-page PNG inside the working directory. |
| `browser_evaluate` | `expression` | Evaluate JavaScript and return a stringified result. |

Failures — badly formed URLs, missing elements, and timeouts — come back as
readable messages, never bare stack dumps.

## Examples

Open a page and read its rendered heading:

```
browser_navigate { "url": "https://example.com" }
browser_extract { "selector": "h1" }
```

Search a site by filling a form and checking the results:

```
browser_navigate { "url": "https://duckduckgo.com" }
browser_type { "selector": "#searchbox_input", "text": "playwright headless" }
browser_click { "selector": "button[type=submit]" }
browser_extract
```

Count rows in a rendered table with JavaScript:

```
browser_navigate { "url": "https://example.com/data" }
browser_evaluate { "expression": "document.querySelectorAll('tr').length" }
```

Inspect semantics, interact by stable ref, and check runtime health:

```
browser_snapshot { "depth": 12 }
browser_click { "selector": "aria-ref=e7" }
browser_wait { "selector": "[data-state=ready]", "state": "visible" }
browser_diagnostics {}
```

Verify mobile and desktop layouts before reporting completion:

```
browser_resize { "width": 390, "height": 844 }
browser_screenshot { "path": "mobile.png" }
browser_resize { "width": 1440, "height": 900 }
browser_screenshot { "path": "desktop.png" }
```

For local development servers, the default SSRF guard blocks loopback/private
hosts. Only in a trusted project, start Porcupine with
`PORCUPINE_BROWSER_ALLOW_INTERNAL=1`; this disables that protection for the
session, so never combine it with untrusted URLs or content.
