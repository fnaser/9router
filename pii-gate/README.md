# 9router PII gate (optional sidecar)

Uses [LiquidAI/LFM2.5-Encoder-350M-PII-Detector](https://huggingface.co/LiquidAI/LFM2.5-Encoder-350M-PII-Detector)
to detect PII / credentials in a short prompt head. When sensitive, 9router forces
`company` account tier (`x-9router-account-tier` path from PR #21).

## Run

```bash
cd ~/9router/pii-gate
uv venv && source .venv/bin/activate
uv pip install torch transformers huggingface_hub
python server.py
# listens on 127.0.0.1:20129
```

First start downloads ~350M weights (trust_remote_code). Prefer `PII_GATE_DEVICE=mps` on Apple Silicon.

## Point 9router at it

```bash
export FORK_PII_GATE_URL=http://127.0.0.1:20129/classify
# optional: FORK_PII_GATE_TIMEOUT_MS=800
# then restart 9router / launchd
```

Fail-open: if the gate is down or slow, requests proceed with no tier filter.

## API

`POST /classify` `{"text":"Email jane@acme.com"}` →

```json
{"sensitive": true, "types": ["contact.email"], "spans": [{"type":"contact.email","text":"jane@acme.com",...}]}
```

## Note

This covers PII + credentials well. True **company IP** (deals, unreleased product)
still needs a separate signal — this model is not a full `company_ip` classifier.
