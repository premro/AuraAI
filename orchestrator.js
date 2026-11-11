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

  let apiKey = (options.apiKey || userConfig.apiKey || '').trim();
  let model = options.model || userConfig.model || 'gemini-1.5-flash';

  // Server-Side Key Fallback & Provider Routing
  if (!apiKey) {
    if (model === 'llama-3.3-70b-versatile' || model.includes('llama') || model.includes('groq')) {
      apiKey = process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || '';
    } else if (model.includes('gemini')) {
      apiKey = process.env.GEMINI_API_KEY || process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY || '';
    } else if (model.includes('gpt')) {
      if (process.env.OPENAI_API_KEY) {
        apiKey = process.env.OPENAI_API_KEY;
      } else if (process.env.GROQ_API_KEY) {
        apiKey = process.env.GROQ_API_KEY;
        model = 'llama-3.3-70b-versatile';
      } else if (process.env.GEMINI_API_KEY) {
        apiKey = process.env.GEMINI_API_KEY;
        model = 'gemini-1.5-flash';
      }
    } else {
      apiKey = process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || '';
    }
  } else if (!apiKey.startsWith('sk-') && (model.includes('gpt') || model.includes('chatgpt'))) {
    // If the user selects ChatGPT (GPT-4o mini) but has no OpenAI key, automatically route through Groq or Gemini
    if (process.env.OPENAI_API_KEY) {
      apiKey = process.env.OPENAI_API_KEY;
    } else if (apiKey.startsWith('gsk_') || process.env.GROQ_API_KEY) {
      apiKey = apiKey.startsWith('gsk_') ? apiKey : process.env.GROQ_API_KEY;
      model = 'llama-3.3-70b-versatile';
    } else if (apiKey.startsWith('AIza') || process.env.GEMINI_API_KEY) {
      apiKey = apiKey.startsWith('AIza') ? apiKey : process.env.GEMINI_API_KEY;
      model = 'gemini-1.5-flash';
    }
  }

  let provider = options.provider || pickProvider(apiKey) || (model.includes('gemini') ? 'gemini' : 'openai');

  const debug = { conversationId, provider, model, keyPresent: !!apiKey };
  const prior = H.dropCurrentTurn(history, userPrompt);

  // Model caller adapter with Error Auto-Switching between Groq and Gemini
  async function callModel(system, text, hist = []) {
    let result = null;
    if (typeof options.callModelFn === 'function') {
      result = await options.callModelFn({ systemPrompt: system, prompt: text, model, history: hist });
    } else {
      const activeProvider = provider;
      const activeKey = apiKey;
      const activeModel = model;

      // Primary provider attempt
      try {
        if (activeProvider === 'gemini' && options.callGeminiAPI) {
          result = await options.callGeminiAPI(activeKey, text, hist, activeModel, system);
        } else if (activeProvider === 'openai' && options.callOpenAIAPI) {
          result = await options.callOpenAIAPI(activeKey, text, hist, activeModel, system);
        }
      } catch (e) {
        console.error(`[orchestrator] ${activeProvider} model call failed:`, e && e.message);
        debug.error = e && e.message;
      }

      // Error Auto-Switching: If primary was Groq/OpenAI and it failed or was rate limited, auto-retry with Gemini
      if (!result && activeProvider === 'openai' && options.callGeminiAPI) {
        const geminiKey = process.env.GEMINI_API_KEY || (activeKey && activeKey.startsWith('AIza') ? activeKey : '');
        if (geminiKey) {
          console.warn('[orchestrator] Groq/OpenAI call failed or rate limited. Auto-switching to Google Gemini (gemini-1.5-flash)...');
          try {
            result = await options.callGeminiAPI(geminiKey, text, hist, 'gemini-1.5-flash', system);
            if (result) {
              debug.fallbackProvider = 'gemini';
              debug.fallbackModel = 'gemini-1.5-flash';
              debug.error = null;
            }
          } catch (gemErr) {
            console.error('[orchestrator] Gemini auto-switch retry failed:', gemErr && gemErr.message);
          }
        }
      }

      // Error Auto-Switching: If primary was Gemini and it failed, auto-retry with Groq/OpenAI
      if (!result && activeProvider === 'gemini' && options.callOpenAIAPI) {
        const groqKey = process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY || (activeKey && (activeKey.startsWith('gsk_') || activeKey.startsWith('sk-')) ? activeKey : '');
        if (groqKey) {
          console.warn('[orchestrator] Gemini call failed. Auto-switching to Groq (llama-3.3-70b-versatile)...');
          try {
            result = await options.callOpenAIAPI(groqKey, text, hist, 'llama-3.3-70b-versatile', system);
            if (result) {
              debug.fallbackProvider = 'openai';
              debug.fallbackModel = 'llama-3.3-70b-versatile';
              debug.error = null;
            }
          } catch (groqErr) {
            console.error('[orchestrator] Groq auto-switch retry failed:', groqErr && groqErr.message);
          }
        }
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

  // Detect pasted conversation transcripts, support tickets, and summary requests
  const hasTranscriptSignals = /(?:customer|agent|client|support|caller|rep|engineer|tech|user|premnath\.[a-z]):\s*/i.test(userText) ||
                               /\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?\b/.test(userText) ||
                               /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+:/.test(userText);
  const isSummaryRequest = /\b(summari[sz]e|summary|tl;?dr|ticket summary|action items?|next steps?)\b/i.test(userText);
  const isPastedTranscriptOrLog = (hasTranscriptSignals || isSummaryRequest) && userText.length > 250;

  // Long Input Handling (Payload Truncation & Token Safety)
  const wordCount = (userText.trim().match(/\S+/g) || []).length;
  const isLargeInput = wordCount > 2000 || userText.length > 8000;
  if (isLargeInput && (process.env.GEMINI_API_KEY || (apiKey && apiKey.startsWith('AIza')) || options.callGeminiAPI)) {
    console.log(`[orchestrator] Large input detected (${wordCount} words). Auto-routing to Google Gemini (gemini-1.5-flash) for 1M token safety.`);
    provider = 'gemini';
    model = 'gemini-1.5-flash';
    apiKey = (apiKey && apiKey.startsWith('AIza')) ? apiKey : (process.env.GEMINI_API_KEY || apiKey);
    debug.provider = provider;
    debug.model = model;
  }

  let resolvedQuery = userText;

  if (isPastedTranscriptOrLog) {
    resolvedQuery = "NO_SEARCH_NEEDED";
  } else if (prior.length > 0 && userPrompt.length < 120 && !attachments.length) {
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
  if (isPastedTranscriptOrLog) {
    route.capability = CAPABILITIES.SUMMARIZE;
  }
  debug.capability = route.capability;
  const isCode = route.capability === CAPABILITIES.CODE_GENERATION || H.looksLikeCode(userText);
  const isSummarize = route.capability === CAPABILITIES.SUMMARIZE || isPastedTranscriptOrLog;
  const webSearchEnabled = options.webSearchEnabled !== false && userConfig.webSearch !== false && !isCode && !isSummarize;

  let searchResults = [];
  if (webSearchEnabled && resolvedQuery !== "NO_SEARCH_NEEDED") {
    try {
      if (typeof options.webSearch === 'function') {
        const customRes = await options.webSearch(resolvedQuery);
        if (typeof customRes === 'string' && customRes.trim()) {
          searchResults = [{ title: 'Web Search', snippet: customRes.trim(), url: '' }];
        } else if (Array.isArray(customRes)) {
          searchResults = customRes;
        }
      } else {
        searchResults = await searchWeb(resolvedQuery);
      }
    } catch (err) {
      console.warn("Search retrieval failed, falling back to model knowledge:", err.message);
      searchResults = [];
    }
  }

  const searchContext = searchResults;
  console.log("[DEBUG CHAT]", { userPrompt, searchResultsLength: searchResults.length });

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
