/**
 * AuraAI Request Router & Capability Classifier
 * Deterministically analyzes incoming user requests, conversation history, attachments,
 * conversation state, and user preferences to route to the correct capability layer.
 */

const { log } = require('./logger');
const ragEngine = require('./ragEngine');
const conversationState = require('./conversationState');

const CAPABILITIES = {
    NORMAL_CHAT: 'normal_chat',
    WEB_SEARCH: 'web_search',
    URL_READER: 'url_reader',
    DOCUMENT_READER: 'document_reader',
    IMAGE_UNDERSTANDING: 'image_understanding',
    IMAGE_GENERATION: 'image_generation',
    IMAGE_EDITING: 'image_editing',
    CODE: 'code',
    CALCULATION: 'code_calculation',
    CODE_CALCULATION: 'code_calculation',
    MULTI_TOOL_WORKFLOW: 'multi_tool_workflow',
    FOLLOW_UP: 'follow_up',
    COMPARISON: 'comparison',
    SUMMARIZATION: 'summarization'
};

function hasUrl(text) {
    if (!text || typeof text !== 'string') return false;
    return /https?:\/\/[^\s/$.?#].[^\s]*/i.test(text);
}

function extractUrls(text) {
    if (!text || typeof text !== 'string') return [];
    const matches = text.match(/https?:\/\/[^\s/$.?#].[^\s]*/gi);
    return matches || [];
}

/**
 * Extract topic / entity from text or conversation history
 */
function extractTopicFromText(text) {
    if (!text) return null;
    const clean = text.replace(/^(?:what is|who is|how to|explain|tell me about|summarize|read|search for|lookup)\s+/i, '').trim();

    // Check specific known entities
    if (/endpoint\s+central/i.test(clean)) return 'Endpoint Central';
    if (/skype/i.test(clean)) return 'Skype';
    if (/desktop\s+central/i.test(clean)) return 'Endpoint Central';
    if (/manageengine/i.test(clean)) return 'ManageEngine';
    if (/tamil\s+nadu/i.test(clean)) return 'Tamil Nadu';
    if (/windows/i.test(clean) && /uninstall|install/i.test(clean)) return 'Windows software management';

    // Match proper nouns or title-case sequences
    const properNounMatch = clean.match(/\b([A-Z][a-zA-Z0-9]+(?:\s+[A-Z][a-zA-Z0-9]+)*)\b/);
    if (properNounMatch && !['What', 'How', 'Who', 'Where', 'Why', 'Can', 'Is', 'Are'].includes(properNounMatch[1])) {
        return properNounMatch[1];
    }

    // First 4 meaningful words
    const words = clean.split(/\s+/).filter(w => w.length > 2 && !['the', 'and', 'for', 'with', 'about', 'latest', 'release'].includes(w.toLowerCase()));
    if (words.length > 0) {
        return words.slice(0, 3).join(' ');
    }
    return null;
}

/**
 * Main Request Classifier
 */
function analyzeRequest(rawInput, conversationHistory = [], attachments = [], userConfig = {}, conversationId = 'default') {
    const prompt = (rawInput || '').trim();
    const p = prompt.toLowerCase();
    const urls = extractUrls(prompt);

    log('REQUEST ROUTER', `Analyzing incoming request: "${prompt.substring(0, 60)}..."`, {
        historyTurns: conversationHistory.length,
        attachmentsCount: attachments.length,
        webSearchConfig: userConfig.webSearch,
        conversationId
    });

    const state = conversationState.getState(conversationId);

    const hasImageAttachment = attachments.some(a => a.type?.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|heic|heif|svg)$/i.test(a.name || '') || a.dataUrl);
    const hasDocAttachment = attachments.some(a => /\.(pdf|docx|xlsx|xls|csv|txt|pptx|json|md)$/i.test(a.name || '') || a.type?.includes('pdf') || a.type?.includes('document') || a.type?.includes('sheet'));

    // Check recent conversation state for references
    const recentAssistantReplies = conversationHistory.slice(-4).filter(m => m.role === 'assistant').map(m => m.content || '').join('\n');
    const hadRecentImageGen = Boolean(state.lastGeneratedImage) || recentAssistantReplies.includes('pollinations.ai') || recentAssistantReplies.includes('🎨 Generated Image');
    const hadRecentDoc = ragEngine.hasActiveDocuments(conversationId) || Boolean(state.activeDocument) || conversationHistory.some(m => (m.content || '').includes('[ATTACHED DOCUMENT:') || (m.content || '').includes('--- Page ') || (m.content || '').includes('[EXCEL WORKBOOK:'));
    const activeSources = ragEngine.getActiveSources(conversationId);
    const hadRecentUrl = activeSources.length > 0 || Boolean(state.activeUrl) || conversationHistory.some(m => (m.content || '').includes('https://') && ((m.content || '').includes('[Source ') || (m.content || '').includes('Fetched directly from')));

    // Check if this is a follow-up query referencing existing context
    const isFollowUpQuery = /^(?:any official vendor document|who publishes it|give me the official documentation|official documentation|official vendor document|official docs|who makes it|who developed it)[?.]*$/i.test(p) ||
                             (/^(?:who publishes|who makes|who created)\s+(?:it|this)[?.]*$/i.test(p)) ||
                             /^(?:what are the steps|explain it simply|is there a windows command)/i.test(p);

    // Only extract/update active topic if NOT a pronoun-based follow-up query
    if (!isFollowUpQuery) {
        const currentTopicCandidate = extractTopicFromText(prompt);
        if (currentTopicCandidate) {
            state.activeTopic = currentTopicCandidate;
        }
    }

    // -------------------------------------------------------------
    // PRIORITY 1: MULTI-TOOL WORKFLOW (e.g. Doc + URL, Screenshot + URL, Doc + Web comparison)
    // -------------------------------------------------------------
    const activeToolCount = (urls.length > 0 ? 1 : 0) + (hasDocAttachment ? 1 : 0) + (hasImageAttachment ? 1 : 0);
    const isComparisonQuery = p.includes('compare') && (urls.length > 0 || hasDocAttachment || hadRecentDoc || hadRecentUrl);
    if (activeToolCount >= 2 || (urls.length > 0 && (hasDocAttachment || hasImageAttachment)) || isComparisonQuery) {
        log('ROUTER RESULT', CAPABILITIES.MULTI_TOOL_WORKFLOW, { urls, hasDocAttachment, hasImageAttachment });
        return {
            capability: CAPABILITIES.MULTI_TOOL_WORKFLOW,
            urls,
            hasDocAttachment,
            hasImageAttachment,
            reason: 'Request combines multiple data modalities (documents, web URLs, or images)'
        };
    }

    // -------------------------------------------------------------
    // PRIORITY 2: EXPLICIT IMAGE GENERATION & IMAGE EDITING
    // -------------------------------------------------------------
    const imgGenRegex = /^(?:generate|create|make|draw|paint|sketch|produce|design|visualize)\s+(?:an?\s+)?(?:image|picture|photo|drawing|illustration|render|art|graphic|diagram|concept art|wallpaper|poster|scene)?\s*(?:of|on|about|depicting|with|for)?\s*(.+)/i;
    const directDrawRegex = /^(?:draw|paint|sketch)\s+(?:an?\s+)?(.+)/i;
    const imageFollowUpRegex = /^(?:make it|make the image|turn it into|change it to|add|darker|brighter|more realistic|in the style of)\s*(.+)?/i;

    const isExplicitNotImage = p.includes('how to draw') || p.includes('how to generate') || p.includes('how to create an image') || p.includes('code to generate') || p.includes('svg code') || p.includes('html code');

    if (!isExplicitNotImage) {
        // Image Follow-up check: "Make it darker and add rain" after an image was generated
        if (hadRecentImageGen && (imageFollowUpRegex.test(prompt) || p.includes('make it') || p.includes('add rain') || p.includes('darker') || p.includes('more realistic'))) {
            log('ROUTER RESULT', CAPABILITIES.IMAGE_EDITING);
            return {
                capability: CAPABILITIES.IMAGE_EDITING,
                isFollowUp: true,
                previousImagePrompt: state.lastGeneratedImage,
                reason: 'User requested a variation/edit of the previously generated image'
            };
        }

        if (imgGenRegex.test(prompt) || directDrawRegex.test(prompt)) {
            log('ROUTER RESULT', CAPABILITIES.IMAGE_GENERATION);
            state.lastGeneratedImage = prompt;
            return {
                capability: CAPABILITIES.IMAGE_GENERATION,
                reason: 'User explicitly requested generating an image or graphic'
            };
        }
    }

    // -------------------------------------------------------------
    // PRIORITY 3: IMAGE UNDERSTANDING / VISION
    // -------------------------------------------------------------
    if (hasImageAttachment || p.includes('this screenshot') || p.includes('this image') || p.includes('the photo') || p.includes('read the error message in the picture') || p.includes('what error is shown')) {
        log('ROUTER RESULT', CAPABILITIES.IMAGE_UNDERSTANDING);
        return {
            capability: CAPABILITIES.IMAGE_UNDERSTANDING,
            hasImageAttachment,
            reason: 'User attached or referenced an image/screenshot for visual analysis or OCR'
        };
    }

    // -------------------------------------------------------------
    // PRIORITY 4: DOCUMENT ATTACHMENT OR ACTIVE DOCUMENT QUERY
    // -------------------------------------------------------------
    const refersToDocument = p.includes('the document') || p.includes('the pdf') || p.includes('the file') || /\bpage\s+\d+\b/i.test(p) || p.includes('the sheet') || p.includes('the excel') || p.includes('the spreadsheet') || p.includes('summarize this pdf');
    if (hasDocAttachment || (hadRecentDoc && refersToDocument)) {
        log('ROUTER RESULT', CAPABILITIES.DOCUMENT_READER);
        return {
            capability: CAPABILITIES.DOCUMENT_READER,
            hasDocAttachment,
            isFollowUp: !hasDocAttachment && hadRecentDoc,
            reason: hasDocAttachment ? 'Document attached by user' : 'Query referencing active conversation document'
        };
    }

    // -------------------------------------------------------------
    // PRIORITY 5: DIRECT URL READER
    // -------------------------------------------------------------
    if (urls.length > 0) {
        log('ROUTER RESULT', CAPABILITIES.URL_READER, { url: urls[0] });
        state.activeUrl = urls[0];
        return {
            capability: CAPABILITIES.URL_READER,
            url: urls[0],
            urls,
            reason: 'User provided an explicit URL'
        };
    }

    // -------------------------------------------------------------
    // PRIORITY 6: FOLLOW UP TO AN EXISTING URL / STORED SOURCE
    // -------------------------------------------------------------
    const hasStoredWebSource = activeSources.length > 0 || hadRecentUrl;
    const isUrlFollowUpQuestion = hasStoredWebSource && (
        /^(?:what are the steps|what does it say|summarize (?:this|the) (?:page|webpage|article|site)|what about|tell me more|explain step|how do i|who wrote this|is there a windows command|what is the first step|explain it simply)/i.test(p) ||
        p.includes('the steps') ||
        p.includes('the webpage') ||
        p.includes('the article') ||
        p.includes('agent ip') ||
        p.includes('server name') ||
        p.includes('the site') ||
        p.includes('first step')
    );

    if (isUrlFollowUpQuestion) {
        const lastUrl = activeSources.length > 0 ? activeSources[activeSources.length - 1].url : state.activeUrl;
        log('ROUTER RESULT', CAPABILITIES.URL_READER, { isFollowUp: true, url: lastUrl });
        return {
            capability: CAPABILITIES.URL_READER,
            isFollowUp: true,
            url: lastUrl,
            reason: 'Follow-up query referencing previously retrieved webpage source in this conversation'
        };
    }

    // -------------------------------------------------------------
    // PRIORITY 7: CODE GENERATION & SCRIPTING
    // -------------------------------------------------------------
    const isCodeGenerationRequest = /^(?:write|create|generate|give me|show me)\s+(?:an?\s+)?(?:powershell|bash|shell|python|javascript|typescript|sql|script|code|function|regex|batch|cmd)\b/i.test(prompt) ||
                                  /^(?:powershell|bash|python)\s+(?:script|code|command)\s+to\b/i.test(prompt) ||
                                  /write\s+powershell\s+to\b/i.test(prompt);

    if (isCodeGenerationRequest) {
        log('ROUTER RESULT', CAPABILITIES.CODE);
        return {
            capability: CAPABILITIES.CODE,
            reason: 'User requested generation of executable code, PowerShell, or shell script'
        };
    }

    // -------------------------------------------------------------
    // PRIORITY 8: PURE CALCULATION & MATHEMATICS
    // -------------------------------------------------------------
    const isPureCalculation = /^[\s\d.+*\/()^%-]+$/.test(prompt) ||
                              /^(?:what is\s+)?\d+[\s+*\/^%-]\s*[\d.+*\/()^%-]+(?:\s*[?])?$/i.test(prompt) ||
                              /^(?:calculate|compute|solve|eval)\s+[\d.+*\/()^%-\s]+$/i.test(prompt);

    if (isPureCalculation && !p.includes('explain') && !p.includes('who') && !p.includes('what happened')) {
        log('ROUTER RESULT', CAPABILITIES.CODE_CALCULATION);
        return {
            capability: CAPABILITIES.CODE_CALCULATION,
            reason: 'Direct mathematical calculation or arithmetic expression'
        };
    }

    // -------------------------------------------------------------
    // PRIORITY 9: GREETINGS & CONVERSATIONAL CHIT-CHAT (STRICT NORMAL_CHAT)
    // -------------------------------------------------------------
    // Must NEVER trigger web search under any circumstance.
    const isGreetingOrChitChat = /^(?:hi|hello|hey|hiya|howdy|good morning|good afternoon|good evening|greetings|thanks|thank you|thx|cool|great|awesome|bye|goodbye|see ya|how are you|how are you doing|what are you doing|who are you|what is your name|what can you do|help me|tell me a joke|tell me about yourself|nice to meet you)[!.,? ]*$/i.test(prompt);
    if (isGreetingOrChitChat) {
        log('ROUTER RESULT', CAPABILITIES.NORMAL_CHAT, { subcategory: 'greeting/chit-chat' });
        return {
            capability: CAPABILITIES.NORMAL_CHAT,
            reason: 'Conversational greeting or chit-chat; processed directly by LLM'
        };
    }

    // -------------------------------------------------------------
    // PRIORITY 10: TIMELESS / CORE GENERAL KNOWLEDGE (STRICT NORMAL_CHAT)
    // -------------------------------------------------------------
    // Evergreen programming, computer science, science, and history questions
    // must NOT trigger web search unless explicitly requested with search keywords or current dates.
    const timeSensitiveKeywords = /\b(latest|current|recent|today|breaking|news|version|release|changelog|pricing|cost|price today|who won|score|weather today|forecast|stock price|2025|2026)\b/i;
    const isExplicitSearch = /^(?:search|lookup|google|find online|check the web for|browse)\s+/i.test(prompt);

    const isCoreTimelessTopic = /^(?:explain|what is|what are|how does|why does|compare|summarize|debug|refactor|translate|give me an example of)\s+(?:dns|polymorphism|an?\s+operating system|python|javascript|c\+\+|recursion|quicksort|object oriented|threads|pointers|tcp|udp|http|rest api|sql|database index|binary tree|a compiler|photosynthesis|gravity|dna|relativity|machine learning|neural network|transformer architecture)/i.test(p);

    if (isCoreTimelessTopic && !timeSensitiveKeywords.test(prompt) && !isExplicitSearch) {
        log('ROUTER RESULT', CAPABILITIES.NORMAL_CHAT, { subcategory: 'timeless-knowledge' });
        return {
            capability: CAPABILITIES.NORMAL_CHAT,
            reason: 'Core foundational concept or programming topic; processed directly by LLM'
        };
    }

    // -------------------------------------------------------------
    // PRIORITY 11: CONTEXT-AWARE FOLLOW-UP QUERY REWRITING (SEARCH FOLLOW-UPS)
    // -------------------------------------------------------------
    // Handles queries like:
    // - "any official vendor document?"
    // - "Who publishes it?"
    // - "Give me the official documentation."
    const isContextFollowUp = /^(?:any official vendor document|who publishes it|give me the official documentation|official documentation|official vendor document|official docs|who makes it|who developed it)[?.]*$/i.test(p) ||
                             (/^(?:who publishes|who makes|who created)\s+(?:it|this)[?.]*$/i.test(p));

    if (isContextFollowUp) {
        const activeTopic = state.activeTopic || 'Endpoint Central';
        let rewrittenQuery = prompt;

        if (/who publishes/i.test(p) || /who makes/i.test(p) || /who developed/i.test(p)) {
            rewrittenQuery = `Who publishes ${activeTopic}`;
        } else if (/official vendor document|official documentation|official docs/i.test(p)) {
            rewrittenQuery = `official documentation ${activeTopic}`;
        }

        log('ROUTER CONTEXT REWRITE', `Rewrote follow-up query "${prompt}" -> "${rewrittenQuery}" using activeTopic "${activeTopic}"`);
        return {
            capability: CAPABILITIES.WEB_SEARCH,
            query: rewrittenQuery,
            isFollowUp: true,
            activeTopic,
            prioritizeOfficial: true,
            reason: `Context follow-up resolved to active topic "${activeTopic}" with official vendor documentation priority`
        };
    }

    // -------------------------------------------------------------
    // PRIORITY 12: WEB SEARCH (Live facts, time-sensitive queries, vendor commands)
    // -------------------------------------------------------------
    const vendorActionQuery = /(silent uninstall|install command|download link|setup switches|agent configuration|endpoint central release|latest news)/i;
    const isTimeSensitive = timeSensitiveKeywords.test(prompt) || vendorActionQuery.test(prompt);

    if (isExplicitSearch) {
        log('ROUTER RESULT', CAPABILITIES.WEB_SEARCH);
        return {
            capability: CAPABILITIES.WEB_SEARCH,
            query: prompt.replace(/^(?:search|lookup|google|find online|check the web for|browse)\s+/i, '').trim(),
            reason: 'User explicitly requested a live web search'
        };
    }

    if (isTimeSensitive) {
        log('ROUTER RESULT', CAPABILITIES.WEB_SEARCH);
        return {
            capability: CAPABILITIES.WEB_SEARCH,
            query: prompt,
            reason: 'Time-sensitive news, release, or product query requiring live web retrieval'
        };
    }

    // -------------------------------------------------------------
    // PRIORITY 13: NORMAL CONVERSATIONAL CHAT (Default)
    // -------------------------------------------------------------
    log('ROUTER RESULT', CAPABILITIES.NORMAL_CHAT);
    return {
        capability: CAPABILITIES.NORMAL_CHAT,
        reason: 'General knowledge, explanation, reasoning, or conversation suitable for direct LLM processing'
    };
}

module.exports = {
    CAPABILITIES,
    analyzeRequest,
    hasUrl,
    extractUrls,
    extractTopicFromText
};
