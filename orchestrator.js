'use strict';
const { CAPABILITIES, analyzeRequest } = require('./router');
const H = require('./helpers');
const { searchWeb, isDynamicQuery } = require('./webRetrieval');

function pickProvider(key) {
  if (!key) return null;
  if (key.startsWith('AIza')) return 'gemini';
  if (key.startsWith('sk-') || key.startsWith('gsk_')) return 'openai';
  return null;
}

function normalizeTechTypos(text) {
  let t = String(text || '');
  t = t.replace(/\bcrowdstike\b/gi, 'CrowdStrike');
  t = t.replace(/\bcrowsdtrike\b/gi, 'CrowdStrike');
  t = t.replace(/\bcalculatot\b/gi, 'calculator');
  t = t.replace(/\bendpoint\s*center\b/gi, 'Endpoint Central');
  return t;
}

async function orchestrateRequest({
  prompt, history = [], attachments = [], userConfig = {}, conversationId = 'default',
  callGeminiAPI, callOpenAIAPI, webSearch, generateBuiltInSmartKnowledge, generateSmartResponseFallback
}) {
  const smartFallback = generateBuiltInSmartKnowledge || generateSmartResponseFallback;
  const rawPrompt = H.stripPrefix(prompt);
  const apiKey = (userConfig.apiKey || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || '').trim();
  const provider = pickProvider(apiKey);
  // Default model must match the provider (a gpt-* name sent to Gemini fails silently)
  const model = userConfig.model ||
    (provider === 'gemini' ? (process.env.DEFAULT_GEMINI_MODEL || 'gemini-2.5-flash') : 'gpt-4o-mini');
  const debug = { conversationId, provider, model, keyPresent: !!apiKey };

  const prior = H.dropCurrentTurn(history, rawPrompt);

  async function callModel(system, text, hist) {
    try {
      if (provider === 'gemini' && callGeminiAPI) return await callGeminiAPI(apiKey, text, hist, model, system);
      if (provider === 'openai' && callOpenAIAPI) return await callOpenAIAPI(apiKey, text, hist, model, system);
    } catch (e) {
      console.error('[orchestrator] model call failed:', e && e.message);
      debug.error = e && e.message;
    }
    return null;
  }

  // 1. Repeat detection (informational only, never a canned reply)
  const lastUser = [...prior].reverse().find(m => m.role === 'user');
  const repeated = !!lastUser && H.norm(H.textOf(lastUser)) === H.norm(rawPrompt) && H.norm(rawPrompt).length > 3;

  // 2. Rewrite short follow-ups into standalone requests & fix typos (e.g. "crowdstike")
  let userText = H.withAttachments(rawPrompt, attachments);
  userText = normalizeTechTypos(userText);
  let rewritten = false;

  if (prior.length && rawPrompt.length < 120 && !attachments.length) {
    if (provider) {
      const r = await callModel(H.REWRITE_SYSTEM, userText, prior.slice(-6));
      if (r && r.trim() && r.length < 300) { userText = normalizeTechTypos(r.trim()); rewritten = true; }
    } else {
      // Local context resolution when no external LLM is configured
      const priorText = prior.map(m => m.content || '').join(' ');
      const ecMatch = priorText.match(/\b(endpoint\s*centr[ae]?l|desktop\s*centr[ae]?l|dcagent)\b/i);
      if (ecMatch && /\b(gpo|push|agent|install|silent|powershell|deploy|uninstall|upgrade|update)\b/i.test(userText) && !ecMatch[0].toLowerCase().includes(userText.toLowerCase())) {
        userText = `${userText} ${ecMatch[0]} agent`;
        rewritten = true;
      }
      if (/calculator|calculatot|compute/i.test(priorText) && /\b(error|bug|enter|fix|wrong|broken|fails|not working|=|crash)\b/i.test(userText)) {
        userText = `Fix error in calculator code: ${userText}`;
        rewritten = true;
      }
    }
  }

  // 3. Route on the standalone text
  const route = analyzeRequest(userText, prior, attachments);
  debug.capability = route.capability;

  // 4. Retrieval flow with dynamic version detection & Wikipedia bypass
  let system = H.SYSTEM_PROMPT;
  let searchResults = null;
  let activeWebSearch = webSearch;

  const isDynamic = isDynamicQuery(userText);
  debug.isDynamicQuery = isDynamic;

  if (!activeWebSearch) {
    activeWebSearch = async (q) => {
      const items = await searchWeb(q, { allowStaticWiki: !isDynamic });
      if (Array.isArray(items) && items.length > 0) {
        return items.map((s, idx) => {
          const pass = Array.isArray(s.passages) ? s.passages.join('\n') : (s.snippet || s.content || '');
          return `[Source ${idx + 1} (${s.domain || 'web'})]: ${s.title || ''}\nLink: ${s.url || ''}\n${pass}`;
        }).join('\n\n');
      }
      return null;
    };
  }

  if (route.capability === CAPABILITIES.WEB_RESEARCH || isDynamic || /\b(silent|install|flags|powershell|cmd|version)\b/i.test(userText)) {
    try {
      searchResults = await activeWebSearch(userText);
      if (searchResults && searchResults.trim().length > 0) {
        system += `\n\nSEARCH RESULTS for "${userText}":\n${searchResults}\nUse these for current facts and say if they do not contain the answer.`;
      } else {
        // Retrieval returned 0 documents: inject FALLBACK_PROMPT instead of hard refusing
        system += `\n\n${H.FALLBACK_PROMPT}`;
        debug.fallbackPromptInjected = true;
      }
    } catch (e) {
      debug.searchError = e.message;
      system += `\n\n${H.FALLBACK_PROMPT}`;
    }
  }

  if (repeated) system += '\n\nThe user repeated their previous message. Do not repeat your earlier answer word for word. Improve it, or ask what they want changed.';

  // 5. Answer with the real model
  let reply = await callModel(system, userText, prior);

  // 6. Validate code. If wrong, retry the model with the problem (never swap in canned content)
  if (reply) {
    const problem = H.checkCode(reply, userText);
    if (problem) {
      const retry = await callModel(system + '\n\n' + problem, userText, prior);
      if (retry) reply = retry;
      debug.codeRetry = true;
    }
  }

  // 7. Fallbacks: intelligent built-in knowledge & code engine when no cloud key is configured
  if (!reply) {
    if (typeof smartFallback === 'function' && !userConfig.strictModelOnly) {
      const b = await smartFallback(userText, prior, { conversationId, apiKey, model });
      if (b && typeof b === 'string' && b.trim()) {
        return { response: b.trim(), provider: 'Built-in knowledge', model, capability: route.capability, verifiedOnline: true, debug };
      }
    }
    if (searchResults && !userConfig.strictModelOnly) {
      return { response: searchResults, provider: 'Web Search Grounding', model, capability: route.capability, verifiedOnline: true, debug };
    }
    const why = !apiKey ? 'no API key is configured'
      : !provider ? 'the API key format is not recognised'
      : 'the model request failed' + (debug.error ? ` (${debug.error})` : '');
    return {
      response: `I can't answer this right now because I couldn't reach an AI model: ${why}. Please check the API key and model name in settings.`,
      provider: 'none', model, capability: route.capability, debug
    };
  }

  const label = provider === 'gemini' ? 'Google Gemini' : 'Frontier AI';
  return { response: reply, provider: label, model, capability: route.capability, verifiedOnline: !!searchResults, debug };
}

// Unified chat handler adhering to handleChatRequest signature
async function handleChatRequest(options) {
  // If invoked with server.js pipeline options (callGeminiAPI, callOpenAIAPI, generateSmartResponseFallback, userConfig, etc.)
  if (options.callGeminiAPI || options.callOpenAIAPI || options.generateSmartResponseFallback || options.userConfig || options.attachments) {
    return await orchestrateRequest(options);
  }

  // Standalone RAG execution flow
  const userPrompt = options.userPrompt || options.prompt || '';
  const history = options.history || [];
  const model = options.model || 'gpt-4o-mini';
  const provider = options.provider || pickProvider(options.apiKey || '');
  const callModel = options.callModelFn || (async () => null);

  // 1. Rewrite and normalize spelling (e.g., "crowdstike" -> "CrowdStrike")
  let searchQuery = normalizeTechTypos(userPrompt);
  try {
    const rewritten = await callModel({
      systemPrompt: H.REWRITE_SYSTEM,
      prompt: `History:\n${JSON.stringify(history)}\n\nCurrent message: ${userPrompt}`
    });
    if (rewritten && rewritten.trim()) {
      searchQuery = normalizeTechTypos(rewritten.trim());
    }
  } catch (e) {
    console.warn("Query rewrite failed, using original prompt:", e.message);
  }

  // 2. Perform retrieval with wiki bypass for version queries
  const isDynamic = isDynamicQuery(searchQuery);
  const searchResults = await searchWeb(searchQuery, {
    allowStaticWiki: !isDynamic
  });

  // 3. Build prompt payload based on search outcome
  let finalSystemPrompt = H.SYSTEM_PROMPT;
  let finalUserPrompt = userPrompt;

  if (searchResults && searchResults.length > 0) {
    finalUserPrompt = `Context Sources:\n${JSON.stringify(searchResults)}\n\nUser Question: ${userPrompt}`;
  } else {
    // Retrieval yielded no hits: Use fallback instructions instead of refusing
    finalSystemPrompt = `${H.SYSTEM_PROMPT}\n\n${H.FALLBACK_PROMPT}`;
    finalUserPrompt = userPrompt;
  }

  // 4. Generate response via model
  return await callModel({
    systemPrompt: finalSystemPrompt,
    prompt: finalUserPrompt,
    model: model
  });
}

module.exports = {
  orchestrateRequest,
  handleChatRequest,
  pickProvider,
  normalizeTechTypos
};
