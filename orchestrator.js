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
  return t;
}

/**
 * Single Standardized Pipeline:
 * Rewrite -> Optional Search -> Call LLM -> Return Response
 */
async function handleChatRequest(options) {
  const rawPrompt = H.stripPrefix(options.userPrompt || options.prompt || '');
  const attachments = options.attachments || [];
  const history = options.history || [];
  const userConfig = options.userConfig || {};
  const conversationId = options.conversationId || 'default';

  const apiKey = (options.apiKey || userConfig.apiKey || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || '').trim();
  const provider = options.provider || pickProvider(apiKey);
  const model = options.model || userConfig.model ||
    (provider === 'gemini' ? (process.env.DEFAULT_GEMINI_MODEL || 'gemini-2.5-flash') : 'gpt-4o-mini');

  const debug = { conversationId, provider, model, keyPresent: !!apiKey };
  const prior = H.dropCurrentTurn(history, rawPrompt);

  // Model caller adapter
  async function callModel(system, text, hist = []) {
    if (typeof options.callModelFn === 'function') {
      return await options.callModelFn({ systemPrompt: system, prompt: text, model, history: hist });
    }
    try {
      if (provider === 'gemini' && options.callGeminiAPI) {
        return await options.callGeminiAPI(apiKey, text, hist, model, system);
      }
      if (provider === 'openai' && options.callOpenAIAPI) {
        return await options.callOpenAIAPI(apiKey, text, hist, model, system);
      }
    } catch (e) {
      console.error('[orchestrator] model call failed:', e && e.message);
      debug.error = e && e.message;
    }
    return null;
  }

  // 1. Context-aware query resolution & typo normalization
  let userText = H.withAttachments(rawPrompt, attachments);
  userText = normalizeTechTypos(userText);
  let searchQuery = userText;

  if (prior.length > 0 && rawPrompt.length < 120 && !attachments.length) {
    if (provider) {
      try {
        const resolved = await callModel(
          H.REWRITE_SYSTEM,
          userText,
          prior.slice(-4)
        );
        if (resolved && resolved.trim() && resolved.length < 300) {
          userText = normalizeTechTypos(resolved.trim());
          searchQuery = userText;
        }
      } catch (e) {
        searchQuery = userText;
      }
    } else {
      // Local context resolution when no external LLM is configured
      const priorText = prior.map(m => m.content || '').join(' ');
      const ecMatch = priorText.match(/\b(endpoint\s*centr[ae]?l|desktop\s*centr[ae]?l|dcagent)\b/i);
      if (ecMatch && /\b(gpo|push|agent|install|silent|powershell|deploy|uninstall|upgrade|update)\b/i.test(userText) && !ecMatch[0].toLowerCase().includes(userText.toLowerCase())) {
        searchQuery = `${userText} ${ecMatch[0]} agent`;
        userText = searchQuery;
      }
      if (/calculator|calculatot|compute/i.test(priorText) && /\b(error|bug|enter|fix|wrong|broken|fails|not working|=|crash)\b/i.test(userText)) {
        userText = `Fix error in calculator code: ${userText}`;
        searchQuery = userText;
      }
    }
  }

  // 2. Retrieval (if enabled)
  const route = analyzeRequest(userText, prior, attachments);
  debug.capability = route.capability;
  const isCode = route.capability === CAPABILITIES.CODE_GENERATION || H.looksLikeCode(userText);
  const webSearchEnabled = options.webSearchEnabled !== false && userConfig.webSearch !== false && !isCode;

  let searchContext = [];
  if (webSearchEnabled) {
    try {
      if (typeof options.webSearch === 'function') {
        const customRes = await options.webSearch(searchQuery);
        if (typeof customRes === 'string' && customRes.trim()) {
          searchContext = [{ title: 'Web Search', snippet: customRes.trim(), url: '' }];
        } else if (Array.isArray(customRes)) {
          searchContext = customRes;
        }
      } else {
        searchContext = await searchWeb(searchQuery);
      }
    } catch (err) {
      console.warn('Web search retrieval failed, proceeding with model knowledge:', err.message);
      searchContext = [];
    }
  }

  // 3. Build dynamic prompt for the LLM
  let fullPrompt = userText;
  let systemPrompt = H.SYSTEM_PROMPT;

  if (searchContext && searchContext.length > 0) {
    const contextText = searchContext
      .map((c, i) => `[Source ${i + 1}]: ${c.title || 'Web Result'}\n${c.snippet || ''}\nURL: ${c.url || ''}`)
      .join('\n\n');
    fullPrompt = `Search Context:\n${contextText}\n\nUser Question:\n${userText}`;
  }

  // 4. Always let the LLM generate the final output
  let aiResponse = await callModel(systemPrompt, fullPrompt, prior);

  // 5. Code validation retry (retry model with issue, never swap in canned content)
  if (aiResponse) {
    const problem = H.checkCode(aiResponse, userText);
    if (problem) {
      const retry = await callModel(systemPrompt + '\n\n' + problem, fullPrompt, prior);
      if (retry) aiResponse = retry;
      debug.codeRetry = true;
    }
  }

  // 6. Intelligent local knowledge fallback when no external LLM is reachable
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

// orchestrateRequest is aliased directly to handleChatRequest for unified pipeline consistency
const orchestrateRequest = handleChatRequest;

module.exports = {
  handleChatRequest,
  orchestrateRequest,
  pickProvider,
  normalizeTechTypos
};
