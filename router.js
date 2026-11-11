/**
 * AuraAI Intelligent Request Router & Capability Selector
 * Conceptually routes:
 * User Message
 *      ↓
 * Request Analyzer
 *      ↓
 * Capability Selection:
 *   ├── Normal Chat (Direct LLM)
 *   ├── Web Search (Live retrieval)
 *   ├── URL Reader (Direct document/webpage fetch)
 *   ├── Document Reader (RAG & document parsing)
 *   ├── Image Understanding (Vision / OCR)
 *   ├── Image Generation (Text-to-Image / Image Edit)
 *   ├── Code / Calculation (Math solver / code helper)
 *   └── Multi-Tool Workflow (Web + Doc + Vision comparison)
 */

const { log } = require('./logger');

const CAPABILITIES = {
    NORMAL_CHAT: 'normal_chat',
    WEB_SEARCH: 'web_search',
    URL_READER: 'url_reader',
    DOCUMENT_READER: 'document_reader',
    IMAGE_UNDERSTANDING: 'image_understanding',
    IMAGE_GENERATION: 'image_generation',
    IMAGE_EDITING: 'image_editing',
    CODE_CALCULATION: 'code_calculation',
    MULTI_TOOL_WORKFLOW: 'multi_tool_workflow'
};

function hasUrl(text) {
    if (!text || typeof text !== 'string') return false;
    return /https?:\/\/[^\s]+/i.test(text);
}

function extractUrls(text) {
    if (!text || typeof text !== 'string') return [];
    const matches = text.match(/https?:\/\/[^\s"'<>()[\]{}]+/gi) || [];
    return matches.map(u => u.replace(/[.,;!?]+$/, ''));
}

function analyzeRequest(rawPrompt, conversationHistory = [], attachments = [], userConfig = {}) {
    const prompt = (rawPrompt || '').trim();
    const p = prompt.toLowerCase();
    const urls = extractUrls(prompt);

    log('REQUEST ROUTER', `Analyzing incoming request: "${prompt.substring(0, 60)}..."`, {
        historyTurns: conversationHistory.length,
        attachmentsCount: attachments.length,
        webSearchConfig: userConfig.webSearch
    });

    const hasImageAttachment = attachments.some(a => a.type?.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|heic|heif|svg)$/i.test(a.name || ''));
    const hasDocAttachment = attachments.some(a => /\.(pdf|docx|xlsx|xls|csv|txt|pptx|json|md)$/i.test(a.name || '') || a.type?.includes('pdf') || a.type?.includes('document') || a.type?.includes('sheet'));

    // Check recent conversation state for references
    const recentAssistantReplies = conversationHistory.slice(-4).filter(m => m.role === 'assistant').map(m => m.content || '').join('\n');
    const hadRecentImageGen = recentAssistantReplies.includes('pollinations.ai') || recentAssistantReplies.includes('🎨 Generated Image');
    const hadRecentDoc = conversationHistory.some(m => (m.content || '').includes('[ATTACHED DOCUMENT:') || (m.content || '').includes('--- Page ') || (m.content || '').includes('[EXCEL WORKBOOK:'));
    const hadRecentUrl = conversationHistory.some(m => (m.content || '').includes('https://') && ((m.content || '').includes('[Source ') || (m.content || '').includes('Fetched directly from')));

    // 1. MULTI-TOOL WORKFLOW (e.g. Screenshot + Doc or Screenshot + URL or Doc + Web)
    const activeToolCount = (urls.length > 0 ? 1 : 0) + (hasDocAttachment ? 1 : 0) + (hasImageAttachment ? 1 : 0);
    if (activeToolCount >= 2 || (urls.length > 0 && (hasDocAttachment || hasImageAttachment)) || (p.includes('compare') && (urls.length > 0 || hasDocAttachment || hasImageAttachment))) {
        log('CAPABILITY SELECTED', CAPABILITIES.MULTI_TOOL_WORKFLOW, { urls, hasDocAttachment, hasImageAttachment });
        return {
            capability: CAPABILITIES.MULTI_TOOL_WORKFLOW,
            urls,
            hasDocAttachment,
            hasImageAttachment,
            reason: 'Request combines multiple data modalities (documents, web URLs, or images)'
        };
    }

    // 2. IMAGE GENERATION & IMAGE EDITING
    const imgGenRegex = /^(?:generate|create|make|draw|paint|sketch|show me|produce|design|visualize)\s+(?:an?\s+)?(?:image|picture|photo|drawing|illustration|render|art|graphic|diagram|concept art|wallpaper|poster|scene)?\s*(?:of|on|about|depicting|with|for)?\s*(.+)/i;
    const directDrawRegex = /^(?:draw|paint|sketch)\s+(?:an?\s+)?(.+)/i;
    const imageFollowUpRegex = /^(?:make it|make the image|turn it into|change it to|add|darker|brighter|more realistic|in the style of)\s+(.+)/i;

    const isExplicitNotImage = p.includes('how to draw') || p.includes('how to generate') || p.includes('how to create an image') || p.includes('code to generate') || p.includes('svg code') || p.includes('html code');

    if (!isExplicitNotImage) {
        // Image Follow-up check: "Make it darker and add rain" after an image was generated
        if (hadRecentImageGen && (imageFollowUpRegex.test(prompt) || p.includes('make it') || p.includes('add rain') || p.includes('darker') || p.includes('more realistic'))) {
            log('CAPABILITY SELECTED', CAPABILITIES.IMAGE_EDITING);
            return {
                capability: CAPABILITIES.IMAGE_EDITING,
                isFollowUp: true,
                reason: 'User requested a variation/edit of the previously generated image'
            };
        }

        if (imgGenRegex.test(prompt) || directDrawRegex.test(prompt)) {
            log('CAPABILITY SELECTED', CAPABILITIES.IMAGE_GENERATION);
            return {
                capability: CAPABILITIES.IMAGE_GENERATION,
                reason: 'User explicitly requested generating an image or graphic'
            };
        }
    }

    // 3. IMAGE UNDERSTANDING / VISION
    if (hasImageAttachment || p.includes('this screenshot') || p.includes('this image') || p.includes('the photo') || p.includes('read the error message in the picture')) {
        log('CAPABILITY SELECTED', CAPABILITIES.IMAGE_UNDERSTANDING);
        return {
            capability: CAPABILITIES.IMAGE_UNDERSTANDING,
            hasImageAttachment,
            reason: 'User attached or referenced an image/screenshot for visual analysis or OCR'
        };
    }

    // 4. DIRECT URL READER
    if (urls.length > 0) {
        log('CAPABILITY SELECTED', CAPABILITIES.URL_READER, { url: urls[0] });
        return {
            capability: CAPABILITIES.URL_READER,
            url: urls[0],
            urls,
            reason: 'User provided an explicit URL'
        };
    }

    // 5. DOCUMENT READER (Active attachment or Follow-up referencing document/page)
    const refersToDocument = p.includes('the document') || p.includes('the pdf') || p.includes('the file') || p.includes('page ') || p.includes('the sheet') || p.includes('the excel') || p.includes('the spreadsheet');
    if (hasDocAttachment || (hadRecentDoc && refersToDocument)) {
        log('CAPABILITY SELECTED', CAPABILITIES.DOCUMENT_READER);
        return {
            capability: CAPABILITIES.DOCUMENT_READER,
            hasDocAttachment,
            isFollowUp: !hasDocAttachment && hadRecentDoc,
            reason: hasDocAttachment ? 'Document attached by user' : 'Follow-up query referencing active conversation document'
        };
    }

    // 6. CODE & CALCULATION (Pure math equations or explicit code execution requests)
    const isPureCalculation = /^[\s\d\.\+\-\*\/\(\)\^\%]+$/.test(prompt) || /^(?:calculate|compute|solve|eval|what is\s+\d+[\s\+\-\*\/\^%])/i.test(prompt);
    if (isPureCalculation && !p.includes('explain') && !p.includes('who') && !p.includes('what happened')) {
        log('CAPABILITY SELECTED', CAPABILITIES.CODE_CALCULATION);
        return {
            capability: CAPABILITIES.CODE_CALCULATION,
            reason: 'Direct mathematical calculation or expression evaluation'
        };
    }

    // 7. WEB SEARCH (Requires real-time / current facts / specific external product details)
    const timeSensitiveWords = /\b(latest|current|recent|today|breaking|news|version|release|changelog|pricing|cost|price today|roadmap|who won|score)\b/i;
    const vendorActionQuery = /(silent uninstall|install command|download link|setup switches|agent configuration)/i;
    const explicitSearchKeywords = /^(?:search|lookup|google|find online|check the web for)\s+/i;

    const isTimeSensitive = timeSensitiveWords.test(prompt) || vendorActionQuery.test(prompt) || explicitSearchKeywords.test(prompt);

    // Timeless / Core knowledge questions that must NOT trigger web search unnecessarily
    const isCoreChatTopic = /^(?:explain|what is|how does|compare|summarize|write|debug|refactor|translate|give me|tell me a|why is)\s+/i.test(prompt) &&
        !isTimeSensitive &&
        !p.includes('endpoint central') &&
        !p.includes('zoho') &&
        !p.includes('2025') &&
        !p.includes('2026') &&
        !p.includes('today');

    if (userConfig.webSearch === true && isTimeSensitive) {
        log('CAPABILITY SELECTED', CAPABILITIES.WEB_SEARCH);
        return {
            capability: CAPABILITIES.WEB_SEARCH,
            query: prompt.replace(explicitSearchKeywords, '').trim(),
            reason: 'Time-sensitive or product query requiring live web retrieval'
        };
    }

    if (userConfig.webSearch === true && !isCoreChatTopic && prompt.length > 5) {
        log('CAPABILITY SELECTED', CAPABILITIES.WEB_SEARCH);
        return {
            capability: CAPABILITIES.WEB_SEARCH,
            query: prompt,
            reason: 'Live web search explicitly active for general query'
        };
    }

    // 8. NORMAL CONVERSATIONAL CHAT (General explanations, reasoning, programming, summarization, etc.)
    log('CAPABILITY SELECTED', CAPABILITIES.NORMAL_CHAT);
    return {
        capability: CAPABILITIES.NORMAL_CHAT,
        reason: 'General knowledge, coding, explanation, reasoning, or conversation suitable for direct LLM processing'
    };
}

module.exports = {
    CAPABILITIES,
    analyzeRequest,
    hasUrl,
    extractUrls
};
