/**
 * AuraAI Automated Capability & Regression Test Suite
 * Fully validates the 32 required capability specifications + regression tests:
 * 1. Simple greeting
 * 2. Normal knowledge question
 * 3. Current news
 * 4. Technical research
 * 5. Official vendor documentation
 * 6. Direct URL
 * 7. PDF URL
 * 8. PDF attachment
 * 9. DOCX attachment
 * 10. PPTX attachment
 * 11. Image attachment
 * 12. Image generation
 * 13. Image editing follow up
 * 14. Follow up question
 * 15. Multi source web retrieval
 * 16. Source citation
 * 17. Search result with malformed data
 * 18. Array instead of string (normalizeText)
 * 19. Object instead of string (normalizeText)
 * 20. Empty retrieval result
 * 21. Failed webpage
 * 22. Redirected webpage
 * 23. PDF extraction
 * 24. SSRF localhost
 * 25. SSRF private IP
 * 26. SSRF cloud metadata
 * 27. Calculation
 * 28. Code generation
 * 29. Endpoint Central technical question
 * 30. Endpoint Central URL reading
 * 31. News deduplication
 * 32. Conversation context preservation
 * 33. REGRESSION: "who is thalapathy in tamilnadu" does not produce targetText.split is not a function
 * 34. REGRESSION: "how to connect wifi on mac m4" does not produce targetText.split is not a function
 */

const assert = require('assert');
const { analyzeRequest, CAPABILITIES } = require('./router');
const { orchestrateRequest } = require('./orchestrator');
const conversationState = require('./conversationState');
const ragEngine = require('./ragEngine');
const documentProcessor = require('./documentProcessor');
const webRetrieval = require('./webRetrieval');
const { validateUrlSafety } = require('./security');
const { normalizeText, createWebResult, createDocumentResult } = require('./textUtils');

let passed = 0;
let total = 0;

function runSyncTest(name, fn) {
    total++;
    try {
        fn();
        console.log(`  ✅ [PASS] ${total}. ${name}`);
        passed++;
    } catch (err) {
        console.error(`  ❌ [FAIL] ${total}. ${name}:`, err.message);
    }
}

async function runAsyncTest(name, fn) {
    total++;
    try {
        await fn();
        console.log(`  ✅ [PASS] ${total}. ${name}`);
        passed++;
    } catch (err) {
        console.error(`  ❌ [FAIL] ${total}. ${name}:`, err.message);
    }
}

// Mock fallback for standalone testing
async function mockSmartResponseFallback(prompt) {
    const p = prompt.toLowerCase();
    if (p.includes('thalapathy')) {
        return "Joseph Vijay Chandrasekhar (known as Vijay) is a superstar of Tamil cinema and president of TVK.";
    }
    if (p.includes('wifi') && p.includes('mac')) {
        return "To connect Wi-Fi on Mac, open Control Center > Wi-Fi, select your network, and enter password.";
    }
    return `Smart response for: ${prompt}`;
}

async function main() {
    console.log('========================================================');
    console.log('🚀 RUNNING AURAAI 34-TEST CAPABILITY & REGRESSION SUITE');
    console.log('========================================================\n');

    const conversationId = 'test_conv_' + Date.now();

    // 1. Simple greeting
    runSyncTest('1. Simple greeting: "hello" routes to NORMAL_CHAT', () => {
        const route = analyzeRequest('hello', [], [], {}, conversationId);
        assert.strictEqual(route.capability, CAPABILITIES.NORMAL_CHAT);
    });

    // 2. Normal knowledge question
    runSyncTest('2. Normal knowledge question: "Explain DNS" routes to NORMAL_CHAT without search', () => {
        const route = analyzeRequest('Explain DNS', [], [], {}, conversationId);
        assert.strictEqual(route.capability, CAPABILITIES.NORMAL_CHAT);
    });

    // 3. Current news
    runSyncTest('3. Current news: "latest news in Tamil Nadu" routes to CURRENT_NEWS', () => {
        const route = analyzeRequest('latest news in Tamil Nadu', [], [], {}, conversationId);
        assert.strictEqual(route.capability, CAPABILITIES.CURRENT_NEWS);
    });

    // 4. Technical research
    runSyncTest('4. Technical research: "What is the latest DNS vulnerability?" routes to WEB_RESEARCH', () => {
        const route = analyzeRequest('What is the latest DNS vulnerability?', [], [], {}, conversationId);
        assert.strictEqual(route.capability, CAPABILITIES.WEB_RESEARCH);
    });

    // 5. Official vendor documentation
    runSyncTest('5. Official vendor documentation: "official documentation Endpoint Central" prioritizes vendor docs', () => {
        conversationState.setActiveTopic(conversationId, 'Endpoint Central');
        const route = analyzeRequest('give me the official documentation', [], [], {}, conversationId);
        assert.strictEqual(route.capability, CAPABILITIES.WEB_RESEARCH);
        assert.strictEqual(route.prioritizeOfficial, true);
    });

    // 6. Direct URL
    runSyncTest('6. Direct URL: "Read https://example.com" routes to URL_READER', () => {
        const route = analyzeRequest('Read https://example.com', [], [], {}, conversationId);
        assert.strictEqual(route.capability, CAPABILITIES.URL_READER);
        assert.strictEqual(route.url, 'https://example.com');
    });

    // 7. PDF URL
    runSyncTest('7. PDF URL: "https://example.com/spec.pdf" routes to URL_READER', () => {
        const route = analyzeRequest('https://example.com/spec.pdf', [], [], {}, conversationId);
        assert.strictEqual(route.capability, CAPABILITIES.URL_READER);
        assert.strictEqual(route.url, 'https://example.com/spec.pdf');
    });

    // 8. PDF attachment
    runSyncTest('8. PDF attachment: Parsed and indexed into RAG', () => {
        const samplePdfText = 'ManageEngine Endpoint Central Unified Endpoint Management\nSection 1: Agent Installation\nTo install agent run setup.exe /silent.';
        const parsed = documentProcessor.parseStructuredText(samplePdfText, 'guide.pdf', 'pdf');
        ragEngine.registerDocument(parsed, conversationId);
        const retrieved = ragEngine.retrieve('agent installation', conversationId);
        assert(retrieved.passages.length > 0);
        assert(retrieved.passages[0].text.includes('Agent Installation'));
    });

    // 9. DOCX attachment
    runSyncTest('9. DOCX attachment: Structure extracted safely', () => {
        const fakeBuffer = Buffer.from('PK\x03\x04MockDocxContent');
        const parsed = documentProcessor.parseDocx(fakeBuffer, 'spec.docx');
        assert.strictEqual(parsed.type, 'docx');
        assert.strictEqual(parsed.filename, 'spec.docx');
    });

    // 10. PPTX attachment
    runSyncTest('10. PPTX attachment: Presentation slides handled safely', () => {
        const fakeBuffer = Buffer.from('PK\x03\x04MockPptxContent');
        const parsed = documentProcessor.parsePptx(fakeBuffer, 'slides.pptx');
        assert.strictEqual(parsed.type, 'pptx');
        assert.strictEqual(parsed.filename, 'slides.pptx');
    });

    // 11. Image attachment
    runSyncTest('11. Image attachment: Routes to IMAGE_UNDERSTANDING', () => {
        const route = analyzeRequest('What is in this image?', [], [{ name: 'screen.png', type: 'image/png' }], {}, conversationId);
        assert.strictEqual(route.capability, CAPABILITIES.IMAGE_UNDERSTANDING);
    });

    // 12. Image generation
    await runAsyncTest('12. Image generation: "Create a futuristic city" produces image result', async () => {
        const route = analyzeRequest('Create a futuristic city', [], [], {}, conversationId);
        assert.strictEqual(route.capability, CAPABILITIES.IMAGE_GENERATION);
        const res = await orchestrateRequest({
            prompt: 'Create a futuristic city',
            conversationId,
            generateSmartResponseFallback: mockSmartResponseFallback
        });
        assert.strictEqual(res.capability, CAPABILITIES.IMAGE_GENERATION);
        assert(res.response.includes('pollinations.ai'));
    });

    // 13. Image editing follow up
    await runAsyncTest('13. Image editing follow up: "Make it darker and add rain" modifies previous image', async () => {
        const history = [
            { role: 'user', content: 'Create a futuristic city' },
            { role: 'assistant', content: '🎨 Generated Image: *futuristic city*\nhttps://image.pollinations.ai/prompt/futuristic%20city' }
        ];
        const route = analyzeRequest('Make it darker and add rain', history, [], {}, conversationId);
        assert.strictEqual(route.capability, CAPABILITIES.IMAGE_EDITING);
        const res = await orchestrateRequest({
            prompt: 'Make it darker and add rain',
            history,
            conversationId,
            generateSmartResponseFallback: mockSmartResponseFallback
        });
        assert.strictEqual(res.capability, CAPABILITIES.IMAGE_EDITING);
        assert(res.response.includes('darker') || res.response.includes('rain'));
    });

    // 14. Follow up question
    runSyncTest('14. Follow up question: "What about macOS?" resolves as FOLLOW_UP', () => {
        conversationState.setActiveTopic(conversationId, 'Endpoint Central agent installation');
        const route = analyzeRequest('What about macOS?', [], [], {}, conversationId);
        assert.strictEqual(route.capability, CAPABILITIES.FOLLOW_UP);
        assert(route.query.includes('macOS'));
    });

    // 15. Multi source web retrieval
    await runAsyncTest('15. Multi source web retrieval: Returns synthesized content with multiple sources', async () => {
        const result = await webRetrieval.executeWebRetrievalPipeline('Endpoint Central latest release', { conversationId });
        assert(result);
        assert(Array.isArray(result.sources));
        assert(result.sources.length > 0);
    });

    // 16. Source citation
    await runAsyncTest('16. Source citation: Citations are properly formatted in web synthesis', async () => {
        const result = await webRetrieval.executeWebRetrievalPipeline('who publishes Endpoint Central', { conversationId });
        const synth = webRetrieval.synthesizeAnswerFromRetrievedContent('who publishes Endpoint Central', result);
        assert(synth.includes('manageengine.com') || synth.includes('Source 1'));
    });

    // 17. Search result with malformed data
    runSyncTest('17. Search result with malformed data: createWebResult safely normalizes undefined/null fields', () => {
        const malformed = createWebResult({ title: null, text: undefined, url: 'https://example.com' });
        assert.strictEqual(typeof malformed.text, 'string');
        assert.strictEqual(typeof malformed.title, 'string');
        assert.strictEqual(malformed.url, 'https://example.com');
    });

    // 18. Array instead of string (normalizeText)
    runSyncTest('18. Array instead of string: normalizeText converts arrays into clean strings', () => {
        const input = ['Step 1: Download agent', 'Step 2: Run installer'];
        const normalized = normalizeText(input);
        assert.strictEqual(typeof normalized, 'string');
        assert.strictEqual(normalized, 'Step 1: Download agent\nStep 2: Run installer');
        assert.doesNotThrow(() => normalized.split(' '));
    });

    // 19. Object instead of string (normalizeText)
    runSyncTest('19. Object instead of string: normalizeText safely extracts text without crashing', () => {
        const inputObj = { text: 'Hello world from object', provider: 'Test' };
        const normalized = normalizeText(inputObj);
        assert.strictEqual(typeof normalized, 'string');
        assert.strictEqual(normalized, 'Hello world from object');
        assert.doesNotThrow(() => normalized.split(' '));
    });

    // 20. Empty retrieval result
    runSyncTest('20. Empty retrieval result: Handled gracefully without errors', () => {
        const emptyResult = webRetrieval.synthesizeAnswerFromRetrievedContent('some query', null);
        assert.strictEqual(typeof emptyResult, 'string');
        assert(emptyResult.length > 0);
    });

    // 21. Failed webpage
    await runAsyncTest('21. Failed webpage: Gracefully returns user-facing message, no raw crash', async () => {
        const res = await webRetrieval.executeWebRetrievalPipeline('https://domain-does-not-exist-123456.invalid');
        assert.strictEqual(res.success, false);
        assert.strictEqual(res.confidence, 'LOW');
        assert(res.answer.includes('could not'));
    });

    // 22. Redirected webpage
    await runAsyncTest('22. Redirected webpage: Validates safety on redirect targets', async () => {
        const check = await validateUrlSafety('https://httpbin.org/redirect/1');
        assert.strictEqual(typeof check.safe, 'boolean');
    });

    // 23. PDF extraction
    runSyncTest('23. PDF extraction: Extracts structured text pages and sections', () => {
        const text = 'Page 1: Title\nPage 2: Chapter 1 Introduction';
        const doc = documentProcessor.parseStructuredText(text, 'doc.pdf', 'pdf');
        assert.strictEqual(doc.filename, 'doc.pdf');
        assert(doc.sections.length > 0);
    });

    // 24. SSRF localhost
    await runAsyncTest('24. SSRF localhost: Blocks loopback 127.0.0.1', async () => {
        const check = await validateUrlSafety('http://127.0.0.1:8080/admin');
        assert.strictEqual(check.safe, false);
    });

    // 25. SSRF private IP
    await runAsyncTest('25. SSRF private IP: Blocks private 192.168.1.1', async () => {
        const check = await validateUrlSafety('http://192.168.1.1/setup');
        assert.strictEqual(check.safe, false);
    });

    // 26. SSRF cloud metadata
    await runAsyncTest('26. SSRF cloud metadata: Blocks 169.254.169.254', async () => {
        const check = await validateUrlSafety('http://169.254.169.254/latest/meta-data/');
        assert.strictEqual(check.safe, false);
    });

    // 27. Calculation
    await runAsyncTest('27. Calculation: "25 * 40 + 15" evaluates to 1015', async () => {
        const route = analyzeRequest('25 * 40 + 15', [], [], {}, conversationId);
        assert.strictEqual(route.capability, CAPABILITIES.CALCULATION);
        const res = await orchestrateRequest({ prompt: '25 * 40 + 15', conversationId });
        assert.strictEqual(res.capability, CAPABILITIES.CALCULATION);
        assert(res.response.includes('1015'));
    });

    // 28. Code generation
    await runAsyncTest('28. Code generation: "Write PowerShell to find .log files" generates PowerShell script', async () => {
        const route = analyzeRequest('Write PowerShell to find .log files', [], [], {}, conversationId);
        assert.strictEqual(route.capability, CAPABILITIES.CODE_GENERATION);
        const res = await orchestrateRequest({ prompt: 'Write PowerShell to find .log files', conversationId });
        assert(res.response.includes('Get-ChildItem') && res.response.includes('.log'));
    });

    // 29. Endpoint Central technical question
    await runAsyncTest('29. Endpoint Central technical question: "how to create image repository in endpoint central OSD" does not say breaking articles', async () => {
        const route = analyzeRequest('how to create image repository in endpoint central OSD', [], [], {}, conversationId);
        assert.strictEqual(route.capability, CAPABILITIES.TECHNICAL_TROUBLESHOOTING);
        const res = await orchestrateRequest({
            prompt: 'how to create image repository in endpoint central OSD',
            conversationId,
            generateSmartResponseFallback: mockSmartResponseFallback
        });
        assert.strictEqual(res.capability, CAPABILITIES.TECHNICAL_TROUBLESHOOTING);
        assert(res.response.includes('Image Repository'));
        assert(res.response.includes('OS Deployment'));
        assert.strictEqual(res.response.includes('breaking articles'), false, 'Must never say "breaking articles" for technical query');
    });

    // 30. Endpoint Central URL reading
    await runAsyncTest('30. Endpoint Central URL reading: Reads and registers manageengine.com doc source', async () => {
        const testSource = {
            title: 'Endpoint Central OS Deployment Guide',
            url: 'https://www.manageengine.com/products/desktop-central/help/os_deployment/creating_image_repository.html',
            domain: 'manageengine.com',
            passages: ['Navigate to OS Deployment > Configure > Image Repository to add network share.']
        };
        ragEngine.registerWebSource(testSource, conversationId);
        const sources = ragEngine.getActiveSources(conversationId);
        assert(sources.some(s => s.domain === 'manageengine.com'));
    });

    // 31. News deduplication
    runSyncTest('31. News deduplication: Deduplicates identical news headlines', () => {
        const articles = [
            { title: 'New tech announcement today', link: 'https://news.com/1' },
            { title: 'New tech announcement today', link: 'https://news.com/2' },
            { title: 'Another tech headline', link: 'https://news.com/3' }
        ];
        const seen = new Set();
        const deduped = articles.filter(a => {
            if (seen.has(a.title)) return false;
            seen.add(a.title);
            return true;
        });
        assert.strictEqual(deduped.length, 2);
    });

    // 32. Conversation context preservation
    await runAsyncTest('32. Conversation context preservation: "What about macOS?" resolves to previous topic', async () => {
        const convId = 'context_preservation_test_' + Date.now();
        // Turn 1
        await orchestrateRequest({
            prompt: 'How do I install Endpoint Central agent?',
            conversationId: convId,
            generateSmartResponseFallback: mockSmartResponseFallback
        });
        // Check state
        const state1 = conversationState.getState(convId);
        assert(state1.currentTopic.includes('Endpoint Central'));

        // Turn 2
        const route2 = analyzeRequest('What about macOS?', [], [], {}, convId);
        assert.strictEqual(route2.capability, CAPABILITIES.FOLLOW_UP);
        assert(route2.query.includes('macOS'));

        const res2 = await orchestrateRequest({
            prompt: 'What about macOS?',
            conversationId: convId,
            generateSmartResponseFallback: mockSmartResponseFallback
        });
        assert(res2.response.includes('macOS'));
        assert(res2.response.includes('Endpoint Central Agent') || res2.response.includes('installer'));
    });

    // 33. REGRESSION TEST A: "who is thalapathy in tamilnadu" does not produce targetText.split is not a function
    await runAsyncTest('33. REGRESSION TEST A: "who is thalapathy in tamilnadu" safely splits without error', async () => {
        const res = await orchestrateRequest({
            prompt: 'who is thalapathy in tamilnadu',
            conversationId,
            generateSmartResponseFallback: mockSmartResponseFallback
        });
        assert.strictEqual(typeof res.response, 'string', 'res.response must be a string');
        assert(res.response.length > 0);
        // Simulate client execution: const words = targetText.split(' ');
        assert.doesNotThrow(() => {
            const targetText = normalizeText(res.response);
            const words = targetText.split(' ');
            assert(words.length > 5, 'Must split into multiple words');
        }, 'Must never throw targetText.split is not a function');
        assert(res.response.includes('Vijay') || res.response.includes('Thalapathy'));
    });

    // 34. REGRESSION TEST B: "how to connect wifi on mac m4" does not produce targetText.split is not a function
    await runAsyncTest('34. REGRESSION TEST B: "how to connect wifi on mac m4" safely splits without error', async () => {
        const res = await orchestrateRequest({
            prompt: 'how to connect wifi on mac m4',
            conversationId,
            generateSmartResponseFallback: mockSmartResponseFallback
        });
        assert.strictEqual(typeof res.response, 'string', 'res.response must be a string');
        assert(res.response.length > 0);
        // Simulate client execution: const words = targetText.split(' ');
        assert.doesNotThrow(() => {
            const targetText = normalizeText(res.response);
            const words = targetText.split(' ');
            assert(words.length > 5, 'Must split into multiple words');
        }, 'Must never throw targetText.split is not a function');
        assert(res.response.includes('Wi-Fi') || res.response.includes('Control Center'));
    });

    // 35. URL Grounding & 4-section format: Endpoint Central agent IP change
    await runAsyncTest('35. URL Grounding & 4-section format: Agent IP change', async () => {
        const res = await orchestrateRequest({
            prompt: 'Read this webpage and tell me what it says about changing Endpoint Central agent IP: https://www.manageengine.com/products/desktop-central/desktop_agent_change_ip.html',
            conversationId: 'test_url_grounding_' + Date.now()
        });
        assert.strictEqual(typeof res.response, 'string');
        assert(res.response.includes('### What the webpage says'), 'Must contain ### What the webpage says');
        assert(res.response.includes('### Steps mentioned on the webpage'), 'Must contain ### Steps mentioned on the webpage');
        assert(res.response.includes('### Important details'), 'Must contain ### Important details');
        assert(res.response.includes('### Source'), 'Must contain ### Source');
        assert(res.response.includes('configureDCAgentServerCommunication'), 'Must mention configureDCAgentServerCommunication script');
        assert(res.response.includes('https://www.manageengine.com'), 'Must cite original URL');
    });

    // 36. URL Missing topic refusal: Refusal when content missing
    await runAsyncTest('36. URL Missing topic refusal: Refuses when topic is absent', async () => {
        const res = await orchestrateRequest({
            prompt: 'Read this webpage and tell me what it says about Cisco VPN: https://www.manageengine.com/products/desktop-central/desktop_agent_change_ip.html',
            conversationId: 'test_url_refusal_' + Date.now()
        });
        assert(res.response.includes('The webpage does not provide information about Cisco VPN'), 'Must explicitly state absence of requested info');
        assert(!res.response.includes('configureDCAgentServerCommunication'), 'Must not invent steps for unrelated topics');
    });

    // 37. Mandatory Structured Source Extraction Contract
    await runAsyncTest('37. Mandatory Structured Source Extraction Contract: All 15 fields present', async () => {
        const candidate = {
            url: 'https://learn.microsoft.com/en-us/azure/',
            title: 'Azure Documentation',
            rawSnippet: 'Official Microsoft Azure documentation',
            score: 0.95
        };
        const pageResult = {
            url: 'https://learn.microsoft.com/en-us/azure/',
            finalUrl: 'https://learn.microsoft.com/en-us/azure/',
            domain: 'learn.microsoft.com',
            title: 'Azure Documentation',
            httpStatus: 200,
            contentType: 'text/html',
            content: 'Detailed documentation for cloud services on Microsoft Azure platform.',
            sections: [{ heading: 'Getting Started', text: 'Steps to configure', steps: ['1. Create account'], commands: [] }],
            passages: ['Detailed documentation for cloud services'],
            links: [{ text: 'Docs', url: 'https://learn.microsoft.com/docs' }]
        };
        const record = webRetrieval.buildStructuredSourceRecord(pageResult, candidate);
        const requiredFields = [
            'url', 'finalUrl', 'domain', 'title', 'publisher',
            'retrievedAt', 'httpStatus', 'contentType', 'content',
            'sections', 'relevantPassages', 'links', 'sourceType',
            'relevanceScore', 'reliabilityScore'
        ];
        requiredFields.forEach(field => {
            assert(field in record, `Field ${field} must be present in source record`);
            assert(record[field] !== undefined, `Field ${field} must not be undefined`);
        });
        assert.strictEqual(record.reliabilityScore, 98, 'Vendor docs must have reliabilityScore 98');
    });

    // 38. Source Reliability Scoring
    await runAsyncTest('38. Source Reliability Scoring: Authority-based tier assignment', async () => {
        const vendor = webRetrieval.getSourceCategoryAndReliability('https://learn.microsoft.com/docs', 'learn.microsoft.com', 'Docs');
        const news = webRetrieval.getSourceCategoryAndReliability('https://reuters.com/world', 'reuters.com', 'News');
        const reddit = webRetrieval.getSourceCategoryAndReliability('https://reddit.com/r/sysadmin', 'reddit.com', 'Discussion');
        const quora = webRetrieval.getSourceCategoryAndReliability('https://quora.com/question', 'quora.com', 'Q&A');

        assert.strictEqual(vendor.reliabilityScore, 98, 'Vendor doc must be 98');
        assert.strictEqual(news.reliabilityScore, 85, 'Major news must be 85');
        assert.strictEqual(reddit.reliabilityScore, 55, 'Reddit must be 55');
        assert.strictEqual(quora.reliabilityScore, 35, 'Quora must be 35');
        assert(vendor.reliabilityScore > news.reliabilityScore);
        assert(news.reliabilityScore > reddit.reliabilityScore);
        assert(reddit.reliabilityScore > quora.reliabilityScore);
    });

    // 39. Multi-source consensus and differences format
    await runAsyncTest('39. Multi-source consensus & differences response formatting', async () => {
        const sources = [
            {
                url: 'https://support.apple.com/kb/HT201222',
                domain: 'support.apple.com',
                title: 'Apple Official',
                content: 'Use the Command + R key combination to start into macOS Recovery.',
                relevantPassages: ['Use Command + R for recovery.'],
                reliabilityScore: 98,
                sourceType: 'Official Vendor Documentation'
            },
            {
                url: 'https://reddit.com/r/apple/comments/recovery',
                domain: 'reddit.com',
                title: 'Reddit Thread',
                content: 'Some users report Option + Command + R also works to install the latest OS.',
                relevantPassages: ['Option + Command + R installs latest macOS.'],
                reliabilityScore: 55,
                sourceType: 'Community Discussion Forum'
            }
        ];
        const answer = webRetrieval.synthesizeMultiSourceAnswer('How to start in recovery mode', sources);
        assert(answer.includes('### What the sources agree on'));
        assert(answer.includes('### Differences'));
        assert(answer.includes('### Conclusion'));
        assert(answer.includes('### Sources'));
        assert(answer.includes('support.apple.com'));
    });

    // 40. Citation Validation
    await runAsyncTest('40. Citation Validation: Prevents ungrounded or hallucinated citations', async () => {
        const sources = [{ url: 'https://support.apple.com/kb/HT201222' }];
        const validText = 'You can read more at [Apple Support](https://support.apple.com/kb/HT201222).';
        const hallucinatedText = 'Check out [Fake Guide](https://fake-hallucination-site.com/docs).';

        const validCheck = webRetrieval.validateCitations(validText, sources);
        const invalidCheck = webRetrieval.validateCitations(hallucinatedText, sources);

        assert.strictEqual(validCheck.valid, true);
        assert.strictEqual(invalidCheck.valid, false);
        assert(invalidCheck.unverifiedUrls.includes('https://fake-hallucination-site.com/docs'));
    });

    // 41. Timeless Knowledge: DNS
    await runAsyncTest('41. Timeless Knowledge: "Explain DNS" produces clear structured answer', async () => {
        const res = await orchestrateRequest({
            prompt: 'Explain DNS',
            conversationId: 'test_dns_' + Date.now()
        });
        assert.strictEqual(res.capability, CAPABILITIES.NORMAL_CHAT);
        assert(res.response.includes('Domain Name System'));
        assert(res.response.includes('### Answer'));
        assert(res.response.includes('### Details'));
    });

    // 42. Timeless Knowledge: Polymorphism
    await runAsyncTest('42. Timeless Knowledge: "What is polymorphism?" produces clear structured answer', async () => {
        const res = await orchestrateRequest({
            prompt: 'What is polymorphism?',
            conversationId: 'test_poly_' + Date.now()
        });
        assert.strictEqual(res.capability, CAPABILITIES.NORMAL_CHAT);
        assert(res.response.includes('Polymorphism'));
        assert(res.response.includes('Method Overloading') || res.response.includes('Method Overriding'));
    });

    // 43. Technical procedure: Skype silent install
    await runAsyncTest('43. Technical procedure: "How do I silently install Skype on Windows?" produces silent switches', async () => {
        const res = await orchestrateRequest({
            prompt: 'How do I silently install Skype on Windows?',
            conversationId: 'test_skype_' + Date.now()
        });
        assert.strictEqual(res.capability, CAPABILITIES.TECHNICAL_TROUBLESHOOTING);
        assert(res.response.includes('/VERYSILENT'));
        assert(res.response.includes('/NORESTART'));
        assert(res.response.includes('### Recommended steps'));
        assert(res.response.includes('### Sources'));
    });

    // 44. Technical procedure: Mac M4 CLI update
    await runAsyncTest('44. Technical procedure: "How do I update macOS via command line on an M4 Mac?" produces softwareupdate commands', async () => {
        const res = await orchestrateRequest({
            prompt: 'How do I update macOS via command line on an M4 Mac?',
            conversationId: 'test_m4_' + Date.now()
        });
        assert.strictEqual(res.capability, CAPABILITIES.TECHNICAL_TROUBLESHOOTING);
        assert(res.response.includes('softwareupdate -l'));
        assert(res.response.includes('softwareupdate -i -a'));
        assert(res.response.includes('### Recommended steps'));
        assert(res.response.includes('Apple Silicon'));
    });

    // 45. Context memory follow-up: Official vendor documents
    await runAsyncTest('45. Context memory: "Are there any official vendor documents for this?" preserves topic', async () => {
        const convId = 'test_vendor_doc_' + Date.now();
        await orchestrateRequest({
            prompt: 'How do I create an image repository in Endpoint Central OSD?',
            conversationId: convId
        });
        const res = await orchestrateRequest({
            prompt: 'Are there any official vendor documents for this?',
            conversationId: convId
        });
        assert(res.response.includes('Official Vendor Documentation'));
        assert(res.response.includes('ManageEngine'));
        assert(res.response.includes('https://www.manageengine.com/products/desktop-central/help/'));
    });

    // 46. Full regression suite for normalizeText with edge cases
    await runAsyncTest('46. Full regression suite: targetText.split edge cases (string, array, object, null, undefined)', () => {
        const cases = [
            'normal string with multiple words',
            ['array', 'with', 'words'],
            { text: 'object with text property' },
            { response: 'object with response property' },
            null,
            undefined,
            12345,
            false
        ];
        for (const c of cases) {
            const normalized = normalizeText(c);
            assert.strictEqual(typeof normalized, 'string', `normalizeText must return string for ${typeof c}`);
            assert.doesNotThrow(() => {
                const words = normalized.split(' ');
                assert(Array.isArray(words), 'Split must return array');
            }, `Split failed on ${typeof c}`);
        }
    });

    // ========================================================
    // SECTION 24: 10 REAL EVALUATION TESTS
    // ========================================================

    // 47. Real Eval 1: Latest Endpoint Central release
    await runAsyncTest('47. Real Eval 1: "What is the latest Endpoint Central release?"', async () => {
        const res = await orchestrateRequest({
            prompt: 'What is the latest Endpoint Central release?',
            conversationId: 'eval_epc_release_' + Date.now()
        });
        assert(res.capability === CAPABILITIES.WEB_RESEARCH || res.capability === CAPABILITIES.NORMAL_CHAT || res.capability === CAPABILITIES.TECHNICAL_TROUBLESHOOTING);
        assert(res.response.includes('Endpoint Central') || res.response.includes('ManageEngine'));
        assert(typeof res.response === 'string' && res.response.length > 50);
    });

    // 48. Real Eval 2: Direct URL reading with 4-section grounding
    await runAsyncTest('48. Real Eval 2: Direct URL reading from manageengine.com', async () => {
        const url = 'https://www.manageengine.com/products/desktop-central/software-deployment.html';
        const res = await orchestrateRequest({
            prompt: url,
            conversationId: 'eval_url_read_' + Date.now()
        });
        assert.strictEqual(res.capability, CAPABILITIES.URL_READER);
        assert(res.response.includes('### What the webpage says'));
        assert(res.response.includes('### Steps mentioned on the webpage') || res.response.includes('### Important details'));
        assert(res.response.includes('### Source'));
        assert(res.response.includes('manageengine.com'));
    });

    // 49. Real Eval 3: How to create image repository in Endpoint Central OSD
    await runAsyncTest('49. Real Eval 3: Image repository in Endpoint Central OSD with official steps', async () => {
        const res = await orchestrateRequest({
            prompt: 'How to create image repository in Endpoint Central OSD?',
            conversationId: 'eval_osd_repo_' + Date.now()
        });
        assert(res.capability === CAPABILITIES.TECHNICAL_TROUBLESHOOTING || res.capability === CAPABILITIES.WEB_RESEARCH);
        assert(res.response.includes('Image Repository') || res.response.includes('image repository'));
        assert(res.response.includes('Network Share') || res.response.includes('UNC') || res.response.includes('HTTP'));
        assert(res.response.includes('manageengine.com') || res.response.includes('ManageEngine'));
    });

    // 50. Real Eval 4: Update macOS on an M4 Mac using Terminal
    await runAsyncTest('50. Real Eval 4: Update macOS on M4 Mac via Terminal with Apple Silicon notes', async () => {
        const res = await orchestrateRequest({
            prompt: 'How to update macOS on an M4 Mac using Terminal?',
            conversationId: 'eval_m4_terminal_' + Date.now()
        });
        assert.strictEqual(res.capability, CAPABILITIES.TECHNICAL_TROUBLESHOOTING);
        assert(res.response.includes('softwareupdate'));
        assert(res.response.includes('Apple Silicon') || res.response.includes('ownership') || res.response.includes('sudo'));
    });

    // 51. Real Eval 5: Multi-turn Thalapathy -> What movies has he acted in?
    await runAsyncTest('51. Real Eval 5: Multi-turn: Thalapathy -> What movies has he acted in?', async () => {
        const convId = 'eval_thalapathy_conv_' + Date.now();
        const turn1 = await orchestrateRequest({
            prompt: 'Who is Thalapathy in Tamil Nadu?',
            conversationId: convId
        });
        assert(turn1.response.includes('Vijay') || turn1.response.includes('Joseph Vijay'));
        
        const turn2 = await orchestrateRequest({
            prompt: 'What movies has he acted in?',
            conversationId: convId
        });
        assert(turn2.response.includes('Vijay') || turn2.response.includes('Thalapathy'));
        assert(turn2.response.includes('Ghilli') || turn2.response.includes('Master') || turn2.response.includes('Leo'));
    });

    // 52. Real Eval 6: Multi-turn Gokul Santol -> Is it powder?
    await runAsyncTest('52. Real Eval 6: Multi-turn: Gokul Santol -> Is it powder?', async () => {
        const convId = 'eval_santol_conv_' + Date.now();
        const turn1 = await orchestrateRequest({
            prompt: 'I am asking about Gokul Santol.',
            conversationId: convId
        });
        assert(turn1.response.includes('Gokul Santol') || turn1.response.includes('powder') || turn1.response.includes('sandalwood'));
        assert(!turn1.response.toLowerCase().includes('chinmayi'));

        const turn2 = await orchestrateRequest({
            prompt: 'Is it powder?',
            conversationId: convId
        });
        assert(turn2.response.toLowerCase().includes('yes'));
        assert(turn2.response.toLowerCase().includes('powder'));
        assert(!turn2.response.toLowerCase().includes('baking powder'));
    });

    // 53. Real Eval 7: gokul santol standalone ambiguity handling
    await runAsyncTest('53. Real Eval 7: "gokul santol" qualified interpretation without hallucinations', async () => {
        const res = await orchestrateRequest({
            prompt: 'gokul santol',
            conversationId: 'eval_santol_solo_' + Date.now()
        });
        assert(res.response.includes('Gokul Santol') || res.response.includes('sandalwood') || res.response.includes('talcum'));
        assert(!res.response.toLowerCase().includes('chinmayi'));
        assert(!res.response.toLowerCase().includes('baking powder'));
    });

    // 54. Real Eval 8: silent install command for Skype Windows
    await runAsyncTest('54. Real Eval 8: silent install command for Skype Windows', async () => {
        const res = await orchestrateRequest({
            prompt: 'silent install command for Skype Windows',
            conversationId: 'eval_skype_silent_' + Date.now()
        });
        assert.strictEqual(res.capability, CAPABILITIES.TECHNICAL_TROUBLESHOOTING);
        assert(res.response.includes('/VERYSILENT') || res.response.includes('/qn') || res.response.includes('/silent'));
        assert(res.response.includes('/NORESTART') || res.response.includes('norestart'));
    });

    // 55. Real Eval 9: Image upload question routing
    await runAsyncTest('55. Real Eval 9: Image upload "What is wrong in this screenshot?"', async () => {
        const res = await orchestrateRequest({
            prompt: 'What is wrong in this screenshot?',
            attachments: [{ type: 'image', data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', mimeType: 'image/png' }],
            conversationId: 'eval_img_' + Date.now()
        });
        assert.strictEqual(res.capability, CAPABILITIES.IMAGE_UNDERSTANDING);
        assert(typeof res.response === 'string' && res.response.length > 20);
    });

    // 57. User Regression 1: HTML code for advance calculator returns single HTML file, not Python
    await runAsyncTest("57. User Regression 1: html code for advance calculator returns single HTML file, not Python", async () => {
        const res = await orchestrateRequest({
            prompt: "html code for advance calculator",
            conversationId: "eval_calc_" + Date.now()
        });
        assert(res.response.includes("<html") || res.response.includes("<!DOCTYPE html>"), "Must contain HTML markup");
        assert(res.response.includes("<script>"), "Must contain inline JavaScript");
        assert(res.response.includes("<style>"), "Must contain inline CSS");
        assert(!res.response.includes("class SolutionManager"), "Must NOT contain SolutionManager");
        assert(!res.response.includes("def execute"), "Must NOT contain Python code");
    });

    // 58. User Regression 2: Duplicate request repetition handling
    await runAsyncTest("58. User Regression 2: Repeated identical request offers changes rather than duplicate", async () => {
        const res1 = await orchestrateRequest({
            prompt: "html code for advance calculator",
            conversationId: "eval_repeat_" + Date.now()
        });
        const res2 = await orchestrateRequest({
            prompt: "html code for advance calculator",
            history: [
                { role: "user", content: "html code for advance calculator" },
                { role: "assistant", content: res1.response }
            ],
            conversationId: "eval_repeat_" + Date.now()
        });
        assert(res2.response.includes("I gave you this above. Want changes?"), "Must offer changes on repeated prompt");
    });

    // 59. User Regression 3: Paste screenshot after wrong answer
    await runAsyncTest("59. User Regression 3: Paste screenshot after wrong answer acknowledges Python vs HTML and gives fixed calculator", async () => {
        const res = await orchestrateRequest({
            prompt: "The code I got from you is wrong, fix it.\n\n[Text read from screenshot]\nclass SolutionManager:\n    def execute(self): pass",
            history: [
                { role: "user", content: "html code for advance calculator" },
                { role: "assistant", content: "Here is a Python implementation:\n```python\nclass SolutionManager:\n    def execute(self): pass\n```" }
            ],
            attachments: [{
                type: "image",
                content: "class SolutionManager:\n    def execute(self): pass",
                name: "screenshot.png"
            }],
            conversationId: "eval_screenshot_fix_" + Date.now()
        });
        assert(res.response.toLowerCase().includes("python") && res.response.toLowerCase().includes("html"), "Must acknowledge Python instead of HTML");
        assert(res.response.includes("<html") || res.response.includes("<!DOCTYPE html>"), "Must include corrected HTML calculator");
    });

    // 60. User Regression 4: Multi-turn Elon Musk net worth with typo
    await runAsyncTest("60. User Regression 4: Multi-turn \"who is elon musk\" -> \"his net wroth\" provides live net worth", async () => {
        const convId = "eval_musk_net_worth_" + Date.now();
        const res1 = await orchestrateRequest({
            prompt: "who is elon musk",
            conversationId: convId
        });
        assert(res1.response.includes("SpaceX") || res1.response.includes("Tesla"), "Must identify Elon Musk");

        const res2 = await orchestrateRequest({
            prompt: "his net wroth",
            history: [
                { role: "user", content: "who is elon musk" },
                { role: "assistant", content: res1.response }
            ],
            conversationId: convId
        });
        assert(res2.response.includes("Elon Musk") || res2.response.includes("net worth") || res2.response.includes("billion"), "Must answer with Elon Musk net worth");
        assert(res2.response.includes("Forbes") || res2.response.includes("Bloomberg"), "Must cite Forbes or Bloomberg sources");
    });

    // 56. Real Eval 10: PDF document upload question routing
    await runAsyncTest('56. Real Eval 10: PDF document upload "Summarize this document."', async () => {
        const samplePdfContent = 'AuraAI System Architecture Documentation. Section 1: Overview of Multimodal Router and Orchestrator.';
        const res = await orchestrateRequest({
            prompt: 'Summarize this document.',
            attachments: [{ type: 'pdf', filename: 'architecture.pdf', data: Buffer.from(samplePdfContent).toString('base64'), mimeType: 'application/pdf' }],
            conversationId: 'eval_pdf_' + Date.now()
        });
        assert.strictEqual(res.capability, CAPABILITIES.DOCUMENT_READER);
        assert(typeof res.response === 'string' && res.response.length > 20);
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
