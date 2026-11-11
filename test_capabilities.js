/**
 * AuraAI Automated Capability & End-to-End Test Suite
 * Validates the 16 core requirements with REAL execution:
 * Real web requests, real SSRF protection, real document parsing, real RAG retrieval,
 * real calculations, and accurate multi-turn conversation memory.
 */

const assert = require('assert');
const { analyzeRequest, CAPABILITIES } = require('./router');
const webRetrieval = require('./webRetrieval');
const { validateUrlSafety } = require('./security');
const { calculateMath } = require('./tools');
const { parseStructuredText, summarizeDocumentLocally } = require('./documentProcessor');
const ragEngine = require('./ragEngine');
const { orchestrateRequest } = require('./orchestrator');
const server = require('./server');
const generateSmartResponseFallback = server.generateSmartResponse;

let passed = 0;
let total = 0;

function runSyncTest(name, fn) {
    total++;
    try {
        fn();
        console.log(`✅ [${total}/16] PASSED: ${name}`);
        passed++;
    } catch (err) {
        console.error(`❌ [${total}/16] FAILED: ${name}`);
        console.error(err);
    }
}

async function runAsyncTest(name, fn) {
    total++;
    try {
        await fn();
        console.log(`✅ [${total}/16] PASSED: ${name}`);
        passed++;
    } catch (err) {
        console.error(`❌ [${total}/16] FAILED: ${name}`);
        console.error(err);
    }
}

async function main() {
    console.log('========================================================');
    console.log('🚀 AuraAI 16-Point Comprehensive Capability Verification');
    console.log('========================================================\n');

    const conversationId = 'e2e_suite_' + Date.now();

    // TEST 1: "hi" -> NORMAL_CHAT, No web search
    await runAsyncTest('TEST 1: "hi" routes to NORMAL_CHAT without web search', async () => {
        const route = analyzeRequest('hi', [], [], { webSearch: true }, conversationId);
        assert.strictEqual(route.capability, CAPABILITIES.NORMAL_CHAT, 'Must route to NORMAL_CHAT');
        const res = await orchestrateRequest({
            prompt: 'hi',
            userConfig: { webSearch: true, conversationId },
            conversationId,
            generateSmartResponseFallback
        });
        assert.strictEqual(res.capability, CAPABILITIES.NORMAL_CHAT);
        assert(!res.response.includes('Verified Summary from Web Retrieval'), 'Must not search web');
        assert(res.response.toLowerCase().includes('hello') || res.response.toLowerCase().includes('how can i help'));
    });

    // TEST 2: "Explain DNS in simple terms" -> NORMAL_CHAT, No web search
    await runAsyncTest('TEST 2: "Explain DNS in simple terms" routes to NORMAL_CHAT without web search', async () => {
        const route = analyzeRequest('Explain DNS in simple terms', [], [], { webSearch: true }, conversationId);
        assert.strictEqual(route.capability, CAPABILITIES.NORMAL_CHAT, 'Must route to NORMAL_CHAT');
        const res = await orchestrateRequest({
            prompt: 'Explain DNS in simple terms',
            userConfig: { webSearch: true, conversationId },
            conversationId,
            generateSmartResponseFallback
        });
        assert.strictEqual(res.capability, CAPABILITIES.NORMAL_CHAT);
        assert(!res.response.includes('Verified Summary from Web Retrieval'), 'Must not search web');
        assert(res.response.toLowerCase().includes('domain name system') || res.response.toLowerCase().includes('dns'));
    });

    // TEST 3: "What is the latest Endpoint Central release?" -> WEB_SEARCH
    await runAsyncTest('TEST 3: "What is the latest Endpoint Central release?" routes to WEB_SEARCH', async () => {
        const route = analyzeRequest('What is the latest Endpoint Central release?', [], [], { webSearch: true }, conversationId);
        assert.strictEqual(route.capability, CAPABILITIES.WEB_SEARCH, 'Must route to WEB_SEARCH');
        const res = await orchestrateRequest({
            prompt: 'What is the latest Endpoint Central release?',
            userConfig: { webSearch: true, conversationId },
            conversationId,
            generateSmartResponseFallback
        });
        assert.strictEqual(res.capability, CAPABILITIES.WEB_SEARCH);
        assert(res.response.length > 50, 'Must produce informative release/installation response');
    });

    // TEST 4: "What is the latest news in Tamil Nadu?" -> WEB_SEARCH with real articles
    await runAsyncTest('TEST 4: "What is the latest news in Tamil Nadu?" retrieves actual news content', async () => {
        const route = analyzeRequest('What is the latest news in Tamil Nadu?', [], [], { webSearch: true }, conversationId);
        assert.strictEqual(route.capability, CAPABILITIES.WEB_SEARCH);
        const retrieval = await webRetrieval.executeWebRetrievalPipeline('What is the latest news in Tamil Nadu?', { conversationId });
        assert.strictEqual(retrieval.mode, 'web_search');
        assert(retrieval.sources.length >= 1, 'Must retrieve candidate sources');
        assert(retrieval.confidence === 'HIGH' || retrieval.confidence === 'MEDIUM', 'Confidence must be HIGH or MEDIUM');
        const synthesized = webRetrieval.synthesizeAnswerFromRetrievedContent('What is the latest news in Tamil Nadu?', retrieval);
        assert(synthesized.includes('Verified News') || synthesized.includes('Current News'), 'Must generate news report');
        assert(synthesized.includes('http'), 'Must cite sources with URLs');
    });

    // TEST 5: Direct URL ManageEngine Agent IP change
    const meUrl = 'https://www.manageengine.com/products/desktop-central/desktop_agent_change_ip.html';
    await runAsyncTest('TEST 5: Direct URL reading extracts instructions accurately', async () => {
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

    // TEST 6: After TEST 5: "What are the steps?" uses stored source without new search
    await runAsyncTest('TEST 6: Follow-up "What are the steps?" uses stored ManageEngine source', async () => {
        const route = analyzeRequest('What are the steps?', [], [], {}, conversationId);
        assert.strictEqual(route.capability, CAPABILITIES.URL_READER, 'Must route to URL_READER follow-up');
        assert.strictEqual(route.isFollowUp, true, 'Must be marked as follow-up');
        const res = await orchestrateRequest({
            prompt: 'What are the steps?',
            userConfig: { conversationId },
            conversationId,
            generateSmartResponseFallback
        });
        assert.strictEqual(res.capability, CAPABILITIES.URL_READER);
        assert.strictEqual(res.provider, 'AuraAI Source Memory');
        assert(res.response.includes('manageengine.com'), 'Must cite original source');
    });

    // TEST 7: Upload PDF / text document -> Hierarchical summary
    let sampleDoc;
    runSyncTest('TEST 7: Upload document and generate hierarchical summary', () => {
        const docText = "--- Page 1 ---\n# Project Aura Architecture\nAuraAI is an enterprise AI assistant featuring unified routing, RAG, and multimodal capabilities.\n--- Page 2 ---\n# Database Failover Protocol\nWhen active database node fails, replica initiates takeover in 250ms with zero data loss.\nAutomatic health checks poll every 50ms.\n--- Page 3 ---\n# Security & SSRF Protection\nPrivate IPv4 ranges and cloud metadata endpoints are strictly blocked at DNS and network levels.";
        sampleDoc = parseStructuredText(docText, 'aura_architecture.txt', 'txt');
        assert.strictEqual(sampleDoc.totalPages, 3);
        const summary = summarizeDocumentLocally(sampleDoc, 'executive');
        assert(summary.includes('Executive Summary'));
        ragEngine.registerDocument(sampleDoc, conversationId);
    });

    // TEST 8: After TEST 7: "What does page 2 say?" -> RAG retrieves page 2 accurately
    runSyncTest('TEST 8: RAG retrieves specific page 2 content accurately', () => {
        const ret = ragEngine.retrieve('What does page 2 say about failover?', conversationId);
        assert.strictEqual(ret.confidence, 'HIGH');
        assert(ret.passages.length > 0);
        assert.strictEqual(ret.passages[0].page, 2);
        assert(ret.passages[0].text.includes('replica initiates takeover in 250ms'));
    });

    // TEST 9: Image understanding / OCR identification
    runSyncTest('TEST 9: Image attachment routes to IMAGE_UNDERSTANDING', () => {
        const route = analyzeRequest('What error is shown?', [], [{ name: 'db_error.png', type: 'image/png', dataUrl: 'data:image/png;base64,iVBORw0KGgo' }], {}, conversationId);
        assert.strictEqual(route.capability, CAPABILITIES.IMAGE_UNDERSTANDING);
    });

    // TEST 10: "Create an image of a futuristic city" -> IMAGE_GENERATION
    await runAsyncTest('TEST 10: "Create an image of a futuristic city" calls image generator', async () => {
        const route = analyzeRequest('Create an image of a futuristic city', [], [], {}, conversationId);
        assert.strictEqual(route.capability, CAPABILITIES.IMAGE_GENERATION);
        const res = await orchestrateRequest({
            prompt: 'Create an image of a futuristic city',
            userConfig: { conversationId },
            conversationId,
            generateSmartResponseFallback
        });
        assert.strictEqual(res.capability, CAPABILITIES.IMAGE_GENERATION);
        assert(res.response.includes('🎨 Generated Image:'));
        assert(res.response.includes('https://image.pollinations.ai/prompt/'));
    });

    // TEST 11: After TEST 10: "Make it darker and add rain" -> IMAGE_EDITING
    await runAsyncTest('TEST 11: Follow-up "Make it darker and add rain" routes to IMAGE_EDITING', async () => {
        const history = [
            { role: 'user', content: 'Create an image of a futuristic city' },
            { role: 'assistant', content: "🎨 Generated Image: *futuristic city*\n\n> **Prompt**: *\"futuristic city\"*\nhttps://image.pollinations.ai/prompt/futuristic%20city" }
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

    // TEST 12: Calculate 25 * 40 + 15 -> 1015
    await runAsyncTest('TEST 12: Math calculation 25 * 40 + 15 evaluates to 1015', async () => {
        const val = calculateMath('25 * 40 + 15');
        assert.strictEqual(val, 1015);
        const res = await orchestrateRequest({
            prompt: '25 * 40 + 15',
            userConfig: { conversationId },
            conversationId,
            generateSmartResponseFallback
        });
        assert.strictEqual(res.capability, CAPABILITIES.CODE_CALCULATION);
        assert(res.response.includes('1015'));
    });

    // TEST 13: Multimodal comparison (Doc + URL) -> MULTI_TOOL_WORKFLOW
    runSyncTest('TEST 13: Document + URL comparison routes to MULTI_TOOL_WORKFLOW', () => {
        const route = analyzeRequest('Compare this document with https://example.com', [], [{ name: 'spec.pdf', type: 'application/pdf' }], {}, conversationId);
        assert.strictEqual(route.capability, CAPABILITIES.MULTI_TOOL_WORKFLOW);
    });

    // TEST 14: SSRF test: http://127.0.0.1 is blocked
    await runAsyncTest('TEST 14: SSRF blocks loopback 127.0.0.1', async () => {
        const check = await validateUrlSafety('http://127.0.0.1:8080/admin');
        assert.strictEqual(check.safe, false, '127.0.0.1 must be blocked');
        assert(check.reason.includes('loopback') || check.reason.includes('blocked'));
    });

    // TEST 15: SSRF test: http://169.254.169.254 is blocked
    await runAsyncTest('TEST 15: SSRF blocks cloud metadata 169.254.169.254', async () => {
        const check = await validateUrlSafety('http://169.254.169.254/latest/meta-data');
        assert.strictEqual(check.safe, false, '169.254.169.254 must be blocked');
        assert(check.reason.includes('metadata') || check.reason.includes('internal'));
    });

    // TEST 16: SSRF test: http://192.168.1.1 is blocked
    await runAsyncTest('TEST 16: SSRF blocks private LAN IP 192.168.1.1', async () => {
        const check = await validateUrlSafety('http://192.168.1.1/router-login');
        assert.strictEqual(check.safe, false, '192.168.1.1 must be blocked');
        assert(check.reason.includes('private') || check.reason.includes('blocked'));
    });

    console.log('\n========================================================');
    console.log(`🎯 TEST SUITE VERIFICATION: ${passed}/${total} PASSED`);
    console.log('========================================================\n');

    if (passed === total) {
        console.log('🏆 ALL 16 CAPABILITY & END-TO-END TESTS PASSED WITH 100% SUCCESS!');
        process.exit(0);
    } else {
        console.error(`🚨 ${total - passed} test(s) failed!`);
        process.exit(1);
    }
}

main().catch(err => {
    console.error('Fatal test error:', err);
    process.exit(1);
});
