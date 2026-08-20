# Local models (Apple Silicon)

Porcupine talks to local servers. It does not load weights itself. On a Mac, use one of these three native paths:

| Runtime | Best for | Login | List models | Default URL |
|---|---|---|---|---|
| **llama.cpp** | GGUF, Metal via `-ngl`, router load/unload | `/login llama.cpp` | `/llama` | `http://127.0.0.1:8080` |
| **Ollama** | One-command pulls, Metal by default on macOS | `/login ollama` | `/ollama` | `http://127.0.0.1:11434` |
| **MLX** (`mlx_lm.server`) | Native Apple Silicon weights | `/login mlx` | `/mlx` | `http://127.0.0.1:8080` |

After login, `/model` only shows models the server currently lists. Cost is always zero. No cloud key is required.

llama.cpp and MLX both default to port **8080**. Do not run both on the same port. Point one of them at `8081` (or any free port) and enter that URL at `/login`.

## Ollama

Install Ollama, pull a model, then connect Porcupine:

```bash
ollama pull qwen2.5-coder:7b
export OLLAMA_BASE_URL=http://127.0.0.1:11434
porcupine
```

Or inside the TUI:

```text
/login ollama
/ollama
/model
```

`/login ollama` probes the server (`/api/tags`, then `/v1/models`). The API key prompt is optional; local Ollama ignores it.

On Apple Silicon, Ollama uses Metal automatically. No extra GPU flag.

Environment:

- `OLLAMA_BASE_URL` — management URL (no `/v1` suffix). Default `http://127.0.0.1:11434`.
- `OLLAMA_API_KEY` — optional. Used only if the server is locked down.

You can still add a static Ollama block in `models.json`. The native provider is the supported path: it discovers whatever is pulled, without editing JSON.

## MLX

MLX is Apple Silicon only. Install the official server and start it with an MLX-community model:

```bash
pip install mlx-lm
mlx_lm.server --model mlx-community/Llama-3.2-3B-Instruct-4bit --port 8080 --host 127.0.0.1
```

Then:

```text
/login mlx
/mlx
/model
```

Or:

```bash
export MLX_BASE_URL=http://127.0.0.1:8080
porcupine
```

`mlx_lm.server` speaks OpenAI chat completions on `/v1`. `/login mlx` lists `/v1/models`. If you also run llama.cpp, start MLX on another port:

```bash
mlx_lm.server --model mlx-community/Qwen2.5-7B-Instruct-4bit --port 8081 --host 127.0.0.1
```

Environment:

- `MLX_BASE_URL` — management URL. Default `http://127.0.0.1:8080`.
- `MLX_API_KEY` — optional.

The MLX HTTP server is a local development endpoint. Keep `--host 127.0.0.1`.

## llama.cpp

Full router, Hugging Face download, and load/unload UI: [llama.cpp](llama-cpp.md).

On Apple Silicon, start the router with Metal offload:

```bash
llama-server \
  --models-dir ~/models \
  --no-models-autoload \
  --jinja \
  --host 127.0.0.1 \
  --port 8080 \
  -ngl 999 \
  -c 32768
```

`-ngl 999` offloads as many layers as fit in unified memory.

## Which one to pick

| You have | Use |
|---|---|
| A GGUF file / want `/llama` download + load | llama.cpp |
| `ollama pull` already on the machine | Ollama |
| An `mlx-community/*` model, M-series Mac | MLX |

All three stay native-first: the model never leaves the machine, and Porcupine still applies Ask / Normal / Auto on tool calls.
