'use strict';
const { CAPABILITIES, analyzeRequest } = require('./router');
const H = require('./helpers');

function pickProvider(key) {
  if (!key) return null;
  if (key.startsWith('AIza')) return 'gemini';
  if (key.startsWith('sk-') || key.startsWith('gsk_')) return 'openai';
  return null;
}

async function orchestrateRequest({
  prompt, history = [], attachments = [], userConfig = {}, conversationId = 'default',
  callGeminiAPI, callOpenAIAPI, webSearch, generateBuiltInSmartKnowledge
}) {
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
      // Assumes the 5th argument is the system instruction. Adjust to your helper's signature.
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

  // 2. Rewrite short follow-ups into standalone requests (fixes "his net wroth")
  let userText = H.withAttachments(rawPrompt, attachments);
  let rewritten = false;
  if (prior.length && rawPrompt.length < 120 && !attachments.length && provider) {
    const r = await callModel(H.REWRITE_SYSTEM, rawPrompt, prior.slice(-6));
    if (r && r.trim() && r.length < 300) { userText = r.trim(); rewritten = true; }
  }

  // 3. Route on the standalone text
  const route = analyzeRequest(userText, prior, attachments);
  debug.capability = route.capability;

  // 4. Optional live search (only for live-data questions)
  let system = H.SYSTEM_PROMPT;
  if (route.capability === CAPABILITIES.WEB_RESEARCH && typeof webSearch === 'function') {
    try {
      const results = await webSearch(userText);
      if (results) system += `\n\nSEARCH RESULTS for "${userText}":\n${results}\nUse these for current facts and say if they do not contain the answer.`;
    } catch (e) { debug.searchError = e.message; }
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

  // 7. Fallbacks: honest, never templates for code/summaries
  if (!reply) {
    const needsModel = H.looksLikeCode(userText) || route.capability === CAPABILITIES.SUMMARIZE ||
      route.capability === CAPABILITIES.IMAGE_UNDERSTANDING;
    if (!needsModel && typeof generateBuiltInSmartKnowledge === 'function') {
      const b = generateBuiltInSmartKnowledge(userText, conversationId);
      if (b) return { response: b, provider: 'Built-in knowledge', model, capability: route.capability, debug };
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
  return { response: reply, provider: label, model, capability: route.capability, debug };
}

module.exports = { orchestrateRequest };
