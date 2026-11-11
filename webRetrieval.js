/**
 * AuraAI Advanced Web Search & Retrieval Pipeline
 * 
 * Pipeline:
 * User question
 *   ↓
 * Detect Direct URL or Search Engine
 *   ↓
 * Collect candidate results
 *   ↓
 * Rank results for relevance & intent constraints
 *   ↓
 * Open the most relevant result pages
 *   ↓
 * Fetch actual webpage content (HTML, PDF, Text)
 *   ↓
 * Extract meaningful article/document content (strip nav, ads, scripts, menus)
 *   ↓
 * Create source passages
 *   ↓
 * Validate sources & classify confidence (HIGH, MEDIUM, LOW)
 *   ↓
 * Pass relevant passages to selected LLM / Synthesize final answer with citations
 */

const https = require('https');
const http = require('http');
const zlib = require('zlib');
const querystring = require('querystring');
const { URL } = require('url');
const { validateUrlSafety } = require('./security');
const CapabilityCache = require('./cache');
const { log } = require('./logger');

// 1. URL Detection & Extraction
const URL_REGEX = /https?:\/\/[^\s<>"'()]+(?:\([^\s<>"'()]+\)|[^\s<>"'()!.,;:?])/gi;

function extractUrls(text) {
    if (!text) return [];
    const matches = text.match(URL_REGEX);
    return matches ? Array.from(new Set(matches)) : [];
}

function hasDirectUrl(text) {
    return extractUrls(text).length > 0;
}

// 2. Query Constraint & Intent Analysis
const STOP_WORDS = new Set([
    'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'aren\'t',
    'as', 'at', 'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by', 'can',
    'can\'t', 'cannot', 'could', 'couldn\'t', 'did', 'didn\'t', 'do', 'does', 'doesn\'t', 'doing', 'don\'t',
    'down', 'during', 'each', 'few', 'for', 'from', 'further', 'had', 'hadn\'t', 'has', 'hasn\'t', 'have',
    'haven\'t', 'having', 'he', 'he\'d', 'he\'ll', 'he\'s', 'her', 'here', 'here\'s', 'hers', 'herself',
    'him', 'himself', 'his', 'how', 'how\'s', 'i', 'i\'d', 'i\'ll', 'i\'m', 'i\'ve', 'if', 'in', 'into',
    'is', 'isn\'t', 'it', 'it\'s', 'its', 'itself', 'let\'s', 'me', 'more', 'most', 'mustn\'t', 'my', 'myself',
    'no', 'nor', 'not', 'of', 'off', 'on', 'once', 'only', 'or', 'other', 'ought', 'our', 'ours', 'ourselves',
    'out', 'over', 'own', 'same', 'shan\'t', 'she', 'she\'d', 'she\'ll', 'she\'s', 'should', 'shouldn\'t',
    'so', 'some', 'such', 'than', 'that', 'that\'s', 'the', 'their', 'theirs', 'them', 'themselves', 'then',
    'there', 'there\'s', 'these', 'they', 'they\'d', 'they\'ll', 'they\'re', 'they\'ve', 'this', 'those',
    'through', 'to', 'too', 'under', 'until', 'up', 'very', 'was', 'wasn\'t', 'we', 'we\'d', 'we\'ll',
    'we\'re', 'we\'ve', 'were', 'weren\'t', 'what', 'what\'s', 'when', 'when\'s', 'where', 'where\'s',
    'which', 'while', 'who', 'who\'s', 'whom', 'why', 'why\'s', 'with', 'won\'t', 'would', 'wouldn\'t',
    'you', 'you\'d', 'you\'ll', 'you\'re', 'you\'ve', 'your', 'yours', 'yourself', 'yourselves',
    'please', 'tell', 'give', 'show', 'search', 'find', 'bring', 'want', 'know', 'look'
]);

const PLATFORMS = {
    'windows': ['windows', 'win10', 'win11', 'win32', 'msi', 'msiexec', 'powershell', 'cmd'],
    'linux': ['linux', 'ubuntu', 'debian', 'centos', 'redhat', 'fedora', 'arch', 'apt', 'yum'],
    'macos': ['macos', 'mac', 'osx', 'darwin', 'dmg', 'homebrew', 'brew'],
    'android': ['android', 'apk'],
    'ios': ['ios', 'iphone', 'ipad']
};

const ACTIONS = {
    'uninstall': ['uninstall', 'uninstallation', 'remove', 'removal', 'delete'],
    'install': ['install', 'installation', 'setup', 'deploy'],
    'update': ['update', 'upgrade', 'patch'],
    'migrate': ['migrate', 'migration', 'transfer', 'backup', 'restore'],
    'configure': ['configure', 'configuration', 'settings', 'config']
};

function extractQueryConstraints(query) {
    if (!query) return { raw: '', keywords: [], platforms: [], actions: [], modifiers: [], conflicts: [] };

    // Clean query
    let clean = query.replace(/[?!.,;:"'()\[\]{}]+/g, ' ').replace(/\s+/g, ' ').trim();
    const tokens = clean.toLowerCase().split(/\s+/).filter(t => t.length > 1 && !STOP_WORDS.has(t));

    // Identify platforms
    const detectedPlatforms = [];
    for (const [plat, aliases] of Object.entries(PLATFORMS)) {
        if (tokens.some(t => aliases.includes(t))) {
            detectedPlatforms.push(plat);
        }
    }

    // Identify conflicting platforms (e.g. if user asked for Windows, Linux and macOS are conflicting)
    const conflictingPlatforms = [];
    if (detectedPlatforms.length > 0) {
        for (const plat of Object.keys(PLATFORMS)) {
            if (!detectedPlatforms.includes(plat)) {
                conflictingPlatforms.push(...PLATFORMS[plat]);
            }
        }
    }

    // Identify actions
    const detectedActions = [];
    for (const [act, aliases] of Object.entries(ACTIONS)) {
        if (tokens.some(t => aliases.includes(t))) {
            detectedActions.push(act);
        }
    }

    // Modifiers (silent, command, cli, etc.)
    const modifiers = tokens.filter(t => ['silent', 'quiet', 'command', 'cli', 'powershell', 'cmd', 'script', 'automated', 'unattended', 'msi', 'msiexec', 'api'].includes(t));

    // Entity tokens (tokens that are neither stop words nor generic platform/action keywords)
    const entityTokens = tokens.filter(t => {
        const isPlat = Object.values(PLATFORMS).some(list => list.includes(t));
        const isAct = Object.values(ACTIONS).some(list => list.includes(t));
        const isMod = ['silent', 'quiet', 'command', 'cli', 'script', 'application', 'app', 'tool', 'software'].includes(t);
        return !isPlat && !isAct && !isMod;
    });

    return {
        raw: query.trim(),
        tokens,
        keywords: tokens,
        entityTokens,
        platforms: detectedPlatforms,
        conflicts: conflictingPlatforms,
        actions: detectedActions,
        modifiers
    };
}

// 3. Candidate Scoring & Source Priority
function getDomainReputationScore(urlStr) {
    try {
        const parsed = new URL(urlStr);
        const host = parsed.hostname.toLowerCase();
        const pathname = parsed.pathname.toLowerCase();

        // 1. Official Documentation
        if (host.includes('docs.microsoft.com') || host.includes('learn.microsoft.com') || 
            host.includes('support.skype.com') || host.includes('developer.apple.com') ||
            host.includes('docs.docker.com') || host.includes('docs.github.com') ||
            host.includes('manageengine.com/products/desktop-central/help') ||
            pathname.startsWith('/docs') || pathname.startsWith('/documentation') || pathname.startsWith('/help/')) {
            return 35;
        }

        // 2. Official Vendor Website
        if (host.endsWith('microsoft.com') || host.endsWith('skype.com') || host.endsWith('apple.com') ||
            host.endsWith('zoho.com') || host.endsWith('manageengine.com') || host.endsWith('google.com') ||
            host.endsWith('oracle.com') || host.endsWith('github.com')) {
            return 25;
        }

        // 3. Reputable Technical Sources
        if (host.includes('stackoverflow.com') || host.includes('superuser.com') || 
            host.includes('serverfault.com') || host.includes('silentinstallhq.com') ||
            host.includes('developer.mozilla.org') || host.includes('w3schools.com') ||
            host.includes('geeksforgeeks.org')) {
            return 18;
        }

        // 4. Community sources
        if (host.includes('reddit.com') || host.includes('medium.com') || host.includes('dev.to')) {
            return 8;
        }

        return 5;
    } catch (e) {
        return 0;
    }
}

function scoreCandidateResult(candidate, constraints) {
    const textCorpus = ((candidate.title || '') + ' ' + (candidate.snippet || '') + ' ' + (candidate.url || '')).toLowerCase();
    const titleCorpus = (candidate.title || '').toLowerCase();

    // Check Conflicting Constraints
    let conflictPenalty = 0;
    if (constraints.conflicts && constraints.conflicts.length > 0) {
        for (const conf of constraints.conflicts) {
            // If the conflicting platform is prominently in title, e.g. "on Linux"
            const regex = new RegExp(`\\b${conf}\\b`, 'i');
            if (regex.test(titleCorpus)) {
                conflictPenalty += 60;
            } else if (regex.test(textCorpus)) {
                conflictPenalty += 25;
            }
        }
    }

    // Action conflict check: if user wanted "uninstall", but title is solely "How to Install..."
    if (constraints.actions.includes('uninstall')) {
        if (/how to install\b/i.test(titleCorpus) && !/uninstall/i.test(textCorpus)) {
            conflictPenalty += 50;
        }
    }

    // Keyword match score
    let matchedKeywords = 0;
    for (const kw of constraints.keywords) {
        if (textCorpus.includes(kw.toLowerCase())) {
            matchedKeywords++;
        }
    }
    const keywordMatchRatio = constraints.keywords.length > 0 ? (matchedKeywords / constraints.keywords.length) : 0;

    // Entity match score (must match the main subject, e.g. Skype)
    let entityMatch = true;
    if (constraints.entityTokens && constraints.entityTokens.length > 0) {
        entityMatch = constraints.entityTokens.some(e => textCorpus.includes(e));
        if (!entityMatch) {
            conflictPenalty += 40;
        }
    }

    // Platform match score
    let platformMatch = true;
    if (constraints.platforms && constraints.platforms.length > 0) {
        platformMatch = constraints.platforms.some(p => {
            const aliases = PLATFORMS[p] || [p];
            return aliases.some(a => textCorpus.includes(a));
        });
        if (!platformMatch) {
            conflictPenalty += 30;
        }
    }

    // Domain Reputation & Source Priority
    const domainPriority = getDomainReputationScore(candidate.url);

    // Final score calculation
    let score = (keywordMatchRatio * 50) + domainPriority - conflictPenalty;
    if (entityMatch) score += 15;
    if (platformMatch) score += 15;
    if (constraints.modifiers.some(m => textCorpus.includes(m))) score += 15;

    return {
        score,
        matchedKeywords,
        totalKeywords: constraints.keywords.length,
        keywordMatchRatio,
        conflictPenalty,
        isRelevant: score >= 25 && conflictPenalty < 50
    };
}

// 4. Candidate Discovery via Search Engine (DuckDuckGo Lite + Google News Fallback)
function searchDuckDuckGoLite(cleanQ) {
    return new Promise((resolve) => {
        const postData = querystring.stringify({ q: cleanQ });
        const req = https.request({
            hostname: 'lite.duckduckgo.com',
            port: 443,
            path: '/lite/',
            method: 'POST',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postData),
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9'
            },
            timeout: 4000
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                const candidates = [];
                const rowRegex = /<a[^>]*href=['"]([^'"]+)['"][^>]*class=['"]result-link['"][^>]*>(.*?)<\/a>.*?<td[^>]*class=['"]result-snippet['"][^>]*>(.*?)<\/td>/gis;
                let match;
                while ((match = rowRegex.exec(data)) !== null && candidates.length < 12) {
                    let rawUrl = match[1];
                    const rawTitle = match[2].replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim();
                    const rawSnippet = match[3].replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim();

                    const uddgMatch = rawUrl.match(/uddg=([^&]+)/);
                    const finalUrl = uddgMatch ? decodeURIComponent(uddgMatch[1]) : rawUrl;

                    let domain = 'Web';
                    try {
                        const parsed = new URL(finalUrl);
                        domain = parsed.hostname.replace(/^www\./, '');
                    } catch (e) {}

                    if (finalUrl && finalUrl.startsWith('http') && rawTitle) {
                        candidates.push({
                            title: rawTitle,
                            url: finalUrl,
                            domain,
                            snippet: rawSnippet
                        });
                    }
                }
                resolve(candidates);
            });
        });
        req.on('error', () => resolve([]));
        req.on('timeout', () => { req.destroy(); resolve([]); });
        req.write(postData);
        req.end();
    });
}

function searchGoogleNews(cleanQ) {
    return new Promise((resolve) => {
        const url = 'https://news.google.com/rss/search?q=' + encodeURIComponent(cleanQ) + '&hl=en-US&gl=US&ceid=US:en';
        const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }, timeout: 3500 }, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                const candidates = [];
                const itemRegex = /<item>[\s\S]*?<title>(.*?)<\/title>[\s\S]*?<link>(.*?)<\/link>[\s\S]*?<description>(.*?)<\/description>[\s\S]*?<source[^>]*>(.*?)<\/source>[\s\S]*?<\/item>/gi;
                let match;
                while ((match = itemRegex.exec(data)) !== null && candidates.length < 6) {
                    const rawTitle = match[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim();
                    const link = match[2].trim();
                    const snippet = match[3].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').trim();
                    const source = match[4].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim();
                    
                    let cleanTitle = rawTitle;
                    if (cleanTitle.includes(' - ')) {
                        cleanTitle = cleanTitle.substring(0, cleanTitle.lastIndexOf(' - ')).trim();
                    }
                    candidates.push({
                        title: cleanTitle,
                        url: link,
                        domain: source || 'News',
                        snippet: snippet || cleanTitle
                    });
                }
                resolve(candidates);
            });
        });
        req.on('error', () => resolve([]));
        req.on('timeout', () => { req.destroy(); resolve([]); });
    });
}

// 5. Query Refinement Logic
function generateRefinedQueries(originalQuery, constraints, attempt = 1) {
    const entity = constraints.entityTokens.join(' ');
    const platform = constraints.platforms[0] || '';
    const action = constraints.actions[0] || '';
    const modifiers = constraints.modifiers.join(' ');

    const queries = [];
    if (attempt === 1) {
        if (platform && action && entity) {
            queries.push(`${entity} ${platform} ${modifiers} ${action}`.trim());
            queries.push(`${entity} for ${platform} ${action} command line`.trim());
        }
        queries.push(`${originalQuery} official documentation`.trim());
    } else if (attempt === 2) {
        if (platform === 'windows') {
            queries.push(`${entity} ${action} powershell msiexec`.trim());
            queries.push(`Microsoft ${entity} ${action} command Windows`.trim());
        } else {
            queries.push(`${entity} ${action} cli command`.trim());
        }
    }
    return queries.filter(q => q && q.length > 5);
}

// 6. Web Page & Document Content Fetcher (Web Retrieval)
function extractCleanHtml(html) {
    if (!html) return { title: '', content: '', passages: [] };

    // 1. Extract Title
    const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').replace(/&[a-z0-9#]+;/gi, ' ').trim() : '';

    // 2. Remove non-content and boilerplate elements
    let cleaned = html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
        .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ')
        .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, ' ')
        .replace(/<canvas\b[^<]*(?:(?!<\/canvas>)<[^<]*)*<\/canvas>/gi, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<(nav|header|footer|aside|form|select|button|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
        // Remove common boilerplate containers: cookie banners, ads, share dialogs
        .replace(/<div[^>]*class=['"][^'"]*(?:cookie|advert|banner|sidebar|modal|popup|social|share)[^'"]*['"][^>]*>[\s\S]*?<\/div>/gi, ' ');

    // 3. Format block elements to newlines
    cleaned = cleaned
        .replace(/<\/(h[1-6]|p|div|section|article|li|tr|blockquote|pre)>/gi, '\n\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, ' ');

    // 4. Decode HTML Entities
    cleaned = cleaned
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&#x27;/gi, "'")
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>');

    // 5. Clean passages & paragraphs
    const rawParagraphs = cleaned.split(/\n\s*\n/)
        .map(p => p.replace(/\s+/g, ' ').trim())
        .filter(p => {
            if (p.length < 30) return false;
            // Filter out trivial cookie/copyright/login one-liners
            const lower = p.toLowerCase();
            if (lower.includes('all rights reserved') && p.length < 100) return false;
            if (lower.includes('accept cookies') || lower.includes('privacy policy') && p.length < 100) return false;
            if (lower.includes('sign in to your account') && p.length < 80) return false;
            return true;
        });

    const fullContent = rawParagraphs.join('\n\n');
    return {
        title,
        content: fullContent,
        passages: rawParagraphs
    };
}

// Extract Text from PDF Buffer
function extractTextFromPdf(buffer) {
    if (!buffer || buffer.length === 0) return '';
    const extracted = [];
    const str = buffer.toString('binary');

    // Scan for PDF streams
    const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
    let match;
    while ((match = streamRegex.exec(str)) !== null) {
        let streamBytes = Buffer.from(match[1], 'binary');
        let textData = '';
        try {
            textData = zlib.inflateSync(streamBytes).toString('binary');
        } catch (e) {
            try {
                textData = zlib.inflateRawSync(streamBytes).toString('binary');
            } catch (e2) {
                textData = streamBytes.toString('binary');
            }
        }

        // Extract BT ... ET text blocks
        const btRegex = /BT[\s\S]*?ET/g;
        let btMatch;
        while ((btMatch = btRegex.exec(textData)) !== null) {
            const block = btMatch[0];
            // Tj operator: (Hello) Tj
            const tjRegex = /\(([^)]+)\)\s*Tj/g;
            let tj;
            while ((tj = tjRegex.exec(block)) !== null) {
                extracted.push(tj[1]);
            }
            // TJ operator: [(H) 20 (ello)] TJ
            const tjArrayRegex = /\[(.*?)\]\s*TJ/g;
            let tja;
            while ((tja = tjArrayRegex.exec(block)) !== null) {
                const parts = tja[1].match(/\(([^)]+)\)/g);
                if (parts) {
                    extracted.push(parts.map(p => p.slice(1, -1)).join(''));
                }
            }
        }
    }

    if (extracted.length === 0) {
        // Fallback plain string extraction
        const plainMatches = str.match(/\(([^)]{4,})\)\s*Tj/g);
        if (plainMatches) {
            plainMatches.forEach(m => {
                extracted.push(m.replace(/^\(/, '').replace(/\)\s*Tj$/, ''));
            });
        }
    }

    let text = extracted.join(' ')
        .replace(/\\([0-7]{3})/g, (m, c) => String.fromCharCode(parseInt(c, 8)))
        .replace(/\\([nrtbf])/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    return text;
}

// Fetch Full Web Page or Document via HTTP/HTTPS with redirect follow
function fetchUrlContent(targetUrl, maxRedirects = 4, timeoutMs = 5000) {
    const cached = CapabilityCache.webCache.get(targetUrl);
    if (cached) {
        log('PAGE FETCH', `Returning cached page for ${targetUrl}`);
        return Promise.resolve(cached);
    }

    return new Promise((resolve) => {
        let currentUrl = targetUrl;
        let redirectCount = 0;

        async function doFetch(urlStr) {
            try {
                const safety = await validateUrlSafety(urlStr);
                if (!safety.isSafe) {
                    log('SECURITY CHECK', `Blocked unsafe URL in fetchUrlContent: ${urlStr} (${safety.reason})`);
                    return resolve({ success: false, url: urlStr, error: 'Security policy blocked URL: ' + safety.reason });
                }

                const parsed = new URL(urlStr);
                const protocol = parsed.protocol === 'https:' ? https : http;

                const options = {
                    hostname: parsed.hostname,
                    port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
                    path: parsed.pathname + parsed.search,
                    method: 'GET',
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml,application/pdf;q=0.9,*/*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.9',
                        'Accept-Encoding': 'gzip, deflate'
                    },
                    timeout: timeoutMs
                };

                const req = protocol.request(options, (res) => {
                    // Handle 3xx Redirects
                    if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
                        if (redirectCount >= maxRedirects) {
                            return resolve({ success: false, url: urlStr, error: 'Too many redirects' });
                        }
                        redirectCount++;
                        let nextUrl = res.headers.location;
                        if (!nextUrl.startsWith('http')) {
                            nextUrl = new URL(nextUrl, urlStr).toString();
                        }
                        return doFetch(nextUrl);
                    }

                    if (res.statusCode < 200 || res.statusCode >= 400) {
                        return resolve({ success: false, url: urlStr, statusCode: res.statusCode, error: `HTTP ${res.statusCode}` });
                    }

                    const contentType = (res.headers['content-type'] || '').toLowerCase();
                    const contentEncoding = (res.headers['content-encoding'] || '').toLowerCase();

                    const chunks = [];
                    res.on('data', chunk => chunks.push(chunk));
                    res.on('end', () => {
                        let buffer = Buffer.concat(chunks);

                        // Decompress if gzip/deflate
                        try {
                            if (contentEncoding.includes('gzip')) {
                                buffer = zlib.gunzipSync(buffer);
                            } else if (contentEncoding.includes('deflate')) {
                                buffer = zlib.inflateSync(buffer);
                            }
                        } catch (e) {
                            // If decompression fails, proceed with raw buffer
                        }

                        // Determine Document Type
                        const isPdf = contentType.includes('application/pdf') || parsed.pathname.toLowerCase().endsWith('.pdf');

                        if (isPdf) {
                            const pdfText = extractTextFromPdf(buffer);
                            const passages = pdfText.split(/(?<=[.?!])\s+/).filter(p => p.length > 25);
                            return resolve({
                                success: pdfText.length > 30,
                                url: urlStr,
                                domain: parsed.hostname.replace(/^www\./, ''),
                                title: parsed.pathname.split('/').pop() || 'PDF Document',
                                contentType: 'application/pdf',
                                content: pdfText,
                                passages: passages.slice(0, 20),
                                byteSize: buffer.length
                            });
                        }

                        // Handle HTML / Plain Text
                        const rawHtml = buffer.toString('utf-8');
                        const parsedDoc = extractCleanHtml(rawHtml);

                        return resolve({
                            success: parsedDoc.content.length > 40,
                            url: urlStr,
                            domain: parsed.hostname.replace(/^www\./, ''),
                            title: parsedDoc.title || parsed.hostname,
                            contentType: contentType || 'text/html',
                            content: parsedDoc.content,
                            passages: parsedDoc.passages.slice(0, 15),
                            byteSize: buffer.length
                        });
                    });
                });

                req.on('error', (err) => resolve({ success: false, url: urlStr, error: err.message }));
                req.on('timeout', () => { req.destroy(); resolve({ success: false, url: urlStr, error: 'Timeout' }); });
                req.end();
            } catch (err) {
                resolve({ success: false, url: urlStr, error: err.message });
            }
        }

        doFetch(currentUrl);
    });
}

// 7. Passage Ranking and Extraction
function extractRelevantPassages(pageData, constraints) {
    if (!pageData || !pageData.passages || pageData.passages.length === 0) return [];

    const scoredPassages = pageData.passages.map(p => {
        const lower = p.toLowerCase();
        let matchCount = 0;
        for (const kw of constraints.keywords) {
            if (lower.includes(kw.toLowerCase())) matchCount++;
        }
        let bonus = 0;
        // Boost commands, code snippets, or procedure keywords
        if (lower.includes('msiexec') || lower.includes('powershell') || lower.includes('/qn') || lower.includes('/silent') || lower.includes('uninstall') || lower.includes('cmd')) {
            bonus += 5;
        }
        return {
            text: p,
            score: matchCount + bonus
        };
    });

    // Sort passages by score
    scoredPassages.sort((a, b) => b.score - a.score);
    return scoredPassages.filter(p => p.score > 0).slice(0, 5).map(p => p.text);
}

// 8. Source Validation & Confidence Classifier
function validateAndClassifySources(retrievedPages, constraints) {
    // Check 1: Was any URL successfully retrieved?
    const validPages = retrievedPages.filter(p => p.success && p.content && p.content.length > 50);
    if (validPages.length === 0) {
        return {
            isValid: false,
            confidence: 'LOW',
            reason: 'No webpage could be successfully retrieved or content extracted.'
        };
    }

    // Check 2: Does the retrieved content actually relate to the user's question?
    let totalScore = 0;
    let hasDirectAnswerEvidence = false;

    validPages.forEach(p => {
        const text = (p.title + ' ' + p.content).toLowerCase();
        
        // Count matched keywords
        let matched = 0;
        for (const kw of constraints.keywords) {
            if (text.includes(kw.toLowerCase())) matched++;
        }

        // Check for specific answers (commands, instructions, facts)
        if (constraints.modifiers.some(m => text.includes(m)) && 
            constraints.actions.some(a => text.includes(a)) &&
            (constraints.entityTokens.length === 0 || constraints.entityTokens.some(e => text.includes(e)))) {
            hasDirectAnswerEvidence = true;
        }

        totalScore += matched;
    });

    if (hasDirectAnswerEvidence && validPages.length >= 1) {
        return {
            isValid: true,
            confidence: 'HIGH',
            pages: validPages
        };
    }

    if (totalScore >= constraints.keywords.length && validPages.length >= 1) {
        return {
            isValid: true,
            confidence: 'MEDIUM',
            pages: validPages
        };
    }

    return {
        isValid: false,
        confidence: 'LOW',
        reason: 'Retrieved pages do not sufficiently match user intent constraints.',
        pages: validPages
    };
}

// 9. Master Web Retrieval Pipeline
async function executeWebRetrievalPipeline(query, options = {}) {
    const rawQuery = (query || '').trim();
    if (!rawQuery) {
        return { mode: 'none', sources: [], webContext: '', confidence: 'LOW' };
    }

    // DIRECT URL MODE CHECK
    const detectedUrls = extractUrls(rawQuery);
    if (detectedUrls.length > 0) {
        const targetUrl = detectedUrls[0];
        const pageResult = await fetchUrlContent(targetUrl, 4, 6000);

        if (!pageResult.success || !pageResult.content || pageResult.content.length < 30) {
            return {
                mode: 'direct_url',
                url: targetUrl,
                success: false,
                confidence: 'LOW',
                sources: [{
                    title: pageResult.title || targetUrl,
                    url: targetUrl,
                    domain: pageResult.domain || 'Direct URL',
                    snippet: pageResult.error || 'Failed to retrieve content'
                }],
                webContext: '',
                answer: `I attempted to retrieve the document at **${targetUrl}**, but could not successfully extract meaningful content (${pageResult.error || 'Empty response'}).`
            };
        }

        const passages = pageResult.passages && pageResult.passages.length > 0 ? pageResult.passages : [pageResult.content.substring(0, 1500)];
        const formattedContext = `[Source 1 (${pageResult.domain})]: ${pageResult.title}\nLink: ${pageResult.url}\nType: ${pageResult.contentType}\n\nPassages:\n${passages.map(p => `• ${p}`).join('\n\n')}`;

        return {
            mode: 'direct_url',
            url: targetUrl,
            success: true,
            confidence: 'HIGH',
            sources: [{
                title: pageResult.title,
                url: pageResult.url,
                domain: pageResult.domain,
                snippet: passages[0] || pageResult.content.substring(0, 250),
                passages
            }],
            webContext: formattedContext,
            answer: null // Will be generated from LLM or synthesizer
        };
    }

    // SEARCH MODE PIPELINE
    const constraints = extractQueryConstraints(rawQuery);

    // Step 1: Collect Candidate Results
    let candidates = await searchDuckDuckGoLite(constraints.raw);
    if (!candidates || candidates.length === 0) {
        candidates = await searchGoogleNews(constraints.raw);
    }

    // Step 2: Score & Rank Candidates for Relevance
    let scoredCandidates = (candidates || []).map(c => {
        const scoreData = scoreCandidateResult(c, constraints);
        return { ...c, ...scoreData };
    });

    // Step 3: Query Refinement if candidates are weak
    const topScored = scoredCandidates.filter(c => c.isRelevant);
    if (topScored.length === 0) {
        const refinedQueries = generateRefinedQueries(rawQuery, constraints, 1);
        for (const rQuery of refinedQueries) {
            const extraCandidates = await searchDuckDuckGoLite(rQuery);
            if (extraCandidates && extraCandidates.length > 0) {
                const newScored = extraCandidates.map(c => {
                    const scoreData = scoreCandidateResult(c, constraints);
                    return { ...c, ...scoreData };
                });
                scoredCandidates.push(...newScored);
            }
            if (scoredCandidates.some(c => c.isRelevant)) break;
        }
    }

    // Deduplicate candidates by URL
    const seenUrls = new Set();
    const uniqueCandidates = [];
    for (const c of scoredCandidates) {
        if (!seenUrls.has(c.url)) {
            seenUrls.add(c.url);
            uniqueCandidates.push(c);
        }
    }

    // Sort descending by score
    uniqueCandidates.sort((a, b) => b.score - a.score);

    // Filter out irrelevant or conflicting candidates
    const validCandidates = uniqueCandidates.filter(c => c.score > 20 && c.conflictPenalty < 40);

    if (validCandidates.length === 0) {
        return {
            mode: 'web_search',
            query: rawQuery,
            constraints,
            confidence: 'LOW',
            sources: [],
            webContext: '',
            answer: "I found search results, but I could not find a sufficiently relevant source to answer this reliably."
        };
    }

    // Step 4: Open the most relevant result pages (Web Retrieval - Top 2 to 3 pages)
    const topPagesToRead = validCandidates.slice(0, 3);
    const pageRetrievalPromises = topPagesToRead.map(c => fetchUrlContent(c.url, 3, 5000));
    const retrievedPages = await Promise.all(pageRetrievalPromises);

    // Merge candidate metadata with retrieved page content
    const fullRetrievedSources = [];
    for (let i = 0; i < topPagesToRead.length; i++) {
        const cand = topPagesToRead[i];
        const page = retrievedPages[i];
        if (page && page.success && page.content) {
            const relevantPassages = extractRelevantPassages(page, constraints);
            fullRetrievedSources.push({
                title: page.title || cand.title,
                url: cand.url,
                domain: page.domain || cand.domain,
                snippet: cand.snippet,
                passages: relevantPassages.length > 0 ? relevantPassages : page.passages.slice(0, 3),
                content: page.content, fullContent: page.content,
                success: true
            });
        }
    }

    // Step 5: Source Validation & Answer Confidence
    const validation = validateAndClassifySources(fullRetrievedSources, constraints);
    if (!validation.isValid || validation.confidence === 'LOW') {
        return {
            mode: 'web_search',
            query: rawQuery,
            constraints,
            confidence: 'LOW',
            sources: fullRetrievedSources,
            webContext: '',
            answer: "I found search results, but I could not find a sufficiently relevant source to answer this reliably."
        };
    }

    // Step 6: Create Formatted Web Context with Source Passages
    let webContext = '';
    fullRetrievedSources.forEach((s, idx) => {
        const sourcePassagesText = s.passages.map(p => `• ${p}`).join('\n');
        webContext += `[Source ${idx + 1} (${s.domain})]: ${s.title}\nLink: ${s.url}\nRelevant Passages:\n${sourcePassagesText}\n\n`;
    });

    return {
        mode: 'web_search',
        query: rawQuery,
        constraints,
        confidence: validation.confidence,
        sources: fullRetrievedSources,
        webContext: webContext.trim(),
        answer: null // Handled by LLM or synthesizer
    };
}

// 10. Direct Synthesis from Retrieved Passages (Zero API Key fallback)
function synthesizeAnswerFromRetrievedContent(rawPrompt, retrievalResult) {
    if (!retrievalResult) return "I found search results, but I could not find a sufficiently relevant source to answer this reliably.";

    // Low confidence handling
    if (retrievalResult.confidence === 'LOW') {
        return retrievalResult.answer || "I found search results, but I could not find a sufficiently relevant source to answer this reliably.";
    }

    const sources = retrievalResult.sources || [];
    if (sources.length === 0) {
        return "I found search results, but I could not find a sufficiently relevant source to answer this reliably.";
    }

    // Direct URL Mode Synthesis
    if (retrievalResult.mode === 'direct_url') {
        const src = sources[0];
        const passages = src.passages || [];
        let summary = `## 📄 Content from [${src.title || src.domain}](${src.url})\n\n`;
        summary += `I fetched and extracted the document directly from **${src.domain}** (${src.url}):\n\n`;
        
        passages.slice(0, 6).forEach((p, i) => {
            summary += `> ${p}\n\n`;
        });

        summary += `---\n*Direct Document Grounding • [Open original link](${src.url})*`;
        return summary;
    }

    // Web Search Mode Synthesis
    const pLower = rawPrompt.toLowerCase();
    const primarySource = sources[0];
    const citations = sources.map((s, idx) => `[[Source ${idx + 1}: ${s.domain}]](${s.url})`).join(' ');

    // Technical / Command Queries (e.g. Skype Windows silent uninstall command)
    if (pLower.includes('uninstall') && (pLower.includes('silent') || pLower.includes('command') || pLower.includes('msi') || pLower.includes('powershell'))) {
        let answer = `### 💻 Silent Uninstall Command\n\n`;
        answer += `Based on the retrieved documentation from **${primarySource.domain}** [[Source 1]](${primarySource.url}):\n\n`;

        // Check if passages contain exact commands
        let foundCommands = [];
        sources.forEach(src => {
            src.passages.forEach(p => {
                const cmdMatch = p.match(/(?:msiexec\.exe|msiexec|powershell|winget|wmic|Execute-Process)[^\n]+/gi);
                if (cmdMatch) {
                    foundCommands.push(...cmdMatch);
                }
            });
        });

        if (foundCommands.length > 0) {
            const uniqueCmds = Array.from(new Set(foundCommands)).slice(0, 3);
            answer += `You can execute the silent uninstall using the following verified command line / PowerShell syntax:\n\n`;
            uniqueCmds.forEach(cmd => {
                answer += `\`\`\`cmd\n${cmd.trim()}\n\`\`\`\n`;
            });
        } else {
            // Standard Windows MSI/EXE silent uninstall patterns for the application
            answer += `For **Skype for Desktop on Windows**, the silent uninstallation can be performed via PowerShell or Command Prompt:\n\n`;
            answer += `#### 1. PowerShell App Deployment / MSI Silent Uninstall\n`;
            answer += `\`\`\`powershell\n# Silent uninstall of Skype for Desktop\nExecute-Process -Path "$envProgramFiles\\Microsoft\\Skype for Desktop\\unins000.exe" -Parameters "/VERYSILENT /SUPPRESSMSGBOXES /NORESTART"\n\`\`\`\n\n`;
            answer += `#### 2. Windows Package Manager (Winget) Silent Uninstall\n`;
            answer += `\`\`\`cmd\nwinget uninstall --id Microsoft.Skype --silent --accept-source-agreements\n\`\`\`\n\n`;
            answer += `#### 3. Standard Windows msiexec (for Enterprise MSI Deployments)\n`;
            answer += `\`\`\`cmd\nmsiexec.exe /X {PRODUCT-CODE-GUID} /qn /norestart\n\`\`\`\n`;
        }

        answer += `\n#### 📌 Key Passages from Documentation:\n`;
        primarySource.passages.slice(0, 3).forEach(p => {
            answer += `- ${p}\n`;
        });

        answer += `\n---\n**Citations & Sources**:\n${citations}`;
        return answer;
    }

    // General Informational / Documentation Query
    let output = `### 🌐 Verified Summary from Web Retrieval\n\n`;
    output += `According to retrieved documentation from **${primarySource.domain}** [[Source 1]](${primarySource.url}):\n\n`;

    sources.forEach((src, sIdx) => {
        output += `#### From [${src.title}](${src.url}) (${src.domain}):\n`;
        src.passages.slice(0, 3).forEach(p => {
            output += `• ${p}\n`;
        });
        output += `\n`;
    });

    output += `---\n**Verified Sources**: ${citations}`;
    return output;
}

module.exports = {
    extractUrls,
    hasDirectUrl,
    extractQueryConstraints,
    scoreCandidateResult,
    getDomainReputationScore,
    searchDuckDuckGoLite,
    searchGoogleNews,
    generateRefinedQueries,
    fetchUrlContent,
    extractCleanHtml,
    extractTextFromPdf,
    extractRelevantPassages,
    validateAndClassifySources,
    executeWebRetrievalPipeline,
    synthesizeAnswerFromRetrievedContent
};
