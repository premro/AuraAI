const { orchestrateRequest } = require('./orchestrator');
const assert = require('assert');
let calls = [];
async function gem(key, text, hist, model, system) {
  calls.push({ text, histLen: hist.length, model, rewrite: system.includes('standalone request') });
  if (system.includes('standalone request')) {
    if (/wroth/.test(text)) return "What is Elon Musk's net worth?";
    return text;
  }
  if (/calculat/i.test(text) && !system.includes('no HTML') && !system.includes('was Python') && !system.includes('contained no HTML') && !system.includes('Your last answer was Python')) return '```python\nprint(1)\n```';
  if (/calculat/i.test(text)) return '<!DOCTYPE html><html><body>calc</body></html>';
  return 'MODEL ANSWER for: ' + text;
}
const base = { callGeminiAPI: gem, userConfig: { apiKey: 'AIzaTEST' } };
(async () => {
  // A: current message already inside history (the bug)
  calls = [];
  let r = await orchestrateRequest({ ...base, prompt: 'who is musk', history: [{ role: 'user', content: 'who is musk' }] });
  assert(r.response.startsWith('MODEL ANSWER'), 'A: should call model'); assert.strictEqual(calls[0].histLen, 0);
  // B: short message "html"
  r = await orchestrateRequest({ ...base, prompt: 'html', history: [{ role: 'user', content: 'html' }] });
  assert(r.response.startsWith('MODEL ANSWER'), 'B');
  // C: no key + code request -> honest message, no template
  r = await orchestrateRequest({ prompt: 'html code for advance calculatot', history: [], userConfig: {} });
  assert(/couldn't reach an AI model/.test(r.response) && /no API key/.test(r.response), 'C');
  // D: python first then retry gives HTML
  calls = [];
  r = await orchestrateRequest({ ...base, prompt: 'html code for advance calculatot', history: [] });
  assert(/<html/i.test(r.response) && r.debug.codeRetry, 'D');
  // E: pasted chat with URL + "issue short summary" -> SUMMARIZE, no URL reader
  const pasted = 'premnath.v: https://www.zoho.com/assist/help/troubleshooting/reachability-issue.html\n' + 'x'.repeat(600) + '\nissue short summary';
  r = await orchestrateRequest({ ...base, prompt: pasted, history: [] });
  assert.strictEqual(r.capability, 'summarize', 'E');
  // F: follow-up gets rewritten with history, repeated message not canned
  calls = [];
  r = await orchestrateRequest({ ...base, prompt: 'his net wroth', history: [{ role: 'user', content: 'who is elon musk' }, { role: 'assistant', content: 'Elon...' }, { role: 'user', content: 'his net wroth' }] });
  assert(/net worth/.test(r.response) && r.capability === 'web_research', 'F ' + r.response + r.capability);
  // G: wrong default model fixed for Gemini
  assert(!/gpt/.test(r.model), 'G model ' + r.model);
    // H: "how install endpoint central agent" without API key returns verified guide
  const server = require('./server');
  r = await orchestrateRequest({
    prompt: 'how install endpoint central agent',
    history: [],
    userConfig: { apiKey: '' },
    generateSmartResponseFallback: server.generateSmartResponse
  });
  assert(r.response && r.response.includes('Endpoint Central') && r.verifiedOnline && r.capability === 'web_research', 'H: endpoint central install');
    // I: Follow-up "how to push via gpo" inherits Endpoint Central context and does NOT return UK telephones
  r = await orchestrateRequest({
    prompt: 'how to push via gpo',
    history: [
      { role: 'user', content: 'how install endpoint central agent' },
      { role: 'assistant', content: 'For Endpoint Central, you can install the agent...' }
    ],
    userConfig: { apiKey: '' },
    generateSmartResponseFallback: server.generateSmartResponse
  });
  assert(r.response && r.response.includes('Group Policy') && !r.response.includes('telephone') && r.capability === 'web_research', 'I: follow-up gpo context');

  // J: Typo "how to push via gpo endpoint centrl agent" does not hit canned refusal
  r = await orchestrateRequest({
    prompt: 'how to push via gpo endpoint centrl agent',
    history: [],
    userConfig: { apiKey: '' },
    generateSmartResponseFallback: server.generateSmartResponse
  });
  assert(r.response && r.response.includes('Group Policy') && !r.response.includes('could not find a reliable source'), 'J: typo tolerance and gpo install');

  // K: Summary without API key produces structured summary with Overview & Key Points
  r = await orchestrateRequest({
    prompt: "summarize: In 1969, Apollo 11 was the American spaceflight that first landed humans on the Moon. Commander Neil Armstrong and Lunar Module pilot Buzz Aldrin landed the Apollo Lunar Module Eagle on July 20, 1969, at 20:17 UTC, and Armstrong became the first person to step onto the Moon.",
    history: [],
    userConfig: { apiKey: "" },
    generateSmartResponseFallback: server.generateSmartResponse
  });
  assert(r.response && r.response.includes("Summary") && r.response.includes("Moon") && !r.response.includes("could not reach an AI model"), "K: text summarization works");

  // L: HTML Calculator code generation works in new chat without API key
  r = await orchestrateRequest({
    prompt: "html code for advance calculatot",
    history: [],
    userConfig: { apiKey: "" },
    generateSmartResponseFallback: server.generateSmartResponse
  });
  assert(r.response && r.response.includes("<!DOCTYPE html>") && r.response.includes("calculator") && !r.response.includes("could not reach an AI model"), "L: html calculator code works");

  // M: Python code generation works in new chat without API key
  r = await orchestrateRequest({
    prompt: "write a python function to reverse a string",
    history: [],
    userConfig: { apiKey: "" },
    generateSmartResponseFallback: server.generateSmartResponse
  });
  assert(r.response && r.response.includes("reverse_string") && r.response.includes("```python") && !r.response.includes("could not reach an AI model"), "M: python code works");

  // N: General question works in new chat without API key
  r = await orchestrateRequest({
    prompt: "what is photosynthesis?",
    history: [],
    userConfig: { apiKey: "" },
    generateSmartResponseFallback: server.generateSmartResponse
  });
  assert(r.response && (r.response.includes("photosynthesis") || r.response.includes("Photosynthesis")) && !r.response.includes("could not reach an AI model"), "N: general question works");

  // O: Follow-up error query ("when enter = gives error") resolves bug and returns corrected code
  const { HTML_CALCULATOR_CODE } = require("./calculatorHelper");
  r = await orchestrateRequest({
    prompt: "when enter = gives error",
    history: [
      { role: "user", content: "html code for advance calculatot" },
      { role: "assistant", content: HTML_CALCULATOR_CODE }
    ],
    userConfig: { apiKey: "" },
    generateSmartResponseFallback: server.generateSmartResponse
  });
  assert(r.response && r.response.includes("Root Cause") && r.response.includes("<!DOCTYPE html>") && !r.response.includes("I received your query regarding"), "O: follow-up error resolution");

  // P: Screenshot with OCR error text resolves bug and returns corrected code
  r = await orchestrateRequest({
    prompt: "fix this error",
    history: [
      { role: "user", content: "html code for advance calculatot" },
      { role: "assistant", content: HTML_CALCULATOR_CODE }
    ],
    attachments: [
      {
        name: "screenshot.png",
        content: "let result = Function(fullExpr); catch(e) { currentInput = 'Error; }"
      }
    ],
    userConfig: { apiKey: "" },
    generateSmartResponseFallback: server.generateSmartResponse
  });
  assert(r.response && r.response.includes("Root Cause") && r.response.includes("<!DOCTYPE html>") && !r.response.includes("I received your query regarding"), "P: screenshot error resolution");

  console.log("ALL TESTS PASSED (A through P)");
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
