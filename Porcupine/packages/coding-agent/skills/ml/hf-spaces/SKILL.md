---
name: hf-spaces
description: >
  Build and deploy ML demo apps on Hugging Face Spaces: Gradio, Docker, or
  Static SDKs, ZeroGPU vs paid hardware, and debugging a Space that won't
  build or run. Use to host a public demo or app for a model.
stack: ml
---

# Hugging Face Spaces

A Space is a git repo hosting an app. Three SDKs:

| SDK | Use | Hardware |
|---|---|---|
| Gradio | default for ML demos, Python, ZeroGPU | compute |
| Docker | non-Python stack (Streamlit, etc.) | compute, no ZeroGPU |
| Static | plain HTML / Svelte / React, in-browser ML (transformers.js) | free, none |

## Auth + hardware reality

```bash
hf auth whoami    # note canPay and isPro
```

- **Static** Spaces are free for everyone, no hardware.
- **Gradio/Docker** need a paid plan, except a free account in good standing can
  host up to **2 ZeroGPU** Spaces.
- **ZeroGPU (`zero-a10g`)** is dynamic per-request GPU (RTX PRO 6000). Gradio +
  PyTorch only. Free to create; visitors spend their own quota.
- **Dedicated GPU** (T4/L4/A10G/A100/H200) is hourly-billed, `canPay=True` only.
  Check: `hf spaces hardware`.

## Workflow

1. Search prior art first: `hf spaces search "<model or task>" --sdk gradio`.
   Read an existing `app.py` + `requirements.txt` for the working pattern.
2. Decide SDK + hardware (Gradio + ZeroGPU for a public demo by default).
3. Create the Space, then write `app.py`, `requirements.txt`, and a README with
   YAML frontmatter (`title`, `sdk`, `app_file`, `pinned`).
4. Deploy by pushing to the Space repo (or `hf upload ... --type space`).
5. Debug: `hf spaces logs <ns>/<space>` and `hf spaces restart <ns>/<space>`.

## When to use

Hosting a demo, a public app, or an interactive report for a model.

## Pitfalls

- ZeroGPU is Gradio + PyTorch only; a non-PyTorch main model needs dedicated
  GPU (or a Static Space with in-browser inference).
- Free accounts: 2 ZeroGPU Spaces max. Beyond that needs PRO or a community
  grant.

---
*Adapted from huggingface/skills (Apache-2.0).*
