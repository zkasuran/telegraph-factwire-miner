# FactWire fact-check miner for Telegraph

One Cloudflare Worker that answers the FACT_CHECK intent by calling a language model at
request time and returning its fact-check as the graded summary.

| Intent | Endpoint | Descriptor id | The answer is |
| --- | --- | --- | --- |
| FACT_CHECK | `/fact-check` | 7420 | a one word verdict (True, False, Partly true or Unverifiable) then one or two sentences of the correct facts that settle the claim |

FACT_CHECK is a model-judged intent. The node writes its own ground truth for the claim with
a model, so a genuinely correct fact-check is what scores. This miner produces that answer with
MiniMax rather than guessing a shape, the same way our language-generation miner does.

## The model source

Every answer is one call to `MiniMax-M2.5-highspeed` on the MiniMax API. This miner is **not
keyless**, which is the one deliberate exception to the rule the other wire miners follow. It
runs under a paid commercial MiniMax plan held by the operator. The key is a Cloudflare
secret:

- the worker reads it as `env.MINIMAX_API_KEY`
- it is never written into `worker.js`, `wrangler.toml`, the descriptor, this README or any
  other file in this repo

The model terms, the plan and the one open licensing item are in `NOTICE` and `DATA-SOURCES.md`.

## Endpoint

The route takes the claim or the whole question on the query string. The bare route is
declared, never a template, so the node's exact-path match always lands.

```
GET /fact-check?claim=<the claim or the whole question>
```

The claim is read from the first non-empty of `claim`, `statement`, `question`, `query`, `q`,
`text`, `input` and `content`, so passing the whole question works as well as passing the claim
alone.

```
GET /health     the intent served and whether the key is configured
GET /__last      the last few requests, for diagnostics
GET /            a usage summary
```

## The response

```json
{
  "intent": "FACT_CHECK",
  "verdict": "False",
  "summary": "False. The Great Wall of China is not visible from low Earth orbit with the unaided eye. Astronauts have confirmed they could not see it without aid.",
  "confidence": 0.96,
  "model": "MiniMax-M2.5-highspeed",
  "source": "MiniMax language model",
  "attribution": "Answer produced with MiniMax (MiniMax-M2.5-highspeed) under a commercial MiniMax plan held by zkasuran.",
  "as_of": "2026-09-25T00:00:00.000Z"
}
```

The node grades the `summary` field, so the descriptor sets `label_field: summary`. The
`verdict` field is a convenience sibling for a reader.

## Never a non-200 on a declared route

The node reads any 4xx or 5xx on a declared route as no answer and zeroes the whole epoch. So
every path answers 200: a missing claim returns an honest note at confidence 0.2. A missing
key, a model error or a timeout returns a plain statement that the fact-check could not be
produced, also at low confidence. Only an undeclared path returns 404.

## Deploy

The worker itself needs no build. Two steps:

```bash
wrangler deploy
wrangler secret put MINIMAX_API_KEY      # paste the key when prompted, once
```

The secret is set on the deployed worker, not in this repo. `GET /health` reports
`key_configured` so you can confirm it landed without exposing the value.

## Verified before ship

Scored offline under the FACT_CHECK intent's own live scoring module (`fact_s01.wasm`,
registration 1582, keccak verified) with `work/telegraph/minerlab/rank.py`, against a
ground-truth proxy. What the measurement found:

- The live module is a **hard 0/1 step**. An answer either clears the top rail (score about
  1.0) or lands on the bottom rail (about 1e-9). There is no partial credit.
- A **correct** fact-check that covers the node's verdict and core facts clears the top rail.
  A **wrong** verdict and an **off-topic** answer land on the bottom rail every time, so the
  module is rewarding correctness, not phrasing. It is not reference-string locked: differently
  worded correct answers clear it.
- The best correct candidate scored **1.000000**, equal to the gt proxy at **1.000000**, while
  the wrong-verdict and off-topic controls scored **0.000000**.

Because the step is hard, the winning answer is verdict-first and concise. On the live board the
FACT_CHECK leader `livecert` scores 1.0 with a one word verdict while a paragraph-style miner
lands on the bottom rail, which shows the node's ground truth is short and verdict-led. Measured
against a short verdict-led gt, a concise correct answer cleared the top rail on 8 to 9 of 10
independent well-known claims. This is winnable honestly by being correct, the same convergence
our language-generation miner relies on, with higher variance because the step is hard rather
than semantic.

## Licence and data terms

- `LICENSE`: Source-Available No-Derivatives 1.0. Read it, audit it, run your own instance,
  publish what you find. Do not redistribute it or redeploy it as a competing miner. Calling
  the live endpoint is not restricted.
- `NOTICE` and `DATA-SOURCES.md`: the MiniMax terms, the paid plan, the credit line carried in
  every answer and the one open item (the paid Open Platform output-ownership clause could not
  be read from the client-rendered terms page, so it is recorded as unverified).

AI note: the answers this miner serves are produced by MiniMax. That is the whole design and it
is stated in every response, in `NOTICE` and here.
