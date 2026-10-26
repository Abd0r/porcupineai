# Local Browser Workbench

`porcupine --serve` serves a local browser workbench at the server root, for example `http://127.0.0.1:4096/`. The existing terminal interface remains available; the workbench is an additional client of the same session API.

Start the server with a token:

```bash
porcupine --serve --port 4096 --token <secret>
```

Open the local address in your browser and enter the token in the connection form. The page keeps it in memory for that tab only. For an explicitly tokenless loopback server, set `PORCUPINE_SERVE_ALLOW_TOKENLESS=1` as documented in [server.md](./server.md).

The workbench supports session selection and creation, live message events, prompt submission, abort, explicit permission decisions, and model-requested 3D scenes. For a spatial explanation, the model can call `visualize_3d`; the browser renders its validated boxes, spheres, and arrows on an interactive canvas. Scenes are bounded to 80 objects and coordinates in `[-20, 20]`. The model supplies data, not executable code, meshes, URLs, or external assets. The first renderer is deliberately small; charts and other adaptive answer components remain future work.

The view shows activity from the time a session is opened; the current HTTP API does not provide prior transcript history. The server serves the static page without exposing session data. All session API calls still require the configured bearer token, and the existing same-origin check applies. Keep the server bound to loopback for browser use. Do not send the bearer token over an untrusted network or expose the plain-HTTP server to the public internet.
