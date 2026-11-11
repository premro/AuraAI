/**
 * AuraAI Hybrid RAG (Retrieval-Augmented Generation) & Conversation Source Registry
 * Handles chunk indexing, semantic & BM25 hybrid retrieval, heading relevance,
 * exact phrase matching, reranking, and multi-turn document & web memory.
 */

const { log } = require('./logger');
const { chunkDocument } = require('./documentProcessor');
const conversationState = require('./conversationState');

class RAGEngine {
    constructor() {
        // conversationId -> { documents: Map(docId -> doc), sources: Map(url -> source), chunks: Array }
        this.registries = new Map();
    }

    getRegistry(conversationId = 'default') {
        if (!this.registries.has(conversationId)) {
            this.registries.set(conversationId, {
                documents: new Map(),
                sources: new Map(),
                chunks: []
            });
        }
        return this.registries.get(conversationId);
    }

    registerDocument(doc, conversationId = 'default') {
        const reg = this.getRegistry(conversationId);
        reg.documents.set(doc.id, doc);

        // Chunk and index with full metadata
        const chunks = chunkDocument(doc);
        reg.chunks.push(...chunks);

        conversationState.setActiveDocument(conversationId, doc.filename);

        log('DOCUMENT PARSE', `Registered document "${doc.filename}" (ID: ${doc.id}) in conversation "${conversationId}"`, {
            totalChunks: chunks.length,
            totalPages: doc.totalPages
        });

        return doc;
    }

    registerWebSource(sourceData, conversationId = 'default') {
        const reg = this.getRegistry(conversationId);
        const sourceId = 'src_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
        
        const sourceEntry = {
            sourceId,
            url: sourceData.url,
            title: sourceData.title || sourceData.domain || 'Retrieved Webpage',
            domain: sourceData.domain || 'Web',
            content: sourceData.content || '',
            passages: sourceData.passages || [],
            quality: sourceData.quality || 'HIGH',
            retrievalTime: Date.now()
        };

        reg.sources.set(sourceData.url, sourceEntry);
        conversationState.setActiveUrl(conversationId, sourceData.url);

        // Chunk and index web passages for cross-turn conversational follow-up
        if (sourceData.passages && sourceData.passages.length > 0) {
            sourceData.passages.forEach((p, idx) => {
                const tokenCount = Math.ceil(p.length / 4);
                reg.chunks.push({
                    id: `${sourceId}_chunk_${idx}`,
                    documentId: sourceId,
                    docId: sourceId,
                    filename: sourceEntry.title,
                    url: sourceEntry.url,
                    domain: sourceEntry.domain,
                    isWebSource: true,
                    page: 1,
                    section: 'Web Content',
                    heading: sourceEntry.title,
                    title: sourceEntry.title,
                    text: p,
                    tokenCount
                });
            });
        }

        log('SOURCE STORED', `Registered web source "${sourceEntry.title}" in conversation "${conversationId}"`, {
            url: sourceEntry.url,
            passagesCount: sourceEntry.passages.length,
            totalChunks: reg.chunks.length
        });

        return sourceEntry;
    }

    getActiveSources(conversationId = 'default') {
        const reg = this.getRegistry(conversationId);
        return Array.from(reg.sources.values());
    }

    hasActiveSources(conversationId = 'default') {
        const reg = this.getRegistry(conversationId);
        return reg.sources.size > 0;
    }

    getDocuments(conversationId = 'default') {
        const reg = this.getRegistry(conversationId);
        return Array.from(reg.documents.values());
    }

    hasActiveDocuments(conversationId = 'default') {
        const reg = this.getRegistry(conversationId);
        return reg.documents.size > 0;
    }

    // Tokenize text for BM25 and term matching
    tokenize(text) {
        if (!text) return [];
        return text.toLowerCase()
            .replace(/[^\w\s\.-]/g, ' ')
            .split(/\s+/)
            .filter(t => t.length > 1);
    }

    // Hybrid Retrieval: BM25/keyword + heading relevance + exact phrase + metadata filtering + reranking
    retrieve(query, conversationId = 'default', topK = 5) {
        const reg = this.getRegistry(conversationId);
        if (reg.chunks.length === 0) {
            return { passages: [], confidence: 'LOW', totalDocs: 0, totalSources: 0 };
        }

        const qTokens = this.tokenize(query);
        const qLower = query.toLowerCase();

        // Check if query targets a specific page: "page 5", "page 2", etc.
        const pageMatch = qLower.match(/\bpage\s+(\d+)\b/i);
        const targetPage = pageMatch ? parseInt(pageMatch[1], 10) : null;

        log('HYBRID RETRIEVAL', `Retrieving context for query: "${query}"`, {
            conversationId,
            targetPage,
            totalIndexedChunks: reg.chunks.length
        });

        const scoredChunks = reg.chunks.map(chunk => {
            let score = 0;
            const cLower = chunk.text.toLowerCase();
            const headingLower = (chunk.heading || chunk.title || '').toLowerCase();
            const sectionLower = (chunk.section || '').toLowerCase();

            // 1. Direct page match bonus (Metadata Filtering)
            if (targetPage !== null && chunk.page === targetPage) {
                score += 50;
            }

            // 2. Exact phrase match bonus
            if (qLower.length > 5 && cLower.includes(qLower)) {
                score += 25;
            }

            // 3. Heading and section relevance
            qTokens.forEach(token => {
                if (headingLower.includes(token)) score += 12;
                if (sectionLower.includes(token)) score += 8;
            });

            // 4. BM25 / Keyword matching & Term frequency
            let matchedTokens = 0;
            qTokens.forEach(token => {
                if (cLower.includes(token)) {
                    matchedTokens++;
                    score += 6;
                    // Exact word boundary match bonus
                    const regex = new RegExp(`\\b${token}\\b`, 'i');
                    if (regex.test(chunk.text)) {
                        score += 4;
                    }
                }
            });

            // 5. Query Coverage Bonus (proportion of query words found)
            if (qTokens.length > 0) {
                const coverage = matchedTokens / qTokens.length;
                score += (coverage * 15);
            }

            // 6. Action / Step / Command words bonus for procedural queries
            if (qLower.includes('step') || qLower.includes('how') || qLower.includes('command') || qLower.includes('instruction')) {
                if (cLower.includes('step') || cLower.includes('1.') || cLower.includes('2.') || cLower.includes('follow') || cLower.includes('configure') || cLower.includes('powershell') || cLower.includes('exe')) {
                    score += 10;
                }
            }

            // 7. Source Authority Bonus (Official vendor sources get a small boost)
            if (chunk.url && (chunk.url.includes('manageengine.com') || chunk.url.includes('microsoft.com') || chunk.url.includes('github.com'))) {
                score += 5;
            }

            // Length normalization to prevent long text bias
            const normScore = score / (1 + Math.log(chunk.text.length / 200 + 1));
            return { ...chunk, score: normScore };
        });

        // Rerank by score descending
        scoredChunks.sort((a, b) => b.score - a.score);
        const topChunks = scoredChunks.filter(c => c.score > 0).slice(0, topK);

        let confidence = 'LOW';
        if (topChunks.length > 0) {
            const bestScore = topChunks[0].score;
            if (bestScore > 15 || (targetPage && topChunks[0].page === targetPage)) {
                confidence = 'HIGH';
            } else if (bestScore > 4) {
                confidence = 'MEDIUM';
            }
        }

        log('HYBRID RETRIEVAL', `Found ${topChunks.length} matching passages`, { confidence });

        return {
            passages: topChunks,
            confidence,
            totalDocs: reg.documents.size,
            totalSources: reg.sources.size
        };
    }

    formatContextString(retrievalResult) {
        if (!retrievalResult.passages || retrievalResult.passages.length === 0) return '';
        return retrievalResult.passages.map((p, idx) => {
            if (p.isWebSource) {
                return `[Source ${idx + 1} | Webpage: ${p.filename} | ${p.url}]:\n${p.text}`;
            }
            return `[Passage ${idx + 1} | Doc: ${p.filename}, Page ${p.page} | Section: ${p.section || p.heading}]:\n${p.text}`;
        }).join('\n\n');
    }
}

const ragInstance = new RAGEngine();

module.exports = ragInstance;
