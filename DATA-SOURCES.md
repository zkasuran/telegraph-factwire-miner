# Data sources

This miner does not read a public data feed. Every answer it serves is produced by a language
model, MiniMax, called once per request. This file records what the model provides, under what
plan, what its terms say about output ownership and commercial use and what is still open.

Two rules were followed in writing it. A licence or a terms clause is only recorded when the
provider's own page was read. Where a page could not be read that is stated as unverified rather
than guessed. And the model was called before it went in, so the request path is the one the miner
actually uses.

This is also the one deliberate exception to the keyless rule the other wire miners follow. The
seven intents it serves (FACT_CHECK, CONTENT_VERIFICATION, TEXT_AUTHENTICITY_CHECK,
AI_TEXT_DETECTION, DOCUMENT_AUTHENTICITY, PRODUCT_AUTHENTICITY and CONTRACT_OBLIGATION_AUDIT) are
judged on the quality of a genuine answer, so the miner calls a keyed provider the operator holds a
commercial plan for rather than a free public feed.

| Host | Provides | Plan | Output ownership | Commercial use | Rate limit |
| --- | --- | --- | --- | --- | --- |
| api.minimax.io | MiniMax-M3 answers for FACT_CHECK, CONTENT_VERIFICATION, TEXT_AUTHENTICITY_CHECK, AI_TEXT_DETECTION, DOCUMENT_AUTHENTICITY, PRODUCT_AUTHENTICITY and CONTRACT_OBLIGATION_AUDIT | Paid commercial MiniMax plan held by the operator, key as a Cloudflare secret | User keeps ownership of generated content per MiniMax's readable consumer terms, but the exact paid Open Platform clause could not be read (unverified, open item) | Not confirmed for the paid API surface, see the open item below | Governed by the paid plan, not published as a fixed public number; this miner declares 2 requests per second and makes one model call per request |

## Per source

### api.minimax.io (MiniMax API, Open Platform)

The answer for each of the seven intents. One call to MiniMax-M3 with a tight per-intent system
prompt, at request time. MiniMax-M3 is a reasoning model and emits a `<think>` block before its
answer, which the worker strips, returning only the verdict and reasoning as the summary the node
grades.

Plan: a paid commercial MiniMax plan held by the operator. The key is a Cloudflare secret set with
`wrangler secret put MINIMAX_API_KEY` and read as env.MINIMAX_API_KEY. It is never written into
worker.js, wrangler.toml, a descriptor, this file or any other file in the repo.

What the readable terms say: MiniMax's consumer App and Web Terms of Service state "We do not claim
ownership of User Contributions or User Generated Content" and separately "These Terms of Use permit
you to use the Services for your personal, non-commercial use only". Those two lines are from the
consumer surface, not the paid API Open Platform, so the non-commercial limit is a consumer-app
limit rather than a limit on the paid API.

Commercial use: not confirmed for the paid API surface. The Open Platform terms page
(https://platform.minimax.io/protocol/user-agreement) is client-rendered and returned no text to a
server fetch, so the clause that governs output ownership and commercial reuse on the paid plan
could not be quoted.

Credit line published in every answer:

    Answer produced with MiniMax (MiniMax-M3) under a commercial MiniMax plan held by zkasuran.

## On the two detection intents

AI text detection and text authenticity detection are not reliable. This miner does not claim a
measured detector accuracy, because none was measured. The `/ai-detect` and `/authenticity` answers
are a genuine model judgment plus the linguistic signals it rests on, each ending with a plain
statement that the reading is low confidence and not proof. Each carries a confidence of 0.6 rather
than 0.96. The honesty floor is that the answer never overclaims certainty it does not have.

## Compliance

Met:

- The key is held as a Cloudflare secret and appears in no file in the repo.
- The credit line naming MiniMax as the source travels in every answer and in NOTICE.
- Every answer is a live model call at request time, with a short per-isolate memo only.
- The two detection intents state their uncertainty in the answer and carry a lower confidence,
  and no detector accuracy figure is claimed anywhere.

Open:

- The exact MiniMax API (Open Platform) clause on output ownership and commercial reuse under the
  paid plan is unverified, because the platform terms page is client-rendered and could not be read
  by a server fetch. Confirm that clause for the paid plan before this miner is registered to sell
  answers. Until then the licence clause is the one item to close. The answers themselves score.
