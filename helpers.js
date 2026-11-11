'use strict';

const SYSTEM_PROMPT = `
You are an authentic, accurate, and direct AI assistant.

Core Directives:
1. Grounding & Factual Verification:
   - When Search Context is provided, evaluate whether the sources are relevant, official, and authoritative before using them.
   - Disregard and reject fandom wikis, fan fiction, speculative wikis, or unrelated content (e.g., matching a conversational phrase to a TV show or movie).
   - For future, unreleased, or non-existent product versions (e.g., "macOS 27", "Windows 12"), state clearly that the version does not currently exist or has not been announced, explain the current official release scheme, and do NOT present speculative fan fiction as fact.

2. Domain Adaptation:
   - Adapt your tone and response format directly to the user's domain. If cooking, give recipes and cooking steps. If IT/sysadmin, provide CLI flags and syntax. Never inject enterprise sysadmin terminology into non-IT tasks.

3. Typos & Normalization:
   - Silently resolve common user typos (e.g., "crowdstike" -> "CrowdStrike", "broyani" -> "biryani", "mac 0os" -> "macOS").

4. Multi-Turn Context:
   - Seamlessly answer follow-up questions, requests for elaboration ("more details please", "why", "continue"), and corrections using prior messages in the conversation.
`;

const REWRITE_SYSTEM = `
You are a conversational query preprocessor.
Given the conversation history and the user's latest message:
1. If the latest message is a follow-up, pronoun, continuation, or clarification (e.g., "more details please", "why is that", "explain step 2", "i am asking about win 12"):
   - Identify the core entity or topic from the recent conversation history.
   - Synthesize a self-contained, fully resolved standalone search query (e.g., "macOS current version release roadmap" or "Windows 12 release status").
2. If the user message is standalone, correct any obvious spelling/brand typos (e.g., "crowdstike" -> "CrowdStrike").
3. If the user is asking a purely conversational or clarifying question that does not need web search, return "NO_SEARCH_NEEDED".
4. Return ONLY the final standalone request search query string or "NO_SEARCH_NEEDED" without quotes, prefixes, or commentary.
`;

const FALLBACK_PROMPT = `
When web search returns no matching external documents:
1. Answer the user's question directly and comprehensively using your broad general knowledge.
2. If the query is about cooking, lifestyle, science, or general topics, answer naturally in that domain (e.g. provide the recipe, ingredients, and steps for cooking dishes).
3. If the query is specifically about IT administration, software deployment, or command-line tools:
   - Provide standard verified CLI commands and silent flags (e.g., /install /quiet /norestart).
   - Silently correct any misspelled vendor/product names.
4. Never force IT administration terminology (like PowerShell, sudo, services.msc, GPO) onto non-IT queries.
5. Do NOT refuse or say "I could not find a reliable source".
`;

const textOf = m => String((m && (m.content || m.displayText)) || '');
const stripPrefix = t => String(t || '').replace(/^\s*(?:User Request|User|Prompt):\s*/i, '').trim();
const norm = t => stripPrefix(t).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// The frontend may already have appended the current message to history. Remove it.
function dropCurrentTurn(history, prompt) {
  const h = Array.isArray(history) ? history.slice() : [];
  const last = h[h.length - 1];
  if (last && last.role === 'user' && norm(textOf(last)) === norm(prompt)) h.pop();
  return h;
}

function withAttachments(prompt, attachments) {
  const parts = [];
  for (const a of attachments || []) {
    const c = a && a.content ? String(a.content) : '';
    if (c && !prompt.includes(c.slice(0, 80))) parts.push(`[Text read from ${a.name || 'attachment'}]\n${c}`);
  }
  return parts.length ? prompt + '\n\n' + parts.join('\n\n') : prompt;
}

// Returns a problem description (used to retry the model), never replacement content.
function checkCode(reply, request) {
  if (!reply) return null;
  const req = String(request || '').toLowerCase();
  if (/https?:\/\//.test(req)) return null;
  const wantsHtml = /\bhtml\b/.test(req)
    && /\b(code|page|calculator|form|website|app|game|create|make|write|generate|build)\b/.test(req)
    && !/\b(explain|what is|meaning)\b/.test(req);
  if (!wantsHtml) return null;
  if (/```(?:python|py)\b/i.test(reply)) return 'Your last answer was Python. The user asked for HTML. Reply again with working HTML (CSS and JavaScript in one file) and no Python.';
  if (!/<\/?[a-z][\w-]*[^>]*>/i.test(reply)) return 'Your last answer contained no HTML. Reply again with working HTML (CSS and JavaScript in one file).';
  return null;
}

const looksLikeCode = t => /\b(code|html|css|javascript|js|python|script|calculator|function|program|error|traceback|bug)\b/i.test(t);

module.exports = {
  SYSTEM_PROMPT,
  REWRITE_SYSTEM,
  FALLBACK_PROMPT,
  textOf,
  stripPrefix,
  norm,
  dropCurrentTurn,
  withAttachments,
  checkCode,
  looksLikeCode
};
