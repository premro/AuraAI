/**
 * AuraAI RAG (Retrieval-Augmented Generation) & Conversation Source Registry
 * Handles chunk indexing, semantic retrieval, page-level query routing, and multi-turn document memory.
 */

const { log } = require('./logger');
const { chunkDocument } = require('./documentProcessor');

class RAGEngine {
    constructor() {
        // conversationId -> { documents: Map(docId -> doc), chunks: Array }
        this.registries = new Map();
    }

    getRegistry(conversationId = 'default') {
        if (!this.registries.has(conversationId)) {
            this.registries.set(conversationId, {
                documents: new Map(),
                chunks: []
            });
        }
        return this.registries.get(conversationId);
    }

    registerDocument(doc, conversationId = 'default') {
        const reg = this.getRegistry(conversationId);
        reg.documents.set(doc.id, doc);

        // Chunk and index
        const chunks = chunkDocument(doc);
        reg.chunks.push(...chunks);

        log('DOCUMENT PARSE', `Registered document "${doc.filename}" (ID: ${doc.id}) in conversation "${conversationId}"`, {
            totalChunks: chunks.length,
            totalPages: doc.totalPages
        });

        return doc;
    }

    getDocuments(conversationId = 'default') {
        const reg = this.getRegistry(conversationId);
        return Array.from(reg.documents.values());
    }

    // Tokenize text for BM25 and term matching
    tokenize(text) {
        if (!text) return [];
        return text.toLowerCase()
            .replace(/[^\w\s\.-]/g, ' ')
            .split(/\s+/)
            .filter(t => t.length > 1);
    }

    // Retrieve relevant passages
    retrieve(query, conversationId = 'default', topK = 4) {
        const reg = this.getRegistry(conversationId);
        if (reg.chunks.length === 0) {
            return { passages: [], confidence: 'LOW', totalDocs: 0 };
        }

        const qTokens = this.tokenize(query);
        const qLower = query.toLowerCase();

        // Check if query is targeting a specific page: "page 7", "page 12", etc.
        const pageMatch = qLower.match(/\bpage\s+(\d+)\b/i);
        const targetPage = pageMatch ? parseInt(pageMatch[1], 10) : null;

        log('RETRIEVAL', `Retrieving context for query: "${query}"`, {
            conversationId,
            targetPage,
            totalIndexedChunks: reg.chunks.length
        });

        const scoredChunks = reg.chunks.map(chunk => {
            let score = 0;
            const cLower = chunk.text.toLowerCase();

            // Direct page match bonus
            if (targetPage !== null && chunk.page === targetPage) {
                score += 50;
            }

            // Keyword matching & Term frequency
            qTokens.forEach(token => {
                if (cLower.includes(token)) {
                    score += 5;
                    // Exact word match bonus
                    const regex = new RegExp(`\\b${token}\\b`, 'i');
                    if (regex.test(chunk.text)) {
                        score += 3;
                    }
                }
                if (chunk.title && chunk.title.toLowerCase().includes(token)) {
                    score += 8;
                }
            });

            // Length normalization
            const normScore = score / (1 + Math.log(chunk.text.length / 200 + 1));
            return { ...chunk, score: normScore };
        });

        scoredChunks.sort((a, b) => b.score - a.score);
        const topChunks = scoredChunks.filter(c => c.score > 0).slice(0, topK);

        let confidence = 'LOW';
        if (topChunks.length > 0) {
            const bestScore = topChunks[0].score;
            if (bestScore > 15 || (targetPage && topChunks[0].page === targetPage)) {
                confidence = 'HIGH';
            } else if (bestScore > 5) {
                confidence = 'MEDIUM';
            }
        }

        log('RETRIEVAL', `Found ${topChunks.length} matching passages`, { confidence });

        return {
            passages: topChunks,
            confidence,
            totalDocs: reg.documents.size
        };
    }

    formatContextString(retrievalResult) {
        if (!retrievalResult.passages || retrievalResult.passages.length === 0) return '';
        return retrievalResult.passages.map((p, idx) => {
            return `[Passage ${idx + 1} | Doc: ${p.filename}, Page ${p.page} | ${p.title}]:\n${p.text}`;
        }).join('\n\n');
    }
}

const ragInstance = new RAGEngine();

module.exports = ragInstance;
