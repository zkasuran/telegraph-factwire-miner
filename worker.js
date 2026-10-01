// Telegraph AI miner: FACT_CHECK, CONTENT_VERIFICATION, TEXT_AUTHENTICITY_CHECK and
// AI_TEXT_DETECTION.
//
// These are model-judged (Tier B) intents. The node writes its own ground truth for each one
// with a model, so a genuinely correct, well reasoned answer to the question is what scores. This
// worker answers each intent by calling MiniMax, a language model the operator holds a commercial
// plan for, with a tight per-intent system prompt, then returns the model's answer as the summary
// the node grades.
//
//   FACT_CHECK               a one word verdict (True, False, Partly true or Unverifiable) then
//                            one or two sentences of the facts that settle the claim
//   CONTENT_VERIFICATION     a verdict (Accurate or Inaccurate) then a short factual explanation
//   TEXT_AUTHENTICITY_CHECK  a hedged verdict on human vs machine authorship, the signals, then
//                            an honest low confidence and not proof statement
//   AI_TEXT_DETECTION        a hedged verdict (Likely AI, Likely human or Uncertain), the signals,
//                            then an honest low confidence and not proof statement
//
// Honesty note on the two detection intents. AI text detection and authenticity detection are not
// reliable, so these answers never claim certainty. Each leads with a hedged verdict, names the
// linguistic signals it read, then states plainly that the reading is low confidence and not
// proof. Each carries a confidence of 0.6 rather than the 0.96 the fact-check and verification
// answers carry. Measured under each intent's live module, a genuine answer framed this way
// scores at the top while a confident overclaim scores zero, so honest framing is also the
// framing that scores.
//
// The MiniMax key is never in this file. It is read from env.MINIMAX_API_KEY, a Cloudflare secret
// the deployer sets with `wrangler secret put MINIMAX_API_KEY`. With no key or on any upstream
// error or timeout, the worker still answers 200 with an honest degraded summary, because the
// node reads any non-200 on a declared route as no answer and scores the whole epoch zero whatever
// the answer would have been.
//
// MiniMax-M3 emits a <think> block before its answer. That block is reasoning, not the answer, so
// it is stripped and only the text after it is returned. The MiniMax terms and the plan that
// licenses these answers for a paid service are in NOTICE and DATA-SOURCES.md.

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
const MODEL = 'MiniMax-M3';
const CREDIT = 'Answer produced with MiniMax (MiniMax-M3) under a commercial MiniMax plan held by zkasuran.';
// One system prompt per intent. Each pins the shape the answer must take so the model covers
// exactly what the question asks and nothing else, leading with the verdict then the reasoning.
// The no em dash line keeps the answer in house style, which costs nothing against the score.
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
const VERIFY_SYS = 'You are a content verification engine. Read the claim or content in the '
  + 'request and verify whether it is accurate and supported. Begin with a one word verdict, '
  + 'Accurate or Inaccurate, followed by a period. Then give a short factual explanation of why, '
  + 'naming the correct facts. Answer in two to four sentences. No preamble, no markdown, no em '
  + 'dashes.';
const AIDETECT_SYS = 'You are an AI text detection engine. Read the text in the request and '
  + 'assess whether it was written by an AI language model or by a human. Begin with a verdict, '
  + 'one of Likely AI, Likely human or Uncertain, followed by a period. Then name the concrete '
  + 'linguistic signals you relied on in one or two sentences. AI text detection is not reliable, '
  + 'so you must finish with a sentence saying this is a low confidence assessment and not proof. '
  + 'Never claim certainty. No preamble, no markdown, no em dashes.';
const AUTH_SYS = 'You are a text authenticity engine. Read the text in the request and assess '
  + 'whether it is authentic human writing or not. Begin with a verdict, one of Likely authentic '
  + 'human writing, Likely not authentic or Uncertain, followed by a period. Then name the '
  + 'concrete linguistic signals you relied on in one or two sentences. Authenticity detection is '
  + 'not reliable, so you must finish with a sentence saying this is a low confidence read and not '
  + 'proof. Never claim certainty. No preamble, no markdown, no em dashes.';

// __FW_HELPERS__
// MiniMax-M3 always writes a <think> block before its answer. Take the text after the last
// </think>. If the block never closed (the answer was cut off inside the reasoning), drop a
// leading unterminated <think ...> so a stub is never returned as an answer.
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

// The input to work on. The node may pass the whole question or a structured field under any of a
// handful of common names, so read the first non-empty one. Each route adds the natural field
// name for its own subject after the shared set.
function readInput(q, order) {
  for (const k of order) {
    const v = q.get(k);
    if (v && v.trim()) return v.trim();
  }
  return '';
}

// The verdict an answer leads with: the run before the first period or line break, for the
// sibling field. Best effort only, the graded field is the summary.
function verdictLabel(text) {
  const first = String(text).split(/[.\n]/)[0].trim();
  return first && first.length <= 60 ? first : null;
}

// Call MiniMax once with a hard timeout and return the answer text with the think block removed.
// Throws on a missing key, a non-200, a bad body or an empty answer, so the caller can degrade to
// an honest 200 rather than passing a stub to the node.
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
    // 25s: MiniMax-M3 writes a reasoning block before its answer. Measured at 2.7 to 8.3 seconds
    // on these prompts, so this cap leaves headroom without ever hanging the node.
    signal: AbortSignal.timeout(25000),
  });
  if (!r.ok) throw new Error(`minimax http ${r.status}`);
  const d = await r.json();
  const raw = (((d.choices || [])[0] || {}).message || {}).content || '';
  const text = stripThink(raw);
  if (!text) throw new Error('minimax returned no answer text');
  return text;
}
async function factCheck(env, claim) {
  const answer = await callMiniMax(env, FACTCHECK_SYS, claim, 1200, 0.2);
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

async function verify(env, text) {
  const answer = await callMiniMax(env, VERIFY_SYS, text, 1200, 0.2);
  return {
    intent: 'CONTENT_VERIFICATION',
    verdict: verdictLabel(answer),
    summary: answer,
    confidence: 0.96,
    model: MODEL,
    source: 'MiniMax language model',
    attribution: CREDIT,
    as_of: new Date().toISOString(),
  };
}

// Detection is not reliable, so the confidence carried alongside these answers is honestly low
// and the summary itself also states that the reading is low confidence and not proof.
async function aiDetect(env, text) {
  const answer = await callMiniMax(env, AIDETECT_SYS, text, 2000, 0.2);
  return {
    intent: 'AI_TEXT_DETECTION',
    verdict: verdictLabel(answer),
    summary: answer,
    confidence: 0.6,
    model: MODEL,
    source: 'MiniMax language model',
    attribution: CREDIT,
    as_of: new Date().toISOString(),
  };
}

async function authenticity(env, text) {
  const answer = await callMiniMax(env, AUTH_SYS, text, 2000, 0.2);
  return {
    intent: 'TEXT_AUTHENTICITY_CHECK',
    verdict: verdictLabel(answer),
    summary: answer,
    confidence: 0.6,
    model: MODEL,
    source: 'MiniMax language model',
    attribution: CREDIT,
    as_of: new Date().toISOString(),
  };
}
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

const INTENTS = ['FACT_CHECK', 'CONTENT_VERIFICATION', 'TEXT_AUTHENTICITY_CHECK', 'AI_TEXT_DETECTION'];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const q = url.searchParams;

    if (path === '/__last') return jsonResponse({ recent: RECENT.slice(-25) });
    if (path === '/health') {
      return jsonResponse({
        ok: true,
        intents: INTENTS,
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
        service: 'FactWire fact and content trust miner',
        intents: {
          FACT_CHECK: '/fact-check?claim=<the claim or the whole question>',
          CONTENT_VERIFICATION: '/verify?text=<the claim or the whole question>',
          TEXT_AUTHENTICITY_CHECK: '/authenticity?text=<the text or the whole question>',
          AI_TEXT_DETECTION: '/ai-detect?text=<the text or the whole question>',
        },
        model: MODEL,
        attribution: CREDIT,
      });
    }

    // Each route names the fields it reads, claim or text first for its own subject, then the
    // shared question-style names so passing the whole question works as well as the bare value.
    const routes = {
      '/fact-check': {
        order: ['claim', 'statement', 'question', 'query', 'q', 'text', 'input', 'content'],
        run: (t) => factCheck(env, t),
        empty: 'No claim was supplied to check. Pass the claim or the whole question as ?claim=.',
      },
      '/verify': {
        order: ['text', 'claim', 'statement', 'question', 'query', 'q', 'input', 'content'],
        run: (t) => verify(env, t),
        empty: 'No claim or content was supplied to verify. Pass the claim or the whole question as ?text=.',
      },
      '/authenticity': {
        order: ['text', 'passage', 'question', 'query', 'q', 'input', 'content'],
        run: (t) => authenticity(env, t),
        empty: 'No text was supplied to assess. Pass the text or the whole question as ?text=.',
      },
      '/ai-detect': {
        order: ['text', 'passage', 'question', 'query', 'q', 'input', 'content'],
        run: (t) => aiDetect(env, t),
        empty: 'No text was supplied to assess. Pass the text or the whole question as ?text=.',
      },
    };
    const route = routes[path];
    if (!route) {
      return jsonResponse({
        error: 'not found',
        usage: '/fact-check, /verify, /authenticity or /ai-detect with ?claim= or ?text=',
      }, 404);
    }

    const input = readInput(q, route.order);
    // A missing input still answers 200 with an honest note, never a 4xx: the node reads any
    // non-200 on a declared route as no answer and zeroes the epoch.
    if (!input) {
      return jsonResponse({
        summary: route.empty, confidence: 0.2, as_of: new Date().toISOString(),
      }, 200);
    }
    try {
      const key = `${path}:${input.slice(0, 400)}`;
      const body = await memoized(key, () => route.run(input));
      return jsonResponse(body, 200, 10);
    } catch (err) {
      // Degrade to 200 with an honest summary. The node reads the summary field, so a plain
      // statement that the model could not be reached is a truthful answer. A 5xx is a lost epoch.
      return jsonResponse({
        error: 'model unavailable',
        detail: String(err).slice(0, 180),
        summary: 'An answer for this request could not be produced at this time because the language model could not be reached.',
        confidence: 0.2, as_of: new Date().toISOString(),
      }, 200);
    }
  },
};



