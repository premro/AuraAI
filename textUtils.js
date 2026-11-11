/**
 * AuraAI Text & Result Normalization Utilities
 * Enforces strict data contracts across the entire pipeline:
 * web retrieval -> orchestrator -> context builder -> LLM -> UI.
 *
 * Guarantees that any text operation (including .split, .replace, .trim)
 * always receives a valid, sanitized string and never throws TypeError.
 */

/**
 * Universal text normalizer.
 * Safely extracts or converts any data structure into a clean string.
 *
 * @param {*} value - Any value (string, object, array, null, undefined, Error, etc.)
 * @returns {string} Guaranteed string representation
 */
function normalizeText(value) {
    if (typeof value === 'string') {
        return value;
    }

    if (value === null || value === undefined) {
        return '';
    }

    if (Array.isArray(value)) {
        return value
            .map(item => normalizeText(item))
            .filter(Boolean)
            .join('\n');
    }

    if (typeof value === 'object') {
        // Common string container keys across the application
        if (typeof value.text === 'string') {
            return value.text;
        }
        if (typeof value.content === 'string') {
            return value.content;
        }
        if (typeof value.response === 'string') {
            return value.response;
        }
        if (typeof value.message === 'string') {
            return value.message;
        }
        if (typeof value.extract === 'string') {
            return value.extract;
        }
        if (typeof value.snippet === 'string') {
            return value.snippet;
        }
        if (typeof value.summary === 'string') {
            return value.summary;
        }

        // Nested objects with text/response properties
        if (value.response && typeof value.response === 'object') {
            return normalizeText(value.response);
        }
        if (value.data && typeof value.data === 'object') {
            return normalizeText(value.data);
        }

        // If Error instance
        if (value instanceof Error) {
            return value.message || 'An error occurred';
        }

        // Safe JSON serialization fallback
        try {
            return JSON.stringify(value);
        } catch (_) {
            return String(value);
        }
    }

    return String(value);
}

/**
 * Standard Internal Result Formats
 */

function createWebResult(options = {}) {
    const text = normalizeText(options.text || options.content || '');
    const title = normalizeText(options.title || 'Web Source');
    const url = normalizeText(options.url || '');
    const domain = normalizeText(options.domain || (url ? new URL(url).hostname : 'web'));
    const sourceType = normalizeText(options.sourceType || 'web');
    const confidence = normalizeText(options.confidence || 'medium');
    const citations = Array.isArray(options.citations) ? options.citations.map(c => ({
        title: normalizeText(c.title || title),
        url: normalizeText(c.url || url),
        domain: normalizeText(c.domain || domain),
        snippet: normalizeText(c.snippet || '')
    })) : (url ? [{ title, url, domain }] : []);

    return {
        type: 'web',
        text,
        title,
        url,
        domain,
        sourceType,
        confidence,
        citations,
        sources: options.sources || citations
    };
}

function createDocumentResult(options = {}) {
    const text = normalizeText(options.text || options.content || '');
    const filename = normalizeText(options.filename || options.title || 'Document');
    const pages = Array.isArray(options.pages) ? options.pages : [];
    const citations = Array.isArray(options.citations) ? options.citations : [{ title: filename, page: options.page || 1 }];

    return {
        type: 'document',
        text,
        filename,
        pages,
        citations,
        chunksCount: options.chunksCount || 0
    };
}

function createImageResult(options = {}) {
    return {
        type: 'image',
        analysis: normalizeText(options.analysis || options.text || ''),
        metadata: options.metadata || {},
        imageUrl: options.imageUrl || null
    };
}

function createCalculationResult(options = {}) {
    return {
        type: 'calculation',
        expression: normalizeText(options.expression || ''),
        result: normalizeText(options.result || options.value || '')
    };
}

function createTechnicalResult(options = {}) {
    return {
        type: 'technical',
        product: normalizeText(options.product || ''),
        module: normalizeText(options.module || ''),
        topic: normalizeText(options.topic || ''),
        intent: normalizeText(options.intent || ''),
        text: normalizeText(options.text || options.answer || ''),
        citations: Array.isArray(options.citations) ? options.citations : []
    };
}

/**
 * Normalizes any tool result into a standard structure with guaranteed text string.
 */
function normalizeToolResult(result) {
    if (!result) {
        return {
            type: 'empty',
            text: ''
        };
    }

    if (typeof result === 'string') {
        return {
            type: 'text',
            text: result
        };
    }

    if (result.type === 'web') return createWebResult(result);
    if (result.type === 'document') return createDocumentResult(result);
    if (result.type === 'image') return createImageResult(result);
    if (result.type === 'calculation') return createCalculationResult(result);
    if (result.type === 'technical') return createTechnicalResult(result);

    // Fallback normalization
    return {
        type: result.type || 'generic',
        text: normalizeText(result.text || result.content || result.response || result),
        ...result
    };
}

module.exports = {
    normalizeText,
    createWebResult,
    createDocumentResult,
    createImageResult,
    createCalculationResult,
    createTechnicalResult,
    normalizeToolResult
};
