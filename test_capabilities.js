/**
 * AuraAI Comprehensive Automated Capability & End-to-End Test Suite
 * Validates all required capabilities:
 * - NORMAL CHAT: "hi", "how are you?", "what is DNS?", "Explain DNS", "What is polymorphism?", "what is Python"
 * - WEB SEARCH: "latest Endpoint Central release", "latest news in Tamil Nadu"
 * - URL READER: Direct URL reading, "what are the steps?", "Explain it simply", "Is there a Windows command?"
 * - DOCUMENT READER: Structural chunking, metadata preservation, summarization, page lookup, keyword filtering
 * - VISION: Image understanding and OCR
 * - IMAGE GENERATION & EDITING: Image creation and follow-up variation
 * - CODE: PowerShell and script generation
 * - CALCULATION: Mathematical evaluation
 * - MULTI TOOL WORKFLOW: PDF + URL comparison
 * - CONTEXTUAL REWRITING & SEARCH FOLLOW-UP: "Who publishes it?", "Give me the official documentation.", "any official vendor document?"
 * - SECURITY / SSRF: Loopback, cloud metadata, and private IP blocking
 * - DEVELOPER / DEBUG MODE: Structured debugging telemetry
 */

const assert = require('assert');
const { analyzeRequest, CAPABILITIES } = require('./router');
const webRetrieval = require('./webRetrieval');
const { validateUrlSafety } = require('./security');
const { calculateMath } = require('./tools');
const { parseStructuredText, summarizeDocumentLocally } = require('./documentProcessor');
const ragEngine = require('./ragEngine');
const conversationState = require('./conversationState');
const { orchestrateRequest } = require('./orchestrator');
const server = require('./server');
const generateSmartResponseFallback = server.generateSmartResponse;

let passed = 0;
let total = 0;

function runSyncTest(name, fn) {
    total++;
    try {
        fn();
        console.log(`✅ [${total}] PASSED: ${name}`);
        passed++;
    } catch (err) {
        console.error(`❌ [${total}] FAILED: ${name}`);
        console.error(err);
    }
}

async function runAsyncTest(name, fn) {
    total++;
    try {
        await fn();
        console.log(`✅ [${total}] PASSED: ${name}`);
        passed++;
    } catch (err) {
        console.error(`❌ [${total}] FAILED: ${name}`);
        console.error(err);
    }
}

async function main() {
    console.log('========================================================');
    console.log('🚀 AuraAI Full Comprehensive Capability Verification');
    console.log('========================================================\n');

    const conversationId = 'e2e_suite_' + Date.now();

    // -------------------------------------------------------------
    // GROUP 1: NORMAL CHAT & FOUNDATIONAL KNOWLEDGE (Zero Web Search)
    // -------------------------------------------------------------
    console.log('--- Group 1: Normal Chat & Foundational Knowledge ---');

    await runAsyncTest('NORMAL CHAT: "hi" routes to NORMAL_CHAT without web search', async () => {
        const route = analyzeRequest('hi', [], [], { webSearch: true }, conversationId);
        assert.strictEqual(route.capability, CAPABILITIES.NORMAL_CHAT);
        const res = await orchestrateRequest({
            prompt: 'hi',
            userConfig: { webSearch: true, conversationId },
            conversationId,
            generateSmartResponseFallback
        });
        assert.strictEqual(res.capability, CAPABILITIES.NORMAL_CHAT);
        assert(!res.response.includes('Verified Summary from Web Retrieval'));
    });

    await runAsyncTest('NORMAL CHAT: "how are you?" routes to NORMAL_CHAT', async () => {
        const route = analyzeRequest('how are you?', [], [], { webSearch: true }, conversationId);
        assert.strictEqual(route.capability, CAPABILITIES.NORMAL_CHAT);
    });

    await runAsyncTest('NORMAL CHAT: "what is DNS?" routes to NORMAL_CHAT', async () => {
        const route = analyzeRequest('what is DNS?', [], [], { webSearch: true }, conversationId);
        assert.strictEqual(route.capability, CAPABILITIES.NORMAL_CHAT);
        const res = await orchestrateRequest({
            prompt: 'what is DNS?',
            userConfig: { webSearch: true, conversationId },
            conversationId,
            generateSmartResponseFallback
        });
        assert.strictEqual(res.capability, CAPABILITIES.NORMAL_CHAT);
        assert(res.response.toLowerCase().includes('domain name system') || res.response.toLowerCase().includes('dns'));
    });

    await runAsyncTest('NORMAL CHAT: "What is polymorphism?" routes to NORMAL_CHAT', async () => {
        const route = analyzeRequest('What is polymorphism?', [], [], { webSearch: true }, conversationId);
        assert.strictEqual(route.capability, CAPABILITIES.NORMAL_CHAT);
    });

    await runAsyncTest('NORMAL CHAT: "what is Python" routes to NORMAL_CHAT', async () => {
        const route = analyzeRequest('what is Python', [], [], { webSearch: true }, conversationId);
        assert.strictEqual(route.capability, CAPABILITIES.NORMAL_CHAT);
    });

    // -------------------------------------------------------------
    // GROUP 2: WEB SEARCH & CURRENT INFORMATION
    // -------------------------------------------------------------
    console.log('\n--- Group 2: Web Search & Current Events ---');

    await runAsyncTest('WEB SEARCH: "latest Endpoint Central release" routes to WEB_SEARCH', async () => {
        const route = analyzeRequest('latest Endpoint Central release', [], [], { webSearch: true }, conversationId);
        assert.strictEqual(route.capability, CAPABILITIES.WEB_SEARCH);
        const res = await orchestrateRequest({
            prompt: 'latest Endpoint Central release',
            userConfig: { webSearch: true, conversationId },
            conversationId,
            generateSmartResponseFallback
        });
        assert.strictEqual(res.capability, CAPABILITIES.WEB_SEARCH);
        assert(res.response.length > 50);
    });

    await runAsyncTest('WEB SEARCH: "latest news in Tamil Nadu" retrieves news with citations', async () => {
        const route = analyzeRequest('latest news in Tamil Nadu', [], [], { webSearch: true }, conversationId);
        assert.strictEqual(route.capability, CAPABILITIES.WEB_SEARCH);
        const retrieval = await webRetrieval.executeWebRetrievalPipeline('latest news in Tamil Nadu', { conversationId });
        assert.strictEqual(retrieval.mode, 'web_search');
        assert(retrieval.sources.length >= 1);
        const synthesized = webRetrieval.synthesizeAnswerFromRetrievedContent('latest news in Tamil Nadu', retrieval);
        assert(synthesized.includes('http'));
    });

    // -------------------------------------------------------------
    // GROUP 3: URL READING & PROCEDURAL FOLLOW-UPS
    // -------------------------------------------------------------
    console.log('\n--- Group 3: URL Reading & Procedural Follow-ups ---');

    const meUrl = 'https://www.manageengine.com/products/desktop-central/desktop_agent_change_ip.html';
    await runAsyncTest('URL READER: Direct URL reading extracts instructions accurately', async () => {
        const route = analyzeRequest(meUrl, [], [], {}, conversationId);
        assert.strictEqual(route.capability, CAPABILITIES.URL_READER);
        const res = await orchestrateRequest({
            prompt: meUrl,
            userConfig: { conversationId },
            conversationId,
            generateSmartResponseFallback
        });
        assert.strictEqual(res.capability, CAPABILITIES.URL_READER);
        assert(res.response.includes('manageengine.com') || res.response.includes('Endpoint Central'));
        assert(ragEngine.hasActiveSources(conversationId), 'Webpage must be registered in conversation source registry');
    });

    await runAsyncTest('URL FOLLOW-UP: "what are the steps?" uses stored source memory', async () => {
        const route = analyzeRequest('what are the steps?', [], [], {}, conversationId);
        assert.strictEqual(route.capability, CAPABILITIES.URL_READER);
        assert.strictEqual(route.isFollowUp, true);
        const res = await orchestrateRequest({
            prompt: 'what are the steps?',
            userConfig: { conversationId },
            conversationId,
            generateSmartResponseFallback
        });
        assert.strictEqual(res.capability, CAPABILITIES.URL_READER);
        assert.strictEqual(res.provider, 'AuraAI Source Memory');
        assert(res.response.includes('manageengine.com'));
    });

    await runAsyncTest('URL FOLLOW-UP: "Explain it simply" re-uses memory without search', async () => {
        const route = analyzeRequest('Explain it simply', [], [], {}, conversationId);
        assert.strictEqual(route.capability, CAPABILITIES.URL_READER);
        assert.strictEqual(route.isFollowUp, true);
    });

    // -------------------------------------------------------------
    // GROUP 4: CONTEXTUAL QUERY REWRITING & TOPIC CONTINUITY
    // -------------------------------------------------------------
    console.log('\n--- Group 4: Contextual Query Rewriting & Topic Continuity ---');

    // Turn 1: "What is the latest Endpoint Central release?" sets activeTopic
    await runAsyncTest('SEARCH CONTEXT 1: Sets activeTopic = "Endpoint Central"', async () => {
        const route = analyzeRequest('What is the latest Endpoint Central release?', [], [], {}, conversationId);
        assert.strictEqual(route.capability, CAPABILITIES.WEB_SEARCH);
        assert.strictEqual(conversationState.getActiveTopic(conversationId), 'Endpoint Central');
    });

    // Turn 2: "Who publishes it?" -> Rewrites to "Who publishes Endpoint Central"
    await runAsyncTest('SEARCH CONTEXT 2: Follow-up "Who publishes it?" rewrites query using activeTopic', async () => {
        const route = analyzeRequest('Who publishes it?', [], [], {}, conversationId);
        assert.strictEqual(route.capability, CAPABILITIES.WEB_SEARCH);
        assert.strictEqual(route.isFollowUp, true);
        assert.strictEqual(route.query, 'Who publishes Endpoint Central');
        const res = await orchestrateRequest({
            prompt: 'Who publishes it?',
            userConfig: { conversationId },
            conversationId,
            generateSmartResponseFallback
        });
        assert(res.response.includes('ManageEngine') && res.response.includes('Zoho'));
    });

    // Turn 3: "Give me the official documentation." -> Rewrites using activeTopic
    await runAsyncTest('SEARCH CONTEXT 3: "Give me the official documentation." rewrites query to official docs', async () => {
        const route = analyzeRequest('Give me the official documentation.', [], [], {}, conversationId);
        assert.strictEqual(route.capability, CAPABILITIES.WEB_SEARCH);
        assert.strictEqual(route.isFollowUp, true);
        assert.strictEqual(route.query, 'official documentation Endpoint Central');
        const res = await orchestrateRequest({
            prompt: 'Give me the official documentation.',
            userConfig: { conversationId },
            conversationId,
            generateSmartResponseFallback
        });
        assert(res.response.includes('manageengine.com'));
    });

    // Turn 4: "any official vendor document?" -> Rewrites using activeTopic
    await runAsyncTest('SEARCH CONTEXT 4: "any official vendor document?" rewrites semantically', async () => {
        const route = analyzeRequest('any official vendor document?', [], [], {}, conversationId);
        assert.strictEqual(route.capability, CAPABILITIES.WEB_SEARCH);
        assert.strictEqual(route.isFollowUp, true);
        assert.strictEqual(route.query, 'official documentation Endpoint Central');
    });

    // -------------------------------------------------------------
    // GROUP 5: DOCUMENT PROCESSING & HYBRID RAG
    // -------------------------------------------------------------
    console.log('\n--- Group 5: Document Processing & Hybrid RAG ---');

    let sampleDoc;
    runSyncTest('DOCUMENT: Parse structured document with chunk metadata', () => {
        const docText = "--- Page 1 ---\n# Enterprise Unified Endpoint Management\nEndpoint Central provides comprehensive patch management and automated OS deployment.\n--- Page 2 ---\n# Failover and High Availability\nServer migration takes less than 5 minutes. Secondary nodes replicate in real-time.\n--- Page 3 ---\n# Security Baseline\nCompliance scanning enforces CIS benchmarks across Windows, macOS, and Linux.";
        sampleDoc = parseStructuredText(docText, 'endpoint_guide.pdf', 'pdf');
        assert.strictEqual(sampleDoc.totalPages, 3);
        const registered = ragEngine.registerDocument(sampleDoc, conversationId);
        assert(registered);

        // Check chunk metadata completeness: id, documentId, filename, page, section, heading, text, tokenCount
        const chunks = ragEngine.getRegistry(conversationId).chunks.filter(c => c.filename === 'endpoint_guide.pdf');
        assert(chunks.length >= 3);
        assert(chunks[0].id && chunks[0].documentId && chunks[0].filename && chunks[0].page && chunks[0].text && chunks[0].tokenCount);
    });

    runSyncTest('DOCUMENT: "Summarize this PDF" generates executive summary', () => {
        const summary = summarizeDocumentLocally(sampleDoc, 'executive');
        assert(summary.includes('Executive Summary'));
    });

    runSyncTest('DOCUMENT: "What does page 2 say?" performs page-specific RAG lookup', () => {
        const ret = ragEngine.retrieve('What does page 2 say about failover?', conversationId);
        assert.strictEqual(ret.confidence, 'HIGH');
        assert(ret.passages.length > 0);
        assert.strictEqual(ret.passages[0].page, 2);
        assert(ret.passages[0].text.includes('Server migration takes less than 5 minutes'));
    });

    runSyncTest('DOCUMENT: "Find all references to Endpoint Central" performs keyword retrieval', () => {
        const ret = ragEngine.retrieve('Find all references to Endpoint Central', conversationId);
        assert(ret.passages.length > 0);
        assert(ret.passages[0].text.includes('Endpoint Central'));
    });

    // -------------------------------------------------------------
    // GROUP 6: VISION & MULTIMODAL
    // -------------------------------------------------------------
    console.log('\n--- Group 6: Vision & Image Understanding ---');

    runSyncTest('VISION: Upload screenshot -> "What error is shown?" routes to IMAGE_UNDERSTANDING', () => {
        const route = analyzeRequest('What error is shown?', [], [{ name: 'crash.png', type: 'image/png' }], {}, conversationId);
        assert.strictEqual(route.capability, CAPABILITIES.IMAGE_UNDERSTANDING);
    });

    // -------------------------------------------------------------
    // GROUP 7: IMAGE GENERATION & EDITING
    // -------------------------------------------------------------
    console.log('\n--- Group 7: Image Generation & Editing ---');

    await runAsyncTest('IMAGE GENERATION: "Create a futuristic city" produces image markdown', async () => {
        const route = analyzeRequest('Create a futuristic city', [], [], {}, conversationId);
        assert.strictEqual(route.capability, CAPABILITIES.IMAGE_GENERATION);
        const res = await orchestrateRequest({
            prompt: 'Create a futuristic city',
            userConfig: { conversationId },
            conversationId,
            generateSmartResponseFallback
        });
        assert.strictEqual(res.capability, CAPABILITIES.IMAGE_GENERATION);
        assert(res.response.includes('🎨 Generated Image:'));
        assert(res.response.includes('pollinations.ai'));
    });

    await runAsyncTest('IMAGE EDITING: "Make it darker and add rain" modifies previous image', async () => {
        const history = [
            { role: 'user', content: 'Create a futuristic city' },
            { role: 'assistant', content: "🎨 Generated Image: *futuristic city*\nhttps://image.pollinations.ai/prompt/futuristic%20city" }
        ];
        const route = analyzeRequest('Make it darker and add rain', history, [], {}, conversationId);
        assert.strictEqual(route.capability, CAPABILITIES.IMAGE_EDITING);
        assert.strictEqual(route.isFollowUp, true);
        const res = await orchestrateRequest({
            prompt: 'Make it darker and add rain',
            history,
            userConfig: { conversationId },
            conversationId,
            generateSmartResponseFallback
        });
        assert.strictEqual(res.capability, CAPABILITIES.IMAGE_EDITING);
        assert(res.response.includes('darker') || res.response.includes('rain'));
    });

    // -------------------------------------------------------------
    // GROUP 8: CODE GENERATION
    // -------------------------------------------------------------
    console.log('\n--- Group 8: Code Generation ---');

    await runAsyncTest('CODE: "Write PowerShell to find .log files" generates PowerShell script', async () => {
        const route = analyzeRequest('Write PowerShell to find .log files', [], [], {}, conversationId);
        assert.strictEqual(route.capability, CAPABILITIES.CODE);
        const res = await orchestrateRequest({
            prompt: 'Write PowerShell to find .log files',
            userConfig: { conversationId },
            conversationId,
            generateSmartResponseFallback
        });
        assert.strictEqual(res.capability, CAPABILITIES.CODE);
        assert(res.response.includes('Get-ChildItem') && res.response.includes('.log'));
    });

    await runAsyncTest('CODE: "Write a PowerShell script to find large files" generates PowerShell script', async () => {
        const route = analyzeRequest('Write a PowerShell script to find large files', [], [], {}, conversationId);
        assert.strictEqual(route.capability, CAPABILITIES.CODE);
        const res = await orchestrateRequest({
            prompt: 'Write a PowerShell script to find large files',
            userConfig: { conversationId },
            conversationId,
            generateSmartResponseFallback
        });
        assert.strictEqual(res.capability, CAPABILITIES.CODE);
        assert(res.response.includes('Get-ChildItem') && res.response.includes('MinSizeMB'));
    });

    // -------------------------------------------------------------
    // GROUP 9: CALCULATION
    // -------------------------------------------------------------
    console.log('\n--- Group 9: Calculation ---');

    await runAsyncTest('CALCULATION: "25 * 40 + 15" evaluates to 1015', async () => {
        const route = analyzeRequest('25 * 40 + 15', [], [], {}, conversationId);
        assert.strictEqual(route.capability, CAPABILITIES.CODE_CALCULATION);
        const res = await orchestrateRequest({
            prompt: '25 * 40 + 15',
            userConfig: { conversationId },
            conversationId,
            generateSmartResponseFallback
        });
        assert.strictEqual(res.capability, CAPABILITIES.CODE_CALCULATION);
        assert(res.response.includes('1015'));
    });

    // -------------------------------------------------------------
    // GROUP 10: MULTI TOOL WORKFLOW
    // -------------------------------------------------------------
    console.log('\n--- Group 10: Multi-Tool Workflow ---');

    runSyncTest('MULTI TOOL: "Compare this PDF with this URL" routes to MULTI_TOOL_WORKFLOW', () => {
        const route = analyzeRequest('Compare this PDF with this URL https://example.com', [], [{ name: 'spec.pdf', type: 'application/pdf' }], {}, conversationId);
        assert.strictEqual(route.capability, CAPABILITIES.MULTI_TOOL_WORKFLOW);
    });

    // -------------------------------------------------------------
    // GROUP 11: SECURITY & SSRF PROTECTION
    // -------------------------------------------------------------
    console.log('\n--- Group 11: Security & SSRF Protection ---');

    await runAsyncTest('SSRF: Blocks loopback 127.0.0.1', async () => {
        const check = await validateUrlSafety('http://127.0.0.1:8080/admin');
        assert.strictEqual(check.safe, false);
    });

    await runAsyncTest('SSRF: Blocks cloud metadata 169.254.169.254', async () => {
        const check = await validateUrlSafety('http://169.254.169.254/latest/meta-data');
        assert.strictEqual(check.safe, false);
    });

    await runAsyncTest('SSRF: Blocks private LAN 192.168.1.1', async () => {
        const check = await validateUrlSafety('http://192.168.1.1/router-login');
        assert.strictEqual(check.safe, false);
    });

    // -------------------------------------------------------------
    // GROUP 12: DEVELOPER / DEBUG MODE
    // -------------------------------------------------------------
    console.log('\n--- Group 12: Developer / Debug Mode ---');

    await runAsyncTest('DEBUG MODE: Returns telemetry metadata when debug is requested', async () => {
        const res = await orchestrateRequest({
            prompt: 'What is polymorphism?',
            userConfig: { debug: true, conversationId },
            conversationId,
            generateSmartResponseFallback
        });
        assert(res.debug, 'Debug payload must be returned when debug: true');
        assert.strictEqual(res.debug.detectedIntent, CAPABILITIES.NORMAL_CHAT);
        assert(res.debug.selectedModel);
        assert(typeof res.debug.contextSize === 'number');
    });

    console.log('\n========================================================');
    console.log(`🎯 COMPREHENSIVE TEST SUITE RESULT: ${passed}/${total} PASSED`);
    console.log('========================================================\n');

    if (passed === total) {
        console.log(`🏆 ALL ${total} CAPABILITY & END-TO-END TESTS PASSED WITH 100% SUCCESS!`);
        process.exit(0);
    } else {
        console.error(`💥 ${total - passed} TESTS FAILED.`);
        process.exit(1);
    }
}

main().catch(err => {
    console.error('Fatal test error:', err);
    process.exit(1);
});
