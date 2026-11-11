/**
 * AuraAI Security & SSRF Protection
 * Guards against SSRF, private network probing, cloud metadata access, zip bombs, and oversized files.
 */

const { URL } = require('url');
const dns = require('dns').promises;
const { log } = require('./logger');

const MAX_DOWNLOAD_BYTES = 15 * 1024 * 1024; // 15MB
const MAX_REDIRECTS = 4;
const DEFAULT_TIMEOUT_MS = 6000;

function isPrivateIp(ip) {
    if (!ip) return false;

    // IPv4 checks
    if (ip === '127.0.0.1' || ip === '0.0.0.0' || ip === 'localhost') return true;

    const parts = ip.split('.').map(p => parseInt(p, 10));
    if (parts.length === 4 && parts.every(p => !isNaN(p) && p >= 0 && p <= 255)) {
        // 10.0.0.0/8
        if (parts[0] === 10) return true;
        // 172.16.0.0/12 (172.16.x.x - 172.31.x.x)
        if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
        // 192.168.0.0/16
        if (parts[0] === 192 && parts[1] === 168) return true;
        // 169.254.0.0/16 (Link-local & AWS/GCP metadata 169.254.169.254)
        if (parts[0] === 169 && parts[1] === 254) return true;
        // 127.0.0.0/8
        if (parts[0] === 127) return true;
        // 0.0.0.0/8
        if (parts[0] === 0) return true;
    }

    // IPv6 checks
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80')) {
        return true;
    }

    return false;
}

async function validateUrlSafety(urlStr) {
    let parsed;
    try {
        parsed = new URL(urlStr);
    } catch (e) {
        log('SECURITY CHECK', `Invalid URL format: ${urlStr}`);
        return { isSafe: false, reason: 'Invalid URL format' };
    }

    // Only allow HTTP and HTTPS
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        log('SECURITY CHECK', `Blocked disallowed protocol: ${parsed.protocol}`);
        return { isSafe: false, reason: `Disallowed protocol: ${parsed.protocol}` };
    }

    const hostname = parsed.hostname.toLowerCase();

    // Check direct hostnames
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0' || hostname === '::1') {
        log('SECURITY CHECK', `Blocked loopback address: ${hostname}`);
        return { isSafe: false, reason: 'Access to localhost/loopback is blocked' };
    }

    if (hostname === '169.254.169.254' || hostname === 'metadata.google.internal' || hostname.endsWith('.internal') || hostname.endsWith('.local')) {
        log('SECURITY CHECK', `Blocked metadata/internal domain: ${hostname}`);
        return { isSafe: false, reason: 'Access to cloud metadata or internal network is blocked' };
    }

    // Direct IP check
    if (isPrivateIp(hostname)) {
        log('SECURITY CHECK', `Blocked private IP access: ${hostname}`);
        return { isSafe: false, reason: 'Access to private network IPs is blocked' };
    }

    // Resolve DNS to verify the domain does not resolve to a private IP (DNS rebinding protection)
    try {
        const addresses = await dns.lookup(hostname, { all: true });
        for (const addr of addresses) {
            if (isPrivateIp(addr.address)) {
                log('SECURITY CHECK', `DNS resolved ${hostname} to private IP ${addr.address}`);
                return { isSafe: false, reason: `Domain resolves to private/internal network IP (${addr.address})` };
            }
        }
    } catch (dnsErr) {
        // If DNS fails to resolve, allow network request to handle natural failure or return unsafe
        log('SECURITY CHECK', `DNS lookup warning for ${hostname}: ${dnsErr.message}`);
    }

    return { isSafe: true, url: parsed.toString() };
}

function sanitizeUntrustedText(text) {
    if (!text || typeof text !== 'string') return '';
    // Strip control characters
    return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

module.exports = {
    validateUrlSafety,
    isPrivateIp,
    sanitizeUntrustedText,
    MAX_DOWNLOAD_BYTES,
    MAX_REDIRECTS,
    DEFAULT_TIMEOUT_MS
};
