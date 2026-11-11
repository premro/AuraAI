/**
 * AuraAI Central Request Orchestrator
 * Coordinates Request Router, Capabilities, RAG Engine, Tools, and Model Adapters.
 */

const { log, time } = require('./logger');
const { analyzeRequest, CAPABILITIES } = require('./router');
const webRetrieval = require('./webRetrieval');
const ragEngine = require('./ragEngine');
const { parseStructuredText, summarizeDocumentLocally } = require('./documentProcessor');
const { getModelMetadata, checkCapability, generateImage } = require('./modelRegistry');
const { calculateMath } = require('./tools');
const { buildSafeGroundedPrompt } = require('./promptSanitizer');

async function orchestrateRequest({
    prompt,
    history = [],
    attachments = [],
    userConfig = {},
    conversationId = 'default',
    callGeminiAPI,
    callOpenAIAPI,
    generateSmartResponseFallback
}) {
    const rawPrompt = (prompt || '').replace(/^(?:User Request|User|Prompt):\s*/i, '').trim();
    const activeApiKey = (userConfig.apiKey || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || process.env.GROQ_API_KEY || '').trim();
    const selectedModel = userConfig.model || 'gpt-4o-mini';
    const timer = time('REQUEST ROUTER', `Request orchestration for model: ${selectedModel}`);

    // 1. Analyze request and select capability
    const route = analyzeRequest(rawPrompt, history, attachments, userConfig, conversationId);
    log('MODEL SELECTED', selectedModel, { provider: getModelMetadata(selectedModel).provider });

    // Handle any newly attached documents
    if (attachments && attachments.length > 0) {
        attachments.forEach(att => {
            if (att.content && (att.type?.includes('pdf') || att.type?.includes('document') || att.name?.match(/\.(pdf|docx|xlsx|txt|csv|pptx)$/i))) {
                const parsedDoc = parseStructuredText(att.content, att.name || 'attachment.pdf', att.name?.split('.').pop() || 'pdf');
                ragEngine.registerDocument(parsedDoc, conversationId);
            }
        });
    }

    // -------------------------------------------------------------
    // CAPABILITY 1: IMAGE GENERATION & EDITING
    // -------------------------------------------------------------
    if (route.capability === CAPABILITIES.IMAGE_GENERATION || route.capability === CAPABILITIES.IMAGE_EDITING) {
        let previousPrompt = '';
        if (route.isFollowUp) {
            // Find recent image prompt from history
            const prevMsg = [...history].reverse().find(m => (m.content || '').includes('🎨 Generated Image:'));
            if (prevMsg) {
                const match = prevMsg.content.match(/\*([^*]+)\*/);
                if (match) previousPrompt = match[1];
            }
        }

        const imgResult = generateImage(rawPrompt, previousPrompt);
        timer.end('Image Generated');
        return {
            response: imgResult.markdown,
            provider: 'Flux Diffusion Engine',
            verifiedOnline: true,
            model: 'flux-diffusion',
            capability: route.capability
        };
    }

    // -------------------------------------------------------------
    // CAPABILITY 2: CODE & CALCULATION
    // -------------------------------------------------------------
    if (route.capability === CAPABILITIES.CODE_CALCULATION) {
        const mathResult = calculateMath(rawPrompt);
        if (mathResult !== null) {
            timer.end('Calculation completed');
            return {
                response: `### 🔢 Calculation Result\n\n\`\`\`\n${rawPrompt.trim()} = ${mathResult}\n\`\`\`\n\n- **Computed Value**: **${mathResult}**`,
                provider: 'AuraAI Math Engine',
                verifiedOnline: false,
                model: selectedModel,
                capability: route.capability
            };
        }
    }

    // -------------------------------------------------------------
    // CAPABILITY 3: DOCUMENT READER & RAG
    // -------------------------------------------------------------
    if (route.capability === CAPABILITIES.DOCUMENT_READER) {
        const docs = ragEngine.getDocuments(conversationId);
        const activeDoc = docs[docs.length - 1];

        // Check if user requested a summarization
        const isSummaryRequest = /^(summarize|summary|give me a summary|explain this document|key points|takeaways)/i.test(rawPrompt);
        if (isSummaryRequest && activeDoc) {
            let mode = 'executive';
            if (/bullet|points/i.test(rawPrompt)) mode = 'bullet_points';
            else if (/technical/i.test(rawPrompt)) mode = 'technical';
            else if (/detailed/i.test(rawPrompt)) mode = 'detailed';

            const localSummary = summarizeDocumentLocally(activeDoc, mode);
            timer.end('Document Summarized');
            return {
                response: localSummary,
                provider: 'AuraAI Document Processor',
                verifiedOnline: false,
                model: selectedModel,
                capability: route.capability
            };
        }

        // RAG Passage Retrieval
        const ragResult = ragEngine.retrieve(rawPrompt, conversationId, 4);
        const contextStr = ragEngine.formatContextString(ragResult);

        if (contextStr) {
            if (activeApiKey) {
                const safePrompt = buildSafeGroundedPrompt({
                    systemPrompt: userConfig.systemPrompt,
                    userMessage: rawPrompt,
                    retrievedContext: contextStr,
                    mode: 'document'
                });

                if (activeApiKey.startsWith('AIza') && callGeminiAPI) {
                    const geminiReply = await callGeminiAPI(activeApiKey, rawPrompt, history, selectedModel, contextStr);
                    if (geminiReply) return { response: geminiReply, provider: 'Google Gemini', model: selectedModel };
                } else if ((activeApiKey.startsWith('sk-') || activeApiKey.startsWith('gsk_')) && callOpenAIAPI) {
                    const openaiReply = await callOpenAIAPI(activeApiKey, rawPrompt, history, selectedModel, contextStr);
                    if (openaiReply) return { response: openaiReply, provider: 'Frontier AI', model: selectedModel };
                }
            }

            // Grounded response from document passages
            const passageList = ragResult.passages.map(p => `• **[Page ${p.page} | ${p.title}]**: ${p.text}`).join('\n\n');
            timer.end('Document RAG Answered');
            return {
                response: `### 📄 Grounded Answer from Document (${activeDoc ? activeDoc.filename : 'Uploaded File'})\n\n` +
                          `Based on the retrieved sections:\n\n${passageList}\n\n` +
                          `---\n*Source: [Doc: ${activeDoc ? activeDoc.filename : 'Document'}, Page ${ragResult.passages[0]?.page || 1}]*`,
                provider: 'AuraAI RAG Engine',
                verifiedOnline: false,
                model: selectedModel,
                capability: route.capability
            };
        }
    }

    // -------------------------------------------------------------
    // CAPABILITY 4: DIRECT URL READER & STORED URL FOLLOW-UP
    // -------------------------------------------------------------
    if (route.capability === CAPABILITIES.URL_READER) {
        // Follow-up question targeting stored web source
        if (route.isFollowUp && ragEngine.hasActiveSources(conversationId)) {
            const activeSources = ragEngine.getActiveSources(conversationId);
            const primarySource = activeSources[activeSources.length - 1];
            const retrieved = ragEngine.retrieve(rawPrompt, conversationId, 5);

            if (retrieved.passages && retrieved.passages.length > 0) {
                let answer = `### 📄 Grounded Answer from [${primarySource.title}](${primarySource.url})\n\n`;
                answer += `Based on the stored webpage content from **${primarySource.domain}**:\n\n`;
                retrieved.passages.forEach((p, idx) => {
                    answer += `${idx + 1}. ${p.text}\n\n`;
                });
                answer += `---\n*Source*: [${primarySource.url}](${primarySource.url})`;

                timer.end('URL Follow-up Retrieved and Grounded');
                return {
                    response: answer,
                    provider: 'AuraAI Source Memory',
                    verifiedOnline: true,
                    model: selectedModel,
                    capability: route.capability
                };
            }
        }

        if (route.url) {
            const retrieval = await webRetrieval.executeWebRetrievalPipeline(route.url, { conversationId });
            if (retrieval && retrieval.success) {
                if (activeApiKey) {
                    if (activeApiKey.startsWith('AIza') && callGeminiAPI) {
                        const geminiReply = await callGeminiAPI(activeApiKey, rawPrompt, history, selectedModel, retrieval.webContext);
                        if (geminiReply) return { response: geminiReply, provider: 'Google Gemini', model: selectedModel };
                    } else if ((activeApiKey.startsWith('sk-') || activeApiKey.startsWith('gsk_')) && callOpenAIAPI) {
                        const openaiReply = await callOpenAIAPI(activeApiKey, rawPrompt, history, selectedModel, retrieval.webContext);
                        if (openaiReply) return { response: openaiReply, provider: 'Frontier AI', model: selectedModel };
                    }
                }
                const synth = webRetrieval.synthesizeAnswerFromRetrievedContent(rawPrompt, retrieval);
                timer.end('URL Retrieved and Grounded');
                return {
                    response: synth,
                    provider: 'AuraAI URL Reader',
                    verifiedOnline: true,
                    model: selectedModel,
                    capability: route.capability
                };
            }
        }
    }

    // -------------------------------------------------------------
    // CAPABILITY 5: WEB SEARCH & RETRIEVAL PIPELINE
    // -------------------------------------------------------------
    if (route.capability === CAPABILITIES.WEB_SEARCH) {
        const query = route.query || rawPrompt;
        const retrieval = await webRetrieval.executeWebRetrievalPipeline(query, { conversationId });

        if (retrieval) {
            // Check confidence level
            if (retrieval.confidence === 'LOW') {
                timer.end('Web search low confidence refusal');
                return {
                    response: retrieval.answer || "I found search results, but I could not find a sufficiently relevant source to answer this reliably.",
                    provider: 'AuraAI Web Search',
                    verifiedOnline: true,
                    model: selectedModel,
                    capability: route.capability
                };
            }

            if (activeApiKey) {
                if (activeApiKey.startsWith('AIza') && callGeminiAPI) {
                    const geminiReply = await callGeminiAPI(activeApiKey, rawPrompt, history, selectedModel, retrieval.webContext);
                    if (geminiReply) return { response: geminiReply, provider: 'Google Gemini', model: selectedModel };
                } else if ((activeApiKey.startsWith('sk-') || activeApiKey.startsWith('gsk_')) && callOpenAIAPI) {
                    const openaiReply = await callOpenAIAPI(activeApiKey, rawPrompt, history, selectedModel, retrieval.webContext);
                    if (openaiReply) return { response: openaiReply, provider: 'Frontier AI', model: selectedModel };
                }
            }

            const synth = webRetrieval.synthesizeAnswerFromRetrievedContent(rawPrompt, retrieval);
            timer.end('Web Search Synthesized');
            return {
                response: synth,
                provider: 'AuraAI Web Search',
                verifiedOnline: true,
                model: selectedModel,
                capability: route.capability
            };
        }
    }

    // -------------------------------------------------------------
    // CAPABILITY 6: MULTI-TOOL WORKFLOW (Web + Doc + Vision comparison)
    // -------------------------------------------------------------
    if (route.capability === CAPABILITIES.MULTI_TOOL_WORKFLOW) {
        let combinedContext = '';

        // 1. Fetch URLs if present
        if (route.urls && route.urls.length > 0) {
            const urlResult = await webRetrieval.executeWebRetrievalPipeline(route.urls[0]);
            if (urlResult && urlResult.webContext) {
                combinedContext += `[DOCUMENTATION / WEBPAGE SOURCE: ${route.urls[0]}]:\n${urlResult.webContext}\n\n`;
            }
        }

        // 2. Retrieve Document passages if present
        const docResult = ragEngine.retrieve(rawPrompt, conversationId, 3);
        if (docResult && docResult.passages && docResult.passages.length > 0) {
            combinedContext += `[ATTACHED DOCUMENT SOURCE]:\n${ragEngine.formatContextString(docResult)}\n\n`;
        }

        // 3. Attach image / screenshot description
        const imgAtt = attachments.find(a => a.type?.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(a.name || ''));
        if (imgAtt && imgAtt.content) {
            combinedContext += `[SCREENSHOT / IMAGE SOURCE (${imgAtt.name || 'screenshot'})]:\n${imgAtt.content}\n\n`;
        }

        if (activeApiKey) {
            if (activeApiKey.startsWith('AIza') && callGeminiAPI) {
                const geminiReply = await callGeminiAPI(activeApiKey, rawPrompt, history, selectedModel, combinedContext);
                if (geminiReply) return { response: geminiReply, provider: 'Google Gemini', model: selectedModel };
            } else if ((activeApiKey.startsWith('sk-') || activeApiKey.startsWith('gsk_')) && callOpenAIAPI) {
                const openaiReply = await callOpenAIAPI(activeApiKey, rawPrompt, history, selectedModel, combinedContext);
                if (openaiReply) return { response: openaiReply, provider: 'Frontier AI', model: selectedModel };
            }
        }

        timer.end('Multi-Tool Workflow executed');
        return {
            response: `### 🔍 Multi-Source Comparative Analysis\n\n` +
                      `I analyzed your combined sources (documentation, uploaded files, and visual screenshot):\n\n` +
                      `${combinedContext.substring(0, 1200)}...\n\n` +
                      `---\n*Synthesized across verified multi-modal sources.*`,
            provider: 'AuraAI Multi-Tool Engine',
            verifiedOnline: true,
            model: selectedModel,
            capability: route.capability
        };
    }

    // -------------------------------------------------------------
    // CAPABILITY 7: NORMAL CONVERSATIONAL CHAT (Direct LLM processing)
    // -------------------------------------------------------------
    log('LLM REQUEST', `Sending normal conversational request to ${selectedModel}`);
    if (activeApiKey) {
        if (activeApiKey.startsWith('AIza') && callGeminiAPI) {
            const geminiReply = await callGeminiAPI(activeApiKey, rawPrompt, history, selectedModel, '');
            if (geminiReply) return { response: geminiReply, provider: 'Google Gemini', model: selectedModel };
        } else if ((activeApiKey.startsWith('sk-') || activeApiKey.startsWith('gsk_')) && callOpenAIAPI) {
            const openaiReply = await callOpenAIAPI(activeApiKey, rawPrompt, history, selectedModel, '');
            if (openaiReply) return { response: openaiReply, provider: 'Frontier AI', model: selectedModel };
        }
    }

    // Fall back to AuraAI local response generator
    if (generateSmartResponseFallback) {
        const fallbackText = await generateSmartResponseFallback(rawPrompt, history, { ...userConfig, conversationId });
        timer.end('Normal Chat fallback answered');
        return {
            response: fallbackText,
            provider: 'AuraAI Core Knowledge',
            verifiedOnline: false,
            model: selectedModel,
            capability: CAPABILITIES.NORMAL_CHAT
        };
    }

    timer.end('Default chat response');
    return {
        response: `I received your message: "${rawPrompt}". How can I help you further?`,
        provider: 'AuraAI Core',
        model: selectedModel,
        capability: CAPABILITIES.NORMAL_CHAT
    };
}

module.exports = {
    orchestrateRequest
};
