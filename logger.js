/**
 * AuraAI Observability & Structured Logger
 * Provides trace logging for all system capabilities with timestamps and timing.
 */

const LOG_TAGS = [
    'REQUEST ROUTER',
    'CAPABILITY SELECTED',
    'MODEL SELECTED',
    'URL DETECTED',
    'WEB SEARCH',
    'PAGE FETCH',
    'DOCUMENT PARSE',
    'OCR',
    'CHUNKING',
    'EMBEDDING',
    'RETRIEVAL',
    'IMAGE ANALYSIS',
    'IMAGE GENERATION',
    'CODE EXECUTION',
    'CALCULATION',
    'LLM REQUEST',
    'LLM RESPONSE',
    'SOURCE CITATION',
    'SECURITY CHECK',
    'ERROR'
];

function log(tag, message, metadata = null) {
    const timestamp = new Date().toISOString().substring(11, 23);
    const formattedTag = `[${tag.toUpperCase()}]`.padEnd(23);
    let output = `${timestamp} ${formattedTag} ${message}`;
    if (metadata && typeof metadata === 'object') {
        try {
            output += ' | ' + JSON.stringify(metadata);
        } catch (e) {}
    }
    console.log(output);
}

function time(tag, label) {
    const start = Date.now();
    return {
        end: (msg = '') => {
            const elapsed = Date.now() - start;
            log(tag, `${label} completed in ${elapsed}ms ${msg ? `(${msg})` : ''}`);
            return elapsed;
        }
    };
}

module.exports = {
    log,
    time,
    LOG_TAGS
};
