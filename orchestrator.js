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
  t = t.replace(/\bbroyani\b/gi, 'biryani');
  t = t.replace(/\bwin\s*12\b/gi, 'Windows 12');
  t = t.replace(/\bmac\s*0os\b/gi, 'macOS');
  return t;
}

/**
 * Context-First Standardized Pipeline:
 * Query Preprocessing -> Optional Grounded Search -> LLM Generation -> Return Response
 */
async function handleChatRequest(options) {
  const userPrompt = H.stripPrefix(options.userPrompt || options.prompt || '');
  const attachments = options.attachments || [];
  const history = options.history || [];
  const userConfig = options.userConfig || {};
  const conversationId = options.conversationId || 'default';

  const apiKey = (options.apiKey || userConfig.apiKey || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || '').trim();
  const provider = options.provider || pickProvider(apiKey);
  const model = options.model || userConfig.model ||
    (provider === 'gemini' ? (process.env.DEFAULT_GEMINI_MODEL || 'gemini-2.5-flash') : 'gpt-4o-mini');

  const debug = { conversationId, provider, model, keyPresent: !!apiKey };
  const prior = H.dropCurrentTurn(history, userPrompt);

  // Model caller adapter supporting both { messages } and (system, prompt, history)
  async function callModel(system, text, hist = []) {
    let result = null;
    if (typeof options.callModelFn === 'function') {
      result = await options.callModelFn({ systemPrompt: system, prompt: text, model, history: hist });
    } else {
      try {
        if (provider === 'gemini' && options.callGeminiAPI) {
          result = await options.callGeminiAPI(apiKey, text, hist, model, system);
        } else if (provider === 'openai' && options.callOpenAIAPI) {
          result = await options.callOpenAIAPI(apiKey, text, hist, model, system);
        }
      } catch (e) {
        console.error('[orchestrator] model call failed:', e && e.message);
        debug.error = e && e.message;
      }
    }
    if (result && typeof result === 'object') {
      return result.text || result.content || result.response || '';
    }
    return result || null;
  }

  // 1. Resolve multi-turn context and handle follow-up phrases
  let userText = H.withAttachments(userPrompt, attachments);
  userText = normalizeTechTypos(userText);
  let resolvedQuery = userText;

  if (prior.length > 0 && userPrompt.length < 120 && !attachments.length) {
    if (provider) {
      try {
        const rewritten = await callModel(
          H.REWRITE_SYSTEM,
          userText,
          prior.slice(-6)
        );
        if (rewritten && rewritten.trim() && rewritten.length < 300) {
          resolvedQuery = normalizeTechTypos(rewritten.trim());
          if (resolvedQuery !== "NO_SEARCH_NEEDED") {
            userText = resolvedQuery;
          }
        }
      } catch (e) {
        console.warn("Rewrite failed, using original prompt:", e.message);
        resolvedQuery = userText;
      }
    } else {
      // Local context resolution when no external LLM is configured
      const priorText = prior.map(m => m.content || '').join(' ');
      const ecMatch = priorText.match(/\b(endpoint\s*centr[ae]?l|desktop\s*centr[ae]?l|dcagent)\b/i);
      if (ecMatch && /\b(gpo|push|agent|install|silent|powershell|deploy|uninstall|upgrade|update)\b/i.test(userText) && !ecMatch[0].toLowerCase().includes(userText.toLowerCase())) {
        resolvedQuery = `${userText} ${ecMatch[0]} agent`;
        userText = resolvedQuery;
      }
      if (/calculator|calculatot|compute/i.test(priorText) && /\b(error|bug|enter|fix|wrong|broken|fails|not working|=|crash)\b/i.test(userText)) {
        userText = `Fix error in calculator code: ${userText}`;
        resolvedQuery = userText;
      }
    }
  }

  // 2. Fetch grounded search results unless marked unnecessary
  const route = analyzeRequest(userText, prior, attachments);
  debug.capability = route.capability;
  const isCode = route.capability === CAPABILITIES.CODE_GENERATION || H.looksLikeCode(userText);
  const webSearchEnabled = options.webSearchEnabled !== false && userConfig.webSearch !== false && !isCode;

  let searchContext = [];
  if (webSearchEnabled && resolvedQuery !== "NO_SEARCH_NEEDED") {
    try {
      if (typeof options.webSearch === 'function') {
        const customRes = await options.webSearch(resolvedQuery);
        if (typeof customRes === 'string' && customRes.trim()) {
          searchContext = [{ title: 'Web Search', snippet: customRes.trim(), url: '' }];
        } else if (Array.isArray(customRes)) {
          searchContext = customRes;
        }
      } else {
        searchContext = await searchWeb(resolvedQuery);
      }
    } catch (err) {
      console.warn("Search retrieval failed, falling back to model knowledge:", err.message);
      searchContext = [];
    }
  }

  // 3. Construct LLM payload with conversation history & verified context
  const systemMessage = H.SYSTEM_PROMPT || "You are a helpful, direct AI assistant. Answer the user's question accurately. If search context is provided, use it to ground your answer. If no search context is provided or if it is irrelevant, answer using your internal knowledge. Never invent fake releases or repeat irrelevant sources.";

  let finalPrompt = userText;
  if (searchContext && searchContext.length > 0) {
    const formattedSources = searchContext
      .map(s => `Title: ${s.title || 'Source'}\nContent: ${s.snippet || ''}`)
      .join('\n\n');
    finalPrompt = `Search Context:\n${formattedSources}\n\nUser Question:\n${userText}`;
  }

  // 4. ALWAYS generate response using the LLM
  let aiResponse = await callModel(systemMessage, finalPrompt, prior.slice(-8));

  // 5. Code validation retry (retry model with issue, never swap in canned content)
  if (aiResponse) {
    const problem = H.checkCode(aiResponse, userText);
    if (problem) {
      const retry = await callModel(systemMessage + '\n\n' + problem, finalPrompt, prior.slice(-8));
      if (retry) aiResponse = retry;
      debug.codeRetry = true;
    }
  }

  // 6. Intelligent local fallback when no external LLM is reachable
  const smartFallback = options.generateBuiltInSmartKnowledge || options.generateSmartResponseFallback;
  if (!aiResponse) {
    if (typeof smartFallback === 'function' && !userConfig.strictModelOnly) {
      const b = await smartFallback(userText, prior, { conversationId, apiKey, model });
      if (b && typeof b === 'string' && b.trim()) {
        return {
          response: b.trim(),
          provider: 'Built-in knowledge',
          model,
          capability: route.capability,
          verifiedOnline: searchContext.length > 0,
          sources: searchContext.map(s => ({ title: s.title, url: s.url })),
          debug
        };
      }
    }
    if (searchContext && searchContext.length > 0 && !userConfig.strictModelOnly) {
      const formatted = searchContext.map((s, idx) => `[Source ${idx + 1}]: ${s.title}\n${s.snippet}\n${s.url}`).join('\n\n');
      return {
        response: formatted,
        provider: 'Web Search Grounding',
        model,
        capability: route.capability,
        verifiedOnline: true,
        sources: searchContext.map(s => ({ title: s.title, url: s.url })),
        debug
      };
    }
    const why = !apiKey ? 'no API key is configured'
      : !provider ? 'the API key format is not recognised'
      : 'the model request failed' + (debug.error ? ` (${debug.error})` : '');
    return {
      response: `I can't answer this right now because I couldn't reach an AI model: ${why}. Please check the API key and model name in settings.`,
      provider: 'none',
      model,
      capability: route.capability,
      sources: [],
      debug
    };
  }

  const label = provider === 'gemini' ? 'Google Gemini' : 'Frontier AI';
  return {
    response: aiResponse,
    provider: label,
    model,
    capability: route.capability,
    verifiedOnline: searchContext.length > 0,
    sources: searchContext.map(s => ({ title: s.title, url: s.url })),
    debug
  };
}

const orchestrateRequest = handleChatRequest;

module.exports = {
  handleChatRequest,
  orchestrateRequest,
  pickProvider,
  normalizeTechTypos
};
