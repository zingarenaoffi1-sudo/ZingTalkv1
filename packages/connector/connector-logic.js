// Pure logic helpers for ZingTalk TV Connector (Option 2 Split-Mesh Companion)

export function sanitizeTvUid(raw) {
    return String(raw || '').replace(/\D/g, '').slice(0, 10);
}

export function sanitizePairingPin(raw) {
    return String(raw || '').replace(/\D/g, '').slice(0, 4);
}

export function generatePairingPin(rng = Math.random) {
    const num = Math.floor(1000 + rng() * 9000);
    return String(num).slice(0, 4);
}

export function validatePairingInput(rawTvUid, rawPin) {
    const tvUid = sanitizeTvUid(rawTvUid);
    const pin = sanitizePairingPin(rawPin);
    if (tvUid.length !== 10) {
        return { ok: false, tvUid, pin, error: 'Please enter a valid 10-digit Fire TV UID.' };
    }
    if (pin.length !== 4) {
        return { ok: false, tvUid, pin, error: 'Please enter the 4-digit pairing PIN shown on your Fire TV.' };
    }
    return { ok: true, tvUid, pin, error: null };
}

export function getOrCreateConnectorId(storageObj = null) {
    const KEY = 'zingTalkConnectorDeviceId';
    try {
        if (storageObj) {
            const existing = storageObj.getItem(KEY);
            if (existing && existing.trim()) return existing.trim();
            const created = 'conn_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now().toString(36);
            storageObj.setItem(KEY, created);
            return created;
        }
    } catch (_) {}
    return 'conn_' + Math.random().toString(36).slice(2, 10);
}

export function detectFriendlyDeviceName(userAgent = '') {
    const ua = String(userAgent || '');
    if (/KF[A-Z0-9]+|Kindle|Silk/i.test(ua)) return 'Amazon Fire Tablet';
    if (/iPad/i.test(ua)) return 'Apple iPad';
    if (/iPhone/i.test(ua)) return 'Apple iPhone';
    if (/Pixel/i.test(ua)) return 'Google Pixel';
    if (/SM-[A-Z0-9]+|Samsung/i.test(ua)) return 'Samsung Galaxy';
    if (/Android/i.test(ua)) return 'Android Phone';
    return 'Companion Camera';
}

export function resolveCallStageState({ paired, streaming, micMuted, cameraEnabled, callType }) {
    if (!paired) {
        return {
            code: 'unpaired',
            headline: 'Not Connected to Fire TV',
            detail: 'Enter your Fire TV 10-digit UID and 4-digit PIN to link camera and mic.'
        };
    }
    if (!streaming) {
        return {
            code: 'standby',
            headline: 'Paired & Ready on Standby',
            detail: 'Camera and mic will activate automatically whenever Fire TV starts or answers a call.'
        };
    }
    const camState = callType === 'audio'
        ? 'Audio Call Mode'
        : (cameraEnabled ? 'HD Video Live' : 'Camera Paused (Mic Only)');
    const micState = micMuted ? 'Mic Muted' : 'Mic Live';
    return {
        code: 'streaming',
        headline: 'Streaming Direct to Call',
        detail: `${camState} · ${micState}`
    };
}
