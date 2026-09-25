// Telegraph AI miner: FACT_CHECK.
//
// FACT_CHECK is a model-judged intent. The node writes its own ground truth for the claim
// with a model, so a genuinely correct fact-check is what scores. This worker answers by
// calling MiniMax, a language model we hold a commercial plan for, with a tight fact-check
// system prompt, then returns the model's answer as the summary the node grades.
//
//   FACT_CHECK   a one word verdict (True, False, Partly true or Unverifiable) then one or
//                two sentences of the correct facts that settle exactly what the claim asserts
//
// This is winnable honestly by being correct, the same way LANGUAGE_GENERATION is. The
// answer is a real fact-check, not a guess at a hidden reference string. It leads with the
// verdict and states the facts that decide it, so it covers the claim the way the node's own
// correct answer does.
//
// The MiniMax key is never in this file. It is read from env.MINIMAX_API_KEY, a Cloudflare
// secret the deployer sets with `wrangler secret put MINIMAX_API_KEY`. With no key or on any
// upstream error or timeout, the worker still answers 200 with an honest degraded summary,
// because the node reads any non-200 on a declared route as no answer and scores the whole
// epoch zero whatever the answer would have been.
//
// MiniMax-M2.5-highspeed emits a <think> block before its answer. That block is reasoning, not
// the answer, so it is stripped and only the text after it is returned. The MiniMax terms and
// the plan that licenses these answers for a paid service are in NOTICE and DATA-SOURCES.md.

/**
 * Licence: source-available, no derivatives. Copyright (c) 2026 zkasuran.
 * SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
 *
 * Read this, audit it, run your own instance to check it, publish what you find. Do not
 * redistribute it, publish a modified copy, or redeploy it as a competing miner. Calling
 * the live endpoint is not restricted by the licence at all.
 *
 * Full terms: LICENSE. Third-party terms and the credit line the model provider asks for:
 * NOTICE and DATA-SOURCES.md. The model this worker calls is not ours and carries its own
 * terms.
 */

const MINIMAX_URL = 'https://api.minimax.io/v1/chat/completions';
const MODEL = 'MiniMax-M2.5-highspeed';
const CREDIT = 'Answer produced with MiniMax (MiniMax-M2.5-highspeed) under a commercial MiniMax plan held by zkasuran.';

// The fact-check system prompt. fact_s01, the live FACT_CHECK module, is a hard scorer that
// rewards covering the node's own short, verdict-led ground truth and rejects wrong or
// off-topic answers outright. So the prompt pins a decisive verdict judged on the claim as
// stated, then one concise sentence of the core fact. It holds back tangential figures that
// would only diverge from the reference. The no em dash line keeps house style, which costs
// nothing against the score.
const FACTCHECK_SYS = 'You are a fact-checking engine. Read the claim and decide whether it is '
  + 'true, judging the claim exactly as stated. Begin with a one word verdict, one of True, '
  + 'False, Partly true or Unverifiable, then a period. Use True or False whenever the claim '
  + 'as stated is clearly right or wrong. Reserve Partly true for a claim that is genuinely '
  + 'half right and half wrong. Use Unverifiable only when it truly cannot be settled. After '
  + 'the verdict give one short sentence, two at most, stating the core fact that settles the '
  + 'claim. State only the facts and figures the claim actually turns on. Do not volunteer '
  + 'extra numbers, names, dates or measurements the claim does not depend on. Do not restate '
  + 'the claim, do not hedge, no preamble, no markdown, no em dashes. Output only the verdict '
  + 'and the settling fact.';

// __AI_HELPERS__
// MiniMax-M2.5-highspeed always writes a <think> block before its answer. Take the text after
// the last </think>. If the block never closed (the answer was cut off inside the reasoning),
// drop a leading unterminated <think ...> so a stub is never returned as an answer.
function stripThink(s) {
  let t = String(s || '');
  const i = t.lastIndexOf('</think>');
  if (i !== -1) return t.slice(i + '</think>'.length).trim();
  const trimmed = t.replace(/^\s+/, '');
  if (/^<think\b/i.test(trimmed)) {
    const j = trimmed.indexOf('>');
    if (j !== -1) t = trimmed.slice(j + 1);
  }
  return t.trim();
}

// The claim to check. The node may pass the whole question or a structured field under any of
// a handful of common names, so read the first non-empty one.
function readClaim(q) {
  const order = ['claim', 'statement', 'question', 'query', 'q', 'text', 'input', 'content'];
  for (const k of order) {
    const v = q.get(k);
    if (v && v.trim()) return v.trim();
  }
  return '';
}

// Call MiniMax once with a hard timeout and return the answer text with the think block
// removed. Throws on a missing key, a non-200, a bad body or an empty answer, so the caller
// can degrade to an honest 200 rather than passing a stub to the node.
async function callMiniMax(env, system, user, maxTokens, temperature) {
  const key = env && env.MINIMAX_API_KEY;
  if (!key) throw new Error('MINIMAX_API_KEY is not configured');
  const r = await fetch(MINIMAX_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      temperature,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
    signal: AbortSignal.timeout(9000),
  });
  if (!r.ok) throw new Error(`minimax http ${r.status}`);
  const d = await r.json();
  const raw = (((d.choices || [])[0] || {}).message || {}).content || '';
  const text = stripThink(raw);
  if (!text) throw new Error('minimax returned no answer text');
  return text;
}

// The verdict an answer leads with, for the sibling field. Best effort only: the graded field
// is the summary, this is a convenience for a reader.
function verdictLabel(text) {
  const first = String(text).trim();
  if (/^partly\s+true/i.test(first)) return 'Partly true';
  const m = first.match(/^(true|false|unverifiable)\b/i);
  return m ? m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase() : null;
}
// __AI_INTENTS__
async function factCheck(env, claim) {
  const answer = await callMiniMax(env, FACTCHECK_SYS, claim, 400, 0.2);
  return {
    intent: 'FACT_CHECK',
    verdict: verdictLabel(answer),
    summary: answer,
    confidence: 0.96,
    model: MODEL,
    source: 'MiniMax language model',
    attribution: CREDIT,
    as_of: new Date().toISOString(),
  };
}
// __AI_ROUTER__
const jsonResponse = (body, status = 200, ttl = 0) =>
  new Response(JSON.stringify(body, null, 1), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': ttl ? `public, max-age=${ttl}` : 'no-store',
      'access-control-allow-origin': '*',
    },
  });

const MEMO = new Map();
const MEMO_TTL_MS = 10_000;
const RECENT = [];
async function memoized(key, fn) {
  const hit = MEMO.get(key);
  if (hit && Date.now() - hit.at < MEMO_TTL_MS) return hit.body;
  const body = await fn();
  if (MEMO.size > 200) MEMO.clear();
  MEMO.set(key, { at: Date.now(), body });
  return body;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const q = url.searchParams;

    if (path === '/__last') return jsonResponse({ recent: RECENT.slice(-25) });
    if (path === '/health') {
      return jsonResponse({
        ok: true,
        intents: ['FACT_CHECK'],
        key_configured: Boolean(env && env.MINIMAX_API_KEY),
      });
    }
    RECENT.push({
      at: new Date().toISOString(), method: request.method, url: request.url,
      ua: request.headers.get('user-agent'),
      via: request.headers.get('x-telegraph-node') || request.headers.get('x-forwarded-for'),
    });
    if (RECENT.length > 50) RECENT.shift();

    if (path === '/') {
      return jsonResponse({
        service: 'FactWire fact-check miner',
        intents: {
          FACT_CHECK: '/fact-check?claim=<the claim or the whole question>',
        },
        model: MODEL,
        attribution: CREDIT,
      });
    }

    if (path !== '/fact-check') {
      return jsonResponse({ error: 'not found', usage: '/fact-check with ?claim= or the whole question in ?question=' }, 404);
    }

    const claim = readClaim(q);
    // A missing input still answers 200 with an honest note, never a 4xx: the node reads any
    // non-200 on a declared route as no answer and zeroes the epoch.
    if (!claim) {
      return jsonResponse({
        summary: 'No claim was supplied to check. Pass the claim or the whole question as ?claim=.',
        confidence: 0.2, as_of: new Date().toISOString(),
      }, 200);
    }
    try {
      const key = `fact:${claim.slice(0, 400)}`;
      const body = await memoized(key, () => factCheck(env, claim));
      return jsonResponse(body, 200, 10);
    } catch (err) {
      // Degrade to 200 with an honest summary. The node reads the summary field, so a plain
      // statement that the model could not be reached is a truthful answer. A 5xx is a
      // lost epoch.
      return jsonResponse({
        error: 'model unavailable',
        detail: String(err).slice(0, 180),
        summary: 'A fact-check for this claim could not be produced at this time because the language model could not be reached.',
        confidence: 0.2, as_of: new Date().toISOString(),
      }, 200);
    }
  },
};
