/**
 * AuraAI Common Tool Interface
 * Defines model-independent tool execution layer.
 */

const { log } = require('./logger');
const webRetrieval = require('./webRetrieval');
const ragEngine = require('./ragEngine');
const { generateImage } = require('./modelRegistry');

// Safe mathematical calculator
function calculateMath(expression) {
    try {
        const cleaned = (expression || '').replace(/^(?:calculate|compute|solve|eval|what is)\s+/i, '').trim();
        const sanitized = cleaned.replace(/[^0-9+\-*\/().^% \t]/g, '');
        if (!sanitized) return null;
        // Evaluate power symbol ^
        const jsExpr = sanitized.replace(/\^/g, '**');
        // Safe evaluation with Function
        const result = Function(`"use strict"; return (${jsExpr})`)();
        if (typeof result === 'number' && !isNaN(result) && isFinite(result)) {
            return result;
        }
        return null;
    } catch (e) {
        return null;
    }
}

const TOOLS = {
    searchWeb: {
        name: 'searchWeb',
        description: 'Searches the live web and reads top relevant pages to return verified passages and citations.',
        parameters: { query: 'string' },
        execute: async ({ query }) => {
            log('WEB SEARCH', `Executing searchWeb tool: "${query}"`);
            return await webRetrieval.executeWebRetrievalPipeline(query);
        }
    },
    readUrl: {
        name: 'readUrl',
        description: 'Reads and extracts clean document content directly from a specified URL.',
        parameters: { url: 'string' },
        execute: async ({ url }) => {
            log('PAGE FETCH', `Executing readUrl tool: "${url}"`);
            return await webRetrieval.executeWebRetrievalPipeline(url);
        }
    },
    retrieveContext: {
        name: 'retrieveContext',
        description: 'Retrieves relevant sections and pages from conversation documents using semantic RAG.',
        parameters: { query: 'string', conversationId: 'string' },
        execute: async ({ query, conversationId }) => {
            log('RETRIEVAL', `Executing retrieveContext tool: "${query}"`);
            const result = ragEngine.retrieve(query, conversationId);
            return {
                passages: result.passages,
                confidence: result.confidence,
                formattedContext: ragEngine.formatContextString(result)
            };
        }
    },
    generateImage: {
        name: 'generateImage',
        description: 'Generates a high-resolution image using the diffusion engine.',
        parameters: { prompt: 'string', context: 'string' },
        execute: async ({ prompt, context }) => {
            log('IMAGE GENERATION', `Executing generateImage tool: "${prompt}"`);
            return generateImage(prompt, context);
        }
    },
    calculate: {
        name: 'calculate',
        description: 'Calculates mathematical expressions with numerical precision.',
        parameters: { expression: 'string' },
        execute: async ({ expression }) => {
            log('CALCULATION', `Executing calculate tool: "${expression}"`);
            const val = calculateMath(expression);
            return { expression, result: val };
        }
    }
};

async function executeTool(toolName, args = {}) {
    const tool = TOOLS[toolName];
    if (!tool) {
        throw new Error(`Tool "${toolName}" is not registered.`);
    }
    return await tool.execute(args);
}

module.exports = {
    TOOLS,
    executeTool,
    calculateMath
};
