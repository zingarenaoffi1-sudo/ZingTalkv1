// ZingTalk Connector — Option 2 Split-Mesh Camera/Mic Uplink & Fire TV Remote Controller

const PRODUCTION_SERVER_URL = "https://zingtalk.duckdns.org";
const SAVED_TVS_KEY = "zingTalkConnectorSavedTvs";
const LAST_DEVICE_NAME_KEY = "zingTalkConnectorDeviceName";

// Ephemeral TURN credentials are fetched dynamically from the authenticated server after pairing (zero static secrets in APK)
const RTC_CONFIG = {
    iceServers: [
        {
            urls: [
                "stun:stun.l.google.com:19302",
                "stun:stun1.l.google.com:19302",
                "stun:stun2.l.google.com:19302"
            ]
        },
        {
            urls: ["stun:zingtalk.duckdns.org:3478"]
        }
    ],
    iceCandidatePoolSize: 8
};

let lastIceFetchAt = 0;
async function refreshIceServers(force = false) {
    const now = Date.now();
    if (!force && lastIceFetchAt && (now - lastIceFetchAt) < 15 * 60 * 1000) return;
    if (!socket || !socket.connected) return;
    await new Promise((resolve) => {
        let done = false;
        const timer = setTimeout(() => { if (!done) { done = true; resolve(); } }, 1200);
        try {
            socket.emit("request_turn_credentials", {}, (res) => {
                if (!done) {
                    done = true;
                    clearTimeout(timer);
                    if (res && res.ok && Array.isArray(res.iceServers)) {
                        RTC_CONFIG.iceServers = res.iceServers;
                        lastIceFetchAt = Date.now();
                    }
                    resolve();
                }
            });
        } catch (_) {
            if (!done) { done = true; clearTimeout(timer); resolve(); }
        }
    });
}

const RESOLUTION_MAP = {
    "480p": { width: { ideal: 640, max: 854 }, height: { ideal: 480, max: 480 }, frameRate: { ideal: 24, max: 30 } },
    "720p": { width: { ideal: 1280, max: 1280 }, height: { ideal: 720, max: 720 }, frameRate: { ideal: 30, max: 30 } },
    "1080p": { width: { ideal: 1920, max: 1920 }, height: { ideal: 1080, max: 1080 }, frameRate: { ideal: 30, max: 30 } }
};

let socket = null;
let pairedTvUid = null;
let pairedTvName = "";
let pairedCode = "";

let previewStream = null;
let uplinkStream = null;
let connectorPeerConnection = null;
let connectorIceQueue = [];
let activeSplitSession = null;

let currentResolution = "720p";
let currentFacingMode = "user";
let currentVideoDeviceId = null;
let isSwitchingCamera = false;
let isMicMuted = false;
let isVideoOff = false;
let echoGuardEnabled = true;

// Web Audio AEC / 90Hz High-Pass Filter & Live Meter state
let audioContext = null;
let audioMeterRaf = null;
let audioProcessedTrack = null;

// QR Scanner state
let qrScanStream = null;
let qrScanTimer = null;
let qrScanBusy = false;
let qrScanFacingMode = "environment";
let qrScanCanvas = null;
let qrScanCtx = null;
let pendingPairRequest = null;

function sanitizeServerUrl(rawUrl, fallbackUrl = PRODUCTION_SERVER_URL) {
    if (!rawUrl || typeof rawUrl !== "string") return fallbackUrl;
    const trimmed = rawUrl.trim();
    if (!trimmed || /^javascript:/i.test(trimmed) || /^data:/i.test(trimmed)) return fallbackUrl;
    try {
        const parsed = new URL(trimmed);
        const host = parsed.hostname.toLowerCase();
        const isLocal = host === "localhost" || host === "127.0.0.1";
        if (parsed.protocol === "https:" && (host === "zingtalk.duckdns.org" || isLocal || host.endsWith(".run.app") || host.endsWith(".ai.studio"))) {
            return parsed.origin;
        }
        if (parsed.protocol === "http:" && isLocal) {
            return parsed.origin;
        }
    } catch (_) {}
    return fallbackUrl;
}

function getServerUrl() {
    try {
        const saved = localStorage.getItem("zingTalkServerUrl");
        if (saved && saved.trim()) return sanitizeServerUrl(saved.trim(), PRODUCTION_SERVER_URL);
        const { protocol, host, origin } = window.location;
        if (protocol.startsWith("http") && (host.includes(":3000") || host.includes("run.app") || host.includes("ai.studio") || host.includes("duckdns"))) {
            return sanitizeServerUrl(origin, PRODUCTION_SERVER_URL);
        }
    } catch (_) {}
    return PRODUCTION_SERVER_URL;
}

function showToast(msg) {
    const el = document.getElementById("conn-toast");
    if (!el) return;
    el.textContent = msg;
    el.style.opacity = "1";
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => {
        el.style.opacity = "0";
    }, 3000);
}

function setBadgeStatus(id, label, stateClass = "") {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = label;
    el.className = `conn-perm-badge${stateClass ? ` ${stateClass}` : ""}`;
}

async function refreshPermissionsUI() {
    let camGranted = false;
    let micGranted = false;
    let camDenied = false;
    let micDenied = false;

    const bridge = window.ZingNativeBridge;
    if (bridge && typeof bridge.hasCameraPermission === "function") {
        try { camGranted = Boolean(bridge.hasCameraPermission()); } catch (_) {}
        try { micGranted = Boolean(bridge.hasMicPermission()); } catch (_) {}
        setBadgeStatus("perm-cam-status", camGranted ? "Granted" : "Tap Allow", camGranted ? "is-ok" : "is-warn");
        setBadgeStatus("perm-mic-status", micGranted ? "Granted" : "Tap Allow", micGranted ? "is-ok" : "is-warn");
        return { camGranted, micGranted };
    }

    if (navigator.permissions && navigator.permissions.query) {
        try {
            const camP = await navigator.permissions.query({ name: "camera" });
            camGranted = camP.state === "granted";
            camDenied = camP.state === "denied";
        } catch (_) {}
        try {
            const micP = await navigator.permissions.query({ name: "microphone" });
            micGranted = micP.state === "granted";
            micDenied = micP.state === "denied";
        } catch (_) {}
    }

    setBadgeStatus(
        "perm-cam-status",
        camGranted ? "Granted" : (camDenied ? "Blocked" : "Ready on Ask"),
        camGranted ? "is-ok" : (camDenied ? "is-err" : "is-warn")
    );
    setBadgeStatus(
        "perm-mic-status",
        micGranted ? "Granted" : (micDenied ? "Blocked" : "Ready on Ask"),
        micGranted ? "is-ok" : (micDenied ? "is-err" : "is-warn")
    );
    return { camGranted, micGranted };
}

async function ensureAndroidMediaPermissions(needVideo = true) {
    const bridge = window.ZingNativeBridge;
    if (!bridge) {
        await refreshPermissionsUI();
        return true;
    }

    const hasCam = typeof bridge.hasCameraPermission === "function" ? bridge.hasCameraPermission() : false;
    const hasMic = typeof bridge.hasMicPermission === "function" ? bridge.hasMicPermission() : false;
    if ((needVideo ? hasCam : true) && hasMic) {
        await refreshPermissionsUI();
        return true;
    }

    const waitForResult = new Promise((resolve) => {
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            window.removeEventListener("zing-permissions-result", onRes);
            clearTimeout(timer);
            resolve();
        };
        const onRes = () => setTimeout(finish, 180);
        window.addEventListener("zing-permissions-result", onRes);
        const timer = setTimeout(finish, 12000);
    });

    try {
        if (typeof bridge.requestAllPermissions === "function") {
            bridge.requestAllPermissions();
        } else if (typeof bridge.requestCallPermissions === "function") {
            bridge.requestCallPermissions(needVideo ? "video" : "audio");
        }
    } catch (_) {}

    await waitForResult;
    const status = await refreshPermissionsUI();
    return needVideo ? (status.camGranted || status.micGranted) : status.micGranted;
}

async function requestBrowserAndNativePermissions() {
    const bridge = window.ZingNativeBridge;
    if (bridge && typeof bridge.requestAllPermissions === "function") {
        await ensureAndroidMediaPermissions(true);
    }

    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try {
            const probe = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
            probe.getTracks().forEach((t) => { try { t.stop(); } catch (_) {} });
            setBadgeStatus("perm-cam-status", "Granted", "is-ok");
            setBadgeStatus("perm-mic-status", "Granted", "is-ok");
            showToast("Camera & Microphone permissions granted!");
            return true;
        } catch (err) {
            await refreshPermissionsUI();
            showToast("Allow Camera & Mic in Android Settings or popup: " + (err.message || "Denied"));
            return false;
        }
    }
    await refreshPermissionsUI();
    return false;
}

async function checkServerConnectivity() {
    const url = getServerUrl();
    setBadgeStatus("perm-srv-status", "Checking...", "is-warn");
    try {
        const res = await fetch(`${url}/api/health`, { method: "GET", cache: "no-store" });
        if (res.ok) {
            setBadgeStatus("perm-srv-status", "Online", "is-ok");
            const label = document.getElementById("server-conn-label");
            if (label) label.textContent = socket && socket.connected ? "Server online" : "Connecting socket...";
            if (!socket || !socket.connected) connectSocket();
            showToast("ZingTalk server is online!");
            return true;
        }
        setBadgeStatus("perm-srv-status", `HTTP ${res.status}`, "is-err");
        showToast(`Server returned HTTP ${res.status} — check port 3000 service.`);
    } catch (_) {
        setBadgeStatus("perm-srv-status", "Offline", "is-err");
        const label = document.getElementById("server-conn-label");
        if (label) label.textContent = "Server unreachable";
        showToast("Server unreachable right now. Retrying...");
        connectSocket();
    }
    return false;
}

function setPairFeedback(msg, isOk = false) {
    const el = document.getElementById("pair-feedback");
    if (!el) return;
    if (!msg) {
        el.classList.add("hidden");
        el.textContent = "";
        return;
    }
    el.textContent = msg;
    el.className = `conn-feedback ${isOk ? "is-ok" : "is-error"}`;
}

function sanitizeCode(raw) {
    return String(raw || "").trim().replace(/\D/g, "").slice(0, 6);
}

function sanitizeUid(raw) {
    return String(raw || "").trim().replace(/\D/g, "").slice(0, 10);
}

function parsePairingInput(raw) {
    const str = String(raw || "").trim();
    if (!str) return null;
    if (str.startsWith("{")) {
        try {
            const obj = JSON.parse(str);
            const uid = sanitizeUid(obj.uid || obj.tvUid || "");
            const code = sanitizeCode(obj.code || obj.pairCode || "");
            if (code.length === 6 || uid.length === 10) {
                return { uid, code };
            }
        } catch (_) {}
    }
    try {
        if (/^zingtalk:\/\//i.test(str) || str.includes("code=") || str.includes("uid=")) {
            const url = new URL(str.replace(/^zingtalk:\/\//i, "https://zingtalk.local/"));
            const uid = sanitizeUid(url.searchParams.get("uid") || "");
            const code = sanitizeCode(url.searchParams.get("code") || "");
            if (uid.length === 10 || code.length === 6) {
                return { uid, code };
            }
        }
    } catch (_) {}
    const digits = str.replace(/\D/g, "");
    if (digits.length === 6) return { code: digits, uid: "" };
    if (digits.length === 10) return { uid: digits, code: "" };
    return null;
}

// Saved TVs local history
function loadSavedTvs() {
    try {
        const raw = localStorage.getItem(SAVED_TVS_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (_) {
        return [];
    }
}

function saveTvEntry(tvUid, tvName, code) {
    if (!tvUid) return;
    const list = loadSavedTvs().filter((item) => item.uid !== tvUid);
    list.unshift({ uid: tvUid, name: tvName || `TV ${tvUid}`, code: code || "", savedAt: Date.now() });
    try {
        localStorage.setItem(SAVED_TVS_KEY, JSON.stringify(list.slice(0, 5)));
    } catch (_) {}
    renderSavedTvs();
}

function renderSavedTvs() {
    const container = document.getElementById("saved-tvs-list");
    if (!container) return;
    const list = loadSavedTvs();
    container.innerHTML = "";
    if (list.length === 0) {
        container.innerHTML = `<div class="conn-muted-sm">No recent Fire TVs saved yet.</div>`;
        return;
    }
    list.forEach((tv) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "conn-saved-item";
        btn.innerHTML = `
            <div>
                <div class="conn-saved-item-name"></div>
                <div class="conn-saved-item-uid conn-mono"></div>
            </div>
            <span class="conn-muted-sm">Quick Pair</span>
        `;
        btn.querySelector(".conn-saved-item-name").textContent = tv.name || "Fire TV";
        btn.querySelector(".conn-saved-item-uid").textContent = `UID: ${tv.uid}`;
        btn.addEventListener("click", () => {
            const uidInput = document.getElementById("pair-uid-input");
            const codeInput = document.getElementById("pair-code-input");
            if (uidInput) uidInput.value = tv.uid;
            if (codeInput) codeInput.value = tv.code || "";
            submitPairingRequest(tv.code || "", tv.uid);
        });
        container.appendChild(btn);
    });
}

// Tab switching (keeps Desktop and Mobile nav synced)
function switchTab(tabName) {
    document.querySelectorAll(".conn-view").forEach((view) => {
        view.classList.toggle("hidden", view.id !== `tab-${tabName}`);
        view.classList.toggle("active", view.id === `tab-${tabName}`);
    });
    document.querySelectorAll(".conn-nav-tab, .conn-bottom-tab").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.tab === tabName);
    });
}

function updatePairingUI() {
    const statusEl = document.getElementById("conn-pair-state");
    const topUnpair = document.getElementById("top-unpair-btn");
    const pairedPanel = document.getElementById("paired-tv-panel");
    const emptyBox = document.getElementById("unpaired-hint-box");
    const tvNameEl = document.getElementById("paired-tv-name");
    const tvUidEl = document.getElementById("paired-tv-uid");
    const remoteLabel = document.getElementById("remote-target-label");

    if (pairedTvUid) {
        if (statusEl) {
            statusEl.textContent = `Paired · ${pairedTvName || pairedTvUid}`;
            statusEl.classList.add("is-paired");
        }
        topUnpair?.classList.remove("hidden");
        pairedPanel?.classList.remove("hidden");
        emptyBox?.classList.add("hidden");
        if (tvNameEl) tvNameEl.textContent = pairedTvName || "Fire TV";
        if (tvUidEl) tvUidEl.textContent = `UID: ${pairedTvUid}${pairedCode ? ` · Code: ${pairedCode}` : ""}`;
        if (remoteLabel) remoteLabel.textContent = `Linked: ${pairedTvUid}`;
    } else {
        if (statusEl) {
            statusEl.textContent = "Not paired";
            statusEl.classList.remove("is-paired");
        }
        topUnpair?.classList.add("hidden");
        pairedPanel?.classList.add("hidden");
        emptyBox?.classList.remove("hidden");
        if (remoteLabel) remoteLabel.textContent = "No TV paired";
    }
}

function updateStudioControlsUI() {
    const muteBtn = document.getElementById("studio-mute-btn");
    const camBtn = document.getElementById("studio-cam-btn");
    const echoBtn = document.getElementById("studio-echo-btn");
    const callMuteBtn = document.getElementById("call-bar-mute-btn");
    const callCamBtn = document.getElementById("call-bar-cam-btn");

    if (muteBtn) {
        muteBtn.textContent = isMicMuted ? "Muted" : "Active";
        muteBtn.setAttribute("aria-pressed", String(isMicMuted));
        muteBtn.classList.toggle("is-off", isMicMuted);
        muteBtn.classList.toggle("active", !isMicMuted);
    }
    if (camBtn) {
        camBtn.textContent = isVideoOff ? "Off" : "On";
        camBtn.setAttribute("aria-pressed", String(!isVideoOff));
        camBtn.classList.toggle("is-off", isVideoOff);
        camBtn.classList.toggle("active", !isVideoOff);
    }
    if (echoBtn) {
        echoBtn.textContent = echoGuardEnabled ? "Enabled" : "Standard";
        echoBtn.setAttribute("aria-pressed", String(echoGuardEnabled));
        echoBtn.classList.toggle("active", echoGuardEnabled);
    }
    if (callMuteBtn) {
        callMuteBtn.textContent = isMicMuted ? "Unmute" : "Mute";
        callMuteBtn.classList.toggle("is-muted", isMicMuted);
    }
    if (callCamBtn) {
        callCamBtn.textContent = isVideoOff ? "Cam On" : "Cam Off";
        callCamBtn.classList.toggle("is-muted", isVideoOff);
    }

    const resLabel = document.getElementById("preview-res-readout");
    const camLabel = document.getElementById("preview-cam-readout");
    const previewVideo = document.getElementById("connector-preview-video");
    if (resLabel) resLabel.textContent = `${currentResolution} HD`;
    if (camLabel) camLabel.textContent = currentFacingMode === "environment" ? "Rear Camera" : "Front Camera";
    if (previewVideo) {
        previewVideo.classList.toggle("is-mirrored", currentFacingMode !== "environment");
    }
}

function syncMediaStateToTv() {
    if (!socket || !socket.connected || !pairedTvUid) return;
    socket.emit("connector_media_state", {
        tvUid: pairedTvUid,
        micMuted: isMicMuted,
        videoOff: isVideoOff,
        facingMode: currentFacingMode,
        resolution: currentResolution,
        noiseGateEnabled: echoGuardEnabled
    });
}

// Echo Guard & 90Hz High-Pass Audio Pipeline
function cleanupAudioPipeline() {
    if (audioMeterRaf) {
        cancelAnimationFrame(audioMeterRaf);
        audioMeterRaf = null;
    }
    if (audioProcessedTrack) {
        try { audioProcessedTrack.stop(); } catch (_) {}
        audioProcessedTrack = null;
    }
    if (audioContext && audioContext.state !== "closed") {
        audioContext.close().catch(() => {});
    }
    audioContext = null;

    const fill = document.getElementById("mic-meter-fill");
    const status = document.getElementById("mic-meter-status");
    if (fill) fill.style.width = "0%";
    if (status) status.textContent = "Idle";
}

function buildEchoGuardedStream(rawStream) {
    cleanupAudioPipeline();
    const rawAudioTrack = rawStream.getAudioTracks()[0];
    const videoTracks = rawStream.getVideoTracks();
    const outStream = new MediaStream(videoTracks);

    if (!rawAudioTrack) return outStream;

    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) {
            outStream.addTrack(rawAudioTrack);
            return outStream;
        }
        audioContext = new AudioCtx();
        if (audioContext.state === "suspended") {
            audioContext.resume().catch(() => {});
        }
        const source = audioContext.createMediaStreamSource(new MediaStream([rawAudioTrack]));
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;

        let lastNode = source;
        if (echoGuardEnabled) {
            const highPass = audioContext.createBiquadFilter();
            highPass.type = "highpass";
            highPass.frequency.setValueAtTime(95, audioContext.currentTime);

            const compressor = audioContext.createDynamicsCompressor();
            compressor.threshold.setValueAtTime(-28, audioContext.currentTime);
            compressor.knee.setValueAtTime(18, audioContext.currentTime);
            compressor.ratio.setValueAtTime(4, audioContext.currentTime);
            compressor.attack.setValueAtTime(0.005, audioContext.currentTime);
            compressor.release.setValueAtTime(0.18, audioContext.currentTime);

            source.connect(highPass);
            highPass.connect(compressor);
            lastNode = compressor;
        }

        lastNode.connect(analyser);

        const dest = audioContext.createMediaStreamDestination();
        lastNode.connect(dest);
        audioProcessedTrack = dest.stream.getAudioTracks()[0];
        if (audioProcessedTrack) {
            audioProcessedTrack.enabled = !isMicMuted;
            outStream.addTrack(audioProcessedTrack);
        } else {
            outStream.addTrack(rawAudioTrack);
        }

        const samples = new Uint8Array(analyser.frequencyBinCount);
        const fill = document.getElementById("mic-meter-fill");
        const meterStatus = document.getElementById("mic-meter-status");
        const updateMeter = () => {
            if (!audioContext || audioContext.state === "closed") return;
            analyser.getByteTimeDomainData(samples);
            let peak = 0;
            for (let i = 0; i < samples.length; i++) {
                const v = Math.abs(samples[i] - 128) / 128;
                if (v > peak) peak = v;
            }
            const pct = isMicMuted ? 0 : Math.min(100, Math.round(peak * 240));
            if (fill) fill.style.width = `${pct}%`;
            if (meterStatus) {
                meterStatus.textContent = isMicMuted ? "Muted" : `${pct}%`;
            }
            audioMeterRaf = requestAnimationFrame(updateMeter);
        };
        audioMeterRaf = requestAnimationFrame(updateMeter);
        return outStream;
    } catch (_) {
        outStream.addTrack(rawAudioTrack);
        return outStream;
    }
}

function delayMs(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function stopStreamVideoTracks(stream) {
    if (!stream) return;
    stream.getVideoTracks().forEach((t) => {
        try { t.stop(); } catch (_) {}
        try { stream.removeTrack(t); } catch (_) {}
    });
    if (stream._rawStream) {
        stream._rawStream.getVideoTracks().forEach((t) => {
            try { t.stop(); } catch (_) {}
            try { stream._rawStream.removeTrack(t); } catch (_) {}
        });
    }
}

function attachPreviewVideoTrack(videoTrack) {
    const previewVideo = document.getElementById("connector-preview-video");
    const fallback = document.getElementById("preview-fallback");
    if (!previewVideo) return;
    if (videoTrack) {
        previewVideo.srcObject = new MediaStream([videoTrack]);
        previewVideo.play().catch(() => {});
        fallback?.classList.add("hidden");
    } else {
        previewVideo.srcObject = null;
        fallback?.classList.remove("hidden");
    }
}

async function pickCameraDeviceId(targetFacing, excludeDeviceId = null) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return null;
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cams = devices.filter((d) => d.kind === "videoinput" && d.deviceId);
        if (cams.length === 0) return null;

        const wantBack = targetFacing === "environment";
        const backRe = /back|rear|environment|facing back|wide|ultra|macro/i;
        const frontRe = /front|user|selfie|facing front/i;

        const labelMatch = cams.find((c) => (
            c.deviceId !== excludeDeviceId &&
            (wantBack ? backRe.test(c.label || "") : frontRe.test(c.label || ""))
        ));
        if (labelMatch) return labelMatch.deviceId;

        if (cams.length > 1) {
            if (excludeDeviceId) {
                const other = cams.find((c) => c.deviceId !== excludeDeviceId);
                if (other) return other.deviceId;
            }
            return wantBack ? cams[cams.length - 1].deviceId : cams[0].deviceId;
        }
        return cams[0].deviceId;
    } catch (_) {
        return null;
    }
}

async function acquireVideoOnlyStream(targetFacing, resSpec, excludeDeviceId = null, allowGenericFallback = false) {
    const targetDeviceId = await pickCameraDeviceId(targetFacing, excludeDeviceId);
    const attempts = [];
    if (targetDeviceId) {
        attempts.push({ deviceId: { exact: targetDeviceId }, ...resSpec });
    }
    attempts.push({ facingMode: { exact: targetFacing }, ...resSpec });
    attempts.push({ facingMode: { exact: targetFacing } });
    if (targetDeviceId) {
        attempts.push({ deviceId: { exact: targetDeviceId } });
    }
    if (allowGenericFallback) {
        attempts.push({ facingMode: targetFacing, ...resSpec });
        attempts.push({ facingMode: targetFacing });
        attempts.push(true);
    }

    let lastErr = null;
    for (const vConstraint of attempts) {
        try {
            const s = await navigator.mediaDevices.getUserMedia({ video: vConstraint, audio: false });
            const track = s.getVideoTracks()[0];
            if (track) return { stream: s, track };
            s.getTracks().forEach((t) => { try { t.stop(); } catch (_) {} });
        } catch (err) {
            lastErr = err;
        }
    }
    throw lastErr || new Error("Target camera unavailable");
}

function inferFacingFromTrack(track, fallbackFacing) {
    if (!track) return fallbackFacing;
    try {
        const settings = typeof track.getSettings === "function" ? track.getSettings() : {};
        if (settings.facingMode === "environment" || settings.facingMode === "user") {
            return settings.facingMode;
        }
    } catch (_) {}
    const lbl = String(track.label || "");
    if (/back|rear|environment/i.test(lbl)) return "environment";
    if (/front|user|selfie/i.test(lbl)) return "user";
    return fallbackFacing;
}

async function acquireConnectorMedia(needVideo = true) {
    const audioConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
        sampleRate: { ideal: 48000 }
    };
    const resSpec = RESOLUTION_MAP[currentResolution] || RESOLUTION_MAP["720p"];
    const targetDeviceId = needVideo ? await pickCameraDeviceId(currentFacingMode, null) : null;
    const videoConstraints = needVideo
        ? (targetDeviceId ? { deviceId: { exact: targetDeviceId }, ...resSpec } : { facingMode: currentFacingMode, ...resSpec })
        : false;

    let rawStream = null;
    try {
        rawStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: videoConstraints });
    } catch (_) {
        if (needVideo) {
            try {
                rawStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: { facingMode: currentFacingMode } });
            } catch (_) {
                try {
                    rawStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: true });
                } catch (err) {
                    rawStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false });
                    showToast("Camera unavailable on this device — continuing with Phone Mic.");
                }
            }
        } else {
            rawStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false });
        }
    }

    const vTrack = rawStream?.getVideoTracks?.()[0];
    if (vTrack) {
        currentVideoDeviceId = vTrack.getSettings?.().deviceId || currentVideoDeviceId;
        currentFacingMode = inferFacingFromTrack(vTrack, currentFacingMode);
    }
    return rawStream;
}

async function togglePreview() {
    const btn = document.getElementById("toggle-preview-btn");

    if (previewStream) {
        previewStream.getTracks().forEach((t) => {
            try { t.stop(); } catch (_) {}
        });
        if (previewStream._rawStream) {
            previewStream._rawStream.getTracks().forEach((t) => {
                try { t.stop(); } catch (_) {}
            });
        }
        previewStream = null;
        if (!connectorPeerConnection) {
            cleanupAudioPipeline();
        }
        attachPreviewVideoTrack(null);
        if (btn) btn.textContent = "Start Preview";
        return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        showToast("Camera & microphone API unavailable in this browser.");
        return;
    }

    try {
        if (qrScanStream) {
            stopQrScanner();
            await delayMs(140);
        }
        await ensureAndroidMediaPermissions(true);
        const raw = await acquireConnectorMedia(true);
        previewStream = buildEchoGuardedStream(raw);
        previewStream._rawStream = raw;
        attachPreviewVideoTrack(raw.getVideoTracks()[0] || null);
        if (btn) btn.textContent = "Stop Preview";
        applyMediaToggleTracks();
        await refreshPermissionsUI();
    } catch (err) {
        await refreshPermissionsUI();
        showToast("Allow camera & microphone permissions: " + (err.message || "Permission denied"));
    }
}

function applyMediaToggleTracks() {
    [uplinkStream, previewStream].forEach((stream) => {
        if (!stream) return;
        stream.getAudioTracks().forEach((t) => { t.enabled = !isMicMuted; });
        stream.getVideoTracks().forEach((t) => { t.enabled = !isVideoOff; });
        if (stream._rawStream) {
            stream._rawStream.getAudioTracks().forEach((t) => { t.enabled = !isMicMuted; });
            stream._rawStream.getVideoTracks().forEach((t) => { t.enabled = !isVideoOff; });
        }
    });
    updateStudioControlsUI();
    syncMediaStateToTv();
}

async function switchConnectorCamera() {
    if (isSwitchingCamera) return;
    const prevFacing = currentFacingMode;
    const prevDeviceId = currentVideoDeviceId;
    const nextFacing = prevFacing === "user" ? "environment" : "user";

    const targetStreams = [previewStream, uplinkStream].filter(Boolean);
    if (targetStreams.length === 0) {
        currentFacingMode = nextFacing;
        updateStudioControlsUI();
        syncMediaStateToTv();
        showToast(`Camera preference set to ${currentFacingMode === "environment" ? "Rear" : "Front"} Camera`);
        return;
    }

    isSwitchingCamera = true;
    const flipBtn = document.getElementById("flip-cam-btn");
    if (flipBtn) flipBtn.disabled = true;

    try {
        const resSpec = RESOLUTION_MAP[currentResolution] || RESOLUTION_MAP["720p"];

        // Android Camera2 HAL requires releasing the active camera sensor BEFORE opening the other sensor
        attachPreviewVideoTrack(null);
        stopStreamVideoTracks(previewStream);
        stopStreamVideoTracks(uplinkStream);
        await delayMs(150);

        let acquired = null;
        try {
            acquired = await acquireVideoOnlyStream(nextFacing, resSpec, prevDeviceId, false);
            currentFacingMode = inferFacingFromTrack(acquired.track, nextFacing);
        } catch (_) {
            // Single-camera device or rear/front hardware unavailable: restore previous camera gracefully
            acquired = await acquireVideoOnlyStream(prevFacing, resSpec, null, true);
            currentFacingMode = inferFacingFromTrack(acquired.track, prevFacing);
            showToast("Second camera unavailable on this device — kept active camera.");
        }

        const newVideoTrack = acquired.track;
        currentVideoDeviceId = newVideoTrack.getSettings?.().deviceId || currentVideoDeviceId;
        newVideoTrack.enabled = !isVideoOff;

        if (connectorPeerConnection) {
            const sender = connectorPeerConnection.getSenders().find((s) => !s.track || s.track.kind === "video");
            if (sender) {
                await sender.replaceTrack(newVideoTrack);
            } else if (uplinkStream) {
                connectorPeerConnection.addTrack(newVideoTrack, uplinkStream);
            }
        }

        if (previewStream) {
            previewStream.addTrack(newVideoTrack);
        }
        if (uplinkStream && uplinkStream !== previewStream) {
            uplinkStream.addTrack(newVideoTrack);
        }

        attachPreviewVideoTrack(newVideoTrack);
        updateStudioControlsUI();
        syncMediaStateToTv();
        if (currentFacingMode !== prevFacing) {
            showToast(`Switched to ${currentFacingMode === "environment" ? "Rear" : "Front"} Camera`);
        }
    } catch (err) {
        currentFacingMode = prevFacing;
        updateStudioControlsUI();
        showToast("Could not switch camera: " + (err?.message || "Camera busy"));
    } finally {
        isSwitchingCamera = false;
        if (flipBtn) flipBtn.disabled = false;
    }
}

// ----------------- Option 2 Split-Mesh Direct Phone -> Friend Uplink -----------------
async function startSplitMeshUplink(session) {
    if (!session || !session.friendUid) return;
    stopSplitMeshUplink();

    activeSplitSession = session;
    isMicMuted = false;
    isVideoOff = session.callType === "audio";

    const banner = document.getElementById("split-call-banner");
    const peerEl = document.getElementById("split-call-peer");
    const modeEl = document.getElementById("split-call-mode");
    if (peerEl) peerEl.textContent = session.friendName || `UID ${session.friendUid}`;
    if (modeEl) modeEl.textContent = `Direct ${session.callType === "audio" ? "HD Audio" : "HD Video"} Uplink · ${currentResolution}`;
    banner?.classList.remove("hidden");
    updateStudioControlsUI();

    try {
        const wantVideo = session.callType !== "audio";
        await ensureAndroidMediaPermissions(wantVideo);
        const raw = await acquireConnectorMedia(wantVideo);
        uplinkStream = buildEchoGuardedStream(raw);
        uplinkStream._rawStream = raw;

        const previewVideo = document.getElementById("connector-preview-video");
        const fallback = document.getElementById("preview-fallback");
        if (previewVideo && wantVideo && raw.getVideoTracks().length > 0) {
            previewVideo.srcObject = raw;
            previewVideo.play().catch(() => {});
            fallback?.classList.add("hidden");
        }

        await refreshIceServers();
        connectorPeerConnection = new RTCPeerConnection(RTC_CONFIG);
        connectorIceQueue = [];

        uplinkStream.getTracks().forEach((track) => {
            try {
                connectorPeerConnection.addTransceiver(track, {
                    direction: "sendonly",
                    streams: [uplinkStream]
                });
            } catch (_) {
                connectorPeerConnection.addTrack(track, uplinkStream);
            }
        });

        connectorPeerConnection.onicecandidate = (event) => {
            if (event.candidate && socket && activeSplitSession) {
                socket.emit("split_webrtc_ice_candidate", {
                    targetUid: activeSplitSession.friendUid,
                    friendUid: activeSplitSession.friendUid,
                    tvUid: pairedTvUid,
                    candidate: event.candidate
                });
            }
        };

        connectorPeerConnection.oniceconnectionstatechange = () => {
            const st = connectorPeerConnection?.iceConnectionState;
            if (st === "connected" || st === "completed") {
                if (modeEl) modeEl.textContent = `Live Direct Uplink Connected (${currentResolution})`;
            }
        };

        const offer = await connectorPeerConnection.createOffer();
        await connectorPeerConnection.setLocalDescription(offer);

        if (socket && activeSplitSession) {
            socket.emit("split_webrtc_offer", {
                targetUid: activeSplitSession.friendUid,
                friendUid: activeSplitSession.friendUid,
                tvUid: pairedTvUid,
                callType: activeSplitSession.callType,
                offer
            });
        }
        applyMediaToggleTracks();
        switchTab("studio");
        showToast("Live camera/mic uplink started to Friend!");
    } catch (err) {
        showToast("Uplink media error: " + (err.message || "Permission required"));
    }
}

function stopSplitMeshUplink() {
    activeSplitSession = null;
    connectorIceQueue = [];
    if (connectorPeerConnection) {
        try {
            connectorPeerConnection.onicecandidate = null;
            connectorPeerConnection.oniceconnectionstatechange = null;
            connectorPeerConnection.close();
        } catch (_) {}
        connectorPeerConnection = null;
    }
    if (uplinkStream) {
        uplinkStream.getTracks().forEach((t) => {
            try { t.stop(); } catch (_) {}
        });
        if (uplinkStream._rawStream) {
            uplinkStream._rawStream.getTracks().forEach((t) => {
                try { t.stop(); } catch (_) {}
            });
        }
        uplinkStream = null;
    }
    if (!previewStream) {
        cleanupAudioPipeline();
        const previewVideo = document.getElementById("connector-preview-video");
        const fallback = document.getElementById("preview-fallback");
        if (previewVideo) previewVideo.srcObject = null;
        fallback?.classList.remove("hidden");
    }
    document.getElementById("split-call-banner")?.classList.add("hidden");
    updateStudioControlsUI();
}

// ----------------- QR Scanner Modal (Offline jsQR + Native BarcodeDetector) -----------------
function stopQrScanner() {
    if (qrScanTimer) {
        clearInterval(qrScanTimer);
        qrScanTimer = null;
    }
    qrScanBusy = false;
    if (qrScanStream) {
        qrScanStream.getTracks().forEach((t) => {
            try { t.stop(); } catch (_) {}
        });
        qrScanStream = null;
    }
    const vid = document.getElementById("qr-scan-video");
    if (vid) vid.srcObject = null;
    document.getElementById("qr-modal")?.classList.add("hidden");
}

function handleDecodedQrValue(rawValue, msgEl) {
    const parsed = parsePairingInput(rawValue);
    if (!parsed || !parsed.code) {
        if (msgEl) msgEl.textContent = "QR detected, but not a ZingTalk TV code. Aim at the Fire TV QR screen.";
        return false;
    }
    stopQrScanner();
    const codeInp = document.getElementById("pair-code-input");
    const uidInp = document.getElementById("pair-uid-input");
    if (codeInp && parsed.code) codeInp.value = parsed.code;
    if (uidInp && parsed.uid) uidInp.value = parsed.uid;
    showToast(`QR scanned (${parsed.code})! Connecting to Fire TV...`);
    submitPairingRequest(parsed.code, parsed.uid);
    return true;
}

function decodeQrFrameWithJsQr(vid) {
    if (typeof window.jsQR !== "function") return null;
    const vw = vid?.videoWidth || 0;
    const vh = vid?.videoHeight || 0;
    if (!vw || !vh) return null;

    const maxSide = 640;
    const scale = Math.min(1, maxSide / Math.max(vw, vh));
    const w = Math.max(120, Math.round(vw * scale));
    const h = Math.max(120, Math.round(vh * scale));

    if (!qrScanCanvas) {
        qrScanCanvas = document.createElement("canvas");
        qrScanCtx = qrScanCanvas.getContext("2d", { willReadFrequently: true });
    }
    if (!qrScanCtx) return null;
    if (qrScanCanvas.width !== w || qrScanCanvas.height !== h) {
        qrScanCanvas.width = w;
        qrScanCanvas.height = h;
    }
    qrScanCtx.drawImage(vid, 0, 0, w, h);
    const imgData = qrScanCtx.getImageData(0, 0, w, h);
    const decoded = window.jsQR(imgData.data, w, h, { inversionAttempts: "attemptBoth" });
    return decoded && decoded.data ? decoded.data : null;
}

async function openQrScanner(targetFacing = qrScanFacingMode) {
    const modal = document.getElementById("qr-modal");
    const vid = document.getElementById("qr-scan-video");
    const msgEl = document.getElementById("qr-scan-msg");

    if (uplinkStream && connectorPeerConnection) {
        showToast("Live call active — enter the 6-digit TV code manually or end call first.");
        return;
    }

    // Release active preview stream before opening QR camera so Android HAL doesn't throw NotReadableError
    if (previewStream) {
        previewStream.getTracks().forEach((t) => { try { t.stop(); } catch (_) {} });
        if (previewStream._rawStream) {
            previewStream._rawStream.getTracks().forEach((t) => { try { t.stop(); } catch (_) {} });
        }
        previewStream = null;
        attachPreviewVideoTrack(null);
        const pBtn = document.getElementById("toggle-preview-btn");
        if (pBtn) pBtn.textContent = "Start Preview";
        await delayMs(140);
    }

    if (qrScanTimer) {
        clearInterval(qrScanTimer);
        qrScanTimer = null;
    }
    if (qrScanStream) {
        qrScanStream.getTracks().forEach((t) => { try { t.stop(); } catch (_) {} });
        qrScanStream = null;
        await delayMs(140);
    }

    qrScanFacingMode = targetFacing === "user" ? "user" : "environment";
    modal?.classList.remove("hidden");

    if (msgEl) msgEl.textContent = "Opening camera for QR scanner...";
    await ensureAndroidMediaPermissions(true);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        if (msgEl) msgEl.textContent = "Camera unavailable — paste the pairing link or enter the 6-digit code.";
        return;
    }

    try {
        const resSpec = { width: { ideal: 1280 }, height: { ideal: 720 } };
        const acquired = await acquireVideoOnlyStream(qrScanFacingMode, resSpec, null, true);
        qrScanStream = acquired.stream;
        qrScanFacingMode = inferFacingFromTrack(acquired.track, qrScanFacingMode);
        setBadgeStatus("perm-cam-status", "Granted", "is-ok");

        if (vid) {
            vid.srcObject = qrScanStream;
            await vid.play().catch(() => {});
        }

        const hasJsQr = typeof window.jsQR === "function";
        const nativeDetector = ("BarcodeDetector" in window)
            ? (() => { try { return new window.BarcodeDetector({ formats: ["qr_code"] }); } catch (_) { return null; } })()
            : null;

        if (!hasJsQr && !nativeDetector) {
            if (msgEl) msgEl.textContent = "QR decoder unavailable here — enter the 6-digit TV code manually.";
            return;
        }

        if (msgEl) {
            msgEl.textContent = `Align Fire TV QR code inside box (${qrScanFacingMode === "environment" ? "Rear" : "Front"} Cam)...`;
        }

        qrScanTimer = setInterval(async () => {
            if (qrScanBusy || !vid || vid.readyState < 2 || !qrScanStream) return;
            qrScanBusy = true;
            try {
                if (hasJsQr) {
                    const jsQrVal = decodeQrFrameWithJsQr(vid);
                    if (jsQrVal && handleDecodedQrValue(jsQrVal, msgEl)) {
                        return;
                    }
                }
                if (nativeDetector) {
                    const codes = await nativeDetector.detect(vid);
                    if (codes && codes.length > 0 && codes[0].rawValue) {
                        handleDecodedQrValue(codes[0].rawValue, msgEl);
                    }
                }
            } catch (_) {
            } finally {
                qrScanBusy = false;
            }
        }, 180);
    } catch (_) {
        await refreshPermissionsUI();
        if (msgEl) msgEl.textContent = "Camera permission needed for QR scan. Tap 'Allow Cam & Mic' or enter the 6-digit TV code manually.";
    }
}

// ----------------- Socket.IO Signaling -----------------
function submitPairingRequest(code, tvUid) {
    const cleanCode = sanitizeCode(code);
    const cleanUid = sanitizeUid(tvUid);
    if (cleanCode.length !== 6) {
        setPairFeedback("Enter the 6-digit Pairing Code shown on your Fire TV screen.", false);
        return;
    }
    if (!socket || !socket.connected) {
        pendingPairRequest = { code: cleanCode, tvUid: cleanUid };
        setPairFeedback("Connecting to ZingTalk server... pairing automatically as soon as online.", true);
        connectSocket();
        return;
    }

    pendingPairRequest = null;
    const deviceName = document.getElementById("connector-device-name")?.value.trim() || "Phone Camera";
    try {
        localStorage.setItem(LAST_DEVICE_NAME_KEY, deviceName);
    } catch (_) {}

    setPairFeedback("Pairing with Fire TV...", true);
    socket.emit("connector_pair", {
        code: cleanCode,
        tvUid: cleanUid,
        deviceName,
        resolution: currentResolution,
        facingMode: currentFacingMode
    });
}

function connectSocket() {
    if (typeof io === "undefined") return;
    if (socket && socket.connected) return;
    if (socket) {
        try {
            socket.removeAllListeners();
            socket.disconnect();
        } catch (_) {}
    }

    socket = io(getServerUrl(), {
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1200
    });

    socket.on("connect", () => {
        const label = document.getElementById("server-conn-label");
        if (label) label.textContent = "Server online";
        setBadgeStatus("perm-srv-status", "Online", "is-ok");
        if (pendingPairRequest) {
            const req = pendingPairRequest;
            pendingPairRequest = null;
            submitPairingRequest(req.code, req.tvUid);
        } else if (pairedCode || pairedTvUid) {
            submitPairingRequest(pairedCode, pairedTvUid);
        }
    });

    socket.on("disconnect", () => {
        const label = document.getElementById("server-conn-label");
        if (label) label.textContent = "Reconnecting...";
        setBadgeStatus("perm-srv-status", "Reconnecting", "is-warn");
    });

    socket.on("connect_error", () => {
        const label = document.getElementById("server-conn-label");
        if (label) label.textContent = "Server offline — retrying...";
        setBadgeStatus("perm-srv-status", "Unreachable", "is-err");
    });

    socket.on("turn_credentials", (payload) => {
        if (payload && Array.isArray(payload.iceServers)) {
            RTC_CONFIG.iceServers = payload.iceServers;
            lastIceFetchAt = Date.now();
        }
    });

    socket.on("connector_paired", (data) => {
        if (!data || !data.tvUid) return;
        pairedTvUid = data.tvUid;
        pairedTvName = data.tvName || "Fire TV";
        pairedCode = data.code || pairedCode;
        setPairFeedback(`Paired with ${pairedTvName} (${pairedTvUid})`, true);
        saveTvEntry(pairedTvUid, pairedTvName, pairedCode);
        updatePairingUI();
        syncMediaStateToTv();
        refreshIceServers(true);
        showToast(`Connected to ${pairedTvName}`);
    });

    socket.on("connector_pair_error", (data) => {
        setPairFeedback(data?.message || "Invalid pairing code or TV offline.", false);
    });

    socket.on("connector_unpaired", (data) => {
        stopSplitMeshUplink();
        pairedTvUid = null;
        pairedTvName = "";
        pairedCode = "";
        updatePairingUI();
        setPairFeedback(data?.reason || "Disconnected from Fire TV.", false);
        showToast(data?.reason || "Disconnected from Fire TV");
    });

    socket.on("connector_start_uplink", (session) => {
        startSplitMeshUplink(session);
    });

    socket.on("connector_stop_uplink", () => {
        stopSplitMeshUplink();
        showToast("Call ended");
    });

    socket.on("split_webrtc_answer_received", async (data) => {
        if (!connectorPeerConnection || !data?.answer) return;
        if (connectorPeerConnection.signalingState !== "have-local-offer") return;
        try {
            await connectorPeerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
            while (connectorIceQueue.length > 0) {
                const cand = connectorIceQueue.shift();
                if (cand) {
                    try { await connectorPeerConnection.addIceCandidate(new RTCIceCandidate(cand)); } catch (_) {}
                }
            }
        } catch (err) {
            console.warn("[Connector Split-Mesh] Answer error:", err);
        }
    });

    socket.on("split_webrtc_ice_candidate_received", async (data) => {
        if (!data?.candidate) return;
        if (connectorPeerConnection && connectorPeerConnection.remoteDescription) {
            try {
                await connectorPeerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
            } catch (_) {}
        } else {
            connectorIceQueue.push(data.candidate);
        }
    });

    socket.on("connector_remote_control", (data) => {
        if (!data || !data.action) return;
        if (data.action === "mute_mic") {
            isMicMuted = true;
            applyMediaToggleTracks();
        } else if (data.action === "unmute_mic") {
            isMicMuted = false;
            applyMediaToggleTracks();
        } else if (data.action === "toggle_mic") {
            isMicMuted = !isMicMuted;
            applyMediaToggleTracks();
        } else if (data.action === "camera_off") {
            isVideoOff = true;
            applyMediaToggleTracks();
        } else if (data.action === "camera_on") {
            isVideoOff = false;
            applyMediaToggleTracks();
        } else if (data.action === "toggle_camera") {
            isVideoOff = !isVideoOff;
            applyMediaToggleTracks();
        } else if (data.action === "flip_camera") {
            switchConnectorCamera();
        }
    });
}

// ----------------- DOM Event Wiring -----------------
function initConnector() {
    try {
        const savedName = localStorage.getItem(LAST_DEVICE_NAME_KEY);
        const nameInput = document.getElementById("connector-device-name");
        if (savedName && nameInput) nameInput.value = savedName;
    } catch (_) {}

    // Support URL query params (e.g. ?code=123456&uid=1000000001)
    try {
        const params = new URLSearchParams(window.location.search);
        const codeParam = sanitizeCode(params.get("code") || "");
        const uidParam = sanitizeUid(params.get("uid") || "");
        if (codeParam) document.getElementById("pair-code-input").value = codeParam;
        if (uidParam) document.getElementById("pair-uid-input").value = uidParam;
    } catch (_) {}

    renderSavedTvs();
    updatePairingUI();
    updateStudioControlsUI();
    connectSocket();
    refreshPermissionsUI();
    window.addEventListener("zing-permissions-result", () => { refreshPermissionsUI(); });

    // Prompt Android OS Camera/Mic runtime permissions cleanly on initial APK launch
    if (window.ZingNativeBridge && typeof window.ZingNativeBridge.requestAllPermissions === "function") {
        setTimeout(() => {
            try {
                if (!window.ZingNativeBridge.hasAllPermissions || !window.ZingNativeBridge.hasAllPermissions()) {
                    window.ZingNativeBridge.requestAllPermissions();
                }
            } catch (_) {}
        }, 450);
    }

    document.getElementById("grant-perms-btn")?.addEventListener("click", requestBrowserAndNativePermissions);
    document.getElementById("check-server-btn")?.addEventListener("click", checkServerConnectivity);

    document.querySelectorAll("[data-tab]").forEach((btn) => {
        btn.addEventListener("click", () => switchTab(btn.dataset.tab));
    });

    document.getElementById("goto-studio-btn")?.addEventListener("click", () => switchTab("studio"));
    document.getElementById("goto-remote-btn")?.addEventListener("click", () => switchTab("remote"));

    const codeInp = document.getElementById("pair-code-input");
    const uidInp = document.getElementById("pair-uid-input");
    codeInp?.addEventListener("input", (e) => { e.target.value = sanitizeCode(e.target.value); });
    uidInp?.addEventListener("input", (e) => { e.target.value = sanitizeUid(e.target.value); });

    document.getElementById("pair-form")?.addEventListener("submit", (e) => {
        e.preventDefault();
        submitPairingRequest(codeInp?.value || "", uidInp?.value || "");
    });

    const handleUnpair = () => {
        stopSplitMeshUplink();
        if (socket && socket.connected) socket.emit("connector_unpair");
        pairedTvUid = null;
        pairedTvName = "";
        pairedCode = "";
        updatePairingUI();
        setPairFeedback("");
        showToast("Disconnected from Fire TV");
    };
    document.getElementById("top-unpair-btn")?.addEventListener("click", handleUnpair);
    document.getElementById("unpair-card-btn")?.addEventListener("click", handleUnpair);

    document.getElementById("clear-saved-tvs-btn")?.addEventListener("click", () => {
        try { localStorage.removeItem(SAVED_TVS_KEY); } catch (_) {}
        renderSavedTvs();
    });

    // QR Modal
    document.getElementById("open-qr-scan-btn")?.addEventListener("click", () => openQrScanner(qrScanFacingMode));
    document.getElementById("qr-switch-cam-btn")?.addEventListener("click", () => {
        const nextScanFacing = qrScanFacingMode === "environment" ? "user" : "environment";
        openQrScanner(nextScanFacing);
    });
    document.getElementById("close-qr-modal-btn")?.addEventListener("click", stopQrScanner);
    document.getElementById("qr-apply-manual-btn")?.addEventListener("click", () => {
        const raw = document.getElementById("qr-manual-input")?.value || "";
        const parsed = parsePairingInput(raw);
        if (!parsed) {
            showToast("Invalid QR payload. Expected 6-digit code or zingtalk://pair link.");
            return;
        }
        stopQrScanner();
        if (codeInp && parsed.code) codeInp.value = parsed.code;
        if (uidInp && parsed.uid) uidInp.value = parsed.uid;
        submitPairingRequest(parsed.code, parsed.uid);
    });

    // Cam & Mic Studio controls
    document.getElementById("toggle-preview-btn")?.addEventListener("click", togglePreview);
    document.getElementById("flip-cam-btn")?.addEventListener("click", switchConnectorCamera);

    document.querySelectorAll("[data-res]").forEach((btn) => {
        btn.addEventListener("click", () => {
            currentResolution = btn.dataset.res || "720p";
            document.querySelectorAll("[data-res]").forEach((b) => b.classList.toggle("active", b === btn));
            updateStudioControlsUI();
            syncMediaStateToTv();
            showToast(`Upload resolution set to ${currentResolution}`);
        });
    });

    const toggleMute = () => {
        isMicMuted = !isMicMuted;
        applyMediaToggleTracks();
        showToast(isMicMuted ? "Phone mic muted" : "Phone mic active");
    };
    const toggleCam = () => {
        isVideoOff = !isVideoOff;
        applyMediaToggleTracks();
        showToast(isVideoOff ? "Phone camera off" : "Phone camera on");
    };

    document.getElementById("studio-mute-btn")?.addEventListener("click", toggleMute);
    document.getElementById("call-bar-mute-btn")?.addEventListener("click", toggleMute);
    document.getElementById("studio-cam-btn")?.addEventListener("click", toggleCam);
    document.getElementById("call-bar-cam-btn")?.addEventListener("click", toggleCam);

    document.getElementById("studio-echo-btn")?.addEventListener("click", () => {
        echoGuardEnabled = !echoGuardEnabled;
        updateStudioControlsUI();
        syncMediaStateToTv();
        if (previewStream?._rawStream) {
            previewStream = buildEchoGuardedStream(previewStream._rawStream);
        }
        showToast(echoGuardEnabled ? "Echo Guard 90Hz filter enabled" : "Standard audio mode");
    });

    document.getElementById("call-bar-end-btn")?.addEventListener("click", () => {
        if (socket && socket.connected && pairedTvUid) {
            socket.emit("connector_end_split_call", { tvUid: pairedTvUid });
        }
        stopSplitMeshUplink();
    });

    // TV Remote Controls
    document.querySelectorAll("[data-remote-key]").forEach((btn) => {
        btn.addEventListener("click", () => {
            if (!pairedTvUid || !socket || !socket.connected) {
                showToast("Pair a Fire TV first in the Pair TV tab.");
                return;
            }
            socket.emit("tv_remote_key", { tvUid: pairedTvUid, key: btn.dataset.remoteKey });
        });
    });

    const remoteTextInput = document.getElementById("remote-text-input");
    const sendRemoteText = (submit = false) => {
        if (!pairedTvUid || !socket || !socket.connected) {
            showToast("Pair a Fire TV first in the Pair TV tab.");
            return;
        }
        const text = remoteTextInput?.value || "";
        if (!text.trim() && !submit) return;
        socket.emit("tv_remote_text", { tvUid: pairedTvUid, text, submit });
        if (remoteTextInput) remoteTextInput.value = "";
        showToast("Sent text to Fire TV");
    };

    document.getElementById("remote-text-form")?.addEventListener("submit", (e) => {
        e.preventDefault();
        sendRemoteText(false);
    });
    document.getElementById("remote-send-enter-btn")?.addEventListener("click", () => sendRemoteText(true));

    document.querySelectorAll("[data-tv-ctrl]").forEach((btn) => {
        btn.addEventListener("click", () => {
            if (!pairedTvUid || !socket || !socket.connected) {
                showToast("Pair a Fire TV first in the Pair TV tab.");
                return;
            }
            socket.emit("tv_remote_key", { tvUid: pairedTvUid, key: `ctrl:${btn.dataset.tvCtrl}` });
        });
    });
}

initConnector();
