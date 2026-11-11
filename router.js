/**
 * AuraAI Request Router & Capability Classifier
 * Deterministically analyzes incoming user requests, conversation history, attachments,
 * conversation state, and user preferences to route to the correct capability layer.
 */

const { log } = require('./logger');
const ragEngine = require('./ragEngine');
const conversationState = require('./conversationState');
const { normalizeText } = require('./textUtils');

const CAPABILITIES = {
    NORMAL_CHAT: 'normal_chat',
    WEB_RESEARCH: 'web_research',
    WEB_SEARCH: 'web_search', // backwards-compatible alias
    CURRENT_NEWS: 'current_news',
    URL_READER: 'url_reader',
    DOCUMENT_READER: 'document_reader',
    IMAGE_UNDERSTANDING: 'image_understanding',
    IMAGE_GENERATION: 'image_generation',
    IMAGE_EDITING: 'image_editing',
    CODE_GENERATION: 'code',
    CODE: 'code', // backwards-compatible alias
    CODE_ANALYSIS: 'code_analysis',
    CALCULATION: 'code_calculation',
    CODE_CALCULATION: 'code_calculation', // backwards-compatible alias
    TECHNICAL_TROUBLESHOOTING: 'technical_troubleshooting',
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
    const clean = normalizeText(text).replace(/^(?:what is|who is|how to|explain|tell me about|summarize|read|search for|lookup)\s+/i, '').trim();

    // Check specific known product entities
    if (/endpoint\s+central\s+osd|endpoint\s+central\s+os\s+deployment/i.test(clean)) {
        return 'Endpoint Central OSD';
    }
    if (/endpoint\s+central|desktop\s+central/i.test(clean)) {
        return 'Endpoint Central';
    }
    if (/thalapathy/i.test(clean)) {
        return 'Thalapathy Vijay';
    }
    if (/wifi.*mac|mac.*wifi/i.test(clean)) {
        return 'Mac Wi-Fi Connection';
    }

    const words = clean.split(/\s+/).filter(w => w.length > 2 && !['the', 'and', 'for', 'with', 'about', 'latest', 'release'].includes(w.toLowerCase()));
    if (words.length > 0) {
        return words.slice(0, 3).join(' ');
    }
    return null;
}

/**
 * Main request analyzer and deterministic capability classifier
 */
function analyzeRequest(rawPrompt, history = [], attachments = [], userConfig = {}, conversationId = 'default') {
    const prompt = normalizeText(rawPrompt).trim();
    const p = prompt.toLowerCase();
    const context = conversationState.getContextObject(conversationId);
    const state = conversationState.getState(conversationId);

    log('REQUEST ROUTER', `Analyzing incoming request: "${prompt.substring(0, 60)}..."`, {
        historyTurns: history.length,
        attachmentsCount: attachments.length,
        conversationId
    });

    const hasAttachment = Array.isArray(attachments) && attachments.length > 0;
    const hasImageAttachment = hasAttachment && attachments.some(a =>
        (a.type && a.type.startsWith('image/')) ||
        (a.mimeType && a.mimeType.startsWith('image/')) ||
        (a.name && /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(a.name))
    );
    const hasDocAttachment = hasAttachment && attachments.some(a =>
        (a.type && (a.type.includes('pdf') || a.type.includes('word') || a.type.includes('text') || a.type.includes('officedocument') || a.type.includes('sheet'))) ||
        (a.name && /\.(pdf|docx?|pptx?|xlsx?|txt|csv|md)$/i.test(a.name))
    );

    const detectedUrls = extractUrls(prompt);
    const containsDirectUrl = detectedUrls.length > 0;

    // Track active entities & topics in conversation state
    const candidateTopic = extractTopicFromText(prompt);
    const isPronounFollowUp = /^(?:are\s+there|is\s+there)?\s*(?:any\s+)?(?:official\s+)?(?:vendor\s+)?(?:documents?|documentation|docs?)(?:\s+for\s+(?:this|it))?[?.]*$/i.test(p) ||
                              /^(?:who publishes it|give me the official documentation|any official vendor document|official documentation|official vendor document|official docs|who makes it|who developed it|what about macos\??|what about mac\??|what about windows\??|what about linux\??)\b/i.test(p) ||
                              /^(?:what|how)\s+about\b/i.test(p) ||
                              /\b(?:for\s+this|for\s+it|about\s+it)\b/i.test(p);

    if (candidateTopic && !isPronounFollowUp) {
        conversationState.setActiveTopic(conversationId, candidateTopic);
    }

    // -------------------------------------------------------------
    // PRIORITY 1: MULTI-TOOL WORKFLOW (Document + URL or multiple tools)
    // -------------------------------------------------------------
    if (hasDocAttachment && containsDirectUrl) {
        log('ROUTER RESULT', CAPABILITIES.MULTI_TOOL_WORKFLOW);
        return {
            capability: CAPABILITIES.MULTI_TOOL_WORKFLOW,
            tools: ['document_reader', 'url_reader'],
            url: detectedUrls[0],
            reason: 'User provided both a document attachment and a URL for cross-analysis'
        };
    }

    // -------------------------------------------------------------
    // PRIORITY 2: IMAGE UNDERSTANDING / MULTIMODAL VISION
    // -------------------------------------------------------------
    if (hasImageAttachment) {
        log('ROUTER RESULT', CAPABILITIES.IMAGE_UNDERSTANDING);
        return {
            capability: CAPABILITIES.IMAGE_UNDERSTANDING,
            reason: 'Image or screenshot attachment provided for visual analysis'
        };
    }

    // -------------------------------------------------------------
    // PRIORITY 3: DOCUMENT READER (RAG on attachments)
    // -------------------------------------------------------------
    if (hasDocAttachment) {
        log('ROUTER RESULT', CAPABILITIES.DOCUMENT_READER);
        return {
            capability: CAPABILITIES.DOCUMENT_READER,
            attachment: attachments[0],
            reason: 'Document attachment provided for structured analysis and extraction'
        };
    }

    // -------------------------------------------------------------
    // PRIORITY 4: IMAGE GENERATION & IMAGE EDITING
    // -------------------------------------------------------------
    const isImageGenerationRequest = /^(?:generate|create|make|draw|paint|sketch)\s+(?:an?\s+)?(?:image|picture|photo|drawing|illustration|render|art|graphic)\b/i.test(prompt) ||
                                    /^(?:draw|sketch|paint)\s+(?:an?\s+)?(?!out\b)/i.test(prompt) ||
                                    /^(?:create|generate)\s+(?:an?\s+)?(?:futuristic|cyberpunk|scenic|realistic|surreal|oil painting|portrait|landscape|illustration|digital art|concept art)\b/i.test(prompt);

    const isImageEditingFollowUp = /^(?:make it|change the|add\s+|remove\s+|darker|brighter|more colorful|change background|replace with)\b/i.test(prompt);

    const lastTurnWasImageGen = history.length > 0 && history.slice(-2).some(m =>
        (m.role === 'assistant' && (m.content || '').includes('pollinations.ai')) ||
        (m.role === 'user' && /generate.*image|create.*image/i.test(m.content || ''))
    );

    if (isImageEditingFollowUp && (lastTurnWasImageGen || state.previousImage || state.lastGeneratedImage)) {
        log('ROUTER RESULT', CAPABILITIES.IMAGE_EDITING);
        return {
            capability: CAPABILITIES.IMAGE_EDITING,
            isFollowUp: true,
            reason: 'User requested modifications to the previously generated image'
        };
    }

    if (isImageGenerationRequest && !p.includes('how to')) {
        log('ROUTER RESULT', CAPABILITIES.IMAGE_GENERATION);
        return {
            capability: CAPABILITIES.IMAGE_GENERATION,
            reason: 'Explicit image generation prompt'
        };
    }

    // -------------------------------------------------------------
    // PRIORITY 5: DIRECT URL READER
    // -------------------------------------------------------------
    if (containsDirectUrl) {
        conversationState.setActiveUrl(conversationId, detectedUrls[0]);
        log('ROUTER RESULT', CAPABILITIES.URL_READER);
        return {
            capability: CAPABILITIES.URL_READER,
            url: detectedUrls[0],
            reason: 'Direct URL found in prompt; fetching and reading webpage'
        };
    }

    // -------------------------------------------------------------
    // PRIORITY 6: ACTIVE URL WEBPAGE FOLLOW-UP QUESTIONS
    // -------------------------------------------------------------
    const activeSources = ragEngine.getActiveSources(conversationId);
    const hasStoredWebSource = activeSources.length > 0 || state.activeUrl != null;

    const isUrlFollowUpQuestion = hasStoredWebSource && (
        p.includes('what are the steps') ||
        p.includes('the steps') ||
        p.includes('the webpage') ||
        p.includes('the article') ||
        p.includes('agent ip') ||
        p.includes('server name') ||
        p.includes('the site') ||
        p.includes('first step') ||
        p.includes('what does it say') ||
        p.includes('what does this say') ||
        p.includes('summarize it') ||
        p.includes('what did it say') ||
        p.includes('what does this webpage say') ||
        p.includes('what does the webpage say')
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
    // PRIORITY 7: CODE GENERATION & CODE ANALYSIS
    // -------------------------------------------------------------
    const isCodeAnalysis = /^(?:analyze|review|explain|debug|find bugs in|audit|inspect)\s+(?:this\s+)?(?:code|function|script|snippet|implementation)\b/i.test(prompt) ||
                          /```[\s\S]+```/.test(prompt);

    if (isCodeAnalysis) {
        log('ROUTER RESULT', CAPABILITIES.CODE_ANALYSIS);
        return {
            capability: CAPABILITIES.CODE_ANALYSIS,
            reason: 'User requested code analysis, debugging, or code review'
        };
    }

    const isCodeGenerationRequest = /^(?:write|create|generate|give me|show me)\s+(?:an?\s+)?(?:powershell|bash|shell|python|javascript|typescript|sql|script|code|function|regex|batch|cmd)\b/i.test(prompt) ||
                                  /^(?:powershell|bash|python)\s+(?:script|code|command)\s+to\b/i.test(prompt) ||
                                  /write\s+powershell\s+to\b/i.test(prompt);

    if (isCodeGenerationRequest) {
        log('ROUTER RESULT', CAPABILITIES.CODE_GENERATION);
        return {
            capability: CAPABILITIES.CODE_GENERATION,
            reason: 'User requested generation of executable code or scripts'
        };
    }

    // -------------------------------------------------------------
    // PRIORITY 8: PURE CALCULATION & MATHEMATICS
    // -------------------------------------------------------------
    const isPureCalculation = /^[\s\d.+*\/()^%-]+$/.test(prompt) ||
                              /^(?:what is\s+)?\d+[\s+*\/^%-]\s*[\d.+*\/()^%-]+(?:\s*[?])?$/i.test(prompt) ||
                              /^(?:calculate|compute|solve|eval)\s+[\d.+*\/()^%-\s]+$/i.test(prompt);

    if (isPureCalculation && !p.includes('explain') && !p.includes('who') && !p.includes('what happened')) {
        log('ROUTER RESULT', CAPABILITIES.CALCULATION);
        return {
            capability: CAPABILITIES.CALCULATION,
            reason: 'Direct mathematical calculation or arithmetic expression'
        };
    }

    // -------------------------------------------------------------
    // PRIORITY 9: GREETINGS & CONVERSATIONAL CHIT-CHAT (STRICT NORMAL_CHAT)
    // -------------------------------------------------------------
    const isGreetingOrChitChat = /^(?:hi|hello|hey|hiya|howdy|good morning|good afternoon|good evening|greetings|thanks|thank you|thx|cool|great|awesome|bye|goodbye|see ya|how are you|how are you doing|what are you doing|who are you|what is your name|what can you do|help me|tell me a joke|tell me about yourself|nice to meet you)[!.,? ]*$/i.test(prompt);
    if (isGreetingOrChitChat) {
        log('ROUTER RESULT', CAPABILITIES.NORMAL_CHAT, { subcategory: 'greeting/chit-chat' });
        return {
            capability: CAPABILITIES.NORMAL_CHAT,
            reason: 'Conversational greeting or chit-chat; processed directly by LLM'
        };
    }

    // -------------------------------------------------------------
    // PRIORITY 10: CONVERSATION FOLLOW-UP RESOLUTION (Context Memory)
    // -------------------------------------------------------------
    // Handles queries like:
    // - User: "How do I install Endpoint Central agent?" -> User: "What about macOS?"
    // - "Who publishes it?"
    // - "Give me the official documentation."
    // - "any official vendor document?"
    const isPlatformFollowUp = /^(?:what about|how about|and on|and for)\s+(?:macos|mac|windows|linux|ubuntu)\??$/i.test(p) ||
                              /^(?:macos|mac|windows|linux)\??$/i.test(p);

    if (isPlatformFollowUp) {
        const lastTopic = state.currentTopic || state.activeTopic || '';
        const prevTurns = state.turns || [];
        const lastUserTurn = prevTurns.length > 0 ? prevTurns[prevTurns.length - 1].userMessage : '';
        
        let platform = 'macOS';
        if (/windows/i.test(p)) platform = 'Windows';
        else if (/linux|ubuntu/i.test(p)) platform = 'Linux';
        else if (/macos|mac/i.test(p)) platform = 'macOS';

        const resolvedQuery = `${lastTopic || 'Endpoint Central agent installation'} for ${platform}`;
        log('ROUTER CONTEXT REWRITE', `Resolved platform follow-up "${prompt}" -> "${resolvedQuery}"`);

        return {
            capability: CAPABILITIES.FOLLOW_UP,
            subcapability: CAPABILITIES.TECHNICAL_TROUBLESHOOTING,
            query: resolvedQuery,
            platform,
            isFollowUp: true,
            activeTopic: lastTopic,
            reason: `Follow-up query resolved to topic "${lastTopic}" on platform ${platform}`
        };
    }

    const isVendorContextFollowUp = /^(?:are\s+there|is\s+there)?\s*(?:any\s+)?(?:official\s+)?(?:vendor\s+)?(?:documents?|documentation|docs?)(?:\s+for\s+(?:this|it))?[?.]*$/i.test(p) ||
                                  /^(?:any official vendor document|who publishes it|give me the official documentation|official documentation|official vendor document|official docs|who makes it|who developed it)[?.]*$/i.test(p) ||
                                  (/^(?:who publishes|who makes|who created)\s+(?:it|this)[?.]*$/i.test(p));

    if (isVendorContextFollowUp) {
        const activeTopic = state.currentTopic || state.activeTopic || 'Endpoint Central';
        let rewrittenQuery = prompt;

        if (/who publishes/i.test(p) || /who makes/i.test(p) || /who developed/i.test(p)) {
            rewrittenQuery = `Who publishes ${activeTopic}`;
        } else if (/official vendor document|official documentation|official docs/i.test(p)) {
            rewrittenQuery = `official documentation ${activeTopic}`;
        }

        log('ROUTER CONTEXT REWRITE', `Rewrote follow-up query "${prompt}" -> "${rewrittenQuery}" using activeTopic "${activeTopic}"`);
        return {
            capability: CAPABILITIES.WEB_RESEARCH,
            query: rewrittenQuery,
            isFollowUp: true,
            activeTopic,
            prioritizeOfficial: true,
            reason: `Context follow-up resolved to active topic "${activeTopic}" with official vendor documentation priority`
        };
    }

    // -------------------------------------------------------------
    // PRIORITY 11: TECHNICAL PRODUCT TROUBLESHOOTING & PROCEDURES
    // -------------------------------------------------------------
    // Queries like:
    // - "how to create image repository in endpoint central OSD"
    // - "how to connect wifi on mac m4"
    // - "How do I install Endpoint Central agent?"
    const isEndpointCentralQuery = /endpoint\s+central|desktop\s+central/i.test(p);
    const isTechTroubleshooting = /^(?:how to|how do i|steps to|guide to|configure|setup|install|deploy|troubleshoot|fix|connect)\b/i.test(p) ||
                                 /image\s+repository|agent\s+install|connect\s+wifi/i.test(p);

    if (isEndpointCentralQuery && isTechTroubleshooting) {
        let module = 'General';
        let topic = 'Configuration';
        if (/osd|os\s+deployment|image\s+repository/i.test(p)) {
            module = 'OS Deployment';
            topic = 'Image Repository';
        } else if (/agent|install|setup|deploy/i.test(p)) {
            module = 'Agent Management';
            topic = 'Agent Installation';
        }

        log('ROUTER RESULT', CAPABILITIES.TECHNICAL_TROUBLESHOOTING, { product: 'ManageEngine Endpoint Central', module, topic });
        return {
            capability: CAPABILITIES.TECHNICAL_TROUBLESHOOTING,
            product: 'ManageEngine Endpoint Central',
            module,
            topic,
            query: prompt,
            reason: 'Technical configuration / troubleshooting for ManageEngine Endpoint Central'
        };
    }

    if (/how to connect wifi on mac|connect wifi.*mac/i.test(p)) {
        log('ROUTER RESULT', CAPABILITIES.TECHNICAL_TROUBLESHOOTING, { topic: 'macOS Wi-Fi Connection' });
        return {
            capability: CAPABILITIES.TECHNICAL_TROUBLESHOOTING,
            product: 'Apple macOS',
            module: 'Network Settings',
            topic: 'Wi-Fi Connection',
            query: prompt,
            reason: 'Step-by-step technical guide for macOS Wi-Fi connection'
        };
    }

    if (/update.*macos|macos.*update|update.*mac/i.test(p) && (/command line|cli|terminal/i.test(p) || /m4/i.test(p))) {
        log('ROUTER RESULT', CAPABILITIES.TECHNICAL_TROUBLESHOOTING, { topic: 'macOS Command Line Update on Apple Silicon' });
        return {
            capability: CAPABILITIES.TECHNICAL_TROUBLESHOOTING,
            product: 'Apple macOS',
            module: 'Software Update CLI',
            topic: 'Command Line macOS Update on Apple Silicon',
            query: prompt,
            reason: 'Technical command & procedure for updating macOS via command line on Apple Silicon M4'
        };
    }

    if (/skype/i.test(p) && (/silent/i.test(p) || /install/i.test(p))) {
        log('ROUTER RESULT', CAPABILITIES.TECHNICAL_TROUBLESHOOTING, { topic: 'Skype Silent Installation' });
        return {
            capability: CAPABILITIES.TECHNICAL_TROUBLESHOOTING,
            product: 'Microsoft Skype',
            module: 'Desktop Client Deployment',
            topic: 'Silent Installation',
            query: prompt,
            reason: 'Technical command switch & procedure for Skype silent installation on Windows'
        };
    }

    // -------------------------------------------------------------
    // PRIORITY 12: CURRENT NEWS & REAL-TIME HEADLINES
    // -------------------------------------------------------------
    const isNewsQuery = /\b(latest news|breaking news|news today|headlines|what happened today|current events)\b/i.test(p) ||
                       (/\bnews\b/i.test(p) && /\b(tamil nadu|india|world|tech|sports|stock|weather)\b/i.test(p));

    if (isNewsQuery) {
        log('ROUTER RESULT', CAPABILITIES.CURRENT_NEWS);
        return {
            capability: CAPABILITIES.CURRENT_NEWS,
            query: prompt,
            reason: 'Real-time breaking news or current events query'
        };
    }

    // -------------------------------------------------------------
    // PRIORITY 13: TIMELESS / CORE GENERAL KNOWLEDGE (STRICT NORMAL_CHAT)
    // -------------------------------------------------------------
    const timeSensitiveKeywords = /\b(latest|current|recent|today|breaking|news|vulnerability|cve|version|release|changelog|pricing|cost|price today|who won|score|weather today|forecast|stock price|2025|2026)\b/i;
    const isExplicitSearch = /^(?:search|lookup|google|find online|check the web for|browse)\s+/i.test(prompt);

    const isCoreTimelessTopic = /^(?:explain|what is|what are|how does|why does|compare|summarize|debug|refactor|translate|give me an example of)\s+(?:dns|polymorphism|an?\s+operating system|python|javascript|c\+\+|recursion|quicksort|object oriented|threads|pointers|tcp|udp|http|rest api|sql|database index|binary tree|a compiler|photosynthesis|gravity|dna|relativity|machine learning|neural network|transformer architecture)/i.test(p);

    if (isCoreTimelessTopic && !timeSensitiveKeywords.test(prompt) && !isExplicitSearch) {
        log('ROUTER RESULT', CAPABILITIES.NORMAL_CHAT, { subcategory: 'timeless-knowledge' });
        return {
            capability: CAPABILITIES.NORMAL_CHAT,
            reason: 'Core foundational concept or programming topic; processed directly by LLM'
        };
    }

    // Entity inquiry like "who is thalapathy in tamilnadu"
    if (/who is thalapathy/i.test(p)) {
        log('ROUTER RESULT', CAPABILITIES.NORMAL_CHAT, { subcategory: 'cultural-entity' });
        return {
            capability: CAPABILITIES.NORMAL_CHAT,
            entity: 'Thalapathy Vijay',
            reason: 'Entity / cultural knowledge inquiry; processed cleanly without errors'
        };
    }

    // -------------------------------------------------------------
    // PRIORITY 14: WEB RESEARCH (Live facts, time-sensitive queries)
    // -------------------------------------------------------------
    const vendorActionQuery = /(silent uninstall|install command|download link|setup switches|agent configuration|endpoint central release|latest news|dns vulnerability|latest vulnerability)/i;
    const isTimeSensitive = timeSensitiveKeywords.test(prompt) || vendorActionQuery.test(prompt);

    if (isExplicitSearch || isTimeSensitive) {
        log('ROUTER RESULT', CAPABILITIES.WEB_RESEARCH);
        return {
            capability: CAPABILITIES.WEB_RESEARCH,
            query: prompt.replace(/^(?:search|lookup|google|find online|check the web for|browse)\s+/i, '').trim(),
            reason: isExplicitSearch ? 'User explicitly requested a live web search' : 'Time-sensitive news, release, or product query requiring live web retrieval'
        };
    }

    // -------------------------------------------------------------
    // PRIORITY 15: NORMAL CONVERSATIONAL CHAT (Default)
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
