'use strict';
const CAPABILITIES = {
  NORMAL_CHAT: 'normal_chat',
  WEB_RESEARCH: 'web_research',
  URL_READER: 'url_reader',
  DOCUMENT_READER: 'document_reader',
  IMAGE_UNDERSTANDING: 'image_understanding',
  SUMMARIZE: 'summarize',
  MULTI_TOOL_WORKFLOW: 'multi_tool_workflow'
};

function analyzeRequest(text, history = [], attachments = []) {
  const t = String(text || "").trim();
  const isLong = t.length > 400; // long text = pasted content, not a command

  if (attachments && attachments.length) {
    const hasImg = attachments.some(a => (a.type || "").includes("image") || /\.(png|jpe?g|webp|gif)$/i.test(a.name || ""));
    const hasDoc = attachments.some(a => (a.type || "").includes("pdf") || /\.(pdf|docx|xlsx|txt|csv)$/i.test(a.name || ""));
    if (hasImg && hasDoc) return { capability: CAPABILITIES.MULTI_TOOL_WORKFLOW };
    if (hasImg) return { capability: CAPABILITIES.IMAGE_UNDERSTANDING };
    if (hasDoc) return { capability: CAPABILITIES.DOCUMENT_READER };
  }

  // Detect transcripts, support chat logs, and summarization requests
  const hasTranscriptSignals = /(?:customer|agent|client|support|caller|rep|engineer|tech|user|premnath\.[a-z]):\s*/i.test(t) ||
                               /\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?\b/.test(t) ||
                               /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+:/.test(t);
  const isSummaryRequest = /\b(summari[sz]e|summary|tl;?dr|ticket summary|action items?|next steps?)\b/i.test(t);

  if ((isLong || t.length > 250) && (hasTranscriptSignals || isSummaryRequest)) {
    return { capability: CAPABILITIES.SUMMARIZE };
  }

  // Summary of pasted text: instruction is usually at the start or end
  if (isLong && /\b(summary|summari[sz]e|tl;?dr)\b/i.test(t.slice(0, 120) + " " + t.slice(-200))) {
    return { capability: CAPABILITIES.SUMMARIZE };
  }

  // Fetch a URL only when the URL is the main content of a short message
  const url = t.match(/https?:\/\/\S+/i);
  if (url && !isLong && !hasTranscriptSignals && !isSummaryRequest) {
    const rest = t.replace(url[0], "").trim();
    if (rest.split(/\s+/).filter(Boolean).length <= 12) {
      return { capability: CAPABILITIES.URL_READER, url: url[0] };
    }
  }

  // Live data & technical verification: short messages with temporal or product/install queries
  if (!isLong && !hasTranscriptSignals && !isSummaryRequest && /\b(net worth|latest|today|current|news|stock price|release date|weather|install|setup|configure|troubleshoot|how to|guide|agent)\b/i.test(t)) {
    return { capability: CAPABILITIES.WEB_RESEARCH, query: t };
  }

  return { capability: CAPABILITIES.NORMAL_CHAT };
}

module.exports = { CAPABILITIES, analyzeRequest };
