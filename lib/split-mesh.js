/**
 * ZingTalk Option 2: Split-Mesh Wireless Phone Camera & Mic Orchestrator
 * Pure state/validation helpers for pairing TVs with Connector Phones
 * and routing direct sendonly uplinks (Phone -> Friend) + recvonly downlinks (Friend -> TV).
 */

const PAIR_CODE_TTL_MS = 30 * 60 * 1000;

function normalizeUid(raw) {
    const clean = String(raw || '').trim().replace(/\D/g, '');
    return clean.length === 10 ? clean : '';
}

function normalizePairCode(raw) {
    const clean = String(raw || '').trim().replace(/\D/g, '');
    return clean.length === 6 ? clean : '';
}

function parseQrPairingPayload(rawText) {
    const text = String(rawText || '').trim();
    if (!text) return { tvUid: '', code: '' };

    // 1. zingtalk://pair?uid=1234567890&code=654321
    if (text.startsWith('zingtalk://') || text.startsWith('http://') || text.startsWith('https://')) {
        try {
            const parsed = new URL(text);
            const tvUid = normalizeUid(parsed.searchParams.get('uid') || parsed.searchParams.get('tvUid'));
            const code = normalizePairCode(parsed.searchParams.get('code') || parsed.searchParams.get('pairCode'));
            if (tvUid || code) return { tvUid, code };
        } catch (_) {}
    }

    // 2. JSON payload { uid, code }
    if (text.startsWith('{')) {
        try {
            const obj = JSON.parse(text);
            const tvUid = normalizeUid(obj.tvUid || obj.uid);
            const code = normalizePairCode(obj.code || obj.pairCode);
            if (tvUid || code) return { tvUid, code };
        } catch (_) {}
    }

    // 3. Raw 6-digit code or 10-digit UID
    const digits = text.replace(/\D/g, '');
    if (digits.length === 6) return { tvUid: '', code: digits };
    if (digits.length === 10) return { tvUid: digits, code: '' };
    return { tvUid: '', code: '' };
}

class SplitMeshRegistry {
    constructor({ ttlMs = PAIR_CODE_TTL_MS, nowFn = () => Date.now() } = {}) {
        this.ttlMs = ttlMs;
        this.nowFn = nowFn;
        this.codeToTv = new Map();       // 6-digit code -> { tvUid, tvName, createdAt }
        this.tvToCode = new Map();       // tvUid -> 6-digit code
        this.tvToConnector = new Map();  // tvUid -> { socketId, connectorId, deviceName, resolution, facingMode, pairedAt }
        this.connectorToTv = new Map();  // socketId -> tvUid
        this.activeSplitCalls = new Map(); // tvUid -> { callSessionId, tvUid, friendUid, friendName, callType, tvAsCaller, startedAt }
    }

    _purgeExpiredCodes() {
        const now = this.nowFn();
        for (const [code, entry] of this.codeToTv.entries()) {
            if (!entry || (now - entry.createdAt) > this.ttlMs) {
                this.codeToTv.delete(code);
                if (entry && this.tvToCode.get(entry.tvUid) === code) {
                    this.tvToCode.delete(entry.tvUid);
                }
            }
        }
    }

    registerTvPairing(rawTvUid, tvName = 'Fire TV', preferredCode = null) {
        this._purgeExpiredCodes();
        const tvUid = normalizeUid(rawTvUid);
        if (!tvUid) {
            return { ok: false, error: 'Valid 10-digit TV UID required.' };
        }

        const existingCode = this.tvToCode.get(tvUid);
        if (existingCode && this.codeToTv.has(existingCode) && !preferredCode) {
            const entry = this.codeToTv.get(existingCode);
            entry.createdAt = this.nowFn();
            entry.tvName = tvName || entry.tvName || 'Fire TV';
            return {
                ok: true,
                tvUid,
                code: existingCode,
                tvName: entry.tvName,
                qrPayload: `zingtalk://pair?uid=${tvUid}&code=${existingCode}`
            };
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

        this.codeToTv.set(code, {
            tvUid,
            tvName: String(tvName || 'Fire TV').trim().slice(0, 48),
            createdAt: this.nowFn()
        });
        this.tvToCode.set(tvUid, code);

        return {
            ok: true,
            tvUid,
            code,
            tvName: String(tvName || 'Fire TV').trim().slice(0, 48),
            qrPayload: `zingtalk://pair?uid=${tvUid}&code=${code}`
        };
    }

    pairConnector({ code, tvUid, connectorSocketId, deviceName = 'Phone Camera', resolution = '720p', facingMode = 'user', isTvOnlineFn = () => true }) {
        this._purgeExpiredCodes();
        if (!connectorSocketId) {
            return { ok: false, error: 'Connector socket ID required.' };
        }

        const cleanCode = normalizePairCode(code);
        let resolvedTvUid = normalizeUid(tvUid);
        let tvName = 'Fire TV';

        if (cleanCode) {
            const entry = this.codeToTv.get(cleanCode);
            if (!entry) {
                return { ok: false, error: 'Invalid or expired 6-digit Pairing Code. Open Phone Cam on your Fire TV for a fresh code.' };
            }
            resolvedTvUid = entry.tvUid;
            tvName = entry.tvName || 'Fire TV';
        } else if (resolvedTvUid) {
            const mappedCode = this.tvToCode.get(resolvedTvUid);
            if (mappedCode && this.codeToTv.has(mappedCode)) {
                tvName = this.codeToTv.get(mappedCode).tvName || 'Fire TV';
            }
        } else {
            return { ok: false, error: 'Enter a valid 6-digit Pairing Code or 10-digit Fire TV UID.' };
        }

        if (!isTvOnlineFn(resolvedTvUid)) {
            return { ok: false, error: `Fire TV [${resolvedTvUid}] is currently offline. Open ZingTalk TV on your TV first.` };
        }

        // Unbind if this connector was previously paired elsewhere
        const prevTvForThisSocket = this.connectorToTv.get(connectorSocketId);
        if (prevTvForThisSocket && prevTvForThisSocket !== resolvedTvUid) {
            this.unpairByConnector(connectorSocketId);
        }

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
}

module.exports = {
    PAIR_CODE_TTL_MS,
    normalizeUid,
    normalizePairCode,
    parseQrPairingPayload,
    SplitMeshRegistry
};
