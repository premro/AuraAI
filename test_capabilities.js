/**
 * AuraAI Automated Capability Test Suite
 * Tests:
 * 1. SSRF Protection
 * 2. Intelligent Request Router
 * 3. Web Search & Confidence Refusal
 * 4. Document Processing & RAG
 * 5. Image Generation & Follow-up Editing
 * 6. Calculation & Code Execution
 * 7. Live API Endpoints
 */

const assert = require('assert');
const { validateUrlSafety } = require('./security');
const { analyzeRequest, CAPABILITIES } = require('./router');
const { parseStructuredText, summarizeDocumentLocally, chunkDocument } = require('./documentProcessor');
const ragEngine = require('./ragEngine');
const { calculateMath } = require('./tools');
const CapabilityCache = require('./cache');
const http = require('http');

async function runTests() {
    console.log('=== STARTING AURAAI CAPABILITY TEST SUITE ===\n');
    let passed = 0;
    let total = 0;

    function test(name, fn) {
        total++;
        try {
            fn();
            console.log(`✅ [PASS] ${name}`);
            passed++;
        } catch (err) {
            console.error(`❌ [FAIL] ${name}:`, err.message);
        }
    }

    async function testAsync(name, fn) {
        total++;
        try {
            await fn();
            console.log(`✅ [PASS] ${name}`);
            passed++;
        } catch (err) {
            console.error(`❌ [FAIL] ${name}:`, err.message);
        }
    }

    // 1. SSRF Protection Tests
    await testAsync('SSRF blocks loopback (localhost, 127.0.0.1)', async () => {
        const r1 = await validateUrlSafety('http://localhost:3000/api');
        const r2 = await validateUrlSafety('http://127.0.0.1:8080');
        assert.strictEqual(r1.isSafe, false);
        assert.strictEqual(r2.isSafe, false);
    });

    await testAsync('SSRF blocks AWS/Cloud metadata (169.254.169.254)', async () => {
        const r = await validateUrlSafety('http://169.254.169.254/latest/meta-data/');
        assert.strictEqual(r.isSafe, false);
    });

    await testAsync('SSRF blocks private IP ranges (10.x, 192.168.x, 172.16.x)', async () => {
        const r1 = await validateUrlSafety('http://10.0.0.1/');
        const r2 = await validateUrlSafety('http://192.168.1.1/');
        const r3 = await validateUrlSafety('http://172.16.0.5/');
        assert.strictEqual(r1.isSafe, false);
        assert.strictEqual(r2.isSafe, false);
        assert.strictEqual(r3.isSafe, false);
    });

    await testAsync('SSRF permits safe public URLs', async () => {
        const r = await validateUrlSafety('https://example.com');
        assert.strictEqual(r.isSafe, true);
    });

    // 2. Intelligent Request Router Tests
    test('Router: "Explain DNS" routes to NORMAL_CHAT without web search', () => {
        const route = analyzeRequest('Explain DNS');
        assert.strictEqual(route.capability, CAPABILITIES.NORMAL_CHAT);
    });

    test('Router: "What is polymorphism?" routes to NORMAL_CHAT without web search', () => {
        const route = analyzeRequest('What is polymorphism?');
        assert.strictEqual(route.capability, CAPABILITIES.NORMAL_CHAT);
    });

    test('Router: "What is the latest Endpoint Central release?" routes to WEB_SEARCH', () => {
        const route = analyzeRequest('What is the latest Endpoint Central release?', [], [], { webSearch: true });
        assert.strictEqual(route.capability, CAPABILITIES.WEB_SEARCH);
    });

    test('Router: Direct URL "https://example.com" routes to URL_READER', () => {
        const route = analyzeRequest('Read this article: https://example.com');
        assert.strictEqual(route.capability, CAPABILITIES.URL_READER);
    });

    test('Router: Document attachment routes to DOCUMENT_READER', () => {
        const route = analyzeRequest('Summarize this document', [], [{ name: 'report.pdf', type: 'application/pdf' }]);
        assert.strictEqual(route.capability, CAPABILITIES.DOCUMENT_READER);
    });

    test('Router: Image attachment routes to IMAGE_UNDERSTANDING', () => {
        const route = analyzeRequest('What does this screenshot show?', [], [{ name: 'error.png', type: 'image/png' }]);
        assert.strictEqual(route.capability, CAPABILITIES.IMAGE_UNDERSTANDING);
    });

    test('Router: "Create an image of a futuristic city" routes to IMAGE_GENERATION', () => {
        const route = analyzeRequest('Create an image of a futuristic city');
        assert.strictEqual(route.capability, CAPABILITIES.IMAGE_GENERATION);
    });

    test('Router: "Make it darker and add rain" after image generation routes to IMAGE_EDITING', () => {
        const history = [{ role: 'assistant', content: '🎨 Generated Image: *futuristic city*' }];
        const route = analyzeRequest('Make it darker and add rain', history);
        assert.strictEqual(route.capability, CAPABILITIES.IMAGE_EDITING);
        assert.strictEqual(route.isFollowUp, true);
    });

    test('Router: Multi-modal comparison (Doc + URL) routes to MULTI_TOOL_WORKFLOW', () => {
        const route = analyzeRequest('Compare this document with https://example.com', [], [{ name: 'manual.pdf' }]);
        assert.strictEqual(route.capability, CAPABILITIES.MULTI_TOOL_WORKFLOW);
    });

    test('Router: Math equation "25 * 40 + 15" routes to CODE_CALCULATION', () => {
        const route = analyzeRequest('25 * 40 + 15');
        assert.strictEqual(route.capability, CAPABILITIES.CODE_CALCULATION);
    });

    // 3. Calculator Tests
    test('Calculator: Evaluates arithmetic correctly', () => {
        assert.strictEqual(calculateMath('25 * 40 + 15'), 1015);
        assert.strictEqual(calculateMath('(100 - 20) / 4'), 20);
        assert.strictEqual(calculateMath('2 ^ 8'), 256);
    });

    // 4. Document Processing & RAG Tests
    test('DocumentProcessor: Parses multi-page structured document', () => {
        const sampleDocText = 
`--- Page 1 ---
# Overview
This is the system architecture overview for the high availability cluster.

--- Page 2 ---
# Error Handling & Failover
When node A fails, node B automatically initiates IP takeover within 300ms.
Heartbeat checks run every 50ms over redundant UDP channels.`;

        const parsed = parseStructuredText(sampleDocText, 'cluster_spec.txt', 'txt');
        assert.strictEqual(parsed.totalPages, 2);
        assert.strictEqual(parsed.sections.length, 2);

        // Summaries
        const execSummary = summarizeDocumentLocally(parsed, 'executive');
        assert(execSummary.includes('Executive Summary'));

        // Chunking
        const chunks = chunkDocument(parsed);
        assert(chunks.length >= 2);

        // Register in RAG Engine
        ragEngine.registerDocument(parsed, 'test_convo');
        
        // Retrieve targeting specific page
        const ret1 = ragEngine.retrieve('What happens on page 2 when node fails?', 'test_convo');
        assert.strictEqual(ret1.confidence, 'HIGH');
        assert(ret1.passages[0].text.includes('node B automatically initiates IP takeover'));
        assert.strictEqual(ret1.passages[0].page, 2);
    });

    // 5. Cache Layer Tests
    test('Cache: Stores and retrieves with TTL', () => {
        const cache = new CapabilityCache(5000);
        cache.set('key1', { data: 'test_payload' });
        assert.strictEqual(cache.has('key1'), true);
        assert.strictEqual(cache.get('key1').data, 'test_payload');
        cache.delete('key1');
        assert.strictEqual(cache.has('key1'), false);
    });

    // 6. Live Local HTTP Server API Tests
    await testAsync('Live API: /api/instant-chat handles NORMAL_CHAT', async () => {
        const postData = JSON.stringify({
            messages: [{ role: 'user', content: 'Explain DNS in simple terms' }],
            model: 'gpt-4o-mini',
            webSearch: false
        });

        const res = await makePostRequest('/api/instant-chat', postData);
        assert.strictEqual(res.statusCode, 200);
        const data = JSON.parse(res.body);
        assert(data.response.length > 20);
        assert.strictEqual(data.capability, 'normal_chat');
    });

    await testAsync('Live API: /api/instant-chat handles CODE_CALCULATION', async () => {
        const postData = JSON.stringify({
            messages: [{ role: 'user', content: 'calculate 1500 * 4 + 250' }],
            model: 'gpt-4o-mini'
        });

        const res = await makePostRequest('/api/instant-chat', postData);
        assert.strictEqual(res.statusCode, 200);
        const data = JSON.parse(res.body);
        assert(data.response.includes('6250'));
        assert.strictEqual(data.capability, 'code_calculation');
    });

    await testAsync('Live API: /api/instant-chat handles IMAGE_GENERATION', async () => {
        const postData = JSON.stringify({
            messages: [{ role: 'user', content: 'Create an image of an emerald forest at sunrise' }],
            model: 'gpt-4o-mini'
        });

        const res = await makePostRequest('/api/instant-chat', postData);
        assert.strictEqual(res.statusCode, 200);
        const data = JSON.parse(res.body);
        assert(data.response.includes('🎨 Generated Image:'));
        assert(data.response.includes('https://image.pollinations.ai/prompt/'));
        assert.strictEqual(data.capability, 'image_generation');
    });

    await testAsync('Live API: /api/parse-document registers document', async () => {
        const postData = JSON.stringify({
            filename: 'deployment_guide.txt',
            text: '--- Page 1 ---\n# Deployment\nRun docker compose up -d to launch the backend services on port 8080.',
            conversationId: 'live_test_convo'
        });

        const res = await makePostRequest('/api/parse-document', postData);
        assert.strictEqual(res.statusCode, 200);
        const data = JSON.parse(res.body);
        assert.strictEqual(data.success, true);
        assert.strictEqual(data.filename, 'deployment_guide.txt');
    });

    console.log(`\n=== TEST SUITE RESULTS: ${passed}/${total} PASSED ===\n`);
    if (passed === total) {
        console.log('🎉 ALL CAPABILITY TESTS COMPLETED SUCCESSFULLY!');
    }
}

function makePostRequest(path, data) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: '127.0.0.1',
            port: 3000,
            path: path,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
            },
            timeout: 5000
        };

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => resolve({ statusCode: res.statusCode, body }));
        });

        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
        req.write(data);
        req.end();
    });
}

runTests();
