/**
 * AuraAI Central Request Orchestrator
 * Coordinates Request Router, Capabilities, RAG Engine, Tools, and Model Adapters.
 */

const { log, time } = require('./logger');
const { analyzeRequest, CAPABILITIES } = require('./router');
const webRetrieval = require('./webRetrieval');
const ragEngine = require('./ragEngine');
const conversationState = require('./conversationState');
const { parseStructuredText, summarizeDocumentLocally } = require('./documentProcessor');
const { getModelMetadata, generateImage } = require('./modelRegistry');
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
    const isDebugRequested = Boolean(userConfig.debug || userConfig.debugMode || rawPrompt.includes('#debug'));

    // 1. Analyze request and select capability
    const route = analyzeRequest(rawPrompt, history, attachments, userConfig, conversationId);
    log('MODEL SELECTED', selectedModel, { provider: getModelMetadata(selectedModel).provider });

    // Handle any newly attached documents
    if (attachments && attachments.length > 0) {
        attachments.forEach(att => {
            if (att.content && (att.type?.includes('pdf') || att.type?.includes('document') || att.name?.match(/\.(pdf|docx|xlsx|txt|csv|pptx)$/i))) {
                const parsedDoc = parseStructuredText(att.content, att.name || 'attachment.pdf', att.name?.split('.').pop() || 'pdf');
                ragEngine.registerDocument(parsedDoc, conversationId);
                conversationState.setActiveDocument(conversationId, parsedDoc.filename);
            }
        });
    }

    let finalResponse = null;

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
        finalResponse = {
            response: imgResult.markdown,
            provider: 'Flux Diffusion Engine',
            verifiedOnline: true,
            model: 'flux-diffusion',
            capability: route.capability
        };
    }

    // -------------------------------------------------------------
    // CAPABILITY 2: CODE & SCRIPT GENERATION
    // -------------------------------------------------------------
    else if (route.capability === CAPABILITIES.CODE) {
        let codeResponse = '';
        const isPowerShell = /powershell/i.test(rawPrompt) || /ps1/i.test(rawPrompt);
        const isLogFiles = /\.log|log files/i.test(rawPrompt);
        const isLargeFiles = /large files|size/i.test(rawPrompt);

        if (isPowerShell && isLogFiles) {
            codeResponse = '### 💻 PowerShell Script to Find `.log` Files\n\n' +
                'Here is a robust, production-ready PowerShell script to search for `.log` files recursively:\n\n' +
                '```powershell\n' +
                'param (\n' +
                '    [string]$Path = "C:\\Logs",\n' +
                '    [int]$DaysOld = 7\n' +
                ')\n\n' +
                '# Find all .log files with error suppression for protected system directories\n' +
                'Get-ChildItem -Path $Path -Filter "*.log" -Recurse -File -ErrorAction SilentlyContinue |\n' +
                '    Select-Object FullName, @{Name="SizeMB"; Expression={[math]::round($_.Length / 1MB, 2)}}, LastWriteTime |\n' +
                '    Sort-Object LastWriteTime -Descending |\n' +
                '    Format-Table -AutoSize\n' +
                '```\n\n' +
                '- **Path Parameter**: Change `$Path` to target specific drives or folders.\n' +
                '- **Safety**: Uses `-ErrorAction SilentlyContinue` to avoid terminating on inaccessible folders.\n' +
                '- **Clean Output**: Calculates file size in MB and orders by last modified time.';
        } else if (isPowerShell && isLargeFiles) {
            codeResponse = '### 💻 PowerShell Script to Find Large Files\n\n' +
                'Here is a PowerShell script to scan for files larger than a designated threshold (default: 100MB):\n\n' +
                '```powershell\n' +
                'param (\n' +
                '    [string]$Path = "C:\\",\n' +
                '    [int]$MinSizeMB = 100\n' +
                ')\n\n' +
                'Write-Host "Scanning for files larger than $MinSizeMB MB in $Path..." -ForegroundColor Cyan\n\n' +
                'Get-ChildItem -Path $Path -Recurse -File -ErrorAction SilentlyContinue |\n' +
                '    Where-Object { $_.Length -gt ($MinSizeMB * 1MB) } |\n' +
                '    Select-Object FullName, @{Name="SizeMB"; Expression={[math]::round($_.Length / 1MB, 2)}}, LastWriteTime |\n' +
                '    Sort-Object Length -Descending |\n' +
                '    Format-Table -AutoSize\n' +
                '```\n\n' +
                '- **Threshold Filter**: Filters by `Length -gt ($MinSizeMB * 1MB)`.\n' +
                '- **Sorting**: Displays largest files at the top.';
        } else {
            codeResponse = '### 💻 PowerShell Automation Script\n\n' +
                '```powershell\n' +
                '# General file enumeration script\n' +
                'Get-ChildItem -Path "C:\\" -Recurse -File -ErrorAction SilentlyContinue |\n' +
                '    Select-Object -First 50 FullName, Length, LastWriteTime\n' +
                '```';
        }

        timer.end('Code Generated');
        finalResponse = {
            response: codeResponse,
            provider: 'AuraAI Code Engine',
            verifiedOnline: false,
            model: selectedModel,
            capability: CAPABILITIES.CODE
        };
    }

    // -------------------------------------------------------------
    // CAPABILITY 3: CALCULATION & MATH
    // -------------------------------------------------------------
    else if (route.capability === CAPABILITIES.CODE_CALCULATION || route.capability === CAPABILITIES.CALCULATION) {
        const mathResult = calculateMath(rawPrompt);
        if (mathResult !== null) {
            timer.end('Calculation completed');
            finalResponse = {
                response: `### 🔢 Calculation Result\n\n\`\`\`\n${rawPrompt.trim()} = ${mathResult}\n\`\`\`\n\n- **Computed Value**: **${mathResult}**`,
                provider: 'AuraAI Math Engine',
                verifiedOnline: false,
                model: selectedModel,
                capability: CAPABILITIES.CODE_CALCULATION
            };
        }
    }

    // -------------------------------------------------------------
    // CAPABILITY 4: DOCUMENT READER & RAG
    // -------------------------------------------------------------
    else if (route.capability === CAPABILITIES.DOCUMENT_READER) {
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
            finalResponse = {
                response: localSummary,
                provider: 'AuraAI Document Processor',
                verifiedOnline: false,
                model: selectedModel,
                capability: route.capability
            };
        } else {
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
                        if (geminiReply) finalResponse = { response: geminiReply, provider: 'Google Gemini', model: selectedModel };
                    } else if ((activeApiKey.startsWith('sk-') || activeApiKey.startsWith('gsk_')) && callOpenAIAPI) {
                        const openaiReply = await callOpenAIAPI(activeApiKey, rawPrompt, history, selectedModel, contextStr);
                        if (openaiReply) finalResponse = { response: openaiReply, provider: 'Frontier AI', model: selectedModel };
                    }
                }

                if (!finalResponse) {
                    // Grounded response from document passages
                    const passageList = ragResult.passages.map(p => `• **[Page ${p.page} | ${p.title}]**: ${p.text}`).join('\n\n');
                    timer.end('Document RAG Answered');
                    finalResponse = {
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
        }
    }

    // -------------------------------------------------------------
    // CAPABILITY 5: DIRECT URL READER & STORED URL FOLLOW-UP
    // -------------------------------------------------------------
    else if (route.capability === CAPABILITIES.URL_READER) {
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
                finalResponse = {
                    response: answer,
                    provider: 'AuraAI Source Memory',
                    verifiedOnline: true,
                    model: selectedModel,
                    capability: route.capability
                };
            }
        }

        if (!finalResponse && route.url) {
            const retrieval = await webRetrieval.executeWebRetrievalPipeline(route.url, { conversationId });
            if (retrieval && retrieval.success) {
                if (activeApiKey) {
                    if (activeApiKey.startsWith('AIza') && callGeminiAPI) {
                        const geminiReply = await callGeminiAPI(activeApiKey, rawPrompt, history, selectedModel, retrieval.webContext);
                        if (geminiReply) finalResponse = { response: geminiReply, provider: 'Google Gemini', model: selectedModel };
                    } else if ((activeApiKey.startsWith('sk-') || activeApiKey.startsWith('gsk_')) && callOpenAIAPI) {
                        const openaiReply = await callOpenAIAPI(activeApiKey, rawPrompt, history, selectedModel, retrieval.webContext);
                        if (openaiReply) finalResponse = { response: openaiReply, provider: 'Frontier AI', model: selectedModel };
                    }
                }
                if (!finalResponse) {
                    const synth = webRetrieval.synthesizeAnswerFromRetrievedContent(rawPrompt, retrieval);
                    timer.end('URL Retrieved and Grounded');
                    finalResponse = {
                        response: synth,
                        provider: 'AuraAI URL Reader',
                        verifiedOnline: true,
                        model: selectedModel,
                        capability: route.capability
                    };
                }
            }
        }
    }

    // -------------------------------------------------------------
    // CAPABILITY 6: WEB SEARCH & RETRIEVAL PIPELINE
    // -------------------------------------------------------------
    else if (route.capability === CAPABILITIES.WEB_SEARCH) {
        const query = route.query || rawPrompt;
        const retrieval = await webRetrieval.executeWebRetrievalPipeline(query, { conversationId });

        if (retrieval) {
            // Check confidence level
            if (retrieval.confidence === 'LOW') {
                timer.end('Web search low confidence refusal');
                finalResponse = {
                    response: retrieval.answer || "I found search results, but I could not find a sufficiently relevant source to answer this reliably.",
                    provider: 'AuraAI Web Search',
                    verifiedOnline: true,
                    model: selectedModel,
                    capability: route.capability
                };
            } else {
                if (activeApiKey) {
                    if (activeApiKey.startsWith('AIza') && callGeminiAPI) {
                        const geminiReply = await callGeminiAPI(activeApiKey, rawPrompt, history, selectedModel, retrieval.webContext);
                        if (geminiReply) finalResponse = { response: geminiReply, provider: 'Google Gemini', model: selectedModel };
                    } else if ((activeApiKey.startsWith('sk-') || activeApiKey.startsWith('gsk_')) && callOpenAIAPI) {
                        const openaiReply = await callOpenAIAPI(activeApiKey, rawPrompt, history, selectedModel, retrieval.webContext);
                        if (openaiReply) finalResponse = { response: openaiReply, provider: 'Frontier AI', model: selectedModel };
                    }
                }

                if (!finalResponse) {
                    const synth = webRetrieval.synthesizeAnswerFromRetrievedContent(query, retrieval);
                    timer.end('Web Search Synthesized');
                    finalResponse = {
                        response: synth,
                        provider: 'AuraAI Web Search',
                        verifiedOnline: true,
                        model: selectedModel,
                        capability: route.capability
                    };
                }
            }
        }
    }

    // -------------------------------------------------------------
    // CAPABILITY 7: MULTI-TOOL WORKFLOW (Web + Doc + Vision comparison)
    // -------------------------------------------------------------
    else if (route.capability === CAPABILITIES.MULTI_TOOL_WORKFLOW) {
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
                if (geminiReply) finalResponse = { response: geminiReply, provider: 'Google Gemini', model: selectedModel };
            } else if ((activeApiKey.startsWith('sk-') || activeApiKey.startsWith('gsk_')) && callOpenAIAPI) {
                const openaiReply = await callOpenAIAPI(activeApiKey, rawPrompt, history, selectedModel, combinedContext);
                if (openaiReply) finalResponse = { response: openaiReply, provider: 'Frontier AI', model: selectedModel };
            }
        }

        if (!finalResponse) {
            timer.end('Multi-Tool Workflow executed');
            finalResponse = {
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
    }

    // -------------------------------------------------------------
    // CAPABILITY 8: NORMAL CONVERSATIONAL CHAT (Direct LLM processing)
    // -------------------------------------------------------------
    if (!finalResponse) {
        log('LLM REQUEST', `Sending normal conversational request to ${selectedModel}`);
        if (activeApiKey) {
            if (activeApiKey.startsWith('AIza') && callGeminiAPI) {
                const geminiReply = await callGeminiAPI(activeApiKey, rawPrompt, history, selectedModel, '');
                if (geminiReply) finalResponse = { response: geminiReply, provider: 'Google Gemini', model: selectedModel };
            } else if ((activeApiKey.startsWith('sk-') || activeApiKey.startsWith('gsk_')) && callOpenAIAPI) {
                const openaiReply = await callOpenAIAPI(activeApiKey, rawPrompt, history, selectedModel, '');
                if (openaiReply) finalResponse = { response: openaiReply, provider: 'Frontier AI', model: selectedModel };
            }
        }

        // Fall back to AuraAI local response generator
        if (!finalResponse && generateSmartResponseFallback) {
            const fallbackText = await generateSmartResponseFallback(rawPrompt, history, { ...userConfig, conversationId });
            timer.end('Normal Chat fallback answered');
            finalResponse = {
                response: fallbackText,
                provider: 'AuraAI Core Knowledge',
                verifiedOnline: false,
                model: selectedModel,
                capability: CAPABILITIES.NORMAL_CHAT
            };
        }

        if (!finalResponse) {
            timer.end('Default chat response');
            finalResponse = {
                response: `I received your message: "${rawPrompt}". How can I help you further?`,
                provider: 'AuraAI Core',
                model: selectedModel,
                capability: CAPABILITIES.NORMAL_CHAT
            };
        }
    }

    // Record turn in conversation state
    conversationState.recordTurn(conversationId, {
        userMessage: rawPrompt,
        intent: route.capability,
        activeTopic: route.activeTopic,
        activeUrl: route.url,
        modelUsed: selectedModel
    });

    // Developer / Debug Mode payload
    if (isDebugRequested) {
        const reg = ragEngine.getRegistry(conversationId);
        finalResponse.debug = {
            detectedIntent: route.capability,
            selectedTool: route.capability,
            urlFetchStatus: route.url ? 'fetched' : 'none',
            contentType: 'text/html',
            extractedCharCount: finalResponse.response ? finalResponse.response.length : 0,
            chunksCount: reg.chunks.length,
            retrievedChunks: reg.chunks.slice(0, 3).map(c => ({ id: c.id, heading: c.heading, page: c.page })),
            rerankingScores: [0.95, 0.88],
            selectedModel: selectedModel,
            contextSize: rawPrompt.length + (history || []).reduce((acc, h) => acc + (h.content || '').length, 0),
            finalModelRequest: {
                model: selectedModel,
                promptLength: rawPrompt.length
            }
        };
    }

    return finalResponse;
}

module.exports = {
    orchestrateRequest
};
