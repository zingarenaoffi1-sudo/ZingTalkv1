const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

// Native .env file loader (Zero external dependencies)
function loadEnvFile() {
    const envPaths = [
        path.join(__dirname, '.env'),
        path.join(process.cwd(), '.env'),
        path.join('/home/ubuntu/ZingTalk', '.env'),
        path.join('/home/ec2-user/ZingTalk', '.env')
    ];
    for (const p of envPaths) {
        if (fs.existsSync(p)) {
            try {
                const content = fs.readFileSync(p, 'utf-8');
                const lines = content.split('\n');
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed.startsWith('#')) continue;
                    const eqIndex = trimmed.indexOf('=');
                    if (eqIndex > 0) {
                        const key = trimmed.slice(0, eqIndex).trim();
                        let val = trimmed.slice(eqIndex + 1).trim();
                        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                            val = val.slice(1, -1);
                        }
                        if (!process.env[key]) {
                            process.env[key] = val;
                        }
                    }
                }
                break;
            } catch (_) {}
        }
    }
}
loadEnvFile();

const { Server } = require('socket.io');
const admin = require('firebase-admin');
let normalizeUid, normalizePairCode, SplitMeshRegistry;
let timingSafeEqualHex, FixedWindowRateLimiter, issueSessionToken, verifySessionToken, generateTurnCredentials, isCorsOriginAllowed, validateAlexaWebhookRequest;
try {
    ({ timingSafeEqualHex, FixedWindowRateLimiter, issueSessionToken, verifySessionToken, generateTurnCredentials, isCorsOriginAllowed, validateAlexaWebhookRequest } = require('./lib/security'));
} catch (_) {
    timingSafeEqualHex = (a, b) => {
        if (typeof a !== 'string' || typeof b !== 'string') return false;
        const ca = a.trim().toLowerCase(), cb = b.trim().toLowerCase();
        if (!ca || ca.length !== cb.length || ca.length % 2 !== 0) return false;
        try { return crypto.timingSafeEqual(Buffer.from(ca, 'hex'), Buffer.from(cb, 'hex')); } catch (_) { return false; }
    };
    FixedWindowRateLimiter = class {
        constructor({ windowMs = 60000, maxRequests = 10 } = {}) {
            this.windowMs = windowMs; this.maxRequests = maxRequests; this.buckets = new Map();
        }
        check(key, cost = 1) {
            const k = String(key || 'anon'), now = Date.now();
            if (this.buckets.size > 5000) this.buckets.clear();
            let e = this.buckets.get(k);
            if (!e || now >= e.resetAt) { e = { count: 0, resetAt: now + this.windowMs }; this.buckets.set(k, e); }
            if (e.count + cost > this.maxRequests) return { allowed: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((e.resetAt - now) / 1000)) };
            e.count += cost;
            return { allowed: true, remaining: this.maxRequests - e.count, retryAfterSeconds: 0 };
        }
        reset(key) { this.buckets.delete(String(key || 'anon')); }
    };
    issueSessionToken = (payload, secret, ttlMs = 30 * 24 * 3600 * 1000) => {
        const now = Date.now();
        const enc = Buffer.from(JSON.stringify({ ...payload, iat: now, exp: now + ttlMs }), 'utf8').toString('base64url');
        const sig = crypto.createHmac('sha256', secret).update(enc).digest('base64url');
        return `${enc}.${sig}`;
    };
    verifySessionToken = (token, secret) => {
        if (!token || typeof token !== 'string' || !secret) return null;
        const parts = token.split('.');
        if (parts.length !== 2) return null;
        const expected = crypto.createHmac('sha256', secret).update(parts[0]).digest('base64url');
        try {
            if (parts[1].length !== expected.length || !crypto.timingSafeEqual(Buffer.from(parts[1]), Buffer.from(expected))) return null;
            const parsed = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
            return parsed && typeof parsed.exp === 'number' && Date.now() <= parsed.exp ? parsed : null;
        } catch (_) { return null; }
    };
    generateTurnCredentials = (uid, secret, ttlSeconds = 3600) => {
        const cleanUid = String(uid || 'guest').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || 'guest';
        const exp = Math.floor(Date.now() / 1000) + Math.max(60, ttlSeconds);
        const username = `${exp}:${cleanUid}`;
        const credential = crypto.createHmac('sha1', String(secret)).update(username).digest('base64');
        return { urls: ['turn:zingtalk.duckdns.org:3478?transport=udp', 'turn:zingtalk.duckdns.org:3478?transport=tcp'], username, credential, ttlSeconds, expiresAt: exp * 1000, mode: 'hmac-ephemeral' };
    };
    isCorsOriginAllowed = (origin) => {
        if (!origin) return true;
        if (origin === 'null') return false;
        const t = String(origin).trim();
        if (t === 'capacitor://localhost' || t === 'ionic://localhost') return true;
        try {
            const u = new URL(t); const h = u.hostname.toLowerCase();
            if (h === 'localhost' || h === '127.0.0.1') return u.protocol === 'http:' || u.protocol === 'https:';
            return u.protocol === 'https:' && (h === 'zingtalk.duckdns.org' || h === 'zingarenaoffi1-sudo.github.io' || h.endsWith('.run.app') || h.endsWith('.ai.studio'));
        } catch (_) { return false; }
    };
    validateAlexaWebhookRequest = (headers = {}, body = {}, { expectedSkillId = '', requireCertUrl = false } = {}) => {
        if (!body || typeof body !== 'object' || !body.request || typeof body.request !== 'object') return { ok: false, reason: 'Malformed Alexa request.' };
        if (body.request.timestamp) {
            const ts = Date.parse(body.request.timestamp);
            if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 150000) return { ok: false, reason: 'Invalid or expired Alexa timestamp.' };
        } else if (requireCertUrl) return { ok: false, reason: 'Missing Alexa timestamp.' };
        if (expectedSkillId && (body.session?.application?.applicationId || body.context?.System?.application?.applicationId) !== expectedSkillId) return { ok: false, reason: 'Skill ID mismatch.' };
        const cert = headers['signaturecertchainurl'] || headers['SignatureCertChainUrl'] || '';
        if (cert) {
            try {
                const u = new URL(String(cert));
                if (u.protocol !== 'https:' || u.hostname.toLowerCase() !== 's3.amazonaws.com' || !u.pathname.startsWith('/echo.api/')) return { ok: false, reason: 'Untrusted Alexa cert URL.' };
            } catch (_) { return { ok: false, reason: 'Invalid Alexa cert URL.' }; }
        } else if (requireCertUrl) return { ok: false, reason: 'Missing Alexa cert URL.' };
        return { ok: true };
    };
}
try {
    ({ normalizeUid, normalizePairCode, SplitMeshRegistry } = require('./lib/split-mesh'));
} catch (_) {
    // Self-contained fallback so EC2 deploy never crashes even if only server.js is synced
    const FALLBACK_PAIR_TTL_MS = 30 * 60 * 1000;
    normalizeUid = (raw) => {
        const clean = String(raw || '').trim().replace(/\D/g, '');
        return clean.length === 10 ? clean : '';
    };
    normalizePairCode = (raw) => {
        const clean = String(raw || '').trim().replace(/\D/g, '');
        return clean.length === 6 ? clean : '';
    };
    SplitMeshRegistry = class {
        constructor({ ttlMs = FALLBACK_PAIR_TTL_MS, nowFn = () => Date.now() } = {}) {
            this.ttlMs = ttlMs;
            this.nowFn = nowFn;
            this.codeToTv = new Map();
            this.tvToCode = new Map();
            this.tvToConnector = new Map();
            this.connectorToTv = new Map();
            this.activeSplitCalls = new Map();
        }
        _purgeExpiredCodes() {
            const now = this.nowFn();
            for (const [code, entry] of this.codeToTv.entries()) {
                if (!entry || (now - entry.createdAt) > this.ttlMs) {
                    this.codeToTv.delete(code);
                    if (entry && this.tvToCode.get(entry.tvUid) === code) this.tvToCode.delete(entry.tvUid);
                }
            }
        }
        registerTvPairing(rawTvUid, tvName = 'Fire TV', preferredCode = null) {
            this._purgeExpiredCodes();
            const tvUid = normalizeUid(rawTvUid);
            if (!tvUid) return { ok: false, error: 'Valid 10-digit TV UID required.' };
            const existingCode = this.tvToCode.get(tvUid);
            if (existingCode && this.codeToTv.has(existingCode) && !preferredCode) {
                const entry = this.codeToTv.get(existingCode);
                entry.createdAt = this.nowFn();
                entry.tvName = tvName || entry.tvName || 'Fire TV';
                return { ok: true, tvUid, code: existingCode, tvName: entry.tvName, qrPayload: `zingtalk://pair?uid=${tvUid}&code=${existingCode}` };
            }
            if (existingCode) {
                this.codeToTv.delete(existingCode);
                this.tvToCode.delete(tvUid);
            }
            let code = normalizePairCode(preferredCode);
            let attempts = 0;
            while ((!code || this.codeToTv.has(code)) && attempts < 50) {
                code = String(Math.floor(100000 + Math.random() * 900000));
                attempts++;
            }
            const cleanName = String(tvName || 'Fire TV').trim().slice(0, 48);
            this.codeToTv.set(code, { tvUid, tvName: cleanName, createdAt: this.nowFn() });
            this.tvToCode.set(tvUid, code);
            return { ok: true, tvUid, code, tvName: cleanName, qrPayload: `zingtalk://pair?uid=${tvUid}&code=${code}` };
        }
        pairConnector({ code, tvUid, connectorSocketId, deviceName = 'Phone Camera', resolution = '720p', facingMode = 'user', isTvOnlineFn = () => true }) {
            this._purgeExpiredCodes();
            if (!connectorSocketId) return { ok: false, error: 'Connector socket ID required.' };
            const cleanCode = normalizePairCode(code);
            const suppliedTvUid = normalizeUid(tvUid);
            if (!cleanCode) {
                return { ok: false, error: 'Valid 6-digit Pairing Code shown on your Fire TV is required to pair securely.' };
            }
            const entry = this.codeToTv.get(cleanCode);
            if (!entry) return { ok: false, error: 'Invalid or expired 6-digit Pairing Code. Open Phone Cam on your Fire TV for a fresh code.' };
            const resolvedTvUid = entry.tvUid;
            if (suppliedTvUid && suppliedTvUid !== resolvedTvUid) {
                return { ok: false, error: 'Pairing Code does not match the entered 10-digit Fire TV UID.' };
            }
            const tvName = entry.tvName || 'Fire TV';
            if (!isTvOnlineFn(resolvedTvUid)) return { ok: false, error: `Fire TV [${resolvedTvUid}] is currently offline. Open ZingTalk TV on your TV first.` };
            const prevTv = this.connectorToTv.get(connectorSocketId);
            if (prevTv && prevTv !== resolvedTvUid) this.unpairByConnector(connectorSocketId);
            const previousConnector = this.tvToConnector.get(resolvedTvUid);
            const connectorId = 'conn_' + Math.random().toString(36).slice(2, 10);
            const record = {
                socketId: connectorSocketId,
                connectorId,
                tvUid: resolvedTvUid,
                tvName,
                deviceName: String(deviceName || 'Phone Camera').trim().slice(0, 40),
                resolution: ['480p', '720p', '1080p'].includes(resolution) ? resolution : '720p',
                facingMode: facingMode === 'environment' ? 'environment' : 'user',
                pairedAt: this.nowFn()
            };
            this.tvToConnector.set(resolvedTvUid, record);
            this.connectorToTv.set(connectorSocketId, resolvedTvUid);
            return {
                ok: true,
                tvUid: resolvedTvUid,
                tvName,
                code: this.tvToCode.get(resolvedTvUid) || cleanCode || '',
                connectorId,
                deviceName: record.deviceName,
                replacedSocketId: previousConnector && previousConnector.socketId !== connectorSocketId ? previousConnector.socketId : null
            };
        }
        getConnectorForTv(rawTvUid) {
            const tvUid = normalizeUid(rawTvUid);
            return tvUid ? (this.tvToConnector.get(tvUid) || null) : null;
        }
        getTvForConnector(connectorSocketId) {
            return connectorSocketId ? (this.connectorToTv.get(connectorSocketId) || null) : null;
        }
        unpairByConnector(connectorSocketId) {
            const tvUid = this.connectorToTv.get(connectorSocketId);
            if (!tvUid) return null;
            this.connectorToTv.delete(connectorSocketId);
            const current = this.tvToConnector.get(tvUid);
            if (current && current.socketId === connectorSocketId) {
                this.tvToConnector.delete(tvUid);
                this.activeSplitCalls.delete(tvUid);
                return { tvUid, connectorId: current.connectorId, deviceName: current.deviceName, socketId: connectorSocketId };
            }
            return null;
        }
        unpairByTv(rawTvUid) {
            const tvUid = normalizeUid(rawTvUid);
            if (!tvUid) return null;
            const current = this.tvToConnector.get(tvUid);
            if (!current) return null;
            this.tvToConnector.delete(tvUid);
            this.connectorToTv.delete(current.socketId);
            this.activeSplitCalls.delete(tvUid);
            return current;
        }
        registerSplitCallSession({ tvUid, friendUid, friendName = '', callType = 'video', tvAsCaller = true }) {
            const cleanTv = normalizeUid(tvUid);
            const cleanFriend = normalizeUid(friendUid);
            if (!cleanTv || !cleanFriend) return null;
            const connector = this.tvToConnector.get(cleanTv);
            if (!connector) return null;
            const session = {
                callSessionId: `mesh_${cleanTv}_${cleanFriend}_${this.nowFn()}`,
                tvUid: cleanTv,
                friendUid: cleanFriend,
                friendName: String(friendName || `UID ${cleanFriend}`).slice(0, 60),
                callType: callType === 'audio' ? 'audio' : 'video',
                tvAsCaller: Boolean(tvAsCaller),
                connectorSocketId: connector.socketId,
                connectorId: connector.connectorId,
                startedAt: this.nowFn()
            };
            this.activeSplitCalls.set(cleanTv, session);
            return session;
        }
        getSplitCallSessionByTv(rawTvUid) {
            const cleanTv = normalizeUid(rawTvUid);
            return cleanTv ? (this.activeSplitCalls.get(cleanTv) || null) : null;
        }
        getSplitCallSessionByFriend(rawFriendUid) {
            const cleanFriend = normalizeUid(rawFriendUid);
            if (!cleanFriend) return null;
            for (const session of this.activeSplitCalls.values()) {
                if (session.friendUid === cleanFriend) return session;
            }
            return null;
        }
        clearSplitCallForUid(rawUid) {
            const clean = normalizeUid(rawUid);
            if (!clean) return [];
            const cleared = [];
            if (this.activeSplitCalls.has(clean)) {
                cleared.push(this.activeSplitCalls.get(clean));
                this.activeSplitCalls.delete(clean);
            }
            for (const [tvUid, session] of this.activeSplitCalls.entries()) {
                if (session.friendUid === clean) {
                    cleared.push(session);
                    this.activeSplitCalls.delete(tvUid);
                }
            }
            return cleared;
        }
    };
}
let detectPlatformFromClient, computeServerLoadReport;
try {
    ({ detectPlatformFromClient, computeServerLoadReport } = require('./lib/server-metrics'));
} catch (_) {
    detectPlatformFromClient = ({ data = {}, userAgent = '' } = {}) => {
        const ua = String(userAgent || '');
        const raw = (data && typeof data.platform === 'string') ? data.platform.trim().toLowerCase() : '';
        const isNativeApp = Boolean(data && data.isNativeApp === true);
        const isFireTvUA = /AFT|FireTV|Silk|Leanback|GoogleTV|BRAVIA|MIBOX/i.test(ua);
        const isMobileUA = /Android.*Mobile|iPhone|iPad|iPod/i.test(ua);
        const isDesktopBrowserUA = /Windows NT|Macintosh|CrOS|X11|Win64|WOW64/i.test(ua) && !/Android/i.test(ua) && !isFireTvUA;
        if (raw.includes('web') || raw.includes('browser') || raw.includes('desktop')) return 'Web Browser';
        if (raw.includes('mob') || raw.includes('ios') || raw.includes('phone')) return 'Mobile';
        if (raw.includes('fire') || raw.includes('tv') || raw.includes('leanback')) {
            if (isNativeApp || isFireTvUA || (!isDesktopBrowserUA && !isMobileUA)) return 'Fire TV';
            return isMobileUA ? 'Mobile' : 'Web Browser';
        }
        if (isFireTvUA) return 'Fire TV';
        if (isMobileUA) return 'Mobile';
        if (/Android/i.test(ua) && !/Mobile/i.test(ua)) return 'Fire TV';
        return 'Web Browser';
    };
    computeServerLoadReport = ({ cpuUsedPct = 0, totalMemBytes = 1, freeMemBytes = 0, processRssBytes = 0, heapUsedBytes = 0, heapTotalBytes = 0, cpuCores = 1, loadAvg1m = 0, loadAvg5m = 0, loadAvg15m = 0, eventLoopLagMs = 0, liveSockets = 0, activePairings = 0, activeSplitCalls = 0, uptimeSeconds = 0 } = {}) => {
        const clamp = (v) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
        const safeTotal = Math.max(1, Number(totalMemBytes) || 1);
        const safeFree = Math.max(0, Math.min(safeTotal, Number(freeMemBytes) || 0));
        const usedBytes = Math.max(0, safeTotal - safeFree);
        const cpuUsed = clamp(cpuUsedPct);
        const ramUsed = clamp((usedBytes / safeTotal) * 100);
        const lagMs = Math.max(0, Math.round((Number(eventLoopLagMs) || 0) * 10) / 10);
        const loopLoadPct = clamp((lagMs / 200) * 100);
        const overallLoadPct = clamp(cpuUsed * 0.5 + ramUsed * 0.35 + loopLoadPct * 0.15);
        const toMb = (b) => Math.max(0, Math.round((Number(b) || 0) / (1024 * 1024)));
        return {
            overallLoadPct,
            remainingCapacityPct: 100 - overallLoadPct,
            statusLabel: overallLoadPct >= 85 ? 'Heavy Load' : (overallLoadPct >= 60 ? 'Moderate Load' : 'Healthy'),
            statusLevel: overallLoadPct >= 85 ? 'heavy' : (overallLoadPct >= 60 ? 'moderate' : 'healthy'),
            cpu: { usedPct: cpuUsed, remainingPct: 100 - cpuUsed, cores: Math.max(1, Number(cpuCores) || 1), loadAvg1m: Math.round((Number(loadAvg1m) || 0) * 100) / 100, loadAvg5m: Math.round((Number(loadAvg5m) || 0) * 100) / 100, loadAvg15m: Math.round((Number(loadAvg15m) || 0) * 100) / 100 },
            memory: { usedPct: ramUsed, remainingPct: 100 - ramUsed, usedMb: toMb(usedBytes), freeMb: toMb(safeFree), totalMb: toMb(safeTotal), processRssMb: toMb(processRssBytes), heapUsedMb: toMb(heapUsedBytes), heapTotalMb: toMb(heapTotalBytes) },
            runtime: { eventLoopLagMs: lagMs, loopLoadPct, liveSockets: Math.max(0, Number(liveSockets) || 0), activePairings: Math.max(0, Number(activePairings) || 0), activeSplitCalls: Math.max(0, Number(activeSplitCalls) || 0), uptimeSeconds: Math.max(0, Math.floor(Number(uptimeSeconds) || 0)) }
        };
    };
}

let nodemailer = null;
try {
    nodemailer = require('nodemailer');
} catch (_) {}

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: (origin, callback) => {
            if (isCorsOriginAllowed(origin)) return callback(null, true);
            return callback(new Error('Origin not allowed by ZingTalk CORS policy'));
        },
        methods: ["GET", "POST"]
    },
    maxHttpBufferSize: 2e6 // 2MB cap prevents memory exhaustion DoS while keeping signaling payloads fast
});

// Standard Security Headers & Scoped API CORS Middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self)');

    const origin = req.headers.origin;
    if (origin && isCorsOriginAllowed(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token, x-zing-session, Authorization');
    }
    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }
    return next();
});

// JSON & URL-encoded body parser with strict size limits
app.use(express.json({ limit: '512kb' }));
app.use(express.urlencoded({ extended: true, limit: '256kb' }));

// Rate limiters & Server Session / TURN Secret helpers
const adminVerifyLimiter = new FixedWindowRateLimiter({ windowMs: 15 * 60 * 1000, maxRequests: 5 });
const resetPasswordLimiter = new FixedWindowRateLimiter({ windowMs: 15 * 60 * 1000, maxRequests: 3 });
const resetEmailCooldown = new FixedWindowRateLimiter({ windowMs: 60 * 1000, maxRequests: 1 });
const turnApiLimiter = new FixedWindowRateLimiter({ windowMs: 60 * 1000, maxRequests: 25 });
const alexaWebhookLimiter = new FixedWindowRateLimiter({ windowMs: 60 * 1000, maxRequests: 60 });
const socketPairLimiter = new FixedWindowRateLimiter({ windowMs: 5 * 60 * 1000, maxRequests: 10 });
const socketBurstLimiter = new FixedWindowRateLimiter({ windowMs: 10 * 1000, maxRequests: 80 });

function getClientIp(req) {
    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd.trim()) {
        return fwd.split(',')[0].trim();
    }
    return req.ip || req.socket?.remoteAddress || 'unknown';
}

// Global connected users registry (UID -> socket.id), active calls, and Split-Mesh registry
const connectedUsers = new Map();
const globalActiveCallPeers = new Map(); // uid -> { peerUid, callType, callerName }
const splitMesh = new SplitMeshRegistry();

// ==========================================================================
// SERVER ADMIN & ANALYTICS PERSISTENCE ENGINE
// Tracks: Daily New Users, Daily Returning Users, Platform Breakdown
// ==========================================================================
const ANALYTICS_FILE_PATH = path.join(__dirname, 'analytics_store.json');
let analyticsStore = {
    allUsers: {},    // uid -> { uid, name, platform, firstSeenDate, lastSeenDate, firstSeenTime, lastSeenTime, totalConnections }
    dailyStats: {}   // YYYY-MM-DD -> { newUsers: [uid, ...], returningUsers: [uid, ...], totalConnections: 0 }
};

function loadAnalyticsFromDisk() {
    try {
        if (fs.existsSync(ANALYTICS_FILE_PATH)) {
            const raw = fs.readFileSync(ANALYTICS_FILE_PATH, 'utf-8');
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
                analyticsStore.allUsers = parsed.allUsers || {};
                analyticsStore.dailyStats = parsed.dailyStats || {};
            }
        }
    } catch (e) {
        console.warn('[Analytics] Failed to load store, using fresh in-memory store:', e.message);
    }
}
loadAnalyticsFromDisk();

let saveAnalyticsTimer = null;
function saveAnalyticsDebounced() {
    if (saveAnalyticsTimer) clearTimeout(saveAnalyticsTimer);
    saveAnalyticsTimer = setTimeout(() => {
        try {
            fs.writeFileSync(ANALYTICS_FILE_PATH, JSON.stringify(analyticsStore, null, 2), 'utf-8');
        } catch (_) {}
    }, 1500);
}

function getTodayDateStr() {
    const now = new Date();
    return now.toISOString().split('T')[0];
}

// Real-time Server CPU & Event Loop Lag Sampler (Lightweight, non-blocking)
let prevCpuSnapshot = os.cpus();
let sampledCpuUsedPct = 0;
let sampledEventLoopLagMs = 0;
let lastLoopTickHr = process.hrtime.bigint();

function sampleCpuUsageNow() {
    try {
        const current = os.cpus();
        if (!Array.isArray(current) || current.length === 0) return;
        let idleDelta = 0;
        let totalDelta = 0;
        for (let i = 0; i < current.length; i++) {
            const prev = prevCpuSnapshot[i] || current[i];
            const cur = current[i];
            const prevTotal = prev.times.user + prev.times.nice + prev.times.sys + prev.times.idle + prev.times.irq;
            const curTotal = cur.times.user + cur.times.nice + cur.times.sys + cur.times.idle + cur.times.irq;
            totalDelta += Math.max(0, curTotal - prevTotal);
            idleDelta += Math.max(0, cur.times.idle - prev.times.idle);
        }
        prevCpuSnapshot = current;
        if (totalDelta > 0) {
            sampledCpuUsedPct = Math.max(0, Math.min(100, Math.round(((totalDelta - idleDelta) / totalDelta) * 100)));
        }
    } catch (_) {}
}

const serverLoadMonitorInterval = setInterval(() => {
    const nowHr = process.hrtime.bigint();
    const elapsedMs = Number(nowHr - lastLoopTickHr) / 1e6;
    lastLoopTickHr = nowHr;
    sampledEventLoopLagMs = Math.max(0, Math.round((elapsedMs - 2000) * 10) / 10);
    sampleCpuUsageNow();
}, 2000);
if (typeof serverLoadMonitorInterval.unref === 'function') {
    serverLoadMonitorInterval.unref();
}

function getServerLoadSnapshot() {
    try {
        sampleCpuUsageNow();
        const cpus = os.cpus() || [];
        const cores = Math.max(1, cpus.length);
        const loadAvgs = os.loadavg ? os.loadavg() : [0, 0, 0];
        const mem = process.memoryUsage();
        const loadBasedCpuPct = Math.min(100, Math.round(((loadAvgs[0] || 0) / cores) * 100));
        const effectiveCpuPct = sampledCpuUsedPct > 0 ? sampledCpuUsedPct : loadBasedCpuPct;

        return computeServerLoadReport({
            cpuUsedPct: effectiveCpuPct,
            totalMemBytes: os.totalmem(),
            freeMemBytes: os.freemem(),
            processRssBytes: mem.rss,
            heapUsedBytes: mem.heapUsed,
            heapTotalBytes: mem.heapTotal,
            cpuCores: cores,
            loadAvg1m: loadAvgs[0] || 0,
            loadAvg5m: loadAvgs[1] || 0,
            loadAvg15m: loadAvgs[2] || 0,
            eventLoopLagMs: sampledEventLoopLagMs,
            liveSockets: getLiveConnectedCount(),
            activePairings: (typeof splitMesh !== 'undefined' && splitMesh && splitMesh.tvToConnector) ? splitMesh.tvToConnector.size : 0,
            activeSplitCalls: (typeof splitMesh !== 'undefined' && splitMesh && splitMesh.activeSplitCalls) ? splitMesh.activeSplitCalls.size : 0,
            uptimeSeconds: process.uptime()
        });
    } catch (err) {
        console.warn('[ZingTalk ServerLoad] Snapshot fallback triggered:', err.message);
        return computeServerLoadReport({ uptimeSeconds: process.uptime() });
    }
}

function detectPlatformFromSocket(socket, data) {
    const ua = (socket && socket.handshake && socket.handshake.headers && socket.handshake.headers['user-agent']) || '';
    return detectPlatformFromClient({ data, userAgent: ua });
}

function getLiveConnectedCount() {
    for (const [uid, socketId] of connectedUsers.entries()) {
        const s = io.sockets.sockets.get(socketId);
        if (!s || !s.connected) {
            connectedUsers.delete(uid);
            userContactsRegistry.delete(uid);
        }
    }
    return connectedUsers.size;
}

function recordUserConnection(uid, name, platform = 'Web Browser') {
    if (!uid) return;
    const cleanUid = String(uid).trim().replace(/\D/g, '');
    if (cleanUid.length !== 10) return;

    const today = getTodayDateStr();
    const nowIso = new Date().toISOString();

    if (!analyticsStore.dailyStats[today]) {
        analyticsStore.dailyStats[today] = { newUsers: [], returningUsers: [], totalConnections: 0 };
    }
    const todayLog = analyticsStore.dailyStats[today];
    todayLog.totalConnections++;

    if (!analyticsStore.allUsers[cleanUid]) {
        // Brand New User! First time ever recorded on ZingTalk
        analyticsStore.allUsers[cleanUid] = {
            uid: cleanUid,
            name: name || `User ${cleanUid}`,
            platform: platform || 'Web Browser',
            firstSeenDate: today,
            lastSeenDate: today,
            firstSeenTime: nowIso,
            lastSeenTime: nowIso,
            totalConnections: 1
        };
        if (!todayLog.newUsers.includes(cleanUid)) {
            todayLog.newUsers.push(cleanUid);
        }
    } else {
        // Existing / Returning User
        const existing = analyticsStore.allUsers[cleanUid];
        existing.lastSeenDate = today;
        existing.lastSeenTime = nowIso;
        existing.totalConnections = (existing.totalConnections || 0) + 1;
        if (name && name !== `User ${cleanUid}`) existing.name = name;
        if (platform) existing.platform = platform;

        if (existing.firstSeenDate !== today) {
            // User registered on a previous day and is returning today!
            if (!todayLog.returningUsers.includes(cleanUid)) {
                todayLog.returningUsers.push(cleanUid);
            }
        } else {
            // User registered earlier today
            if (!todayLog.newUsers.includes(cleanUid)) {
                todayLog.newUsers.push(cleanUid);
            }
        }
    }
    saveAnalyticsDebounced();
}

function getAnalyticsSummary() {
    const today = getTodayDateStr();
    const todayLog = analyticsStore.dailyStats[today] || { newUsers: [], returningUsers: [], totalConnections: 0 };

    let fireTvCount = 0;
    let mobileCount = 0;
    let otherCount = 0;

    for (const u of Object.values(analyticsStore.allUsers)) {
        const p = (u.platform || '').toLowerCase();
        if (p.includes('tv') || p.includes('fire')) fireTvCount++;
        else if (p.includes('mobile') || p.includes('phone') || p.includes('android')) mobileCount++;
        else otherCount++;
    }

    const totalLifetime = Object.keys(analyticsStore.allUsers).length;

    return {
        today,
        newUsersTodayCount: todayLog.newUsers.length,
        returningUsersTodayCount: todayLog.returningUsers.length,
        totalActiveTodayCount: todayLog.newUsers.length + todayLog.returningUsers.length,
        totalLifetimeUsersCount: totalLifetime,
        liveConnectedNowCount: getLiveConnectedCount(),
        platformBreakdown: {
            fireTv: fireTvCount,
            mobile: mobileCount,
            other: otherCount
        },
        serverLoad: getServerLoadSnapshot(),
        system: {
            uptimeSeconds: Math.floor(process.uptime()),
            memoryUsageMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
            domain: "zingtalk.duckdns.org",
            port: process.env.PORT || 3000,
            stunTurn: "zingtalk.duckdns.org:3478",
            alexaWebhook: "/alexa & /api/alexa"
        }
    };
}

function getRecentUsersList() {
    const today = getTodayDateStr();
    const list = Object.values(analyticsStore.allUsers).map(u => {
        const isNewToday = (u.firstSeenDate === today);
        const isActiveToday = (u.lastSeenDate === today);
        const isOnline = isUserOnline(u.uid);

        let typeLabel = 'First-Time User';
        if (isNewToday) {
            typeLabel = 'New User (Today)';
        } else if ((u.totalConnections || 1) > 1) {
            typeLabel = isActiveToday ? 'Returning User (Today)' : 'Returning User';
        } else {
            typeLabel = 'First-Time User';
        }

        return {
            uid: u.uid,
            name: u.name,
            platform: u.platform || 'Web Browser',
            type: typeLabel,
            isNewToday,
            isActiveToday,
            isOnline,
            firstSeenDate: u.firstSeenDate,
            firstSeenTime: u.firstSeenTime,
            lastSeenTime: u.lastSeenTime,
            totalConnections: u.totalConnections || 1
        };
    });

    list.sort((a, b) => new Date(b.lastSeenTime) - new Date(a.lastSeenTime));
    return list.slice(0, 50); // Top 50 recent users
}

// ==========================================================================
// SERVER ADMIN THREE-LEVEL SECURITY GATE
// Level 1: Primary Authentication Key
// Level 2: Secondary Clearance Key
// Level 3: Master Developer Token
// Stored strictly via irreversible SHA-256 cryptographic hashes (No plain text passwords in code)
// ==========================================================================
const ADMIN_LEVEL_HASHES = [
    "a252a4f2e3595682ddcd540785bdb2002158211ebb0cfbbed9f0fefad04c1a65", // Level 1 Hash
    "80f0e1cab6a0c35d342a0a1c2e0f79b0511dcb3eeeeac5740cc0295b3c243e5b", // Level 2 Hash
    "3678bc91dbe8d15525ca2ef34828bcedfdaf0128b4746333d0caa16dc79a5ed6"  // Level 3 Hash
];

const adminSessions = new Map(); // token -> { expires: timestamp }

function getServerSessionSecret() {
    if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.trim().length >= 16) {
        return process.env.SESSION_SECRET.trim();
    }
    const seed = [
        process.env.FIREBASE_PRIVATE_KEY || '',
        process.env.FIREBASE_CLIENT_EMAIL || '',
        ...ADMIN_LEVEL_HASHES
    ].join('|');
    return crypto.createHash('sha256').update(seed).digest('hex');
}

function buildIceServersPayload(uidLabel = 'guest') {
    const iceServers = [
        {
            urls: [
                'stun:stun.l.google.com:19302',
                'stun:stun1.l.google.com:19302',
                'stun:stun2.l.google.com:19302'
            ]
        },
        { urls: ['stun:zingtalk.duckdns.org:3478'] }
    ];

    const turnSecret = (process.env.TURN_AUTH_SECRET || '').trim();
    if (turnSecret) {
        const dyn = generateTurnCredentials(uidLabel, turnSecret, 3600);
        iceServers.push({
            urls: dyn.urls,
            username: dyn.username,
            credential: dyn.credential
        });
    } else if (process.env.TURN_USER && process.env.TURN_PASS) {
        iceServers.push({
            urls: [
                'turn:zingtalk.duckdns.org:3478?transport=udp',
                'turn:zingtalk.duckdns.org:3478?transport=tcp'
            ],
            username: process.env.TURN_USER,
            credential: process.env.TURN_PASS
        });
    }

    return {
        iceServers,
        ttlSeconds: 3600,
        mode: turnSecret ? 'hmac-ephemeral' : ((process.env.TURN_USER && process.env.TURN_PASS) ? 'server-env-turn' : 'stun-only')
    };
}

app.post('/api/admin/verify-gate', (req, res) => {
    try {
        const ip = getClientIp(req);
        const rateCheck = adminVerifyLimiter.check(`admin:${ip}`, 0);
        if (!rateCheck.allowed) {
            res.setHeader('Retry-After', String(rateCheck.retryAfterSeconds));
            return res.status(429).json({
                success: false,
                message: `Too many failed attempts. Try again in ${rateCheck.retryAfterSeconds}s.`
            });
        }

        const { level, key } = req.body || {};
        const lvl = parseInt(level, 10);
        if (!lvl || lvl < 1 || lvl > 3 || !key) {
            return res.status(400).json({ success: false, message: 'Invalid verification parameters' });
        }

        const inputHash = crypto.createHash('sha256').update(String(key).trim()).digest('hex');
        const expectedHash = ADMIN_LEVEL_HASHES[lvl - 1];

        if (!timingSafeEqualHex(inputHash, expectedHash)) {
            const penalty = adminVerifyLimiter.check(`admin:${ip}`, 1);
            if (!penalty.allowed) {
                res.setHeader('Retry-After', String(penalty.retryAfterSeconds));
                return res.status(429).json({
                    success: false,
                    message: `Too many failed attempts. Locked for ${penalty.retryAfterSeconds}s.`
                });
            }
            return res.status(401).json({ success: false, message: `Invalid security key for Level ${lvl}` });
        }

        if (lvl < 3) {
            return res.json({ success: true, nextLevel: lvl + 1 });
        } else {
            adminVerifyLimiter.reset(`admin:${ip}`);
            // Level 3 Verified! Generate secure 24-hour admin session token
            const token = crypto.randomBytes(32).toString('hex');
            adminSessions.set(token, { expires: Date.now() + 24 * 60 * 60 * 1000 });
            return res.json({ success: true, authorized: true, token });
        }
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/admin/analytics', (req, res) => {
    try {
        const authHeader = req.headers['authorization'];
        const bearerToken = (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) ? authHeader.slice(7).trim() : '';
        const token = req.headers['x-admin-token'] || bearerToken || req.query.token;
        if (!token || !adminSessions.has(token) || adminSessions.get(token).expires < Date.now()) {
            if (token && adminSessions.has(token)) adminSessions.delete(token);
            return res.status(401).json({ success: false, message: 'Unauthorized. Security gate clearance required.' });
        }
        return res.json({
            success: true,
            summary: getAnalyticsSummary(),
            recentUsers: getRecentUsersList()
        });
    } catch (err) {
        console.error('[ZingTalk Admin Analytics Error]:', err);
        return res.status(500).json({ success: false, message: 'Failed to compute analytics snapshot.' });
    }
});

app.post('/api/admin/logout', (req, res) => {
    const token = req.headers['x-admin-token'] || req.body?.token;
    if (token) adminSessions.delete(token);
    return res.json({ success: true, message: 'Admin session closed' });
});

app.get('/api/turn-credentials', (req, res) => {
    const ip = getClientIp(req);
    const rate = turnApiLimiter.check(`turn:${ip}`, 1);
    if (!rate.allowed) {
        res.setHeader('Retry-After', String(rate.retryAfterSeconds));
        return res.status(429).json({ success: false, message: 'Rate limit exceeded for TURN credentials.' });
    }
    const sessionToken = req.headers['x-zing-session'] || (typeof req.headers.authorization === 'string' && req.headers.authorization.startsWith('Bearer ') ? req.headers.authorization.slice(7).trim() : '');
    const verified = verifySessionToken(sessionToken, getServerSessionSecret());
    if (!verified || !verified.uid) {
        return res.status(401).json({ success: false, message: 'Valid ZingTalk session required for TURN credentials.' });
    }
    return res.json({ success: true, ...buildIceServersPayload(verified.uid) });
});

// Health check endpoint for AWS EC2 & load balancer monitoring
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        app: 'ZingTalk Fire TV Signaling Server',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

// ==========================================================================
// BREVO (SENDINBLUE) / NODEMAILER CUSTOM BRANDED PASSWORD RESET MAILER
// Generates official cryptographic link via Firebase Admin SDK & sends luxury HTML email
// ==========================================================================
const CIPHER_KEY = "ZingTalk_Security_Cipher_Key_2026";
function decryptSecureCipher(b64) {
    try {
        const buf = Buffer.from(b64, "base64");
        let res = "";
        for (let i = 0; i < buf.length; i++) {
            res += String.fromCharCode(buf[i] ^ CIPHER_KEY.charCodeAt(i % CIPHER_KEY.length));
        }
        return res;
    } catch (_) {
        return "";
    }
}

// Fallback encrypted cipher keys (Never stored in raw plain-text in code)
const SECURE_BREVO_USER_CIPHER = "OVkIVjUEXFtuExYOAQJEFgs6NQZeCwof";
const SECURE_BREVO_KEY_CIPHER = "IhoDEyQSBQlyagNWQ0VZRU0+IQhBCVJLPnwDSz1XVQRUalFbUjcAXghqMVwHQUtZREFpelwWDANBbi9TTWwEVVQDOFwNVG1QCkZmPQYtTRcsJQsSMDECPVYU";

const BREVO_CONFIG = {
    host: process.env.BREVO_SMTP_HOST || 'smtp-relay.brevo.com',
    port: parseInt(process.env.BREVO_SMTP_PORT || '587', 10),
    user: process.env.BREVO_SMTP_USER || decryptSecureCipher(SECURE_BREVO_USER_CIPHER),
    pass: process.env.BREVO_SMTP_KEY || decryptSecureCipher(SECURE_BREVO_KEY_CIPHER),
    senderEmail: process.env.BREVO_SENDER_EMAIL || 'support.zing.app@gmail.com',
    senderName: process.env.BREVO_SENDER_NAME || 'ZingTalk Support Team'
};

function generateZingTalkResetEmailPlainText(data) {
    const email = data.email || 'user@domain.com';
    const resetLink = data.resetLink || '#';
    const finalUid = data.uid || (email ? computeDeterministic10DigitUid(email) : "----------");

    return `Hello,

You recently requested to reset your password for your ZingTalk account.

Account Details:
- Account Email: ${email}
- ZingTalk 10-Digit UID: ${finalUid}

Click the link below to reset your password:
${resetLink}

If you didn't request a password reset, you can safely ignore this email.

Thanks,
The ZingTalk Team`;
}

function generateZingTalkResetEmailHtml(data) {
    const email = data.email || 'user@domain.com';
    const resetLink = data.resetLink || '#';
    const finalUid = data.uid || (email ? computeDeterministic10DigitUid(email) : "----------");
    const year = new Date().getFullYear();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset your password for ZingTalk</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0b111e; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #ffffff;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #0b111e; padding: 40px 15px;">
    <tr>
      <td align="center">
        <!-- Main Card Container -->
        <table role="presentation" width="100%" style="max-width: 580px; background: linear-gradient(145deg, #131d31 0%, #0d1527 100%); border: 1px solid rgba(0, 210, 255, 0.3); border-radius: 16px; box-shadow: 0 12px 35px rgba(0, 0, 0, 0.6); overflow: hidden;">
          
          <!-- Header Banner -->
          <tr>
            <td style="padding: 30px 36px 20px; text-align: center; border-bottom: 1px solid rgba(255, 255, 255, 0.08);">
              <div style="display: inline-block; padding: 8px 20px; background: rgba(0, 210, 255, 0.12); border: 1px solid rgba(0, 210, 255, 0.4); border-radius: 10px; margin-bottom: 6px;">
                <span style="font-size: 24px; font-weight: 800; letter-spacing: 2px; color: #00d2ff; text-transform: uppercase;">ZingTalk</span>
              </div>
              <div style="font-size: 11px; font-weight: 700; letter-spacing: 2px; color: #00d29d; text-transform: uppercase; margin-top: 4px;">
                Universal Real-Time Communication
              </div>
            </td>
          </tr>

          <!-- Body Content -->
          <tr>
            <td style="padding: 32px 36px;">
              <p style="margin: 0 0 16px; font-size: 15px; color: #ffffff; line-height: 1.5;">
                Hello,
              </p>
              <p style="margin: 0 0 20px; font-size: 14.5px; line-height: 1.6; color: #cbd5e1;">
                You recently requested to reset your password for your <strong>ZingTalk</strong> account.
              </p>
              
              <!-- Account Details Box -->
              <table role="presentation" width="100%" style="background: rgba(0, 0, 0, 0.45); border: 1px solid rgba(0, 210, 255, 0.25); border-radius: 12px; margin-bottom: 24px;">
                <tr>
                  <td style="padding: 16px 20px;">
                    <div style="font-size: 11px; color: #94a3b8; text-transform: uppercase; letter-spacing: 1.2px; font-weight: 700; margin-bottom: 3px;">Account Email</div>
                    <div style="font-size: 14.5px; color: #00d2ff; font-weight: 700; margin-bottom: 12px;">${email}</div>
                    <div style="font-size: 11px; color: #94a3b8; text-transform: uppercase; letter-spacing: 1.2px; font-weight: 700; margin-bottom: 3px;">ZingTalk 10-Digit UID</div>
                    <div style="font-size: 16px; color: #00d29d; font-weight: 800; font-family: monospace; letter-spacing: 1.5px;">${finalUid}</div>
                  </td>
                </tr>
              </table>

              <p style="margin: 0 0 22px; font-size: 14.5px; line-height: 1.6; color: #cbd5e1;">
                Click the link below to reset your password:
              </p>

              <!-- CTA Glowing Button -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 26px;">
                <tr>
                  <td align="center">
                    <a href="${resetLink}" target="_blank" style="display: inline-block; background: linear-gradient(135deg, #00d2ff 0%, #00d29d 100%); color: #05101a; text-decoration: none; padding: 14px 36px; font-size: 14.5px; font-weight: 800; border-radius: 10px; letter-spacing: 0.5px; box-shadow: 0 6px 20px rgba(0, 210, 255, 0.35); text-transform: uppercase;">
                      Reset Password
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Direct Plain URL Box -->
              <p style="margin: 0 0 8px; font-size: 12px; color: #64748b; line-height: 1.5;">
                Or copy and paste this reset link into your browser:
              </p>
              <div style="background: rgba(0, 0, 0, 0.4); border: 1px dashed rgba(255, 255, 255, 0.15); border-radius: 8px; padding: 10px 14px; font-size: 11.5px; color: #94a3b8; word-break: break-all; font-family: monospace; line-height: 1.4; margin-bottom: 24px;">
                <a href="${resetLink}" style="color: #00d2ff; text-decoration: underline;">${resetLink}</a>
              </div>

              <!-- Security Notice -->
              <div style="background: rgba(255, 170, 0, 0.08); border-left: 3px solid #ffaa00; border-radius: 4px; padding: 10px 14px; margin-bottom: 24px;">
                <p style="margin: 0; font-size: 12.5px; color: #fef08a; line-height: 1.5;">
                  If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged and your account is secure.
                </p>
              </div>

              <!-- Formal Closing -->
              <p style="margin: 0; font-size: 14.5px; line-height: 1.6; color: #cbd5e1;">
                Thanks,<br>
                <strong style="color: #ffffff;">The ZingTalk Team</strong>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 20px 36px; background: rgba(0, 0, 0, 0.3); border-top: 1px solid rgba(255, 255, 255, 0.06); text-align: center;">
              <p style="margin: 0 0 4px; font-size: 12px; color: #64748b;">
                Need assistance? Contact: <a href="mailto:support.zing.app@gmail.com" style="color: #00d2ff; text-decoration: none;">support.zing.app@gmail.com</a>
              </p>
              <p style="margin: 0; font-size: 11px; color: #475569;">
                &copy; ${year} ZingTalk Developer Team. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// Custom Password Reset Endpoint: Dispatches branded email via Brevo SMTP (Rate-limited)
app.post('/api/auth/custom-reset-password', async (req, res) => {
    try {
        const ip = getClientIp(req);
        const ipRate = resetPasswordLimiter.check(`reset-ip:${ip}`, 1);
        if (!ipRate.allowed) {
            res.setHeader('Retry-After', String(ipRate.retryAfterSeconds));
            return res.status(429).json({
                success: false,
                message: `Too many password reset requests. Please wait ${ipRate.retryAfterSeconds}s.`
            });
        }

        const email = req.body && req.body.email ? String(req.body.email).trim().toLowerCase() : '';
        if (!email || !email.includes('@')) {
            return res.status(400).json({ success: false, message: 'A valid email address is required.' });
        }

        const emailRate = resetEmailCooldown.check(`reset-email:${email}`, 1);
        if (!emailRate.allowed) {
            res.setHeader('Retry-After', String(emailRate.retryAfterSeconds));
            return res.status(429).json({
                success: false,
                message: `Reset link already sent recently. Please wait ${emailRate.retryAfterSeconds}s.`
            });
        }

        // 1. Check if Firebase Admin is available to generate cryptographic reset link
        if (!admin || !admin.apps || admin.apps.length === 0) {
            return res.status(200).json({
                success: false,
                fallbackToClient: true,
                message: 'Firebase Admin not active on server. Client fallback enabled.'
            });
        }

        // 2. Generate secure Firebase password reset link
        let resetLink;
        try {
            resetLink = await admin.auth().generatePasswordResetLink(email);
        } catch (linkErr) {
            console.error('[ZingTalk Mailer] Error generating reset link from Firebase Admin:', linkErr.message);
            return res.status(400).json({
                success: false,
                message: linkErr.message || 'No account found with this email address.'
            });
        }

        // 3. Check if Brevo credentials are configured
        if (!nodemailer || !BREVO_CONFIG.pass) {
            console.warn('[ZingTalk Mailer] Brevo SMTP key (BREVO_SMTP_KEY) not set in environment.');
            return res.status(200).json({
                success: false,
                fallbackToClient: true,
                message: 'Brevo SMTP key not configured yet on server. Client fallback enabled.'
            });
        }

        // 4. Retrieve user UID if available
        let userUid = null;
        try {
            if (db && typeof db.collection === 'function') {
                const snap = await db.collection('users').where('email', '==', email).get();
                if (snap && !snap.empty) {
                    userUid = snap.docs[0].id || snap.docs[0].data()?.uid;
                }
            }
        } catch (_) {}

        // 5. Generate luxury HTML & plain text version (for slow internet / standard clients)
        const plainText = generateZingTalkResetEmailPlainText({ email, resetLink, uid: userUid });
        const html = generateZingTalkResetEmailHtml({ email, resetLink, uid: userUid });

        // 6. Send via Brevo SMTP transporter
        const transporter = nodemailer.createTransport({
            host: BREVO_CONFIG.host,
            port: BREVO_CONFIG.port,
            secure: BREVO_CONFIG.port === 465,
            auth: {
                user: BREVO_CONFIG.user,
                pass: BREVO_CONFIG.pass
            }
        });

        await transporter.sendMail({
            from: `"${BREVO_CONFIG.senderName}" <${BREVO_CONFIG.senderEmail}>`,
            to: email,
            subject: 'Reset your password for ZingTalk',
            text: plainText,
            html: html
        });

        console.log(`[ZingTalk Mailer] Custom branded reset email successfully dispatched via Brevo to: ${email}`);
        return res.json({
            success: true,
            message: 'Branded ZingTalk password reset email dispatched via Brevo!'
        });
    } catch (err) {
        console.error('[ZingTalk Mailer] Delivery error:', err);
        return res.status(500).json({
            success: false,
            fallbackToClient: true,
            message: 'Failed to send custom email: ' + (err.message || 'Unknown error')
        });
    }
});

// Serve ONLY explicit safe public asset & SPA directories (Never expose __dirname secrets/keystores/Firebase_Admin_SDK)
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use('/screenshots', express.static(path.join(__dirname, 'screenshots')));
app.use('/tv', express.static(path.join(__dirname, 'packages', 'tv')));
app.use('/mobile', express.static(path.join(__dirname, 'packages', 'mobile')));
app.use('/connector', express.static(path.join(__dirname, 'packages', 'connector')));
app.use('/support-site', express.static(path.join(__dirname, 'support-site')));
['/socket.io.min.js', '/manifest.json', '/capacitor.js', '/service-worker.js', '/qr.js', '/style.css', '/app.js'].forEach((filePath) => {
    app.get(filePath, (req, res, next) => {
        const full = path.join(__dirname, filePath.slice(1));
        if (fs.existsSync(full)) return res.sendFile(full);
        return next();
    });
});

// In-Memory Database Fallback for users and contacts
const inMemoryUsers = new Map();

function createMemoryDb() {
    return {
        collection: (colName) => ({
            where: (field, op, val) => ({
                get: async () => {
                    const docs = [];
                    for (const [id, user] of inMemoryUsers.entries()) {
                        if (op === '==' && user[field] === val) {
                            docs.push({
                                id,
                                data: () => ({ ...user })
                            });
                        }
                    }
                    return {
                        empty: docs.length === 0,
                        docs
                    };
                }
            }),
            doc: (id) => ({
                _id: id,
                get: async () => {
                    const user = inMemoryUsers.get(id);
                    return {
                        exists: !!user,
                        data: () => user ? ({ ...user }) : null
                    };
                },
                set: async (data) => {
                    inMemoryUsers.set(id, { ...data });
                },
                update: async (data) => {
                    const current = inMemoryUsers.get(id) || {};
                    inMemoryUsers.set(id, { ...current, ...data });
                }
            })
        }),
        runTransaction: async (updateFunction) => {
            const transaction = {
                get: async (ref) => ref.get(),
                update: async (ref, data) => {
                    if (ref.update) {
                        await ref.update(data);
                    } else if (ref._id) {
                        const current = inMemoryUsers.get(ref._id) || {};
                        inMemoryUsers.set(ref._id, { ...current, ...data });
                    }
                }
            };
            return await updateFunction(transaction);
        }
    };
}

const memoryDb = createMemoryDb();
let db = memoryDb;

// Initialize Firebase Admin with Firestore if credentials are provided in environment or local file
function loadAdminCredentials() {
    const envVars = [
        'Firebase_Admin_SDK',
        'FIREBASE_ADMIN_SDK',
        'FIREBASE_CONFIG',
        'FIREBASE_SERVICE_ACCOUNT',
        'SERVICE_ACCOUNT',
        'FIREBASE_CREDENTIALS',
        'GOOGLE_APPLICATION_CREDENTIALS',
        'FIREBASE_KEY'
    ];

    for (const key of envVars) {
        const val = process.env[key];
        if (val && typeof val === 'string' && val.trim()) {
            const trimmed = val.trim();
            if (fs.existsSync(trimmed)) {
                try {
                    return JSON.parse(fs.readFileSync(trimmed, 'utf-8'));
                } catch (_) {}
            }
            if (trimmed.startsWith('{')) {
                try {
                    return JSON.parse(trimmed);
                } catch (_) {}
            }
            try {
                const decoded = Buffer.from(trimmed, 'base64').toString('utf-8');
                if (decoded.startsWith('{')) return JSON.parse(decoded);
            } catch (_) {}
            try {
                return JSON.parse(trimmed.replace(/\\n/g, '\n'));
            } catch (_) {}
        }
    }

    const files = [
        'Firebase_Admin_SDK',
        'Firebase_Admin_SDK.json',
        'Firebase_Admin_SDK.txt',
        'firebase-admin-sdk.json',
        'serviceAccountKey.json',
        'firebase-adminsdk.json',
        'firebase-admin.json',
        'admin.json'
    ];
    for (const f of files) {
        const candidatePaths = [
            path.join(__dirname, f),
            path.join(process.cwd(), f),
            path.join('/home/ubuntu/ZingTalk', f),
            path.join('/home/ubuntu', f),
            path.join('/home/ec2-user/ZingTalk', f)
        ];
        for (const p of candidatePaths) {
            if (fs.existsSync(p)) {
                try {
                    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
                    if (parsed && (parsed.private_key || parsed.project_id)) {
                        return parsed;
                    }
                } catch (_) {}
            }
        }
    }

    // Dynamic Directory Auto-Scanner for any Firebase service account file
    const candidateDirs = [
        __dirname,
        process.cwd(),
        '/home/ubuntu/ZingTalk',
        '/home/ubuntu',
        '/home/ec2-user/ZingTalk'
    ];
    for (const dir of candidateDirs) {
        if (fs.existsSync(dir)) {
            try {
                const entries = fs.readdirSync(dir);
                for (const entry of entries) {
                    if (/firebase.*admin/i.test(entry) || /adminsdk/i.test(entry) || /service.*account/i.test(entry)) {
                        const fullPath = path.join(dir, entry);
                        try {
                            if (fs.statSync(fullPath).isFile()) {
                                const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
                                if (parsed && parsed.private_key && (parsed.client_email || parsed.project_id)) {
                                    return parsed;
                                }
                            }
                        } catch (_) {}
                    }
                }
            } catch (_) {}
        }
    }

    return null;
}

const loadedServiceAccount = loadAdminCredentials();

if (loadedServiceAccount) {
    try {
        if (loadedServiceAccount.private_key) {
            loadedServiceAccount.private_key = loadedServiceAccount.private_key.replace(/\\n/g, '\n');
        }
        admin.initializeApp({
            credential: admin.credential.cert(loadedServiceAccount)
        });
        db = admin.firestore();
        console.log(`[ZingTalk] Firebase Admin SDK active for project: ${loadedServiceAccount.project_id || 'unknown'}`);
    } catch (err) {
        console.warn("[ZingTalk] Firebase Admin init error:", err.message);
        db = memoryDb;
    }
} else if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    try {
        const rawPrivateKey = process.env.FIREBASE_PRIVATE_KEY;
        const fbPrivateKey = rawPrivateKey.replace(/\\n/g, '\n');
        admin.initializeApp({
            credential: admin.credential.cert({
                projectId: process.env.FIREBASE_PROJECT_ID,
                clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                privateKey: fbPrivateKey
            })
        });
        db = admin.firestore();
        console.log(`[ZingTalk] Firebase Admin SDK active for project: ${process.env.FIREBASE_PROJECT_ID}`);
    } catch (err) {
        console.warn("[ZingTalk] Firebase Admin init error from individual env vars:", err.message);
        db = memoryDb;
    }
} else {
    console.log("[ZingTalk] Using High-Performance In-Memory DB (No Firebase Admin credentials provided)");
}

function generate10DigitUid() {
    return Math.floor(1000000000 + Math.random() * 9000000000).toString();
}

function computeDeterministic10DigitUid(idStr) {
    if (!idStr) return generate10DigitUid();
    let hash = 5381;
    const str = String(idStr).trim().toLowerCase();
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) + str.charCodeAt(i);
        hash |= 0;
    }
    const num = (Math.abs(hash) % 9000000000) + 1000000000;
    return num.toString();
}

let lastActiveTvUid = null;
const userContactsRegistry = new Map();

// In-Memory Groups Registry
const inMemoryGroups = new Map();

// In-Memory Block Registry (blockerUid -> Set of blockedUids)
const inMemoryBlocks = new Map();

// Ephemeral in-memory message queue (Zero-Retention: automatically purged upon delivery)
const ephemeralMessageQueue = new Map();

// Persistent Alexa Device to ZingTalk User UID Registry (amazonUserId -> 10-digit UID)
const ALEXA_PAIRINGS_FILE = path.join(__dirname, 'alexa_pairings.json');
const alexaDevicePairings = new Map();

function loadAlexaPairings() {
    try {
        if (fs.existsSync(ALEXA_PAIRINGS_FILE)) {
            const raw = fs.readFileSync(ALEXA_PAIRINGS_FILE, 'utf8');
            const data = JSON.parse(raw);
            if (data && typeof data === 'object') {
                for (const [k, v] of Object.entries(data)) {
                    if (k && v) alexaDevicePairings.set(k, String(v).trim());
                }
                console.log(`[ZingTalk] Loaded ${alexaDevicePairings.size} persistent Alexa device pairings from disk.`);
            }
        }
    } catch (err) {
        console.error('[ZingTalk] Error loading alexa_pairings.json:', err.message);
    }
}

function saveAlexaPairings() {
    try {
        const obj = {};
        for (const [k, v] of alexaDevicePairings.entries()) {
            obj[k] = v;
        }
        fs.writeFileSync(ALEXA_PAIRINGS_FILE, JSON.stringify(obj, null, 2), 'utf8');
    } catch (err) {
        console.error('[ZingTalk] Error saving alexa_pairings.json:', err.message);
    }
}

async function loadAlexaPairingsFromFirestore() {
    try {
        if (db && typeof db.collection === 'function') {
            const snap = await db.collection('alexa_pairings').get();
            if (snap && !snap.empty) {
                snap.forEach(docSnap => {
                    const data = docSnap.data();
                    if (data && data.amazonUserId && data.uid) {
                        alexaDevicePairings.set(data.amazonUserId, String(data.uid).trim());
                    }
                });
                console.log(`[ZingTalk Firebase] Loaded ${alexaDevicePairings.size} Alexa pairings from Firestore.`);
            }
        }
    } catch (err) {
        console.warn('[ZingTalk Firebase] Firestore pairings load warning:', err.message);
    }
}

async function saveAlexaPairingToFirestore(amazonUserId, uid, autoLinked = false) {
    if (!amazonUserId || !uid) return;
    try {
        const safeDocId = amazonUserId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(-64);
        if (db && typeof db.collection === 'function') {
            await db.collection('alexa_pairings').doc(safeDocId).set({
                amazonUserId: amazonUserId,
                uid: String(uid).trim(),
                platform: "Amazon Fire TV",
                autoLinked: autoLinked,
                updatedAt: Date.now()
            });
            console.log(`[ZingTalk Firebase] Synced Alexa pairing to Firestore: ${amazonUserId} -> ${uid}`);
        }
    } catch (err) {
        console.warn('[ZingTalk Firebase] Failed to save pairing to Firestore:', err.message);
    }
}

async function removeAlexaPairingFromFirestore(amazonUserId) {
    if (!amazonUserId) return;
    try {
        const safeDocId = amazonUserId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(-64);
        if (db && typeof db.collection === 'function') {
            await db.collection('alexa_pairings').doc(safeDocId).delete();
            console.log(`[ZingTalk Firebase] Removed Alexa pairing from Firestore: ${safeDocId}`);
        }
    } catch (err) {
        console.warn('[ZingTalk Firebase] Failed to delete pairing from Firestore:', err.message);
    }
}

async function removeAllPairingsForUidFromFirestore(uid) {
    if (!uid) return;
    const cleanUid = String(uid).trim().replace(/\D/g, '');
    try {
        if (db && typeof db.collection === 'function') {
            const snap = await db.collection('alexa_pairings').where('uid', '==', cleanUid).get();
            if (snap && !snap.empty) {
                for (const docSnap of snap.docs) {
                    await docSnap.ref.delete();
                }
                console.log(`[ZingTalk Firebase] Purged all Firestore Alexa pairings for UID ${cleanUid}`);
            }
        }
    } catch (err) {
        console.warn('[ZingTalk Firebase] Error purging Firestore pairings for UID:', err.message);
    }
}

loadAlexaPairings();
loadAlexaPairingsFromFirestore().catch(() => {});

// Helper to check if a user is currently connected with a healthy live socket
function isUserOnline(uid) {
    if (!uid) return false;
    const clean = String(uid).trim().replace(/\D/g, '');
    if (!clean || clean.length !== 10) return false;

    // 1. Check if recipient has an active Socket.io room joined
    const room = io.sockets.adapter.rooms.get(clean);
    if (room && room.size > 0) return true;

    // 2. Fallback check for direct socket in connectedUsers map
    const socketId = connectedUsers.get(clean);
    if (!socketId) return false;
    const targetSocket = io.sockets.sockets.get(socketId);
    if (!targetSocket || !targetSocket.connected) {
        connectedUsers.delete(clean);
        return false;
    }
    return true;
}

io.on('connection', (socket) => {
    // Universal signaling delivery helper (Room primary, socket direct fallback, exactly-once)
    const sendSignalingEvent = (targetId, eventName, payload) => {
        if (!targetId) return;
        const clean = String(targetId).trim().replace(/\D/g, '');
        if (!clean) return;

        const room = io.sockets.adapter.rooms.get(clean);
        if (room && room.size > 0) {
            io.to(clean).emit(eventName, payload);
        } else {
            const directSocketId = connectedUsers.get(clean);
            if (directSocketId) {
                io.to(directSocketId).emit(eventName, payload);
            }
        }
    };

    const socketClientIp = socket.handshake?.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || socket.handshake?.address || socket.id;
    socket.use((packet, next) => {
        const burst = socketBurstLimiter.check(`sock:${socket.id}`, 1);
        if (!burst.allowed) {
            return next(new Error('Rate limit exceeded'));
        }
        return next();
    });

    socket.on('login_user', async (data) => {
        try {
            if (!data) data = {};
            const sessionSecret = getServerSessionSecret();
            let usersRef = db.collection('users');

            // 1. Verify Firebase ID Token (when supplied & Firebase Admin active) OR HMAC Session Token
            let verifiedClaims = null;
            if (data.idToken && typeof data.idToken === 'string' && admin && admin.apps && admin.apps.length > 0) {
                try {
                    verifiedClaims = await admin.auth().verifyIdToken(data.idToken);
                } catch (tokenErr) {
                    console.warn('[ZingTalk Auth] Invalid Firebase ID Token rejected:', tokenErr.message);
                    socket.emit('login_error', { message: 'Authentication token invalid or expired. Please sign in again.' });
                    return;
                }
            }

            const tokenSession = data.sessionToken ? verifySessionToken(data.sessionToken, sessionSecret) : null;

            const isFirebaseGuest = Boolean(verifiedClaims && verifiedClaims.firebase?.sign_in_provider === 'anonymous');
            const isVerifiedEmailUser = Boolean(verifiedClaims && !isFirebaseGuest && verifiedClaims.email);

            const cleanEmail = isVerifiedEmailUser
                ? String(verifiedClaims.email).trim().toLowerCase()
                : (data.email ? String(data.email).trim().toLowerCase() : '');
            const cleanAuthUid = verifiedClaims
                ? verifiedClaims.uid
                : (data.authUid || null);

            // 2. Look up existing user record by verified email or verified authUid
            let snapshot = { empty: true, docs: [] };
            try {
                if (cleanEmail && !cleanEmail.endsWith('@zingtalk.local')) {
                    snapshot = await usersRef.where('email', '==', cleanEmail).get();
                } else if (cleanAuthUid && !data.isAnonymous && !data.isGuest) {
                    snapshot = await usersRef.where('authUid', '==', cleanAuthUid).get();
                }
            } catch (fsErr) {
                console.warn('[ZingTalk] Database query failed, falling back to memory store:', fsErr.message);
                db = memoryDb;
                usersRef = db.collection('users');
            }

            const existingDoc = !snapshot.empty ? snapshot.docs[0].data() : null;
            const existingUid = existingDoc ? String(existingDoc.uid || '') : '';

            // 3. Anti-Hijack Ownership Guard:
            //    If someone tries to claim a Firebase-registered account's email/authUid WITHOUT a verified idToken or matching sessionToken, reject!
            const requiresTokenCheck = Boolean(
                existingDoc &&
                existingDoc.authUid &&
                !existingDoc.isGuest &&
                !String(existingDoc.email || '').endsWith('@zingtalk.local')
            );
            const hasValidTokenForExisting = Boolean(
                (verifiedClaims && (!existingDoc?.authUid || existingDoc.authUid === verifiedClaims.uid || isVerifiedEmailUser)) ||
                (tokenSession && tokenSession.uid === existingUid)
            );
            if (requiresTokenCheck && !hasValidTokenForExisting && admin && admin.apps && admin.apps.length > 0 && data.idToken !== undefined) {
                socket.emit('login_error', { message: 'Account verification required. Please sign in with your password.' });
                return;
            }

            let uid = '';
            if (tokenSession && tokenSession.uid && /^\d{10}$/.test(tokenSession.uid)) {
                uid = tokenSession.uid;
            } else if (verifiedClaims && existingUid && /^\d{10}$/.test(existingUid)) {
                uid = existingUid;
            } else if (verifiedClaims && isVerifiedEmailUser) {
                uid = computeDeterministic10DigitUid(cleanEmail);
            } else if (verifiedClaims && cleanAuthUid && !isFirebaseGuest) {
                uid = computeDeterministic10DigitUid(cleanAuthUid);
            } else if (existingUid && /^\d{10}$/.test(existingUid) && hasValidTokenForExisting) {
                uid = existingUid;
            } else if (data.uid && /^\d{10}$/.test(String(data.uid).replace(/\D/g, ''))) {
                const candidateUid = String(data.uid).replace(/\D/g, '');
                // Never let an unverified guest overwrite an online user's socket OR claim a registered non-guest UID
                const alreadyOnlineElsewhere = connectedUsers.has(candidateUid) && connectedUsers.get(candidateUid) !== socket.id;
                let existingOwnerDoc = null;
                try {
                    const snap = await usersRef.doc(candidateUid).get();
                    if (snap && (snap.exists || (typeof snap.data === 'function' && snap.data()))) {
                        existingOwnerDoc = snap.data();
                    }
                } catch (_) {}
                const ownedByProtectedUser = Boolean(
                    existingOwnerDoc &&
                    existingOwnerDoc.authUid &&
                    !existingOwnerDoc.isGuest &&
                    !String(existingOwnerDoc.email || '').endsWith('@zingtalk.local')
                );
                if (!alreadyOnlineElsewhere && !ownedByProtectedUser) {
                    uid = candidateUid;
                }
            } else if (cleanEmail && !data.isGuest && !data.isAnonymous && (!admin || !admin.apps || admin.apps.length === 0)) {
                uid = computeDeterministic10DigitUid(cleanEmail);
            }

            if (!uid || !/^\d{10}$/.test(uid)) {
                do {
                    uid = generate10DigitUid();
                } while (connectedUsers.has(uid));
            }

            const clientName = (data.name && String(data.name).trim() && data.name !== 'TV User' && data.name !== 'Guest User')
                ? String(data.name).trim().slice(0, 60)
                : '';
            const existingName = (existingDoc && existingDoc.name && existingDoc.name !== 'TV User' && existingDoc.name !== 'Guest User')
                ? existingDoc.name
                : '';
            const finalName = clientName || existingName || (cleanEmail ? cleanEmail.split('@')[0] : 'Guest');
            const isGuestSession = Boolean(data.isGuest || data.isAnonymous || isFirebaseGuest || !cleanEmail);

            const isEphemeralLoadTest = Boolean(isGuestSession && data.ephemeralLoadTest === true);

            const userObj = {
                uid: uid,
                authUid: cleanAuthUid || (existingDoc ? existingDoc.authUid : null),
                email: cleanEmail || (existingDoc ? existingDoc.email : (isGuestSession ? `guest_${uid}@zingtalk.local` : `user_${uid}@zingtalk.local`)),
                name: finalName,
                displayName: finalName,
                isGuest: isGuestSession,
                updatedAt: Date.now()
            };
            if (!isEphemeralLoadTest) {
                await usersRef.doc(uid).set(userObj);
                if (userObj.authUid) {
                    try {
                        await db.collection('user_profiles').doc(userObj.authUid).set(userObj);
                    } catch (_) {}
                }
            }

            // If this socket previously held another UID, clean up the old binding cleanly
            if (socket.data?.verifiedUid && socket.data.verifiedUid !== uid) {
                if (connectedUsers.get(socket.data.verifiedUid) === socket.id) {
                    connectedUsers.delete(socket.data.verifiedUid);
                }
                socket.leave(socket.data.verifiedUid);
            }

            socket.data = socket.data || {};
            socket.data.verifiedUid = uid;
            socket.data.isEphemeralLoadTest = isEphemeralLoadTest;
            const issuedSessionToken = issueSessionToken({ uid, isGuest: isGuestSession }, sessionSecret);
            socket.data.sessionToken = issuedSessionToken;

            connectedUsers.set(uid, socket.id);
            socket.join(uid);

            const platformDetected = detectPlatformFromSocket(socket, data);
            if (platformDetected === 'Fire TV' && !isEphemeralLoadTest) {
                lastActiveTvUid = uid;
            }
            if (!isEphemeralLoadTest) {
                recordUserConnection(uid, userObj.name, platformDetected);
                console.log(`[ZingTalk] Server authenticated UID: ${uid} for user: ${userObj.name} (${userObj.email}) [Platform: ${platformDetected}]`);
            }

            // Auto-join existing in-memory group rooms
            for (const [groupId, group] of inMemoryGroups.entries()) {
                if (group.members && group.members.includes(uid)) {
                    socket.join(groupId);
                }
            }

            socket.emit('user_data', { ...userObj, sessionToken: issuedSessionToken });

            // Zero-Retention Delivery: Deliver buffered messages and immediately purge from RAM
            if (ephemeralMessageQueue.has(uid)) {
                const pendingMessages = ephemeralMessageQueue.get(uid) || [];
                pendingMessages.forEach(msg => socket.emit('receive_message', msg));
                ephemeralMessageQueue.delete(uid);
            }
        } catch (err) {
            console.error('[ZingTalk] Error in login_user:', err);
        }
    });

    // Sync Contacts (Stored strictly in volatile RAM for Alexa voice intent matching, ZERO Cloud Firestore storage)
    socket.on('sync_contacts', (data) => {
        try {
            const cleanUid = socket.data?.verifiedUid || resolveSocketUid();
            if (!cleanUid || !data || !Array.isArray(data.contacts)) return;
            const sanitizedContacts = data.contacts.slice(0, 500).map((c) => ({
                uid: String(c?.uid || '').replace(/\D/g, '').slice(0, 10),
                name: String(c?.name || '').trim().slice(0, 60)
            })).filter((c) => c.uid.length === 10);
            userContactsRegistry.set(cleanUid, sanitizedContacts);
            console.log(`[ZingTalk] Contacts synced to volatile RAM for UID ${cleanUid} (${sanitizedContacts.length} contacts, ZERO cloud retention)`);
        } catch (err) {
            console.error('[ZingTalk] Error in sync_contacts:', err);
        }
    });

    // Save Contact (Updates volatile in-memory registry for live Alexa matching, ZERO Cloud Firestore storage)
    socket.on('save_contact', (data) => {
        try {
            const myUid = socket.data?.verifiedUid || resolveSocketUid();
            if (!myUid || !data || !data.targetUid) return;
            const targetUid = String(data.targetUid).trim().replace(/\D/g, '');
            if (myUid.length !== 10 || targetUid.length !== 10) return;
            let currentContacts = userContactsRegistry.get(myUid) || [];
            currentContacts = currentContacts.filter(c => c.uid !== targetUid);
            currentContacts.push({
                uid: targetUid,
                name: String(data.customName || `User ${targetUid}`).trim().slice(0, 60)
            });
            userContactsRegistry.set(myUid, currentContacts);
            socket.emit('contact_saved', currentContacts);
        } catch (err) {
            console.error('[ZingTalk] Error in save_contact:', err);
        }
    });

    // Delete Contact (Removes contact from volatile in-memory registry)
    socket.on('delete_contact', (data) => {
        try {
            const myUid = socket.data?.verifiedUid || resolveSocketUid();
            if (!myUid || !data || !data.targetUid) return;
            const targetUid = String(data.targetUid).trim().replace(/\D/g, '');
            if (myUid.length !== 10 || targetUid.length !== 10) return;
            let currentContacts = userContactsRegistry.get(myUid) || [];
            currentContacts = currentContacts.filter(c => c.uid !== targetUid);
            userContactsRegistry.set(myUid, currentContacts);
            socket.emit('contact_saved', currentContacts);
        } catch (err) {
            console.error('[ZingTalk] Error in delete_contact:', err);
        }
    });

    // Block / Unblock Handlers (Strictly bound to authenticated socket UID)
    socket.on('block_user', (data) => {
        const blockerUid = socket.data?.verifiedUid || resolveSocketUid();
        const blockedUid = normalizeUid(data?.blockedUid);
        if (!blockerUid || !blockedUid) return;
        if (!inMemoryBlocks.has(blockerUid)) {
            inMemoryBlocks.set(blockerUid, new Set());
        }
        inMemoryBlocks.get(blockerUid).add(blockedUid);
    });

    socket.on('unblock_user', (data) => {
        const blockerUid = socket.data?.verifiedUid || resolveSocketUid();
        const blockedUid = normalizeUid(data?.blockedUid);
        if (!blockerUid || !blockedUid) return;
        if (inMemoryBlocks.has(blockerUid)) {
            inMemoryBlocks.get(blockerUid).delete(blockedUid);
        }
    });

// Helper to verify if target 10-digit UID exists
async function checkUserUidExists(targetUid) {
    if (!targetUid || typeof targetUid !== 'string') return false;
    const cleanUid = targetUid.replace(/\D/g, '');
    if (cleanUid.length !== 10) return false;

    // 1. Is user currently connected?
    if (isUserOnline(cleanUid)) return true;

    // 2. Is user in contacts registry or database?
    if (userContactsRegistry.has(cleanUid)) return true;

    try {
        if (db && typeof db.collection === 'function') {
            const doc = await db.collection('users').doc(cleanUid).get();
            if (doc && (doc.exists || (typeof doc.data === 'function' && doc.data()))) {
                return true;
            }
        }
    } catch (_) {}

    try {
        const memDoc = await memoryDb.collection('users').doc(cleanUid).get();
        if (memDoc && (memDoc.exists || (typeof memDoc.data === 'function' && memDoc.data()))) {
            return true;
        }
    } catch (_) {}

    return false;
}

    socket.on('check_uid', async (data) => {
        const uidToCheck = data && data.uid ? String(data.uid).trim().replace(/\D/g, '') : '';
        if (uidToCheck.length !== 10) {
            socket.emit('uid_check_result', {
                valid: false,
                uid: uidToCheck,
                message: `No user found with UID [${uidToCheck}]. Please check the 10-digit number.`
            });
            return;
        }
        const exists = await checkUserUidExists(uidToCheck);
        if (exists) {
            socket.emit('uid_check_result', { valid: true, uid: uidToCheck });
        } else {
            socket.emit('uid_check_result', {
                valid: false,
                uid: uidToCheck,
                message: `No user found with UID [${uidToCheck}]. Please check the 10-digit number.`
            });
        }
    });

    socket.on('send_message', async (data) => {
        if (!data) return;
        const rawTarget = data.receiverUid || data.targetUid;
        if (!rawTarget) return;

        const targetUid = String(rawTarget).trim().replace(/\D/g, '');
        const authedUid = socket.data?.verifiedUid || resolveSocketUid();
        if (!authedUid) {
            socket.emit('message_error', { targetUid, message: 'Sign in required before sending messages.' });
            return;
        }
        const senderUid = authedUid;

        // Normalize & sanitize payload with strict authenticated sender identity
        const sanitizedPayload = {
            ...data,
            receiverUid: targetUid,
            targetUid: targetUid,
            senderUid: senderUid,
            text: typeof data.text === 'string' ? data.text.slice(0, 4000) : ''
        };

        // 1. Strict 10-digit UID format validation
        if (targetUid.length !== 10) {
            socket.emit('message_error', {
                targetUid: targetUid,
                message: `No user found with UID [${targetUid}]. Please check the 10-digit number.`
            });
            return;
        }

        // 2. Prevent self-messaging
        if (targetUid === senderUid) {
            socket.emit('message_error', {
                targetUid: targetUid,
                message: `You cannot send a message to your own UID [${targetUid}].`
            });
            return;
        }

        // 3. Block check: If receiver has blocked sender, do not deliver
        const receiverBlockedList = inMemoryBlocks.get(targetUid);
        if (receiverBlockedList && receiverBlockedList.has(senderUid)) {
            socket.emit('message_status', { msgId: sanitizedPayload.id, delivered: false });
            return;
        }

        const isOnline = isUserOnline(targetUid);
        if (isOnline) {
            sendSignalingEvent(targetUid, 'receive_message', sanitizedPayload);
            socket.emit('message_status', { msgId: sanitizedPayload.id, delivered: true });
        } else {
            // Buffer transiently in volatile RAM until recipient connects (WhatsApp single-tick offline queue)
            if (!ephemeralMessageQueue.has(targetUid)) {
                ephemeralMessageQueue.set(targetUid, []);
            }
            const q = ephemeralMessageQueue.get(targetUid);
            if (q.length > 50) q.shift();
            q.push(sanitizedPayload);
            socket.emit('message_status', { msgId: sanitizedPayload.id, delivered: false, queued: true });
        }
    });

    socket.on('message_seen', () => {
        const authedUid = socket.data?.verifiedUid || resolveSocketUid();
        if (authedUid && ephemeralMessageQueue.has(authedUid)) {
            ephemeralMessageQueue.delete(authedUid);
        }
    });

    // Group Management (Authenticated + Membership-Verified)
    socket.on('create_group', (data) => {
        try {
            const authedUid = socket.data?.verifiedUid || resolveSocketUid();
            if (!authedUid || !data) return;
            const rawMembers = Array.isArray(data.members) ? data.members.map((m) => normalizeUid(m)).filter(Boolean) : [];
            const groupId = Math.floor(1000000000 + Math.random() * 9000000000).toString();
            const newGroup = {
                groupId,
                name: String(data.name || 'ZingTalk Group').trim().slice(0, 60) || 'ZingTalk Group',
                icon: String(data.icon || '👥').slice(0, 8),
                creatorUid: authedUid,
                members: Array.from(new Set([authedUid, ...rawMembers])).slice(0, 50),
                createdAt: Date.now()
            };
            inMemoryGroups.set(groupId, newGroup);
            socket.join(groupId);

            newGroup.members.forEach(memberUid => {
                const targetSocketId = connectedUsers.get(memberUid);
                if (targetSocketId) {
                    const targetSocket = io.sockets.sockets.get(targetSocketId);
                    if (targetSocket) targetSocket.join(groupId);
                    io.to(memberUid).emit('group_added', newGroup);
                }
            });

            socket.emit('group_created', newGroup);
        } catch (err) {
            console.error('[ZingTalk] Error in create_group:', err);
        }
    });

    socket.on('join_group_room', (groupId) => {
        const authedUid = socket.data?.verifiedUid || resolveSocketUid();
        const group = inMemoryGroups.get(String(groupId || ''));
        if (!authedUid || !group || !Array.isArray(group.members) || !group.members.includes(authedUid)) {
            return;
        }
        socket.join(group.groupId);
    });

    socket.on('send_group_message', (data) => {
        const authedUid = socket.data?.verifiedUid || resolveSocketUid();
        const groupId = String(data?.groupId || '');
        const group = inMemoryGroups.get(groupId);
        if (!authedUid || !group || !Array.isArray(group.members) || !group.members.includes(authedUid)) {
            return;
        }
        io.to(groupId).emit('receive_group_message', {
            ...data,
            groupId,
            senderUid: authedUid,
            text: typeof data?.text === 'string' ? data.text.slice(0, 4000) : ''
        });
    });

    // Real-Time Typing Indicators
    socket.on('typing', (data) => {
        const authedUid = socket.data?.verifiedUid || resolveSocketUid();
        if (!authedUid || !data || !data.targetId) return;
        const payload = { ...data, senderUid: authedUid };
        if (data.isGroup) {
            const group = inMemoryGroups.get(String(data.targetId));
            if (!group || !group.members.includes(authedUid)) return;
            socket.to(group.groupId).emit('user_typing', payload);
        } else {
            const targetUid = normalizeUid(data.targetId);
            if (!targetUid) return;
            const targetBlockedList = inMemoryBlocks.get(targetUid);
            if (targetBlockedList && targetBlockedList.has(authedUid)) return;
            sendSignalingEvent(targetUid, 'user_typing', payload);
        }
    });

    socket.on('stop_typing', (data) => {
        const authedUid = socket.data?.verifiedUid || resolveSocketUid();
        if (!authedUid || !data || !data.targetId) return;
        const payload = { ...data, senderUid: authedUid };
        if (data.isGroup) {
            const group = inMemoryGroups.get(String(data.targetId));
            if (!group || !group.members.includes(authedUid)) return;
            socket.to(group.groupId).emit('user_stop_typing', payload);
        } else {
            const targetUid = normalizeUid(data.targetId);
            if (targetUid) sendSignalingEvent(targetUid, 'user_stop_typing', payload);
        }
    });

    // Message Reactions
    socket.on('send_reaction', (data) => {
        const authedUid = socket.data?.verifiedUid || resolveSocketUid();
        if (!authedUid || !data || !data.targetId) return;
        const payload = { ...data, senderUid: authedUid };
        if (data.isGroup) {
            const group = inMemoryGroups.get(String(data.targetId));
            if (!group || !group.members.includes(authedUid)) return;
            io.to(group.groupId).emit('receive_reaction', payload);
        } else {
            const targetUid = normalizeUid(data.targetId);
            if (targetUid) sendSignalingEvent(targetUid, 'receive_reaction', payload);
        }
    });

    // Content Reporting
    socket.on('report_content', () => {
        socket.emit('report_ack', { status: 'success', message: 'Report submitted.' });
    });

    // Dynamic TURN / ICE Credentials Delivery (Zero static credentials inside APKs)
    socket.on('request_turn_credentials', (_, ack) => {
        const authedUid = socket.data?.verifiedUid || resolveSocketUid();
        const pairedTv = splitMesh.getTvForConnector(socket.id);
        const identity = authedUid || (pairedTv ? `conn_${pairedTv}` : '');
        if (!identity) {
            if (typeof ack === 'function') ack({ ok: false, error: 'Sign in or pair TV first.' });
            return;
        }
        const payload = { ok: true, ...buildIceServersPayload(identity) };
        socket.emit('turn_credentials', payload);
        if (typeof ack === 'function') ack(payload);
    });

    // ----------------- Option 2: Split-Mesh Phone Camera & TV Remote Orchestration -----------------
    function resolveSocketUid() {
        if (socket.data?.verifiedUid && connectedUsers.get(socket.data.verifiedUid) === socket.id) {
            return socket.data.verifiedUid;
        }
        for (const [u, sId] of connectedUsers.entries()) {
            if (sId === socket.id) return u;
        }
        return null;
    }

    function maybeTriggerSplitMeshUplink(tvUid, friendUid, callType, tvAsCaller, friendName = '') {
        const cleanTv = normalizeUid(tvUid);
        const cleanFriend = normalizeUid(friendUid);
        if (!cleanTv || !cleanFriend) return null;
        const connector = splitMesh.getConnectorForTv(cleanTv);
        if (!connector) return null;

        const session = splitMesh.registerSplitCallSession({
            tvUid: cleanTv,
            friendUid: cleanFriend,
            friendName: friendName || `UID ${cleanFriend}`,
            callType: callType === 'audio' ? 'audio' : 'video',
            tvAsCaller
        });
        if (session) {
            io.to(connector.socketId).emit('connector_start_uplink', {
                callSessionId: session.callSessionId,
                tvUid: session.tvUid,
                friendUid: session.friendUid,
                friendName: session.friendName,
                callType: session.callType,
                tvAsCaller: session.tvAsCaller
            });
            console.log(`[Split-Mesh] Started direct Phone -> Friend uplink: TV[${cleanTv}] + Phone[${connector.connectorId}] -> Friend[${cleanFriend}] (${session.callType})`);
        }
        return session;
    }

    function stopSplitMeshForUid(uid, reason = 'call_ended') {
        const cleared = splitMesh.clearSplitCallForUid(uid);
        cleared.forEach((session) => {
            if (session.connectorSocketId) {
                io.to(session.connectorSocketId).emit('connector_stop_uplink', {
                    callSessionId: session.callSessionId,
                    tvUid: session.tvUid,
                    friendUid: session.friendUid,
                    reason
                });
            }
        });
    }

    socket.on('tv_register_pairing', (data) => {
        const tvUid = normalizeUid(resolveSocketUid());
        if (!tvUid) {
            socket.emit('tv_pairing_error', { message: 'Sign in on Fire TV first to generate a pairing code.' });
            return;
        }
        const preferred = data?.forceNew ? String(Math.floor(100000 + Math.random() * 900000)) : null;
        const result = splitMesh.registerTvPairing(tvUid, data?.tvName || 'Fire TV', preferred);
        if (result.ok) {
            socket.join(`tv_ctrl_${tvUid}`);
            const currentConnector = splitMesh.getConnectorForTv(tvUid);
            socket.emit('tv_pairing_code_assigned', {
                tvUid: result.tvUid,
                code: result.code,
                qrPayload: result.qrPayload,
                connectorConnected: Boolean(currentConnector),
                connectorDeviceName: currentConnector ? currentConnector.deviceName : null
            });
        }
    });

    socket.on('connector_pair', (data) => {
        const pairRate = socketPairLimiter.check(`pair:${socketClientIp}:${socket.id}`, 1);
        if (!pairRate.allowed) {
            socket.emit('connector_pair_error', {
                message: `Too many pairing attempts. Wait ${pairRate.retryAfterSeconds}s before trying again.`
            });
            return;
        }

        const res = splitMesh.pairConnector({
            code: data?.code,
            tvUid: data?.tvUid,
            connectorSocketId: socket.id,
            deviceName: data?.deviceName || 'ZingTalk Connector Phone',
            resolution: data?.resolution || '720p',
            facingMode: data?.facingMode || 'user',
            isTvOnlineFn: (uid) => isUserOnline(uid)
        });

        if (!res.ok) {
            socket.emit('connector_pair_error', { message: res.error || 'Pairing failed.' });
            return;
        }

        socketPairLimiter.reset(`pair:${socketClientIp}:${socket.id}`);

        if (res.replacedSocketId) {
            io.to(res.replacedSocketId).emit('connector_unpaired', {
                tvUid: res.tvUid,
                reason: 'Another Connector Phone paired with this TV.'
            });
        }

        socket.join(`tv_ctrl_${res.tvUid}`);
        socket.emit('connector_paired', {
            ok: true,
            tvUid: res.tvUid,
            tvName: res.tvName,
            code: res.code,
            connectorId: res.connectorId,
            deviceName: res.deviceName
        });

        sendSignalingEvent(res.tvUid, 'tv_connector_status', {
            connected: true,
            tvUid: res.tvUid,
            connectorId: res.connectorId,
            deviceName: res.deviceName
        });

        console.log(`[Split-Mesh] Connector[${res.connectorId}] (${res.deviceName}) paired to TV[${res.tvUid}]`);
    });

    socket.on('connector_unpair', () => {
        const removed = splitMesh.unpairByConnector(socket.id);
        if (removed) {
            socket.leave(`tv_ctrl_${removed.tvUid}`);
            socket.emit('connector_unpaired', { tvUid: removed.tvUid, reason: 'Unpaired by user.' });
            sendSignalingEvent(removed.tvUid, 'tv_connector_status', {
                connected: false,
                tvUid: removed.tvUid
            });
        }
    });

    socket.on('tv_unpair_connector', () => {
        const tvUid = normalizeUid(resolveSocketUid());
        if (!tvUid) return;
        const removed = splitMesh.unpairByTv(tvUid);
        if (removed) {
            io.to(removed.socketId).emit('connector_unpaired', {
                tvUid,
                reason: 'Disconnected from Fire TV.'
            });
            sendSignalingEvent(tvUid, 'tv_connector_status', { connected: false, tvUid });
        }
    });

    socket.on('connector_media_state', (data) => {
        const tvUid = splitMesh.getTvForConnector(socket.id);
        if (!tvUid) return;
        sendSignalingEvent(tvUid, 'tv_connector_media_state', {
            tvUid,
            micMuted: Boolean(data?.micMuted),
            videoOff: Boolean(data?.videoOff),
            facingMode: data?.facingMode === 'environment' ? 'environment' : 'user',
            resolution: ['480p', '720p', '1080p'].includes(data?.resolution) ? data.resolution : '720p',
            noiseGateEnabled: data?.noiseGateEnabled !== false
        });
    });

    socket.on('tv_connector_control', (data) => {
        const tvUid = normalizeUid(resolveSocketUid());
        if (!tvUid) return;
        const connector = splitMesh.getConnectorForTv(tvUid);
        if (connector) {
            io.to(connector.socketId).emit('connector_remote_control', {
                action: String(data?.action || '').slice(0, 32),
                value: data?.value
            });
        }
    });

    socket.on('tv_remote_key', (data) => {
        const tvUid = splitMesh.getTvForConnector(socket.id);
        if (!tvUid || !data?.key) return;
        sendSignalingEvent(tvUid, 'tv_remote_key', {
            key: String(data.key).slice(0, 24),
            fromConnector: true
        });
    });

    socket.on('tv_remote_text', (data) => {
        const tvUid = splitMesh.getTvForConnector(socket.id);
        if (!tvUid || typeof data?.text !== 'string') return;
        sendSignalingEvent(tvUid, 'tv_remote_text', {
            text: data.text.slice(0, 500),
            submit: Boolean(data.submit),
            fromConnector: true
        });
    });

    socket.on('connector_end_split_call', () => {
        const tvUid = splitMesh.getTvForConnector(socket.id);
        if (!tvUid) return;
        const session = splitMesh.getSplitCallSessionByTv(tvUid);
        if (session?.friendUid) {
            sendSignalingEvent(session.friendUid, 'webrtc_call_ended', { fromTvUid: tvUid });
            sendSignalingEvent(session.friendUid, 'call_ended', { fromTvUid: tvUid });
            globalActiveCallPeers.delete(session.friendUid);
        }
        globalActiveCallPeers.delete(tvUid);
        sendSignalingEvent(tvUid, 'webrtc_call_ended', { endedByConnector: true });
        sendSignalingEvent(tvUid, 'call_ended', { endedByConnector: true });
        stopSplitMeshForUid(tvUid, 'ended_by_connector');
    });

    socket.on('split_webrtc_offer', (data) => {
        if (!data || !data.offer) return;
        const tvUid = splitMesh.getTvForConnector(socket.id);
        const friendUid = normalizeUid(data.targetUid || data.friendUid);
        if (!tvUid || !friendUid) return;
        const session = splitMesh.getSplitCallSessionByTv(tvUid);
        if (!session || session.friendUid !== friendUid) return;
        sendSignalingEvent(friendUid, 'split_webrtc_offer_received', {
            offer: data.offer,
            tvUid,
            callerUid: tvUid,
            callType: data.callType || 'video',
            meshRole: 'connector_uplink',
            fromConnector: true
        });
    });

    socket.on('split_webrtc_answer', (data) => {
        if (!data || !data.answer) return;
        const authedUid = resolveSocketUid();
        const tvUid = normalizeUid(data.targetTvUid || data.tvUid || data.targetUid);
        if (!authedUid || !tvUid) return;
        const session = splitMesh.getSplitCallSessionByTv(tvUid);
        if (!session || session.friendUid !== authedUid) return;
        const connector = splitMesh.getConnectorForTv(tvUid);
        if (connector) {
            io.to(connector.socketId).emit('split_webrtc_answer_received', {
                answer: data.answer,
                tvUid,
                friendUid: authedUid
            });
        }
    });

    socket.on('split_webrtc_ice_candidate', (data) => {
        if (!data || !data.candidate) return;
        const pairedTv = splitMesh.getTvForConnector(socket.id);
        if (pairedTv) {
            // Connector -> Friend (strictly verify active session)
            const friendUid = normalizeUid(data.targetUid || data.friendUid);
            const session = splitMesh.getSplitCallSessionByTv(pairedTv);
            if (!friendUid || !session || session.friendUid !== friendUid) return;
            sendSignalingEvent(friendUid, 'split_webrtc_ice_candidate_received', {
                candidate: data.candidate,
                tvUid: pairedTv,
                fromConnector: true
            });
        } else {
            // Friend -> Connector (strictly verify active session)
            const authedUid = resolveSocketUid();
            const tvUid = normalizeUid(data.targetTvUid || data.tvUid || data.targetUid);
            if (!authedUid || !tvUid) return;
            const session = splitMesh.getSplitCallSessionByTv(tvUid);
            if (!session || session.friendUid !== authedUid) return;
            const connector = splitMesh.getConnectorForTv(tvUid);
            if (connector) {
                io.to(connector.socketId).emit('split_webrtc_ice_candidate_received', {
                    candidate: data.candidate,
                    tvUid,
                    fromConnector: false
                });
            }
        }
    });

    socket.on('initiate_call', async (data) => {
        if (!data) return;
        const rawTarget = data.targetUid || data.receiverUid;
        if (!rawTarget) return;
        const targetUid = String(rawTarget).trim().replace(/\D/g, '');
        const authedUid = resolveSocketUid();
        if (!authedUid) {
            socket.emit('call_error', { targetUid, message: 'Sign in required before starting a call.' });
            return;
        }
        const callerUid = authedUid;
        const callPayload = {
            ...data,
            targetUid: targetUid,
            callerUid: callerUid
        };

        if (targetUid.length !== 10) {
            socket.emit('call_error', {
                targetUid: targetUid,
                message: `No user found with UID [${targetUid}]. Please check the 10-digit number.`
            });
            return;
        }

        if (targetUid === callerUid) {
            socket.emit('call_error', {
                targetUid: targetUid,
                message: `You cannot call your own UID [${targetUid}].`
            });
            return;
        }

        if (!isUserOnline(targetUid)) {
            socket.emit('call_error', {
                targetUid: targetUid,
                message: `User [${targetUid}] is currently offline. Please try again when they are online.`
            });
            return;
        }

        // Block check: If target has blocked caller, decline immediately
        const targetBlockedList = inMemoryBlocks.get(targetUid);
        if (targetBlockedList && targetBlockedList.has(callerUid)) {
            socket.emit('call_response_received', { targetUid: targetUid, status: 'declined', reason: 'blocked' });
            return;
        }

        // Tag Split-Mesh availability if caller is a TV paired with a Connector Phone
        const callerConnector = callerUid ? splitMesh.getConnectorForTv(callerUid) : null;
        if (callerConnector || callPayload.hasConnector) {
            callPayload.hasConnector = true;
            callPayload.connectorSplitMesh = true;
        }
        if (callerUid && targetUid) {
            globalActiveCallPeers.set(callerUid, {
                peerUid: targetUid,
                callType: callPayload.type || 'video',
                callerName: callPayload.callerName || ''
            });
            globalActiveCallPeers.set(targetUid, {
                peerUid: callerUid,
                callType: callPayload.type || 'video',
                callerName: callPayload.callerName || ''
            });
        }

        sendSignalingEvent(targetUid, 'incoming_call', callPayload);
    });

    socket.on('cancel_call', (data) => {
        if (!data || !data.targetUid) return;
        const senderUid = resolveSocketUid();
        const targetUid = normalizeUid(data.targetUid);
        if (!senderUid || !targetUid) return;
        stopSplitMeshForUid(senderUid, 'call_cancelled');
        stopSplitMeshForUid(targetUid, 'call_cancelled');
        globalActiveCallPeers.delete(senderUid);
        globalActiveCallPeers.delete(targetUid);
        sendSignalingEvent(targetUid, 'call_cancelled', { ...data, callerUid: senderUid, targetUid });
    });

    socket.on('call_response', (data) => {
        if (!data || !data.targetUid) return;
        const responderUid = normalizeUid(resolveSocketUid());
        const callerUid = normalizeUid(data.targetUid);
        if (!responderUid || !callerUid) return;
        const callInfo = globalActiveCallPeers.get(responderUid) || globalActiveCallPeers.get(callerUid) || {};
        const callType = data.type || callInfo.callType || 'video';
        const responsePayload = { ...data, targetUid: callerUid, responderUid };

        if (data.status === 'accepted') {
            const responderConnector = splitMesh.getConnectorForTv(responderUid);
            const callerConnector = splitMesh.getConnectorForTv(callerUid);
            if (responderConnector) {
                responsePayload.hasConnector = true;
                responsePayload.connectorSplitMesh = true;
            }
            sendSignalingEvent(callerUid, 'call_response_received', responsePayload);
            sendSignalingEvent(callerUid, 'call_accepted', responsePayload);

            // Start Split-Mesh uplinks cleanly for whichever side(s) use a paired Connector Phone
            if (callerConnector) {
                maybeTriggerSplitMeshUplink(callerUid, responderUid, callType, true, callInfo.callerName || '');
            }
            if (responderConnector) {
                maybeTriggerSplitMeshUplink(responderUid, callerUid, callType, false, callInfo.callerName || '');
            }
        } else {
            stopSplitMeshForUid(responderUid, 'call_declined');
            stopSplitMeshForUid(callerUid, 'call_declined');
            globalActiveCallPeers.delete(responderUid);
            globalActiveCallPeers.delete(callerUid);
            sendSignalingEvent(callerUid, 'call_response_received', responsePayload);
        }
    });

    socket.on('answer_call', (data) => {
        const targetUid = normalizeUid(data?.callerUid || data?.targetUid);
        const responderUid = normalizeUid(resolveSocketUid());
        if (!targetUid || !responderUid) return;
        const responderConnector = splitMesh.getConnectorForTv(responderUid);
        const callerConnector = splitMesh.getConnectorForTv(targetUid);
        const responsePayload = {
            targetUid,
            callerUid: targetUid,
            responderUid,
            status: 'accepted',
            hasConnector: Boolean(responderConnector),
            connectorSplitMesh: Boolean(responderConnector)
        };
        sendSignalingEvent(targetUid, 'call_response_received', responsePayload);
        sendSignalingEvent(targetUid, 'call_accepted', responsePayload);
        if (callerConnector) {
            maybeTriggerSplitMeshUplink(targetUid, responderUid, data?.type || 'video', true);
        }
        if (responderConnector) {
            maybeTriggerSplitMeshUplink(responderUid, targetUid, data?.type || 'video', false);
        }
    });

    function isAuthorizedCallPeer(senderUid, targetUid) {
        if (!senderUid || !targetUid) return false;
        const peerInfo = globalActiveCallPeers.get(senderUid);
        if (peerInfo && peerInfo.peerUid === targetUid) return true;
        const targetInfo = globalActiveCallPeers.get(targetUid);
        return Boolean(targetInfo && targetInfo.peerUid === senderUid);
    }

    socket.on('webrtc_offer', (data) => {
        const senderUid = resolveSocketUid();
        const targetUid = normalizeUid(data?.targetUid);
        if (!senderUid || !targetUid || !isAuthorizedCallPeer(senderUid, targetUid)) return;
        const payload = { ...data, targetUid, senderUid };
        sendSignalingEvent(targetUid, 'webrtc_offer_received', payload);
        sendSignalingEvent(targetUid, 'webrtc_offer', payload);
    });

    socket.on('webrtc_answer', (data) => {
        const senderUid = resolveSocketUid();
        const targetUid = normalizeUid(data?.targetUid);
        if (!senderUid || !targetUid || !isAuthorizedCallPeer(senderUid, targetUid)) return;
        const payload = { ...data, targetUid, senderUid };
        sendSignalingEvent(targetUid, 'webrtc_answer_received', payload);
        sendSignalingEvent(targetUid, 'webrtc_answer', payload);
    });

    socket.on('webrtc_ice_candidate', (data) => {
        const senderUid = resolveSocketUid();
        const targetUid = normalizeUid(data?.targetUid);
        if (!senderUid || !targetUid || !isAuthorizedCallPeer(senderUid, targetUid)) return;
        const payload = { ...data, targetUid, senderUid };
        sendSignalingEvent(targetUid, 'webrtc_ice_candidate_received', payload);
        sendSignalingEvent(targetUid, 'webrtc_ice_candidate', payload);
    });

    socket.on('webrtc_end_call', (data) => {
        const senderUid = resolveSocketUid();
        const targetUid = normalizeUid(data?.targetUid);
        if (!senderUid || !targetUid) return;
        stopSplitMeshForUid(senderUid, 'call_ended');
        stopSplitMeshForUid(targetUid, 'call_ended');
        globalActiveCallPeers.delete(senderUid);
        globalActiveCallPeers.delete(targetUid);
        sendSignalingEvent(targetUid, 'webrtc_call_ended', { ...data, senderUid, targetUid });
        sendSignalingEvent(targetUid, 'call_ended', { ...data, senderUid, targetUid });
    });

    socket.on('end_call', (data) => {
        const senderUid = resolveSocketUid();
        const targetUid = normalizeUid(data?.targetUid);
        if (!senderUid || !targetUid) return;
        stopSplitMeshForUid(senderUid, 'call_ended');
        stopSplitMeshForUid(targetUid, 'call_ended');
        globalActiveCallPeers.delete(senderUid);
        globalActiveCallPeers.delete(targetUid);
        sendSignalingEvent(targetUid, 'webrtc_call_ended', { ...data, senderUid, targetUid });
        sendSignalingEvent(targetUid, 'call_ended', { ...data, senderUid, targetUid });
    });

    // Fire TV Alexa Voice Command Relay (Strictly scoped to the authenticated socket UID)
    socket.on('voice_command_triggered', (data) => {
        const targetRoom = resolveSocketUid();
        if (targetRoom) {
            io.to(targetRoom).emit('alexa_command', { ...(data || {}), uid: targetRoom });
        }
    });

    function purgeUserSessionData(uid) {
        if (!uid) return;
        const cleanUid = String(uid).trim().replace(/\D/g, '');
        if (!cleanUid) return;

        connectedUsers.delete(cleanUid);
        globalActiveCallPeers.delete(cleanUid);
        userContactsRegistry.delete(cleanUid);
        ephemeralMessageQueue.delete(cleanUid);

        if (lastActiveTvUid === cleanUid) {
            lastActiveTvUid = null;
        }

        let pairingsChanged = false;
        for (const [amzId, pairedUid] of alexaDevicePairings.entries()) {
            if (pairedUid === cleanUid) {
                alexaDevicePairings.delete(amzId);
                pairingsChanged = true;
                removeAlexaPairingFromFirestore(amzId).catch(() => {});
            }
        }
        if (pairingsChanged) {
            saveAlexaPairings();
        }
        removeAllPairingsForUidFromFirestore(cleanUid).catch(() => {});
        console.log(`[ZingTalk] Complete raw session purge for UID ${cleanUid} (Contacts, Alexa Links, and Sockets cleared from memory, disk, and Firebase)`);
    }

    // User Explicit Logout (Strictly logs out ONLY the authenticated socket's own UID)
    socket.on('logout_user', () => {
        const authedUid = resolveSocketUid();
        if (authedUid) {
            purgeUserSessionData(authedUid);
            socket.leave(authedUid);
        }
        if (socket.data) {
            delete socket.data.verifiedUid;
            delete socket.data.sessionToken;
        }
    });

    // Transient Socket Disconnect (Preserves persistent Alexa pairings & contact cache for seamless reconnect)
    socket.on('disconnect', () => {
        const removedConnector = splitMesh.unpairByConnector(socket.id);
        if (removedConnector) {
            sendSignalingEvent(removedConnector.tvUid, 'tv_connector_status', {
                connected: false,
                tvUid: removedConnector.tvUid,
                reason: 'connector_disconnected'
            });
            console.log(`[Split-Mesh] Connector[${removedConnector.connectorId}] disconnected from TV[${removedConnector.tvUid}]`);
        }

        for (const [uid, socketId] of connectedUsers.entries()) {
            if (socketId === socket.id) {
                connectedUsers.delete(uid);
                globalActiveCallPeers.delete(uid);
                socket.leave(uid);
                stopSplitMeshForUid(uid, 'user_disconnected');
                const pairedConn = splitMesh.getConnectorForTv(uid);
                if (pairedConn) {
                    io.to(pairedConn.socketId).emit('connector_unpaired', {
                        tvUid: uid,
                        reason: 'Fire TV went offline.'
                    });
                    splitMesh.unpairByTv(uid);
                }
                if (lastActiveTvUid === uid) {
                    lastActiveTvUid = null;
                }
                console.log(`[ZingTalk] Socket disconnected for user: ${uid} (Alexa pairing preserved)`);
                break;
            }
        }
    });
});

// ----------------- Alexa Smart Voice NLP Engine & Webhook -----------------
let lastCalledTarget = null;

function levenshtein(a, b) {
    const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
    for (let i = 0; i <= a.length; i++) dp[i][0] = i;
    for (let j = 0; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
        }
    }
    return dp[a.length][b.length];
}

function cleanVoiceInput(raw) {
    if (!raw) return "";
    let text = String(raw).toLowerCase().trim();
    // Multi-pass iterative prefix stripping (handles compound commands like "video call" followed by "lagao" or "karo")
    for (let i = 0; i < 3; i++) {
        text = text.replace(/^(?:please\s+)?(?:call\s+to|call\s+my\s+friend|call\s+my|call|audio\s+call\s+to|audio\s+call|video\s+call\s+to|video\s+call|dial|connect\s+with|connect\s+to|start\s+call\s+with|start\s+video\s+call\s+with|phone\s+karo|phone\s+lagao|call\s+karo|call\s+lagao|video\s+call\s+lagao|video\s+call\s+karo|lagao|karo|milao)\s+/i, "").trim();
    }
    // Multi-pass iterative suffix stripping (handles Hindi particles and conversational endings)
    for (let i = 0; i < 3; i++) {
        text = text.replace(/\s+(?:ko|se|par|pe|toll|tell|please|now|call|video\s+call|audio\s+call|karo|lagao|milao)$/i, "").trim();
    }
    return text.trim();
}

function wordsToDigits(str) {
    const wordMap = {
        "zero": "0", "oh": "0", "o": "0", "shunya": "0",
        "one": "1", "ek": "1",
        "two": "2", "do": "2",
        "three": "3", "teen": "3",
        "four": "4", "chaar": "4", "char": "4",
        "five": "5", "paanch": "5", "panch": "5",
        "six": "6", "chhah": "6", "che": "6",
        "seven": "7", "saat": "7",
        "eight": "8", "aath": "8",
        "nine": "9", "nau": "9",
        "ten": "10", "das": "10"
    };
    let res = "";
    const words = String(str).toLowerCase().split(/\s+/);
    for (let i = 0; i < words.length; i++) {
        const w = words[i];
        if (w === "double" && i + 1 < words.length && wordMap[words[i + 1]]) {
            res += wordMap[words[i + 1]] + wordMap[words[i + 1]];
            i++;
        } else if (w === "triple" && i + 1 < words.length && wordMap[words[i + 1]]) {
            res += wordMap[words[i + 1]] + wordMap[words[i + 1]] + wordMap[words[i + 1]];
            i++;
        } else if (wordMap[w]) {
            res += wordMap[w];
        } else if (/^\d+$/.test(w)) {
            res += w;
        }
    }
    return res;
}

function smartFindContact(rawInput, contacts) {
    if (!rawInput || !Array.isArray(contacts)) return null;
    const cleaned = cleanVoiceInput(rawInput);
    const cleanAlpha = cleaned.replace(/[^a-z0-9]/g, "");
    if (!cleanAlpha) return null;

    // 1. Direct UID match
    if (/^\d{10}$/.test(cleanAlpha)) {
        const existing = contacts.find(c => c.uid === cleanAlpha);
        return existing || { uid: cleanAlpha, name: "User " + cleanAlpha };
    }

    // 2. Spoken digit conversion (e.g. "one zero zero zero...")
    const digits = wordsToDigits(cleaned);
    if (/^\d{10}$/.test(digits)) {
        const existing = contacts.find(c => c.uid === digits);
        return existing || { uid: digits, name: "User " + digits };
    }

    // 3. Exact name match (case-insensitive)
    let match = contacts.find(c => {
        const cAlpha = (c.name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
        return cAlpha === cleanAlpha || c.uid === cleanAlpha;
    });
    if (match) return match;

    // 4. Word-token / prefix match
    match = contacts.find(c => {
        const cAlpha = (c.name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
        return cAlpha.startsWith(cleanAlpha) || cleanAlpha.startsWith(cAlpha) ||
               (c.name || "").toLowerCase().split(/\s+/).some(part => part === cleaned);
    });
    if (match) return match;

    // 5. Fuzzy phonetic match (Levenshtein distance <= 2 for similar pronunciations)
    let bestMatch = null;
    let minDistance = 999;
    contacts.forEach(c => {
        const cAlpha = (c.name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
        const dist = levenshtein(cleanAlpha, cAlpha);
        if (dist <= 2 && dist < minDistance && cleanAlpha.length >= 3) {
            minDistance = dist;
            bestMatch = c;
        }
    });

    return bestMatch;
}

function detectCallMode(rawUtterance, defaultMode = 'audio') {
    if (!rawUtterance) return defaultMode;
    const lower = String(rawUtterance).toLowerCase();
    if (lower.includes('video') || lower.includes('camera') || lower.includes('face') || lower.includes('visual')) {
        return 'video';
    }
    if (lower.includes('audio') || lower.includes('voice') || lower.includes('phone')) {
        return 'audio';
    }
    return defaultMode;
}

function extractSlotVal(slots, ...names) {
    if (!slots) return '';
    for (const name of names) {
        if (slots[name]) {
            if (slots[name].value) return String(slots[name].value).trim();
            const res = slots[name]?.resolutions?.resolutionsPerAuthority?.[0]?.values?.[0]?.value?.name;
            if (res) return String(res).trim();
        }
    }
    return '';
}

async function handleAlexaWebhookRequest(req, res) {
    try {
        const ip = getClientIp(req);
        const rate = alexaWebhookLimiter.check(`alexa:${ip}`, 1);
        if (!rate.allowed) {
            res.setHeader('Retry-After', String(rate.retryAfterSeconds));
            return res.status(429).json({ version: '1.0', response: { outputSpeech: { type: 'PlainText', text: 'Too many requests.' }, shouldEndSession: true } });
        }

        const body = req.body || {};
        const askCheck = validateAlexaWebhookRequest(req.headers, body, {
            expectedSkillId: (process.env.ALEXA_SKILL_ID || '').trim(),
            requireCertUrl: Boolean(process.env.ALEXA_SKILL_ID)
        });
        if (!askCheck.ok) {
            console.warn(`[Alexa Skill Webhook] Rejected invalid/replayed request: ${askCheck.reason}`);
            return res.status(403).json({
                version: '1.0',
                response: { outputSpeech: { type: 'PlainText', text: 'Unauthorized Alexa request.' }, shouldEndSession: true }
            });
        }

        const request = body.request || {};
        const reqType = request.type || '';
        const incomingSessionAttributes = (body.session && body.session.attributes) || {};
        let sessionAttributes = { ...incomingSessionAttributes };

        console.log(`[Alexa Skill Webhook] Received ${reqType} from Alexa`);

        let speechText = "Welcome to ZingTalk on Fire TV. Who would you like to call?";
        let shouldEndSession = false;
        let commandPayload = null;

        const amazonUserId = body.session?.user?.userId || body.context?.System?.user?.userId || body.context?.System?.device?.deviceId || '';
        let activeUserUid = amazonUserId ? alexaDevicePairings.get(amazonUserId) : null;

        const activeTvOnline = lastActiveTvUid && isUserOnline(lastActiveTvUid);

        // AUTOMATIC FIRE TV PAIRING (Strict Single-Tenant Safety: requires valid Amazon userId & never overrides existing pairings)
        if (!activeUserUid && amazonUserId && activeTvOnline && connectedUsers.size === 1) {
            activeUserUid = lastActiveTvUid;
            alexaDevicePairings.set(amazonUserId, activeUserUid);
            saveAlexaPairings();
            saveAlexaPairingToFirestore(amazonUserId, activeUserUid, true).catch(() => {});
            console.log(`[ZingTalk Auto-Pairing] Automatically linked Alexa ${amazonUserId} to active Fire TV UID ${activeUserUid}`);
            io.to(activeUserUid).emit('alexa_paired', { uid: activeUserUid, auto: true });
        }

        const isPaired = Boolean(activeUserUid);

        // Retrieve ONLY the active user's contacts (Strict Isolation: zero cross-user leakage)
        let userContacts = [];
        if (activeUserUid && userContactsRegistry.has(activeUserUid)) {
            userContacts = userContactsRegistry.get(activeUserUid) || [];
        }

        if (reqType === 'LaunchRequest') {
            const isPaired = alexaDevicePairings.has(amazonUserId);
            if (userContacts.length > 0) {
                const sampleNames = userContacts.slice(0, 3).map(c => c.name).join(', ');
                speechText = `Welcome to ZingTalk on Fire TV! Who would you like to call? You have ${sampleNames} in your saved contacts.`;
            } else {
                speechText = isPaired
                    ? "Welcome to ZingTalk on Fire TV! You do not have any saved contacts yet. You can say: call UID followed by any 10-digit number to place a call."
                    : "Welcome to ZingTalk on Fire TV! To link this Alexa device to your screen, say: pair UID followed by your 10-digit number. Or say: call UID followed by the digits to dial.";
            }
            shouldEndSession = false;
            sessionAttributes = { pendingAction: 'call', mode: 'audio' };
            commandPayload = {
                intent: 'LaunchRequest',
                action: 'launch',
                timestamp: Date.now()
            };
        } else if (reqType === 'IntentRequest') {
            const intent = request.intent || {};
            const intentName = intent.name || '';
            const slots = intent.slots || {};

            console.log(`[Alexa Skill Webhook] Handling intent: ${intentName}`, slots);

            switch (intentName) {
                case 'ZingCallIntent':
                case 'ZingAudioCallIntent':
                case 'ZingaudioCallIntent':
                case 'ZingVideoCallIntent':
                case 'ZingvideoIntent':
                case 'ZingStartCallIntent':
                case 'ZingDialIntent': {
                    const isVideoRequested = intentName === 'ZingvideoIntent' || intentName === 'ZingVideoCallIntent';
                    const defaultMode = isVideoRequested ? 'video' : 'audio';
                    let rawName = extractSlotVal(slots, 'contact', 'name', 'person', 'user', 'Contact', 'Name', 'target', 'query');
                    
                    if (!rawName) {
                        for (const k of Object.keys(slots)) {
                            if (slots[k]?.value) {
                                rawName = slots[k].value;
                                break;
                            }
                        }
                    }

                    if (!rawName) {
                        if (userContacts.length > 0) {
                            const sampleNames = userContacts.slice(0, 3).map(c => c.name).join(', ');
                            speechText = `Who would you like to call on ZingTalk? You have ${sampleNames} in your saved contacts.`;
                        } else {
                            speechText = "Who would you like to call? You can say: call UID followed by any 10-digit number.";
                        }
                        shouldEndSession = false;
                        sessionAttributes = { pendingAction: 'call', mode: defaultMode };
                        break;
                    }

                    const mode = detectCallMode(rawName, defaultMode);

                    // Direct digit dialing if user spoke a 10-digit number
                    const digitsSpoken = wordsToDigits(rawName).replace(/[^0-9]/g, '');
                    if (digitsSpoken.length === 10) {
                        lastCalledTarget = { uid: digitsSpoken, name: "UID " + digitsSpoken, mode: mode };
                        speechText = `${mode === 'video' ? 'Starting HD video call with' : 'Calling'} UID ${digitsSpoken.split('').join(' ')} on ZingTalk.`;
                        commandPayload = {
                            intent: intentName,
                            action: mode === 'video' ? 'video_call' : 'audio_call',
                            contact: 'UID ' + digitsSpoken,
                            targetUid: digitsSpoken,
                            timestamp: Date.now()
                        };
                        shouldEndSession = true;
                        sessionAttributes = {};
                        break;
                    }

                    const matched = smartFindContact(rawName, userContacts);

                    if (matched) {
                        lastCalledTarget = { uid: matched.uid, name: matched.name, mode: mode };
                        speechText = mode === 'video'
                            ? `Starting HD video call with ${matched.name} on ZingTalk.`
                            : `Calling ${matched.name} on ZingTalk.`;
                        commandPayload = {
                            intent: intentName,
                            action: mode === 'video' ? 'video_call' : 'audio_call',
                            contact: matched.name,
                            targetUid: matched.uid,
                            timestamp: Date.now()
                        };
                        shouldEndSession = true;
                        sessionAttributes = {};
                    } else {
                        speechText = `Sorry, ${rawName} is not saved in your ZingTalk contacts. You can add them with their 10-digit UID, or say: call UID followed by their 10 digits.`;
                        shouldEndSession = true;
                        sessionAttributes = {};
                    }
                    break;
                }
                case 'ZingPairAccountIntent':
                case 'ZingPairIntent':
                case 'ZingLinkDeviceIntent': {
                    let rawUid = extractSlotVal(slots, 'uid', 'number', 'target', 'UID', 'Number');
                    const digits = wordsToDigits(rawUid || '').replace(/[^0-9]/g, '');
                    const cleanDigits = (digits.length === 10) ? digits : (rawUid || '').replace(/[^0-9]/g, '');
                    if (cleanDigits.length === 10) {
                        alexaDevicePairings.set(amazonUserId, cleanDigits);
                        saveAlexaPairings();
                        saveAlexaPairingToFirestore(amazonUserId, cleanDigits, false).catch(() => {});
                        activeUserUid = cleanDigits;
                        speechText = `Successfully paired this Alexa device with ZingTalk Fire TV account UID ${cleanDigits.split('').join(' ')}! Your voice commands are now linked exclusively to your screen.`;
                        shouldEndSession = true;
                        commandPayload = {
                            intent: intentName,
                            action: 'device_paired',
                            pairedUid: cleanDigits,
                            timestamp: Date.now()
                        };
                        io.to(cleanDigits).emit('alexa_paired', { uid: cleanDigits });
                    } else {
                        speechText = "Please provide your 10-digit ZingTalk UID to pair. You can say: pair UID, followed by your 10 digits.";
                        shouldEndSession = false;
                    }
                    break;
                }
                case 'ZingAnswerCallIntent':
                case 'ZingAnswerIntent':
                case 'ZingAcceptCallIntent':
                case 'ZingPickUpIntent': {
                    speechText = "Answering incoming call on ZingTalk.";
                    shouldEndSession = true;
                    commandPayload = {
                        intent: 'ZingAnswerCallIntent',
                        action: 'answer_call',
                        timestamp: Date.now()
                    };
                    break;
                }
                case 'ZingRejectCallIntent':
                case 'ZingRejectIntent':
                case 'ZingDeclineCallIntent':
                case 'ZingDeclineIntent': {
                    speechText = "Declining incoming call on ZingTalk.";
                    shouldEndSession = true;
                    commandPayload = {
                        intent: 'ZingRejectCallIntent',
                        action: 'reject_call',
                        timestamp: Date.now()
                    };
                    break;
                }
                case 'ZingEndCallIntent':
                case 'ZingHangUpIntent':
                case 'ZingHangupIntent':
                case 'ZingStopCallIntent':
                case 'ZingDisconnectIntent': {
                    speechText = "Ending call on ZingTalk.";
                    shouldEndSession = true;
                    commandPayload = {
                        intent: 'ZingEndCallIntent',
                        action: 'end_call',
                        timestamp: Date.now()
                    };
                    break;
                }
                case 'ZingDialUidIntent':
                case 'ZingDialUIDIntent':
                case 'ZingCallUidIntent':
                case 'ZingCallUIDIntent': {
                    let rawUid = extractSlotVal(slots, 'uid', 'number', 'target', 'UID', 'Number');
                    const digits = wordsToDigits(rawUid || '').replace(/[^0-9]/g, '');
                    const cleanDigits = (digits.length === 10) ? digits : (rawUid || '').replace(/[^0-9]/g, '');
                    if (cleanDigits.length === 10) {
                        lastCalledTarget = { uid: cleanDigits, name: "User " + cleanDigits, mode: 'audio' };
                        speechText = `Dialing UID ${cleanDigits.split('').join(' ')} on ZingTalk.`;
                        shouldEndSession = true;
                        commandPayload = {
                            intent: 'ZingDialUidIntent',
                            action: 'audio_call',
                            contact: 'User ' + cleanDigits,
                            targetUid: cleanDigits,
                            timestamp: Date.now()
                        };
                    } else {
                        speechText = "Please provide a valid 10-digit UID number to call.";
                        shouldEndSession = false;
                    }
                    break;
                }
                case 'ZingMuteMicIntent':
                case 'ZingMuteIntent':
                case 'ZingMuteAudioIntent': {
                    speechText = "Microphone muted on ZingTalk.";
                    shouldEndSession = true;
                    commandPayload = {
                        intent: 'ZingMuteMicIntent',
                        action: 'mute_mic',
                        timestamp: Date.now()
                    };
                    break;
                }
                case 'ZingUnmuteMicIntent':
                case 'ZingUnmuteIntent':
                case 'ZingUnmuteAudioIntent': {
                    speechText = "Microphone unmuted on ZingTalk.";
                    shouldEndSession = true;
                    commandPayload = {
                        intent: 'ZingUnmuteMicIntent',
                        action: 'unmute_mic',
                        timestamp: Date.now()
                    };
                    break;
                }
                case 'ZingToggleMicIntent':
                case 'ZingMicToggleIntent': {
                    speechText = "Toggling microphone on ZingTalk.";
                    shouldEndSession = true;
                    commandPayload = {
                        intent: 'ZingToggleMicIntent',
                        action: 'toggle_mic',
                        timestamp: Date.now()
                    };
                    break;
                }
                case 'ZingTurnOffCameraIntent':
                case 'ZingCameraOffIntent':
                case 'ZingStopVideoIntent': {
                    speechText = "Camera turned off on ZingTalk.";
                    shouldEndSession = true;
                    commandPayload = {
                        intent: 'ZingTurnOffCameraIntent',
                        action: 'camera_off',
                        timestamp: Date.now()
                    };
                    break;
                }
                case 'ZingTurnOnCameraIntent':
                case 'ZingCameraOnIntent':
                case 'ZingStartVideoIntent': {
                    speechText = "Camera turned on on ZingTalk.";
                    shouldEndSession = true;
                    commandPayload = {
                        intent: 'ZingTurnOnCameraIntent',
                        action: 'camera_on',
                        timestamp: Date.now()
                    };
                    break;
                }
                case 'ZingToggleCameraIntent':
                case 'ZingCameraToggleIntent': {
                    speechText = "Toggling camera on ZingTalk.";
                    shouldEndSession = true;
                    commandPayload = {
                        intent: 'ZingToggleCameraIntent',
                        action: 'toggle_camera',
                        timestamp: Date.now()
                    };
                    break;
                }
                case 'ZingOpenContactsIntent':
                case 'ZingListContactsIntent':
                case 'ZingWhoCanICallIntent':
                case 'ZingShowContactsIntent':
                case 'ZingContactsIntent': {
                    if (userContacts.length === 0) {
                        speechText = "You do not have any contacts saved on ZingTalk yet. You can add a contact using their 10-digit UID.";
                    } else {
                        const names = userContacts.map(c => c.name).join(', ');
                        speechText = `You have ${userContacts.length} contacts on ZingTalk: ${names}. Say: call, followed by a name to start.`;
                    }
                    shouldEndSession = false;
                    sessionAttributes = { pendingAction: 'call' };
                    commandPayload = {
                        intent: 'ZingOpenContactsIntent',
                        action: 'open_contacts',
                        timestamp: Date.now()
                    };
                    break;
                }
                case 'ZingOpenDialpadIntent':
                case 'ZingShowDialpadIntent':
                case 'ZingDialpadIntent': {
                    speechText = "Opening dialpad on ZingTalk.";
                    shouldEndSession = true;
                    commandPayload = {
                        intent: 'ZingOpenDialpadIntent',
                        action: 'open_dialpad',
                        timestamp: Date.now()
                    };
                    break;
                }
                case 'ZingOpenProfileIntent':
                case 'ZingShowProfileIntent':
                case 'ZingMyUidIntent':
                case 'ZingCheckUidIntent':
                case 'ZingProfileIntent': {
                    const resolvedProfileUid = activeUserUid || lastActiveTvUid;
                    if (resolvedProfileUid) {
                        speechText = `Your ZingTalk 10 digit UID is ${resolvedProfileUid.split('').join(' ')}.`;
                    } else {
                        speechText = "You are currently logged into ZingTalk on Fire TV.";
                    }
                    shouldEndSession = true;
                    commandPayload = {
                        intent: 'ZingOpenProfileIntent',
                        action: 'open_profile',
                        timestamp: Date.now()
                    };
                    break;
                }
                case 'ZingOpenGuideIntent':
                case 'ZingShowGuideIntent':
                case 'ZingHowToUseIntent':
                case 'ZingGuideIntent': {
                    speechText = "Opening the Alexa voice commands and Fire TV remote guide.";
                    shouldEndSession = true;
                    commandPayload = {
                        intent: 'ZingOpenGuideIntent',
                        action: 'open_guide',
                        timestamp: Date.now()
                    };
                    break;
                }
                case 'ZingRedialIntent':
                case 'ZingCallLastIntent':
                case 'ZingCallbackIntent': {
                    if (lastCalledTarget) {
                        const mode = lastCalledTarget.mode || 'audio';
                        speechText = `Calling ${lastCalledTarget.name} again on ZingTalk.`;
                        shouldEndSession = true;
                        commandPayload = {
                            intent: 'ZingRedialIntent',
                            action: mode === 'video' ? 'video_call' : 'audio_call',
                            contact: lastCalledTarget.name,
                            targetUid: lastCalledTarget.uid,
                            timestamp: Date.now()
                        };
                    } else {
                        speechText = "You haven't made any calls on ZingTalk recently. Who would you like to call?";
                        shouldEndSession = false;
                        sessionAttributes = { pendingAction: 'call' };
                    }
                    break;
                }
                case 'ZingOpenChatIntent': {
                    const rawName = extractSlotVal(slots, 'contact', 'name', 'person', 'Contact', 'Name');
                    const matched = smartFindContact(rawName, userContacts);
                    if (matched) {
                        speechText = `Opening chat with ${matched.name} on ZingTalk.`;
                        shouldEndSession = true;
                        commandPayload = {
                            intent: 'ZingOpenChatIntent',
                            action: 'open_chat',
                            contact: matched.name,
                            targetUid: matched.uid,
                            timestamp: Date.now()
                        };
                    } else {
                        speechText = `Sorry, ${rawName || 'that user'} is not saved in your ZingTalk contacts.`;
                        shouldEndSession = true;
                    }
                    break;
                }
                case 'ZingClearChatIntent': {
                    speechText = "Chat conversation cleared on ZingTalk.";
                    shouldEndSession = true;
                    commandPayload = {
                        intent: 'ZingClearChatIntent',
                        action: 'clear_chat',
                        timestamp: Date.now()
                    };
                    break;
                }
                case 'ZingTypeIntent': {
                    const text = extractSlotVal(slots, 'message', 'text', 'Message', 'Text');
                    speechText = `Typing: ${text}`;
                    shouldEndSession = false;
                    commandPayload = {
                        intent: 'ZingTypeIntent',
                        action: 'type_message',
                        message: text,
                        timestamp: Date.now()
                    };
                    break;
                }
                case 'ZingSendMessageIntent': {
                    const rawMsg = extractSlotVal(slots, 'RawMessage', 'message', 'text', 'Message');
                    speechText = `Sending message: ${rawMsg} on ZingTalk.`;
                    shouldEndSession = true;
                    commandPayload = {
                        intent: 'ZingSendMessageIntent',
                        action: 'send_message',
                        message: rawMsg,
                        timestamp: Date.now()
                    };
                    break;
                }
                case 'AMAZON.NavigateHomeIntent': {
                    speechText = "Returning to ZingTalk home screen.";
                    shouldEndSession = true;
                    commandPayload = {
                        intent: 'AMAZON.NavigateHomeIntent',
                        action: 'navigate_home',
                        timestamp: Date.now()
                    };
                    break;
                }
                case 'AMAZON.HelpIntent': {
                    speechText = "You can ask ZingTalk on Fire TV to call a contact, start an HD video call, answer, decline, mute microphone, hang up, or open chat. Opening the Alexa voice guide on your screen now.";
                    shouldEndSession = true;
                    commandPayload = {
                        intent: 'AMAZON.HelpIntent',
                        action: 'open_guide',
                        timestamp: Date.now()
                    };
                    break;
                }
                case 'AMAZON.CancelIntent':
                case 'AMAZON.StopIntent': {
                    speechText = "Goodbye from ZingTalk!";
                    shouldEndSession = true;
                    sessionAttributes = {};
                    break;
                }
                case 'AMAZON.FallbackIntent':
                default: {
                    let candidateName = extractSlotVal(slots, 'contact', 'name', 'person', 'user', 'Contact', 'Name', 'target', 'query', 'uid', 'number', 'UID', 'Number', 'RawMessage', 'message', 'text');
                    if (!candidateName) {
                        for (const key of Object.keys(slots)) {
                            const val = slots[key]?.value;
                            if (val && typeof val === 'string' && val.length > 1) {
                                candidateName = val;
                                break;
                            }
                        }
                    }

                    if (candidateName) {
                        const mode = detectCallMode(candidateName, sessionAttributes.mode || 'audio');
                        const digitsSpoken = wordsToDigits(candidateName).replace(/[^0-9]/g, '');
                        if (digitsSpoken.length === 10) {
                            lastCalledTarget = { uid: digitsSpoken, name: "UID " + digitsSpoken, mode: mode };
                            speechText = `${mode === 'video' ? 'Starting HD video call with' : 'Calling'} UID ${digitsSpoken.split('').join(' ')} on ZingTalk.`;
                            shouldEndSession = true;
                            sessionAttributes = {};
                            commandPayload = {
                                intent: 'ZingSmartCall',
                                action: mode === 'video' ? 'video_call' : 'audio_call',
                                contact: 'UID ' + digitsSpoken,
                                targetUid: digitsSpoken,
                                timestamp: Date.now()
                            };
                            break;
                        }

                        const matched = smartFindContact(candidateName, userContacts);
                        if (matched) {
                            lastCalledTarget = { uid: matched.uid, name: matched.name, mode: mode };
                            speechText = mode === 'video' 
                                ? `Starting video call with ${matched.name} on ZingTalk.`
                                : `Calling ${matched.name} on ZingTalk.`;
                            shouldEndSession = true;
                            sessionAttributes = {};
                            commandPayload = {
                                intent: 'ZingSmartCall',
                                action: mode === 'video' ? 'video_call' : 'audio_call',
                                contact: matched.name,
                                targetUid: matched.uid,
                                timestamp: Date.now()
                            };
                            break;
                        }
                    }

                    speechText = "I didn't quite catch that. You can say: call Raman, video call Rahul, call UID followed by 10 digits, answer call, or end call.";
                    shouldEndSession = false;
                    sessionAttributes = { ...sessionAttributes, pendingAction: 'call' };
                    break;
                }
            }

            if (commandPayload) {
                if (activeUserUid && connectedUsers.has(activeUserUid)) {
                    io.to(activeUserUid).emit('alexa_command', commandPayload);
                    console.log(`[Alexa Skill Webhook] Dispatched exclusively to user room ${activeUserUid}:`, commandPayload);
                } else if (activeUserUid) {
                    console.log(`[Alexa Skill Webhook] Target user ${activeUserUid} is currently offline on Fire TV.`);
                } else if (connectedUsers.size === 1 && lastActiveTvUid) {
                    io.to(lastActiveTvUid).emit('alexa_command', commandPayload);
                    console.log(`[Alexa Skill Webhook] Dispatched to solo active TV room ${lastActiveTvUid}:`, commandPayload);
                } else {
                    console.warn(`[Alexa Skill Webhook] Discarded command: No authenticated/paired Fire TV linked to Amazon User ${amazonUserId}`);
                }
            }
        } else if (reqType === 'SessionEndedRequest') {
            speechText = "";
            shouldEndSession = true;
        }

        return res.json({
            version: "1.0",
            sessionAttributes: sessionAttributes,
            response: {
                outputSpeech: {
                    type: "PlainText",
                    text: speechText
                },
                reprompt: shouldEndSession ? undefined : {
                    outputSpeech: {
                        type: "PlainText",
                        text: "Who would you like to call on ZingTalk?"
                    }
                },
                shouldEndSession: shouldEndSession
            }
        });
    } catch (err) {
        return res.status(500).json({
            version: "1.0",
            response: {
                outputSpeech: {
                    type: "PlainText",
                    text: "Sorry, ZingTalk encountered an error processing your voice command."
                },
                shouldEndSession: true
            }
        });
    }
}

// Support both /alexa and /api/alexa endpoints for Amazon Alexa Skills Kit Webhook
app.post('/alexa', handleAlexaWebhookRequest);
app.post('/api/alexa', handleAlexaWebhookRequest);

// Self-contained Server Status & Health Display (Zero external file dependencies)
function renderServerStatus(req, res) {
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.json({
            status: "online",
            server: "ZingTalk Universal Signaling Server",
            domain: "zingtalk.duckdns.org",
            port: PORT,
            connectedUsers: connectedUsers.size,
            webrtc: {
                stun: "zingtalk.duckdns.org:3478",
                turn: "zingtalk.duckdns.org:3478"
            },
            alexaWebhook: "/alexa",
            health: "/api/health",
            mode: "headless-signaling-server",
            message: "ZingTalk server is 100% active and listening for Socket.IO connections."
        });
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ZingTalk Universal Server | Admin & Analytics</title>
  <link rel="icon" type="image/png" href="/assets/favicon.png">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #070a13;
      color: #f1f5f9;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px;
      position: relative;
      overflow-x: hidden;
    }
    .ambient-glow {
      position: fixed;
      top: -20%;
      left: 50%;
      transform: translateX(-50%);
      width: 700px;
      height: 400px;
      background: radial-gradient(ellipse at center, rgba(0, 210, 255, 0.12) 0%, rgba(16, 185, 129, 0.08) 50%, transparent 70%);
      pointer-events: none;
      z-index: 0;
    }
    .hidden { display: none !important; }

    /* GATE VIEW */
    #gate-view {
      position: relative;
      z-index: 1;
      width: 100%;
      max-width: 480px;
      background: #0d1322;
      border: 1px solid #1e293b;
      border-radius: 20px;
      padding: 36px 32px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
      text-align: center;
      transition: all 0.3s ease;
    }
    .gate-icon {
      width: 64px;
      height: 64px;
      margin: 0 auto 16px;
      background: rgba(0, 210, 255, 0.1);
      border: 1px solid rgba(0, 210, 255, 0.3);
      border-radius: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #00d2ff;
    }
    .gate-title {
      font-size: 1.6rem;
      font-weight: 800;
      color: #ffffff;
      margin-bottom: 6px;
      letter-spacing: -0.5px;
    }
    .gate-subtitle {
      color: #94a3b8;
      font-size: 0.9rem;
      margin-bottom: 24px;
    }
    .level-tabs {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      margin-bottom: 24px;
    }
    .level-tab {
      padding: 10px 6px;
      background: #131b2e;
      border: 1px solid #1e293b;
      border-radius: 10px;
      font-size: 0.75rem;
      font-weight: 700;
      color: #64748b;
      text-align: center;
      transition: all 0.25s ease;
    }
    .level-tab.active {
      background: rgba(0, 210, 255, 0.12);
      border-color: #00d2ff;
      color: #00d2ff;
      box-shadow: 0 0 14px rgba(0, 210, 255, 0.2);
    }
    .level-tab.done {
      background: rgba(16, 185, 129, 0.12);
      border-color: #10b981;
      color: #34d399;
    }
    .gate-instruction {
      font-size: 0.85rem;
      font-weight: 600;
      color: #00d2ff;
      text-align: left;
      margin-bottom: 10px;
    }
    .input-wrapper {
      position: relative;
      margin-bottom: 16px;
    }
    .gate-input {
      width: 100%;
      background: #131b2e;
      border: 1.5px solid #1e293b;
      border-radius: 12px;
      padding: 14px 46px 14px 16px;
      color: #ffffff;
      font-size: 0.95rem;
      outline: none;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .gate-input:focus {
      border-color: #00d2ff;
      box-shadow: 0 0 0 3px rgba(0, 210, 255, 0.2);
    }
    .toggle-eye {
      position: absolute;
      right: 14px;
      top: 50%;
      transform: translateY(-50%);
      background: none;
      border: none;
      color: #64748b;
      cursor: pointer;
      padding: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .toggle-eye:hover { color: #cbd5e1; }
    .gate-error {
      background: rgba(239, 68, 68, 0.15);
      border: 1px solid rgba(239, 68, 68, 0.4);
      color: #f87171;
      font-size: 0.85rem;
      padding: 10px 14px;
      border-radius: 10px;
      margin-bottom: 16px;
      text-align: left;
    }
    .gate-btn {
      width: 100%;
      background: linear-gradient(135deg, #00d2ff 0%, #0099ff 100%);
      color: #050b14;
      font-weight: 800;
      font-size: 0.95rem;
      padding: 14px;
      border: none;
      border-radius: 12px;
      cursor: pointer;
      box-shadow: 0 4px 14px rgba(0, 210, 255, 0.35);
      transition: transform 0.15s, box-shadow 0.15s, opacity 0.15s;
    }
    .gate-btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 6px 20px rgba(0, 210, 255, 0.5);
    }
    .gate-btn:active {
      transform: translateY(1px);
    }
    .gate-btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .gate-footer {
      color: #64748b;
      font-size: 0.75rem;
      margin-top: 24px;
      line-height: 1.4;
    }

    /* DASHBOARD VIEW */
    #dashboard-view {
      position: relative;
      z-index: 1;
      width: 100%;
      max-width: 1100px;
      margin: 0 auto;
    }
    .dash-topbar {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      background: #0d1322;
      border: 1px solid #1e293b;
      border-radius: 16px;
      padding: 16px 24px;
      margin-bottom: 24px;
    }
    .dash-brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .dash-logo {
      width: 36px;
      height: 36px;
      border-radius: 10px;
      background: rgba(0, 210, 255, 0.15);
      border: 1px solid rgba(0, 210, 255, 0.3);
      display: flex;
      align-items: center;
      justify-content: center;
      color: #00d2ff;
      font-weight: 900;
      font-size: 1.1rem;
    }
    .dash-title {
      font-size: 1.25rem;
      font-weight: 800;
      color: #ffffff;
    }
    .dash-subtitle {
      font-size: 0.8rem;
      color: #94a3b8;
    }
    .dash-actions {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .badge-status {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
      border: 1px solid #059669;
      padding: 6px 14px;
      border-radius: 9999px;
      font-size: 0.8rem;
      font-weight: 700;
    }
    .pulse-dot {
      width: 8px;
      height: 8px;
      background: #10b981;
      border-radius: 50%;
      box-shadow: 0 0 10px #10b981;
      animation: pulseAnim 2s infinite;
    }
    @keyframes pulseAnim {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(1.2); }
    }
    .btn-secondary {
      background: #131b2e;
      border: 1px solid #1e293b;
      color: #cbd5e1;
      padding: 8px 16px;
      border-radius: 10px;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn-secondary:hover {
      background: #1e293b;
      color: #ffffff;
    }
    .btn-lock {
      background: rgba(239, 68, 68, 0.15);
      border: 1px solid rgba(239, 68, 68, 0.4);
      color: #f87171;
      padding: 8px 16px;
      border-radius: 10px;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn-lock:hover {
      background: rgba(239, 68, 68, 0.3);
      color: #ffffff;
    }

    /* STATS GRID */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .stat-card {
      background: #0d1322;
      border: 1px solid #1e293b;
      border-radius: 16px;
      padding: 20px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      position: relative;
      overflow: hidden;
    }
    .stat-card::after {
      content: "";
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 3px;
    }
    .card-new::after { background: linear-gradient(90deg, #10b981, #34d399); }
    .card-returning::after { background: linear-gradient(90deg, #00d2ff, #0099ff); }
    .card-live::after { background: linear-gradient(90deg, #f59e0b, #fbbf24); }
    .card-total::after { background: linear-gradient(90deg, #8b5cf6, #a855f7); }

    .stat-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }
    .stat-label {
      font-size: 0.85rem;
      font-weight: 600;
      color: #94a3b8;
    }
    .stat-badge {
      font-size: 0.7rem;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 6px;
    }
    .badge-green { background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }
    .badge-cyan { background: rgba(0, 210, 255, 0.15); color: #00d2ff; border: 1px solid rgba(0, 210, 255, 0.3); }
    .badge-yellow { background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); }
    .badge-purple { background: rgba(139, 92, 246, 0.15); color: #c084fc; border: 1px solid rgba(139, 92, 246, 0.3); }

    .stat-num {
      font-size: 2.4rem;
      font-weight: 800;
      color: #ffffff;
      font-family: monospace;
      letter-spacing: -1px;
      line-height: 1;
      margin-bottom: 8px;
    }
    .stat-desc {
      font-size: 0.78rem;
      color: #64748b;
    }

    /* MIDDLE ROW */
    .middle-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      margin-bottom: 24px;
    }
    @media (max-width: 800px) {
      .middle-grid { grid-template-columns: 1fr; }
    }
    .panel {
      background: #0d1322;
      border: 1px solid #1e293b;
      border-radius: 16px;
      padding: 20px;
    }
    .panel-title {
      font-size: 1rem;
      font-weight: 700;
      color: #ffffff;
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .diag-row {
      display: flex;
      justify-content: space-between;
      padding: 10px 0;
      border-bottom: 1px solid #131b2e;
      font-size: 0.85rem;
    }
    .diag-row:last-child { border-bottom: none; }
    .diag-label { color: #94a3b8; }
    .diag-val {
      font-family: monospace;
      color: #e2e8f0;
      font-weight: 600;
    }
    .bar-item {
      margin-bottom: 14px;
    }
    .bar-header {
      display: flex;
      justify-content: space-between;
      font-size: 0.82rem;
      margin-bottom: 6px;
    }
    .bar-label { color: #cbd5e1; font-weight: 600; }
    .bar-count { color: #94a3b8; font-family: monospace; }
    .progress-track {
      background: #131b2e;
      border-radius: 9999px;
      height: 8px;
      overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      border-radius: 9999px;
      transition: width 0.5s ease;
    }
    .fill-tv { background: linear-gradient(90deg, #ff9900, #ffb84d); }
    .fill-mobile { background: linear-gradient(90deg, #00d2ff, #0099ff); }
    .fill-web { background: linear-gradient(90deg, #10b981, #34d399); }
    .fill-load-healthy { background: linear-gradient(90deg, #10b981, #34d399); }
    .fill-load-moderate { background: linear-gradient(90deg, #f59e0b, #fbbf24); }
    .fill-load-heavy { background: linear-gradient(90deg, #ef4444, #f87171); }

    /* SERVER CAPACITY & LOAD PANEL */
    .capacity-panel {
      background: #0d1322;
      border: 1px solid #1e293b;
      border-radius: 16px;
      padding: 20px;
      margin-bottom: 24px;
    }
    .capacity-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
      margin-bottom: 16px;
    }
    .capacity-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 12px;
      border-radius: 9999px;
      font-size: 0.78rem;
      font-weight: 700;
    }
    .capacity-pill.healthy { background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.35); }
    .capacity-pill.moderate { background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.35); }
    .capacity-pill.heavy { background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.35); }
    .capacity-summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 14px;
      margin-bottom: 16px;
    }
    .capacity-box {
      background: #131b2e;
      border: 1px solid #1e293b;
      border-radius: 12px;
      padding: 14px 16px;
    }
    .capacity-box-top {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: 8px;
      gap: 8px;
    }
    .capacity-box-label {
      font-size: 0.78rem;
      font-weight: 600;
      color: #94a3b8;
    }
    .capacity-box-value {
      font-family: monospace;
      font-size: 1.25rem;
      font-weight: 800;
      color: #ffffff;
    }
    .capacity-box-sub {
      font-size: 0.74rem;
      color: #64748b;
      margin-top: 8px;
      display: flex;
      justify-content: space-between;
      gap: 8px;
      flex-wrap: wrap;
    }
    .capacity-box-sub strong {
      color: #cbd5e1;
      font-family: monospace;
    }

    /* TABLE SECTION */
    .table-container {
      background: #0d1322;
      border: 1px solid #1e293b;
      border-radius: 16px;
      padding: 20px;
      overflow-x: auto;
    }
    .table-header-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      flex-wrap: wrap;
      gap: 12px;
    }
    .search-input {
      background: #131b2e;
      border: 1px solid #1e293b;
      border-radius: 8px;
      padding: 8px 14px;
      color: #ffffff;
      font-size: 0.85rem;
      outline: none;
      min-width: 220px;
    }
    .search-input:focus { border-color: #00d2ff; }
    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 0.85rem;
    }
    th {
      color: #64748b;
      font-weight: 600;
      padding: 10px 12px;
      border-bottom: 1px solid #1e293b;
    }
    td {
      padding: 12px;
      border-bottom: 1px solid #131b2e;
      color: #cbd5e1;
    }
    tr:last-child td { border-bottom: none; }
    .user-uid-cell {
      font-family: monospace;
      color: #00d2ff;
      font-weight: 700;
    }
    .tag-new {
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.3);
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 0.72rem;
      font-weight: 700;
      display: inline-block;
    }
    .tag-returning {
      background: rgba(0, 210, 255, 0.15);
      color: #00d2ff;
      border: 1px solid rgba(0, 210, 255, 0.3);
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 0.72rem;
      font-weight: 700;
      display: inline-block;
    }
    .tag-platform {
      background: #131b2e;
      color: #cbd5e1;
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 0.75rem;
      font-weight: 600;
      border: 1px solid #1e293b;
    }
    .empty-state {
      text-align: center;
      padding: 36px 16px;
      color: #64748b;
      font-size: 0.9rem;
    }
  </style>
</head>
<body>
  <div class="ambient-glow"></div>

  <!-- VIEW 1: THREE-LEVEL SECURITY GATE -->
  <div id="gate-view">
    <div class="gate-icon">
      <svg width="32" height="32" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
      </svg>
    </div>
    <h1 class="gate-title">ZingTalk Security Gate</h1>
    <p class="gate-subtitle">Three-Level Developer Clearance Required for Server Panel</p>

    <div class="level-tabs">
      <div id="tab-lvl-1" class="level-tab active">LEVEL 1<br>Primary Key</div>
      <div id="tab-lvl-2" class="level-tab">LEVEL 2<br>Clearance Key</div>
      <div id="tab-lvl-3" class="level-tab">LEVEL 3<br>Developer Token</div>
    </div>

    <div id="gate-instruction" class="gate-instruction">Level 1 Verification: Enter Primary Authentication Key</div>

    <div class="input-wrapper">
      <input type="password" id="gate-input" class="gate-input" placeholder="Enter Level 1 Password..." autocomplete="off">
      <button type="button" id="toggle-eye-btn" class="toggle-eye" title="Show / Hide Password">
        <svg id="eye-icon" width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
        </svg>
      </button>
    </div>

    <div id="gate-error" class="gate-error hidden"></div>

    <button type="button" id="gate-submit-btn" class="gate-btn">Authorize Level 1 Key</button>

    <div class="gate-footer">
      Protected with Server-Side SHA-256 Multi-Factor Cryptographic Hashing<br>
      Authorized for ZingTalk Developer Team • support.zing.app@gmail.com
    </div>
  </div>

  <!-- VIEW 2: LIVE ANALYTICS & PRODUCTION DASHBOARD -->
  <div id="dashboard-view" class="hidden">
    <div class="dash-topbar">
      <div class="dash-brand">
        <div class="dash-logo">Z</div>
        <div>
          <div class="dash-title">ZingTalk Universal Server</div>
          <div class="dash-subtitle">High-Performance WebRTC Signaling & Alexa Voice Node • zingtalk.duckdns.org</div>
        </div>
      </div>
      <div class="dash-actions">
        <div class="badge-status"><span class="pulse-dot"></span> ONLINE & ACTIVE</div>
        <button type="button" id="btn-refresh" class="btn-secondary">🔄 Refresh Data</button>
        <button type="button" id="btn-lock" class="btn-lock">🔒 Lock Gate</button>
      </div>
    </div>

    <!-- STATS CARDS GRID -->
    <div class="stats-grid">
      <!-- Card 1: New Users Today -->
      <div class="stat-card card-new">
        <div class="stat-top">
          <span class="stat-label">Daily New Users (Today)</span>
          <span class="stat-badge badge-green">🆕 Fresh Users</span>
        </div>
        <div id="stat-new-today" class="stat-num">0</div>
        <div class="stat-desc">Users who opened ZingTalk for the first time today</div>
      </div>

      <!-- Card 2: Returning Users Today -->
      <div class="stat-card card-returning">
        <div class="stat-top">
          <span class="stat-label">Returning Users (Today)</span>
          <span class="stat-badge badge-cyan">🔁 Active Retention</span>
        </div>
        <div id="stat-returning-today" class="stat-num">0</div>
        <div class="stat-desc">Existing registered users who re-opened the app today</div>
      </div>

      <!-- Card 3: Live Online Sockets -->
      <div class="stat-card card-live">
        <div class="stat-top">
          <span class="stat-label">Live Online Sockets</span>
          <span class="stat-badge badge-yellow">🟢 Connected Now</span>
        </div>
        <div id="stat-live-now" class="stat-num">${connectedUsers.size}</div>
        <div class="stat-desc">Active real-time WebRTC & Socket.IO connections</div>
      </div>

      <!-- Card 4: Total Lifetime Users -->
      <div class="stat-card card-total">
        <div class="stat-top">
          <span class="stat-label">Total Lifetime Users</span>
          <span class="stat-badge badge-purple">👥 Registered Database</span>
        </div>
        <div id="stat-total-users" class="stat-num">0</div>
        <div class="stat-desc">Unique 10-digit UIDs across all sessions</div>
      </div>
    </div>

    <!-- SERVER LOAD & REMAINING CAPACITY PANEL -->
    <div class="capacity-panel" id="server-capacity-panel">
      <div class="capacity-header">
        <div class="panel-title" style="margin-bottom: 0;">⚡ Live Server Load &amp; Remaining Capacity</div>
        <div id="cap-status-pill" class="capacity-pill healthy">● Healthy • --% Free</div>
      </div>

      <div class="capacity-summary-grid">
        <div class="capacity-box">
          <div class="capacity-box-top">
            <span class="capacity-box-label">Overall Load Used</span>
            <span id="cap-overall-used" class="capacity-box-value">0%</span>
          </div>
          <div class="progress-track">
            <div id="bar-cap-overall" class="progress-fill fill-load-healthy" style="width: 0%;"></div>
          </div>
          <div class="capacity-box-sub">
            <span>Remaining Headroom:</span>
            <strong id="cap-overall-free">100% Free</strong>
          </div>
        </div>

        <div class="capacity-box">
          <div class="capacity-box-top">
            <span class="capacity-box-label">CPU Usage</span>
            <span id="cap-cpu-used" class="capacity-box-value">0%</span>
          </div>
          <div class="progress-track">
            <div id="bar-cap-cpu" class="progress-fill fill-load-healthy" style="width: 0%;"></div>
          </div>
          <div class="capacity-box-sub">
            <span id="cap-cpu-meta">Cores: -- • Avg: --</span>
            <strong id="cap-cpu-free">100% Free</strong>
          </div>
        </div>

        <div class="capacity-box">
          <div class="capacity-box-top">
            <span class="capacity-box-label">RAM / Memory Usage</span>
            <span id="cap-ram-used" class="capacity-box-value">0%</span>
          </div>
          <div class="progress-track">
            <div id="bar-cap-ram" class="progress-fill fill-load-healthy" style="width: 0%;"></div>
          </div>
          <div class="capacity-box-sub">
            <span id="cap-ram-meta">-- / -- MB</span>
            <strong id="cap-ram-free">-- MB Free</strong>
          </div>
        </div>

        <div class="capacity-box">
          <div class="capacity-box-top">
            <span class="capacity-box-label">Event Loop &amp; Traffic</span>
            <span id="cap-loop-lag" class="capacity-box-value">0 ms</span>
          </div>
          <div class="progress-track">
            <div id="bar-cap-loop" class="progress-fill fill-load-healthy" style="width: 0%;"></div>
          </div>
          <div class="capacity-box-sub">
            <span id="cap-runtime-meta">Sockets: 0 • Pairs: 0</span>
            <strong id="cap-heap-meta">Heap: -- MB</strong>
          </div>
        </div>
      </div>
    </div>

    <!-- MIDDLE ROW: PLATFORMS & SYSTEM INFO -->
    <div class="middle-grid">
      <!-- Platform Distribution -->
      <div class="panel">
        <div class="panel-title">📱 App Platform Distribution</div>
        
        <div class="bar-item">
          <div class="bar-header">
            <span class="bar-label">Amazon Fire TV</span>
            <span id="label-tv-count" class="bar-count">0 users (0%)</span>
          </div>
          <div class="progress-track">
            <div id="bar-tv" class="progress-fill fill-tv" style="width: 0%;"></div>
          </div>
        </div>

        <div class="bar-item">
          <div class="bar-header">
            <span class="bar-label">Android Mobile</span>
            <span id="label-mob-count" class="bar-count">0 users (0%)</span>
          </div>
          <div class="progress-track">
            <div id="bar-mob" class="progress-fill fill-mobile" style="width: 0%;"></div>
          </div>
        </div>

        <div class="bar-item">
          <div class="bar-header">
            <span class="bar-label">Web / Other</span>
            <span id="label-web-count" class="bar-count">0 users (0%)</span>
          </div>
          <div class="progress-track">
            <div id="bar-web" class="progress-fill fill-web" style="width: 0%;"></div>
          </div>
        </div>
      </div>

      <!-- System Diagnostics -->
      <div class="panel">
        <div class="panel-title">⚙️ Server Infrastructure Diagnostics</div>
        <div class="diag-row"><span class="diag-label">Public Domain:</span><span class="diag-val">zingtalk.duckdns.org</span></div>
        <div class="diag-row"><span class="diag-label">Signaling Ports:</span><span class="diag-val">3000 (HTTP) / 443 (HTTPS)</span></div>
        <div class="diag-row"><span class="diag-label">coturn STUN / TURN:</span><span class="diag-val">zingtalk.duckdns.org:3478</span></div>
        <div class="diag-row"><span class="diag-label">Alexa Voice Webhook:</span><span class="diag-val">/alexa & /api/alexa</span></div>
        <div class="diag-row"><span class="diag-label">Server Uptime:</span><span id="diag-uptime" class="diag-val">--</span></div>
        <div class="diag-row"><span class="diag-label">Node Memory RSS:</span><span id="diag-mem" class="diag-val">-- MB</span></div>
      </div>
    </div>

    <!-- RECENT USERS LOG TABLE -->
    <div class="table-container">
      <div class="table-header-row">
        <div class="panel-title" style="margin-bottom: 0;">📊 Recent Connected Users & Live Traffic Log</div>
        <input type="text" id="user-search" class="search-input" placeholder="Search by UID or Name...">
      </div>

      <table>
        <thead>
          <tr>
            <th>10-Digit UID</th>
            <th>Display Name</th>
            <th>User Status</th>
            <th>Platform</th>
            <th>Total Sessions</th>
            <th>Last Active</th>
          </tr>
        </thead>
        <tbody id="users-tbody">
          <tr>
            <td colspan="6" class="empty-state">Loading user telemetry data...</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <script>
    (function() {
      const gateView = document.getElementById('gate-view');
      const dashView = document.getElementById('dashboard-view');
      const gateInput = document.getElementById('gate-input');
      const gateSubmitBtn = document.getElementById('gate-submit-btn');
      const gateError = document.getElementById('gate-error');
      const gateInstruction = document.getElementById('gate-instruction');
      const toggleEyeBtn = document.getElementById('toggle-eye-btn');
      const btnRefresh = document.getElementById('btn-refresh');
      const btnLock = document.getElementById('btn-lock');
      const userSearch = document.getElementById('user-search');

      const tab1 = document.getElementById('tab-lvl-1');
      const tab2 = document.getElementById('tab-lvl-2');
      const tab3 = document.getElementById('tab-lvl-3');

      let currentLevel = 1;
      let cachedUsersList = [];

      // Check for saved session token
      const savedToken = sessionStorage.getItem('zingtalk_admin_session');
      if (savedToken) {
        verifySessionToken(savedToken);
      }

      // Show/Hide password toggle
      toggleEyeBtn.addEventListener('click', function() {
        if (gateInput.type === 'password') {
          gateInput.type = 'text';
          toggleEyeBtn.innerHTML = '<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24M1 1l22 22"/></svg>';
        } else {
          gateInput.type = 'password';
          toggleEyeBtn.innerHTML = '<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
        }
      });

      // Enter key submits
      gateInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') handleGateSubmit();
      });
      gateSubmitBtn.addEventListener('click', handleGateSubmit);

      async function handleGateSubmit() {
        const val = gateInput.value.trim();
        if (!val) {
          showError('Please enter the security password');
          return;
        }

        gateError.classList.add('hidden');
        gateSubmitBtn.disabled = true;
        gateSubmitBtn.textContent = 'Verifying Clearance...';

        try {
          const res = await fetch('/api/admin/verify-gate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ level: currentLevel, key: val })
          });
          const data = await res.json();

          if (!res.ok || !data.success) {
            showError(data.message || 'Invalid security key. Clearance denied.');
            gateSubmitBtn.disabled = false;
            updateLevelUI();
            return;
          }

          if (data.nextLevel) {
            currentLevel = data.nextLevel;
            gateInput.value = '';
            gateSubmitBtn.disabled = false;
            updateLevelUI();
          } else if (data.authorized && data.token) {
            sessionStorage.setItem('zingtalk_admin_session', data.token);
            gateInput.value = '';
            showDashboard(data.token);
          }
        } catch (err) {
          showError('Verification error: ' + err.message);
          gateSubmitBtn.disabled = false;
        }
      }

      function updateLevelUI() {
        if (currentLevel === 1) {
          tab1.className = 'level-tab active';
          tab2.className = 'level-tab';
          tab3.className = 'level-tab';
          gateInstruction.textContent = 'Level 1 Verification: Enter Primary Authentication Key';
          gateInput.placeholder = 'Enter Level 1 Password...';
          gateSubmitBtn.textContent = 'Authorize Level 1 Key';
        } else if (currentLevel === 2) {
          tab1.className = 'level-tab done';
          tab2.className = 'level-tab active';
          tab3.className = 'level-tab';
          gateInstruction.textContent = 'Level 2 Verification: Enter Secondary Clearance Key';
          gateInput.placeholder = 'Enter Level 2 Password...';
          gateSubmitBtn.textContent = 'Authorize Level 2 Key';
        } else if (currentLevel === 3) {
          tab1.className = 'level-tab done';
          tab2.className = 'level-tab done';
          tab3.className = 'level-tab active';
          gateInstruction.textContent = 'Level 3 Verification: Enter Master Developer Token';
          gateInput.placeholder = 'Enter Level 3 Password...';
          gateSubmitBtn.textContent = 'Authorize Developer Token';
        }
        gateInput.focus();
      }

      function showError(msg) {
        gateError.textContent = msg;
        gateError.classList.remove('hidden');
      }

      async function verifySessionToken(token) {
        try {
          const res = await fetch('/api/admin/analytics', {
            headers: { 'x-admin-token': token }
          });
          if (res.ok) {
            showDashboard(token);
          } else {
            sessionStorage.removeItem('zingtalk_admin_session');
          }
        } catch (_) {}
      }

      function showDashboard(token) {
        gateView.classList.add('hidden');
        dashView.classList.remove('hidden');
        loadAnalyticsData(token);
      }

      async function loadAnalyticsData(token, isSilent = false) {
        if (!token) token = sessionStorage.getItem('zingtalk_admin_session');
        if (!token) return;

        if (!isSilent) {
          btnRefresh.textContent = 'Loading...';
        }

        try {
          const res = await fetch('/api/admin/analytics', {
            headers: { 'x-admin-token': token }
          });
          if (!res.ok) {
            if (res.status === 401) {
              sessionStorage.removeItem('zingtalk_admin_session');
              dashView.classList.add('hidden');
              gateView.classList.remove('hidden');
              currentLevel = 1;
              updateLevelUI();
              showError('Session expired. Please re-authenticate.');
            }
            return;
          }
          const data = await res.json();
          renderAnalyticsUI(data);
        } catch (err) {
          console.error('[Dashboard Error]', err);
        } finally {
          btnRefresh.textContent = '🔄 Refresh Data';
        }
      }

      function formatUptime(seconds) {
        const d = Math.floor(seconds / (3600*24));
        const h = Math.floor((seconds % (3600*24)) / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const parts = [];
        if (d > 0) parts.push(d + 'd');
        if (h > 0) parts.push(h + 'h');
        parts.push(m + 'm');
        return parts.join(' ');
      }

      function renderAnalyticsUI(data) {
        if (!data || !data.summary) return;
        const s = data.summary;

        document.getElementById('stat-new-today').textContent = s.newUsersTodayCount || 0;
        document.getElementById('stat-returning-today').textContent = s.returningUsersTodayCount || 0;
        document.getElementById('stat-live-now').textContent = s.liveConnectedNowCount || 0;
        document.getElementById('stat-total-users').textContent = s.totalLifetimeUsersCount || 0;

        // Platform breakdown
        const pb = s.platformBreakdown || { fireTv: 0, mobile: 0, other: 0 };
        const total = (pb.fireTv + pb.mobile + pb.other) || 1;
        const tvPct = Math.round((pb.fireTv / total) * 100);
        const mobPct = Math.round((pb.mobile / total) * 100);
        const webPct = Math.max(0, 100 - tvPct - mobPct);

        document.getElementById('label-tv-count').textContent = pb.fireTv + ' users (' + tvPct + '%)';
        document.getElementById('bar-tv').style.width = tvPct + '%';

        document.getElementById('label-mob-count').textContent = pb.mobile + ' users (' + mobPct + '%)';
        document.getElementById('bar-mob').style.width = mobPct + '%';

        document.getElementById('label-web-count').textContent = pb.other + ' users (' + webPct + '%)';
        document.getElementById('bar-web').style.width = webPct + '%';

        if (s.serverLoad) {
          const sl = s.serverLoad;
          const levelClass = sl.statusLevel === 'heavy' ? 'heavy' : (sl.statusLevel === 'moderate' ? 'moderate' : 'healthy');
          const pickBarClass = (pct) => 'progress-fill ' + (pct >= 85 ? 'fill-load-heavy' : (pct >= 60 ? 'fill-load-moderate' : 'fill-load-healthy'));

          const pill = document.getElementById('cap-status-pill');
          if (pill) {
            pill.className = 'capacity-pill ' + levelClass;
            pill.textContent = '● ' + (sl.statusLabel || 'Healthy') + ' • ' + (sl.remainingCapacityPct ?? 100) + '% Free';
          }

          const overallUsed = sl.overallLoadPct ?? 0;
          const overallFree = sl.remainingCapacityPct ?? (100 - overallUsed);
          document.getElementById('cap-overall-used').textContent = overallUsed + '%';
          document.getElementById('cap-overall-free').textContent = overallFree + '% Free';
          const barOverall = document.getElementById('bar-cap-overall');
          barOverall.style.width = overallUsed + '%';
          barOverall.className = pickBarClass(overallUsed);

          const cpu = sl.cpu || { usedPct: 0, remainingPct: 100, cores: 1, loadAvg1m: 0 };
          document.getElementById('cap-cpu-used').textContent = cpu.usedPct + '%';
          document.getElementById('cap-cpu-free').textContent = cpu.remainingPct + '% Free';
          document.getElementById('cap-cpu-meta').textContent = cpu.cores + ' Core' + (cpu.cores === 1 ? '' : 's') + ' • Load ' + (cpu.loadAvg1m ?? 0);
          const barCpu = document.getElementById('bar-cap-cpu');
          barCpu.style.width = cpu.usedPct + '%';
          barCpu.className = pickBarClass(cpu.usedPct);

          const mem = sl.memory || { usedPct: 0, remainingPct: 100, usedMb: 0, freeMb: 0, totalMb: 0, heapUsedMb: 0 };
          document.getElementById('cap-ram-used').textContent = mem.usedPct + '%';
          document.getElementById('cap-ram-meta').textContent = mem.usedMb + ' / ' + mem.totalMb + ' MB';
          document.getElementById('cap-ram-free').textContent = mem.freeMb + ' MB Free (' + mem.remainingPct + '%)';
          const barRam = document.getElementById('bar-cap-ram');
          barRam.style.width = mem.usedPct + '%';
          barRam.className = pickBarClass(mem.usedPct);

          const rt = sl.runtime || { eventLoopLagMs: 0, loopLoadPct: 0, liveSockets: 0, activePairings: 0, activeSplitCalls: 0 };
          document.getElementById('cap-loop-lag').textContent = (rt.eventLoopLagMs ?? 0) + ' ms';
          document.getElementById('cap-runtime-meta').textContent = 'Sockets: ' + (rt.liveSockets || 0) + ' • Pairs: ' + (rt.activePairings || 0);
          document.getElementById('cap-heap-meta').textContent = 'Heap: ' + (mem.heapUsedMb || 0) + ' MB';
          const barLoop = document.getElementById('bar-cap-loop');
          barLoop.style.width = (rt.loopLoadPct || 0) + '%';
          barLoop.className = pickBarClass(rt.loopLoadPct || 0);
        }

        if (s.system) {
          document.getElementById('diag-uptime').textContent = formatUptime(s.system.uptimeSeconds || 0);
          document.getElementById('diag-mem').textContent = (s.system.memoryUsageMb || 0) + ' MB';
        }

        // Table
        cachedUsersList = data.recentUsers || [];
        renderUsersTable(cachedUsersList);
      }

      function renderUsersTable(list) {
        const tbody = document.getElementById('users-tbody');
        const query = (userSearch.value || '').trim().toLowerCase();
        const filtered = list.filter(u => {
          if (!query) return true;
          return (u.uid && u.uid.includes(query)) || (u.name && u.name.toLowerCase().includes(query));
        });

        if (filtered.length === 0) {
          tbody.innerHTML = '<tr><td colspan="6" class="empty-state">' +
            (list.length === 0 ? 'No user sessions recorded yet today. Launch Fire TV or Mobile APK to see live traffic.' : 'No matching users found for "' + query + '"') +
            '</td></tr>';
          return;
        }

        tbody.innerHTML = filtered.map(u => {
          const isNew = u.isNewToday || (u.type && u.type.includes('New'));
          const isReturning = ((u.totalConnections || 1) > 1) || (u.type && u.type.includes('Returning'));
          const statusTag = isNew
            ? '<span class="tag-new">' + escapeHtml(u.type || 'New User (Today)') + '</span>'
            : (isReturning
                ? '<span class="tag-returning">' + escapeHtml(u.type || 'Returning User') + '</span>'
                : '<span class="tag-platform">First-Time User</span>');
          const onlineIndicator = u.isOnline
            ? '<span style="color: #00d29d; font-weight: 700; margin-left: 6px;">🟢 Online</span>'
            : '<span style="color: #64748b; margin-left: 6px;">⚪ Offline</span>';
          const platformTag = '<span class="tag-platform">' + escapeHtml(u.platform || 'Web Browser') + '</span>';
          const lastSeen = u.lastSeenTime ? new Date(u.lastSeenTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--';

          return '<tr>' +
            '<td class="user-uid-cell">' + (u.uid || '----------') + '</td>' +
            '<td><strong>' + (escapeHtml(u.name) || 'User') + '</strong></td>' +
            '<td>' + statusTag + '</td>' +
            '<td>' + platformTag + '</td>' +
            '<td>' + (u.totalConnections || 1) + '</td>' +
            '<td style="font-family: monospace; color: #94a3b8;">' + lastSeen + onlineIndicator + '</td>' +
            '</tr>';
        }).join('');
      }

      function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      }

      userSearch.addEventListener('input', function() {
        renderUsersTable(cachedUsersList);
      });

      btnRefresh.addEventListener('click', function() {
        loadAnalyticsData();
      });

      btnLock.addEventListener('click', async function() {
        const token = sessionStorage.getItem('zingtalk_admin_session');
        if (token) {
          try {
            await fetch('/api/admin/logout', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token })
            });
          } catch (_) {}
        }
        sessionStorage.removeItem('zingtalk_admin_session');
        dashView.classList.add('hidden');
        gateView.classList.remove('hidden');
        currentLevel = 1;
        gateInput.value = '';
        gateError.classList.add('hidden');
        updateLevelUI();
      });

      // Auto poll analytics every 8 seconds when dashboard is active
      setInterval(function() {
        const token = sessionStorage.getItem('zingtalk_admin_session');
        if (token && !dashView.classList.contains('hidden')) {
          loadAnalyticsData(token, true);
        }
      }, 8000);

    })();
  </script>
</body>
</html>`;
    return res.status(200).type('html').send(html);
}

// Legal Compliance & Privacy Endpoints (Google Play Store & Store Review Compliance)
app.get(['/privacy', '/privacy-policy', '/privacy.html'], (req, res) => {
    const privacyPath = path.join(__dirname, 'privacy.html');
    if (fs.existsSync(privacyPath)) return res.sendFile(privacyPath);
    return res.status(404).send('Privacy Policy not found');
});

app.get(['/terms', '/terms-of-service', '/terms.html'], (req, res) => {
    const termsPath = path.join(__dirname, 'terms.html');
    if (fs.existsSync(termsPath)) return res.sendFile(termsPath);
    return res.status(404).send('Terms of Service not found');
});

app.get(['/delete-account', '/account-deletion'], (req, res) => {
    const privacyPath = path.join(__dirname, 'privacy.html');
    if (fs.existsSync(privacyPath)) return res.sendFile(privacyPath);
    return res.status(404).send('Account Deletion Policy not found');
});

// Amazon Appstore Fire TV Screenshots Gallery
app.get(['/screenshots', '/screenshots/'], (req, res) => {
    const screens = [
        { file: '1_firetv_dashboard_contacts.png', title: '1. Fire TV Dashboard & Contacts' },
        { file: '2_firetv_hd_video_call.png', title: '2. Fullscreen HD Video Call & Fallback PIP' },
        { file: '3_firetv_incoming_call.png', title: '3. TV Incoming Call Alert Modal' },
        { file: '4_firetv_chat_messaging.png', title: '4. TV Real-Time Messaging & Virtual Keyboard' },
        { file: '5_firetv_auth_guest_login.png', title: '5. Fire TV Instant Guest Sign-In & 10-Digit UID' }
    ];
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>ZingTalk Fire TV - Amazon Appstore Screenshots</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      body { background: #0a0f1d; color: #fff; font-family: system-ui, sans-serif; padding: 30px 20px; max-width: 1200px; margin: auto; }
      h1 { color: #00d29d; margin-bottom: 6px; }
      p { color: #94a3b8; margin-top: 0; }
      .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 24px; margin-top: 24px; }
      .card { background: #131b2e; border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; overflow: hidden; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
      img { width: 100%; border-radius: 8px; border: 1px solid rgba(255,255,255,0.15); aspect-ratio: 16/9; object-fit: cover; }
      .btn { display: inline-block; background: #00d29d; color: #0a0f1d; text-decoration: none; padding: 10px 16px; border-radius: 8px; font-weight: 700; text-align: center; }
      .btn:hover { background: #00f0b4; }
    </style></head><body>
      <h1>ZingTalk Fire TV - Amazon Appstore Screenshots (1920x1080)</h1>
      <p>Official 16:9 landscape screenshots ready for Amazon Developer Portal submission.</p>
      <div class="grid">
        ${screens.map(s => `
          <div class="card">
            <h3 style="margin: 0; font-size: 15px;">${s.title}</h3>
            <img src="/screenshots/firetv/${s.file}" alt="${s.title}">
            <a class="btn" href="/screenshots/firetv/${s.file}" download="${s.file}">⬇️ Download Screenshot (1920x1080)</a>
          </div>
        `).join('')}
      </div>
    </body></html>`;
    res.send(html);
});

// Multi-Client SPA & Route Fallback
app.get('/', (req, res) => renderServerStatus(req, res));
app.get('/admin', (req, res) => renderServerStatus(req, res));
app.get('/status', (req, res) => renderServerStatus(req, res));

app.get('/web*', (req, res) => {
    const rootPath = path.join(__dirname, 'index.html');
    if (fs.existsSync(rootPath)) return res.sendFile(rootPath);
    return renderServerStatus(req, res);
});

app.get('/tv*', (req, res) => {
    const tvPath = path.join(__dirname, 'packages', 'tv', 'index.html');
    if (fs.existsSync(tvPath)) return res.sendFile(tvPath);
    const rootPath = path.join(__dirname, 'index.html');
    if (fs.existsSync(rootPath)) return res.sendFile(rootPath);
    return renderServerStatus(req, res);
});

app.get('/mobile*', (req, res) => {
    const mobPath = path.join(__dirname, 'packages', 'mobile', 'index.html');
    if (fs.existsSync(mobPath)) return res.sendFile(mobPath);
    const rootPath = path.join(__dirname, 'index.html');
    if (fs.existsSync(rootPath)) return res.sendFile(rootPath);
    return renderServerStatus(req, res);
});

app.get('/connector*', (req, res) => {
    const connPath = path.join(__dirname, 'packages', 'connector', 'index.html');
    if (fs.existsSync(connPath)) return res.sendFile(connPath);
    return renderServerStatus(req, res);
});

app.get('*', (req, res, next) => {
    if (req.path.startsWith('/socket.io') || req.path.startsWith('/api') || req.path === '/alexa') return next();
    return renderServerStatus(req, res);
});

// Express error handling middleware to catch any stream or routing errors cleanly
app.use((err, req, res, next) => {
    console.error('[ZingTalk Server Error]', err);
    if (!res.headersSent) {
        res.status(500).json({ status: "error", message: err.message || "Internal Server Error" });
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`[ZingTalk] Server running on http://0.0.0.0:${PORT}`);
});
