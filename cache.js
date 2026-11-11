/**
 * AuraAI In-Memory Capability Cache with TTL
 * Caches web pages, parsed documents, search results, embeddings, and OCR results.
 */

class CapabilityCache {
    constructor(defaultTtlMs = 15 * 60 * 1000) { // 15 mins default
        this.cache = new Map();
        this.defaultTtlMs = defaultTtlMs;
    }

    set(key, value, ttlMs = this.defaultTtlMs) {
        const expiresAt = Date.now() + ttlMs;
        this.cache.set(key, { value, expiresAt });
    }

    get(key) {
        const item = this.cache.get(key);
        if (!item) return null;
        if (Date.now() > item.expiresAt) {
            this.cache.delete(key);
            return null;
        }
        return item.value;
    }

    has(key) {
        return this.get(key) !== null;
    }

    delete(key) {
        return this.cache.delete(key);
    }

    clear() {
        this.cache.clear();
    }

    // Specialized namespaces
    static get webCache() {
        if (!this._webCache) this._webCache = new CapabilityCache(20 * 60 * 1000); // 20 mins
        return this._webCache;
    }

    static get docCache() {
        if (!this._docCache) this._docCache = new CapabilityCache(60 * 60 * 1000); // 1 hour
        return this._docCache;
    }

    static get ocrCache() {
        if (!this._ocrCache) this._ocrCache = new CapabilityCache(60 * 60 * 1000); // 1 hour
        return this._ocrCache;
    }
}

module.exports = CapabilityCache;
