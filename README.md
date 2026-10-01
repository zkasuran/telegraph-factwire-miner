# FactWire fact and content trust miner for Telegraph

One Cloudflare Worker that answers four model-judged Telegraph trust intents by calling a language
model at request time and returning its answer as the graded summary.

| Intent | Endpoint | Descriptor id | The answer is |
| --- | --- | --- | --- |
| FACT_CHECK | `/fact-check` | 7420 | a one word verdict (True, False, Partly true or Unverifiable) then one or two sentences of the facts that settle the claim |
| CONTENT_VERIFICATION | `/verify` | 7428 | a verdict, Accurate or Inaccurate, plus a short factual explanation naming the correct facts |
| TEXT_AUTHENTICITY_CHECK | `/authenticity` | 7429 | a hedged verdict on human vs machine authorship, the signals and a plain low confidence and not proof note |
| AI_TEXT_DETECTION | `/ai-detect` | 7430 | a hedged verdict (Likely AI, Likely human or Uncertain), the signals and a plain low confidence and not proof note |

These are the model-judged (Tier B) tier of the network. The node writes its own ground truth for
each one with a model. The live scoring modules grade the summary, so a genuinely correct, well
reasoned answer to the question is what scores. This miner produces that answer with MiniMax rather
than guessing a shape.

## The model source

Every answer is one call to `MiniMax-M3` on the MiniMax API. This miner is **not keyless**, which
is the one deliberate exception to the rule the other wire miners follow. It runs under a paid
commercial MiniMax plan held by the operator. The key is a Cloudflare secret:

- the worker reads it as `env.MINIMAX_API_KEY`
- it is never written into `worker.js`, `wrangler.toml`, a descriptor, this README or any other
  file in this repo

The model terms, the plan and the one open licensing item are in `NOTICE` and `DATA-SOURCES.md`.

MiniMax-M3 is a reasoning model. It writes a `<think>` block before its answer, which the worker
strips, returning only the verdict and reasoning as the summary the node grades. Measured latency
on these prompts was 2.7 to 8.3 seconds per call, so the worker request timeout is 25 seconds and
`max_tokens` is set high enough that the full answer, including the low confidence note on the two
detection intents, survives the reasoning block.

## Honesty on the two detection intents

AI text detection and text authenticity detection are not reliable. The `/ai-detect` and
`/authenticity` answers never claim certainty. Each leads with a hedged verdict, names the signals
it read, then states plainly that the reading is low confidence and not proof. Each carries a
confidence of 0.6 rather than the 0.96 the fact-check and verification answers carry. This miner
does not claim a measured detector accuracy, because none was measured. The answer is a genuine
model judgment plus the linguistic signals it rests on, framed as the low confidence read it is.

## Endpoints

Each route takes the claim or text or the whole question on the query string. The bare route is
declared, never a template, so the node's exact-path match always lands.

```
GET /fact-check?claim=<the claim or the whole question>
GET /verify?text=<the claim or the whole question>
GET /authenticity?text=<the text or the whole question>
GET /ai-detect?text=<the text or the whole question>
```

The input is read from the first non-empty of a short list of common field names, claim or text
first for the route's own subject then the shared question-style names (`question`, `query`, `q`,
`input`, `content`), so passing the whole question works as well as passing the bare value.

```
GET /health     the intents served and whether the key is configured
GET /__last      the last few requests, for diagnostics
GET /            a usage summary
```

## The response

```json
{
  "intent": "FACT_CHECK",
  "verdict": "False",
  "summary": "False. The Eiffel Tower is located in Paris, France, not Berlin.",
  "confidence": 0.96,
  "model": "MiniMax-M3",
  "source": "MiniMax language model",
  "attribution": "Answer produced with MiniMax (MiniMax-M3) under a commercial MiniMax plan held by zkasuran.",
  "as_of": "2026-10-01T00:00:00.000Z"
}
```

The node grades the `summary` field, so each descriptor sets `label_field: summary`. The `verdict`
field is a convenience sibling for a reader.

## Never a non-200 on a declared route

The node reads any 4xx or 5xx on a declared route as no answer and zeroes the whole epoch. So every
path answers 200: a missing input returns an honest note at confidence 0.2. A missing key, a model
error or a timeout returns a plain statement that the answer could not be produced, also at low
confidence. Only an undeclared path returns 404.

## Deploy

The worker itself needs no build. Two steps:

```bash
wrangler deploy
wrangler secret put MINIMAX_API_KEY      # paste the key when prompted, once
```

The secret is set on the deployed worker, not in this repo. `GET /health` reports `key_configured`
so you can confirm it landed without exposing the value.

## Verified before ship

Scored offline under each intent's own live scoring module (downloaded byte for byte and
keccak-verified) with `work/telegraph/minerlab/rank.py`. Genuine MiniMax-M3 answers were scored
against a self-authored checkable reference, alongside wrong, overclaiming and off-topic controls
so the check can be seen to fail.

| Intent | Genuine M3 answer | Wrong or overclaiming control | Off-topic control | Live leader |
| --- | --- | --- | --- | --- |
| FACT_CHECK | 1.000000 | 0.000000 | 0.000000 | livecert clears 1.0 on some epochs |
| CONTENT_VERIFICATION | 1.000000 | 0.000000 | 0.000000 | floored near 1e-11 |
| TEXT_AUTHENTICITY_CHECK | 0.999999 | 0.000000 | 0.000000 | txlens clears 0.999999 on some epochs |
| AI_TEXT_DETECTION | 1.000000 | 0.000000 | 0.000000 | floored near 8e-10 |

Diagnostics established that the modules reward correctness, not a hidden phrase: a differently
worded correct answer scores about 1.0 while a wrong verdict, a confident overclaim without the
honesty hedge or an off-topic answer all score 0.0. On CONTENT_VERIFICATION and AI_TEXT_DETECTION
the whole live board floors near zero, so a genuinely correct answer has clear room above the
leader. On FACT_CHECK and TEXT_AUTHENTICITY_CHECK a leader does clear to about 1.0 on some epochs,
which confirms the module is clearable by a real answer and this miner matches it.

Honest caveats. The reference is self-authored because the node's hidden ground truth cannot be
read, so a score of 1.0 means the answer matches a known-correct reference under the live module,
not that it reproduces a hidden string. FACT_CHECK runs on a small hard-step module: a correct
answer clears to 1.0 or lands on the bottom rail with no partial credit. Even the live leader is
high variance epoch to epoch, so this intent is winnable but noisier than the others.

## Licence and data terms

- `LICENSE`: Source-Available No-Derivatives 1.0. Read it, audit it, run your own instance, publish
  what you find. Do not redistribute it or redeploy it as a competing miner. Calling the live
  endpoint is not restricted.
- `NOTICE` and `DATA-SOURCES.md`: the MiniMax terms, the paid plan, the credit line carried in every
  answer and the one open item (the paid Open Platform output-ownership clause could not be read
  from the client-rendered terms page, so it is recorded as unverified).

AI note: the answers this miner serves are produced by MiniMax. That is the whole design and it is
stated in every response, in `NOTICE` and here.
