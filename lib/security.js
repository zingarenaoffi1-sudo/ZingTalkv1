/**
 * ZingTalk Security Primitives
 * Pure, dependency-free cryptography, rate-limiting, token verification,
 * dynamic TURN credential generation, and request/URL sanitization helpers.
 */

const crypto = require('crypto');

const ALLOWED_SERVER_HOSTS = new Set([
    'zingtalk.duckdns.org',
    'localhost',
    '127.0.0.1'
]);

/**
 * Constant-time hex string comparison to prevent timing side-channel attacks.
 */
function timingSafeEqualHex(hexA, hexB) {
    if (typeof hexA !== 'string' || typeof hexB !== 'string') return false;
    const cleanA = hexA.trim().toLowerCase();
    const cleanB = hexB.trim().toLowerCase();
    if (!cleanA || cleanA.length !== cleanB.length || cleanA.length % 2 !== 0) {
        return false;
    }
    try {
        const bufA = Buffer.from(cleanA, 'hex');
        const bufB = Buffer.from(cleanB, 'hex');
        if (bufA.length !== bufB.length || bufA.length === 0) return false;
        return crypto.timingSafeEqual(bufA, bufB);
    } catch (_) {
        return false;
    }
}

/**
 * In-memory fixed-window rate limiter with bounded map size.
 */
class FixedWindowRateLimiter {
    constructor({ windowMs = 60000, maxRequests = 10, maxKeys = 5000, nowFn = () => Date.now() } = {}) {
        this.windowMs = windowMs;
        this.maxRequests = maxRequests;
        this.maxKeys = maxKeys;
        this.nowFn = nowFn;
        this.buckets = new Map();
    }

    _prune(now) {
        if (this.buckets.size < this.maxKeys) return;
        for (const [k, entry] of this.buckets.entries()) {
            if (!entry || now >= entry.resetAt) {
                this.buckets.delete(k);
            }
        }
        if (this.buckets.size >= this.maxKeys) {
            const firstKey = this.buckets.keys().next().value;
            if (firstKey !== undefined) this.buckets.delete(firstKey);
        }
    }

    check(rawKey, cost = 1) {
        const key = String(rawKey || 'anonymous');
        const now = this.nowFn();
        this._prune(now);

        let entry = this.buckets.get(key);
        if (!entry || now >= entry.resetAt) {
            entry = { count: 0, resetAt: now + this.windowMs };
            this.buckets.set(key, entry);
        }

        if (entry.count + cost > this.maxRequests) {
            const remainingMs = Math.max(0, entry.resetAt - now);
            return {
                allowed: false,
                remaining: 0,
                resetAt: entry.resetAt,
                retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1000))
            };
        }

        entry.count += cost;
        return {
            allowed: true,
            remaining: Math.max(0, this.maxRequests - entry.count),
            resetAt: entry.resetAt,
            retryAfterSeconds: 0
        };
    }

    reset(rawKey) {
        this.buckets.delete(String(rawKey || 'anonymous'));
    }
}

/**
 * HMAC-SHA256 signed session tokens for verified guest & user reconnects.
 */
function issueSessionToken(payload, secret, ttlMs = 30 * 24 * 60 * 60 * 1000, nowFn = () => Date.now()) {
    if (!secret) throw new Error('Session secret is required');
    const now = nowFn();
    const fullPayload = {
        ...payload,
        iat: now,
        exp: now + ttlMs
    };
    const encoded = Buffer.from(JSON.stringify(fullPayload), 'utf8').toString('base64url');
    const sig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
    return `${encoded}.${sig}`;
}

function verifySessionToken(token, secret, nowFn = () => Date.now()) {
    if (!token || typeof token !== 'string' || !secret) return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [encoded, sig] = parts;
    if (!encoded || !sig) return null;

    const expectedSig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
    try {
        const bufSig = Buffer.from(sig, 'utf8');
        const bufExpected = Buffer.from(expectedSig, 'utf8');
        if (bufSig.length !== bufExpected.length || !crypto.timingSafeEqual(bufSig, bufExpected)) {
            return null;
        }
        const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
        if (!parsed || typeof parsed !== 'object') return null;
        if (typeof parsed.exp !== 'number' || nowFn() > parsed.exp) return null;
        return parsed;
    } catch (_) {
        return null;
    }
}

/**
 * Generates coturn REST API / use-auth-secret dynamic time-limited TURN credentials.
 */
function generateTurnCredentials(uid, turnSecret, ttlSeconds = 3600, nowFn = () => Date.now()) {
    const cleanUid = String(uid || 'guest').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || 'guest';
    const expiry = Math.floor(nowFn() / 1000) + Math.max(60, Number(ttlSeconds) || 3600);
    const username = `${expiry}:${cleanUid}`;
    const credential = crypto.createHmac('sha1', String(turnSecret)).update(username).digest('base64');
    return {
        urls: [
            'turn:zingtalk.duckdns.org:3478?transport=udp',
            'turn:zingtalk.duckdns.org:3478?transport=tcp'
        ],
        username,
        credential,
        ttlSeconds,
        expiresAt: expiry * 1000,
        mode: 'hmac-ephemeral'
    };
}

/**
 * Validates and restricts client server URLs to trusted production / dev origins only.
 */
function sanitizeServerUrl(rawUrl, fallbackUrl = 'https://zingtalk.duckdns.org') {
    if (!rawUrl || typeof rawUrl !== 'string') return fallbackUrl;
    const trimmed = rawUrl.trim();
    if (!trimmed || /^javascript:/i.test(trimmed) || /^data:/i.test(trimmed)) {
        return fallbackUrl;
    }
    try {
        const parsed = new URL(trimmed);
        const host = parsed.hostname.toLowerCase();
        const isLocal = host === 'localhost' || host === '127.0.0.1';
        const isTrustedHttps = parsed.protocol === 'https:' && (
            ALLOWED_SERVER_HOSTS.has(host) ||
            host.endsWith('.run.app') ||
            host.endsWith('.ai.studio')
        );
        const isDevHttp = parsed.protocol === 'http:' && isLocal;
        if (isTrustedHttps || isDevHttp) {
            return parsed.origin;
        }
    } catch (_) {}
    return fallbackUrl;
}

/**
 * Strict CORS origin allowlist for Socket.IO and Express endpoints.
 */
function isCorsOriginAllowed(origin) {
    if (!origin) return true; // Native Android/iOS HTTP clients & webhooks omit Origin header
    if (origin === 'null') return false;
    const trimmed = String(origin).trim();
    if (trimmed === 'capacitor://localhost' || trimmed === 'ionic://localhost') return true;
    try {
        const parsed = new URL(trimmed);
        const host = parsed.hostname.toLowerCase();
        if (host === 'localhost' || host === '127.0.0.1') {
            return parsed.protocol === 'http:' || parsed.protocol === 'https:';
        }
        if (parsed.protocol === 'https:') {
            return (
                host === 'zingtalk.duckdns.org' ||
                host === 'zingarenaoffi1-sudo.github.io' ||
                host.endsWith('.run.app') ||
                host.endsWith('.ai.studio')
            );
        }
    } catch (_) {}
    return false;
}

/**
 * Validates incoming Amazon Alexa Skills Kit webhook metadata, timestamp skew (±150s),
 * SignatureCertChainUrl format (per AWS ASK spec), and optional Skill ID.
 */
function validateAlexaWebhookRequest(headers = {}, body = {}, { expectedSkillId = '', requireCertUrl = false, nowFn = () => Date.now() } = {}) {
    if (!body || typeof body !== 'object' || !body.request || typeof body.request !== 'object') {
        return { ok: false, reason: 'Malformed Alexa request payload.' };
    }

    const reqTimestamp = body.request.timestamp;
    if (reqTimestamp) {
        const parsedTime = Date.parse(reqTimestamp);
        if (!Number.isFinite(parsedTime)) {
            return { ok: false, reason: 'Invalid Alexa request timestamp.' };
        }
        const skewMs = Math.abs(nowFn() - parsedTime);
        if (skewMs > 150 * 1000) {
            return { ok: false, reason: 'Expired Alexa request timestamp (>150s replay window).' };
        }
    } else if (requireCertUrl) {
        return { ok: false, reason: 'Missing Alexa request timestamp.' };
    }

    if (expectedSkillId) {
        const appId = body.session?.application?.applicationId || body.context?.System?.application?.applicationId || '';
        if (appId !== expectedSkillId) {
            return { ok: false, reason: 'Alexa Skill Application ID mismatch.' };
        }
    }

    const certUrl = headers['signaturecertchainurl'] || headers['SignatureCertChainUrl'] || '';
    if (certUrl) {
        try {
            const u = new URL(String(certUrl));
            const validPort = !u.port || u.port === '443';
            if (u.protocol !== 'https:' || u.hostname.toLowerCase() !== 's3.amazonaws.com' || !u.pathname.startsWith('/echo.api/') || !validPort) {
                return { ok: false, reason: 'Untrusted Alexa SignatureCertChainUrl.' };
            }
        } catch (_) {
            return { ok: false, reason: 'Invalid Alexa SignatureCertChainUrl.' };
        }
    } else if (requireCertUrl) {
        return { ok: false, reason: 'Missing Alexa SignatureCertChainUrl header.' };
    }

    return { ok: true };
}

module.exports = {
    timingSafeEqualHex,
    FixedWindowRateLimiter,
    issueSessionToken,
    verifySessionToken,
    generateTurnCredentials,
    sanitizeServerUrl,
    isCorsOriginAllowed,
    validateAlexaWebhookRequest
};
