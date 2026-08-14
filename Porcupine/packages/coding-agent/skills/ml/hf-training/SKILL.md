---
name: hf-training
description: >
  Fine-tune models on Hugging Face: set up a training run with transformers or
  TRL (SFT, DPO), run it locally or as an HF Job on cloud GPU, and push the
  checkpoint to the Hub. Use for fine-tuning, LoRA, or PEFT training of LLMs or
  vision models.
stack: ml
---

# Hugging Face Training

The path from a base model + dataset to a trained checkpoint on the Hub.

## Choose the tool

| Goal | Tool |
|---|---|
| Supervised fine-tune an LLM | `trl.SFTTrainer` (LoRA by default via PEFT) |
| Preference optimization (RLHF-style) | `trl.DPOTrainer` |
| Plain transformers training | `transformers.Trainer` |
| Sentence embeddings | `sentence-transformers` |

Prefer `TRL` + `PEFT` (QLoRA) when GPU memory is limited — it trains large
models on one consumer GPU.

## Minimal SFT skeleton

```python
from transformers import AutoModelForCausalLM, AutoTokenizer
from datasets import load_dataset
from trl import SFTTrainer, SFTConfig

model = AutoModelForCausalLM.from_pretrained("meta-llama/Llama-3.1-8B", load_in_4bit=True)
tokenizer = AutoTokenizer.from_pretrained("meta-llama/Llama-3.1-8B")
ds = load_dataset("ns/dataset", split="train")

trainer = SFTTrainer(
    model=model,
    args=SFTConfig(output_dir="./out", per_device_train_batch_size=1,
                   gradient_accumulation_steps=8, max_seq_length=2048),
    train_dataset=ds,
    tokenizer=tokenizer,
)
trainer.train()
```

Then push the checkpoint:

```bash
hf upload <ns>/<model-name> ./out --type model --commit-message "sft run"
```

## Run on cloud GPU (HF Jobs)

When local hardware is insufficient, run the same script as a Job:

```bash
hf jobs run python:3.12 "pip install trl peft && python train.py" \
  --flavor l4x1 --env-file .env --secrets HF_TOKEN
hf jobs logs <job-id> -f
```

Check hardware options with `hf jobs hardware`, and pin the cheapest flavor
that fits (l4x1, a10g, a100 depending on model size).

## When to use

Fine-tuning or LoRA training (e.g. NANOG1, GEKO-style efficient fine-tuning)
that ends in a Hub checkpoint.

## Pitfalls

- Reproduce the run: pin model revision, dataset revision, and seeds (see
  `sci/reproducible-experiments`).
- Push the final checkpoint + a model card; don't leave it in a throwaway job.
- Don't regenerate provider model data — train on your own dataset.

---
*Adapted from huggingface/skills (Apache-2.0).*
