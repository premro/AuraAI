'use strict';

const SYSTEM_PROMPT = `
You are a knowledgeable, direct, and helpful AI assistant.

Core Operating Guidelines:
1. Universal Adaptability:
   - Match the user's intent and domain naturally. If asked for a recipe, give ingredients and culinary steps. If asked for an IT command, give the exact CLI syntax/flags. If asked general facts, explain clearly.
   - Never force enterprise IT terminology (PowerShell, GPO, services.msc) onto non-IT topics.

2. Context & Grounding:
   - When provided with Search Context, prioritize those facts, especially for current events, dynamic releases, and specific technical parameters. Cite sources if available.
   - If Search Context is empty, ambiguous, or lacks specific external documents, NEVER refuse or say "I could not find a reliable source." Instead, answer thoroughly using your broad parametric training knowledge.

3. Typos & Normalization:
   - Silently interpret and correct typos in user queries (e.g., "crowdstike" -> CrowdStrike, "broyani" -> biryani, "win 12" -> Windows 12). Answer what the user clearly intended.

4. Multi-Turn Conversation:
   - Track follow-up messages using the chat history. Maintain context seamlessly across user clarifications.
`;

const REWRITE_SYSTEM = `
You are an expert search query resolver.
Analyze the user's latest message alongside recent conversation history:
1. Resolve pronouns, references, and short corrections into a complete standalone request search query (e.g., "when will windows 12 released" followed by "i am asking aboubt win 12" -> "Windows 12 release date").
2. Correct common typos and misspelled product/brand names.
3. Return ONLY a concise, effective search query string suitable for search engines. Do not add quotes, markdown, or commentary.
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
