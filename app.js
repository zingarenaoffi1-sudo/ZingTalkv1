import { initializeApp } from "https://www.gstatic.com/firebasejs/10.4.0/firebase-app.js";
import { 
    getAuth, 
    signInWithPopup, 
    GoogleAuthProvider, 
    onAuthStateChanged,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    updateProfile,
    signOut
} from "https://www.gstatic.com/firebasejs/10.4.0/firebase-auth.js";

// Client Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyAjvRGXKy9tHTMcyOFJXmrbYmMeVdczDjk",
    authDomain: "zing-talk-c6496.firebaseapp.com",
    projectId: "zing-talk-c6496",
    storageBucket: "zing-talk-c6496.firebasestorage.app",
    messagingSenderId: "214252384173",
    appId: "1:214252384173:web:c7af5b0d4c3c0f41f77b24"
};

let app, auth, provider;
try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    provider = new GoogleAuthProvider();
} catch (e) {
    // Initialized in offline fallback mode
}

export function showToast(message) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.style.opacity = "1";
    setTimeout(() => {
        toast.style.opacity = "0";
    }, 2800);
}

window.addEventListener("submit", (e) => e.preventDefault());

// Application State
export let currentUser = null;
export let my10DigitUid = null;
export let currentTargetUid = null;
export let socket = null;

// Infrastructure Configuration (Handled in background)
const AWS_SIGNALING_URL = "http://18.234.224.25:3000";
const PRIMARY_STUN = "stun:stun.l.google.com:19302";
const BACKUP_STUN = "stun:18.234.224.25:3478";
let isStunFailoverActive = false;

// Resolve backend signaling URL with mixed-content fallback
export function getEffectiveServerUrl() {
    const saved = localStorage.getItem("zingTalkServerUrl");
    if (saved && saved.trim()) return saved.trim();

    if (typeof window !== "undefined" && window.location && window.location.protocol === "https:") {
        const origin = window.location.origin;
        if (!origin.includes("localhost") && !origin.includes("capacitor:") && !origin.startsWith("file:")) {
            return origin;
        }
    }
    return AWS_SIGNALING_URL;
}

// Compute deterministic 10-digit UID
export function computeDeterministic10DigitUid(idStr) {
    if (!idStr) return "1000000001";
    let hash = 5381;
    for (let i = 0; i < idStr.length; i++) {
        hash = ((hash << 5) + hash) + idStr.charCodeAt(i);
        hash |= 0;
    }
    const num = (Math.abs(hash) % 9000000000) + 1000000000;
    return num.toString();
}

export function updateUidDisplays(uid) {
    if (!uid) return;
    my10DigitUid = String(uid);
    const label = document.getElementById("my-uid-label");
    if (label) label.innerText = "UID: " + my10DigitUid;
    const modalUid = document.getElementById("modal-uid");
    if (modalUid) modalUid.innerText = my10DigitUid;
    const alexaText = document.getElementById("alexa-pair-text");
    if (alexaText) alexaText.innerText = `Voice: "Alexa, pair UID ${my10DigitUid}"`;
}

// WebRTC STUN Configuration (Google Primary -> AWS Failover)
const rtcConfig = {
    iceServers: [
        { urls: [PRIMARY_STUN, "stun:stun1.l.google.com:19302"] },
        { urls: BACKUP_STUN }
    ],
    iceCandidatePoolSize: 10
};

// Clean contacts list: starts empty, populated only when the user adds real contacts
let myContacts = [];
try {
    const saved = localStorage.getItem("zingTalkContacts");
    if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
            // Purge any legacy dummy/seed contacts
            myContacts = parsed.filter(c => !["1000000002", "1000000003", "1000000005"].includes(c.uid) && !["Aman", "Rahul", "Raman"].includes(c.name));
            localStorage.setItem("zingTalkContacts", JSON.stringify(myContacts));
        }
    }
} catch (_) {}

let chatHistory = JSON.parse(localStorage.getItem("zingTalkHistory")) || {};
let localStream = null;
let peerConnection = null;
let activeCallTarget = null;
let currentCallType = "video";
let isMicMuted = false;
let callDurationTimer = null;
let callSecondsElapsed = 0;
let iceCandidatesQueue = [];

// Auto-login from saved session
const savedSession = localStorage.getItem("zingTalkTvSession");
if (savedSession) {
    try {
        const sessionData = JSON.parse(savedSession);
        if (sessionData && sessionData.displayName) {
            loginUserSession(sessionData);
        }
    } catch (_) {}
}

function loginUserSession(user) {
    currentUser = user;
    document.getElementById("login-screen")?.classList.add("hidden");
    document.getElementById("tv-top-bar")?.classList.remove("hidden");
    document.getElementById("main-screen")?.classList.remove("hidden");

    const displayName = user.displayName || (user.email ? user.email.split("@")[0] : "TV User");
    if (document.getElementById("my-name")) document.getElementById("my-name").innerText = displayName;
    if (document.getElementById("my-avatar")) document.getElementById("my-avatar").innerText = displayName.charAt(0).toUpperCase();

    const cacheKey = "zingTalkUid_" + (user.email || user.uid || displayName);
    const cachedUid = localStorage.getItem(cacheKey);
    if (cachedUid) {
        updateUidDisplays(cachedUid);
    } else if (!my10DigitUid) {
        const instantUid = computeDeterministic10DigitUid(user.uid || user.email || displayName);
        updateUidDisplays(instantUid);
        localStorage.setItem(cacheKey, instantUid);
    }

    if (socket && socket.connected) {
        socket.emit("login_user", { email: user.email, name: displayName, uid: my10DigitUid, contacts: myContacts });
        socket.emit("sync_contacts", { uid: my10DigitUid, contacts: myContacts });
    }

    renderContacts(myContacts);
    autoFocusFirstElement();
}

function logoutUserSession() {
    currentUser = null;
    my10DigitUid = null;
    currentTargetUid = null;
    localStorage.removeItem("zingTalkTvSession");
    if (auth) {
        signOut(auth).catch(() => {});
    }
    document.getElementById("profile-modal")?.classList.add("hidden");
    document.getElementById("main-screen")?.classList.add("hidden");
    document.getElementById("tv-top-bar")?.classList.add("hidden");
    document.getElementById("login-screen")?.classList.remove("hidden");
    showToast("Signed out");
}

if (auth) {
    onAuthStateChanged(auth, (user) => {
        if (user) {
            loginUserSession(user);
        } else if (!currentUser) {
            document.getElementById("login-screen")?.classList.remove("hidden");
            document.getElementById("tv-top-bar")?.classList.add("hidden");
            document.getElementById("main-screen")?.classList.add("hidden");
        }
    });
}

// ----------------- Socket Signaling & Alexa Webhook Commands -----------------
export function registerSocketListeners(s) {
    if (!s) return;

    s.on("connect", () => {
        if (currentUser) {
            s.emit("login_user", { email: currentUser.email, name: currentUser.displayName || "TV User", uid: my10DigitUid, contacts: myContacts });
            s.emit("sync_contacts", { uid: my10DigitUid, contacts: myContacts });
        }
    });

    s.on("user_data", (data) => {
        if (data && data.uid) {
            updateUidDisplays(data.uid);
            if (currentUser) {
                localStorage.setItem("zingTalkUid_" + (currentUser.email || currentUser.uid), my10DigitUid);
            }
        }
        if (data && data.contacts && data.contacts.length > 0) {
            myContacts = data.contacts;
            localStorage.setItem("zingTalkContacts", JSON.stringify(myContacts));
            renderContacts(myContacts);
            s.emit("sync_contacts", { uid: my10DigitUid, contacts: myContacts });
        }
    });

    s.on("contact_saved", (contacts) => {
        myContacts = contacts;
        localStorage.setItem("zingTalkContacts", JSON.stringify(myContacts));
        renderContacts(myContacts);
        s.emit("sync_contacts", { uid: my10DigitUid, contacts: myContacts });
        showToast("Contact saved successfully");
    });

    s.on("contact_error", (msg) => {
        showToast(msg);
    });

    s.on("receive_message", (data) => {
        const sender = data.senderUid;
        if (!chatHistory[sender]) chatHistory[sender] = [];
        chatHistory[sender].push({ ...data, type: "msg-received" });
        localStorage.setItem("zingTalkHistory", JSON.stringify(chatHistory));

        if (currentTargetUid === sender) {
            appendMessage(data, "msg-received");
        }
    });

    s.on("incoming_call", (data) => {
        activeCallTarget = data.callerUid;
        currentCallType = data.type || "video";

        let callerNameToShow = "UID: " + data.callerUid;
        const knownContact = myContacts.find(c => c.uid === data.callerUid);
        if (knownContact) callerNameToShow = knownContact.name;

        const callerDisplay = document.getElementById("caller-name-display");
        if (callerDisplay) callerDisplay.innerText = callerNameToShow;

        const callTypeEl = document.getElementById("incoming-call-type");
        if (callTypeEl) {
            callTypeEl.innerText = `Incoming ${currentCallType === 'video' ? 'HD Video' : 'Audio'} Call...`;
        }
        document.getElementById("incoming-call-overlay")?.classList.remove("hidden");
        document.getElementById("accept-call-btn")?.focus();
    });

    s.on("call_cancelled", () => {
        document.getElementById("incoming-call-overlay")?.classList.add("hidden");
        activeCallTarget = null;
        showToast("Call cancelled");
    });

    s.on("call_response_received", async (data) => {
        document.getElementById("outgoing-call-overlay")?.classList.add("hidden");
        if (data.status === "accepted") {
            await startWebRTC(true);
        } else {
            showToast("Call declined");
            activeCallTarget = null;
        }
    });

    s.on("webrtc_offer_received", async (data) => {
        if (!peerConnection) return;
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            s.emit("webrtc_answer", { targetUid: activeCallTarget, answer });

            while (iceCandidatesQueue.length > 0) {
                await peerConnection.addIceCandidate(new RTCIceCandidate(iceCandidatesQueue.shift()));
            }
        } catch (_) {}
    });

    s.on("webrtc_answer_received", async (data) => {
        if (!peerConnection) return;
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
            while (iceCandidatesQueue.length > 0) {
                await peerConnection.addIceCandidate(new RTCIceCandidate(iceCandidatesQueue.shift()));
            }
        } catch (_) {}
    });

    s.on("webrtc_ice_candidate_received", async (data) => {
        if (peerConnection && peerConnection.remoteDescription) {
            try {
                await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
            } catch (_) {}
        } else {
            iceCandidatesQueue.push(data.candidate);
        }
    });

    s.on("webrtc_call_ended", () => {
        endCallCleanup();
        showToast("Call ended");
    });

    // Alexa Webhook Intent Dispatcher from Server
    s.on("alexa_command", (cmd) => {
        handleAlexaIncomingCommand(cmd);
    });

    s.on("alexa_paired", (data) => {
        showToast(`🎙️ Alexa Paired (UID: ${data.uid})`);
        const badge = document.getElementById('alexa-pairing-badge');
        if (badge) {
            badge.classList.add('paired');
            const dot = badge.querySelector('.tv-alexa-dot');
            if (dot) dot.classList.add('active');
            const text = document.getElementById('alexa-pair-text');
            if (text) text.innerText = `🎙️ Alexa Linked (${data.uid})`;
        }
    });

    s.on("contact_saved", (updatedContacts) => {
        if (Array.isArray(updatedContacts)) {
            myContacts = updatedContacts;
            try { localStorage.setItem("zingTalkContacts", JSON.stringify(myContacts)); } catch (_) {}
            renderContacts(myContacts);
            showToast("Contact saved successfully");
        }
    });

    s.on("contact_error", (errMsg) => {
        showToast(errMsg || "Failed to save contact");
    });
}

export function connectSocket() {
    if (typeof io === "undefined") return null;
    const targetUrl = getEffectiveServerUrl() || "";

    if (socket) {
        try { socket.disconnect(); } catch (_) {}
    }

    const socketOpts = {
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        timeout: 10000
    };

    socket = targetUrl ? io(targetUrl, socketOpts) : io(socketOpts);
    registerSocketListeners(socket);
    return socket;
}

connectSocket();

// ----------------- UI Rendering (Clean TV Leanback) -----------------
function renderContacts(contacts) {
    const list = document.getElementById("contacts-list");
    if (!list) return;
    list.innerHTML = "";

    if (!contacts || contacts.length === 0) {
        list.innerHTML = `
            <div style="padding: 24px 10px; text-align: center; color: var(--tv-text-secondary); font-size: 14.5px;">
                No contacts saved yet. Enter a 10-digit UID above to save a contact.
            </div>
        `;
        return;
    }

    contacts.forEach(contact => {
        const card = document.createElement("div");
        card.className = "tv-contact-card tv-focusable";
        card.tabIndex = 0;
        card.innerHTML = `
            <div class="tv-contact-info-block">
                <div class="tv-avatar-circle">${(contact.name || "U").charAt(0).toUpperCase()}</div>
                <div>
                    <div class="tv-contact-name-txt">${escapeHtml(contact.name)}</div>
                    <div class="tv-contact-uid-txt">UID: ${contact.uid}</div>
                </div>
            </div>
            <div class="tv-contact-quick-actions">
                <button type="button" class="tv-mini-call-btn tv-focusable" data-action="audio" title="Audio Call">📞</button>
                <button type="button" class="tv-mini-call-btn tv-focusable" data-action="video" title="Video Call">🎥</button>
            </div>
        `;

        card.addEventListener("click", (e) => {
            const btn = e.target.closest("button");
            if (btn) {
                const action = btn.dataset.action;
                initiateDirectCall(contact.uid, action);
            } else {
                openChat(contact);
            }
        });

        card.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                openChat(contact);
            }
        });

        list.appendChild(card);
    });
}

function openChat(contact) {
    currentTargetUid = contact.uid;
    document.getElementById("tv-empty-stage")?.classList.add("hidden");
    document.getElementById("tv-active-chat")?.classList.remove("hidden");

    if (document.getElementById("chat-contact-name")) {
        document.getElementById("chat-contact-name").innerText = contact.name;
    }
    if (document.getElementById("chat-contact-uid")) {
        document.getElementById("chat-contact-uid").innerText = "UID: " + contact.uid;
    }
    if (document.getElementById("chat-avatar")) {
        document.getElementById("chat-avatar").innerText = (contact.name || "U").charAt(0).toUpperCase();
    }

    const messagesArea = document.getElementById("messages-area");
    if (messagesArea) {
        messagesArea.innerHTML = "";
        if (chatHistory[contact.uid]) {
            chatHistory[contact.uid].forEach(msg => appendMessage(msg, msg.type));
        }
    }
    document.getElementById("message-input")?.focus();
}

function closeChat() {
    currentTargetUid = null;
    document.getElementById("tv-active-chat")?.classList.add("hidden");
    document.getElementById("tv-empty-stage")?.classList.remove("hidden");
    autoFocusFirstElement();
}

function sendMessageLogic() {
    const input = document.getElementById("message-input");
    const text = input?.value.trim();
    if (!text || !currentTargetUid || !socket) return;

    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const msgData = {
        id: "msg_" + Date.now(),
        senderUid: my10DigitUid,
        receiverUid: currentTargetUid,
        text: text,
        timestamp: timeStr
    };

    socket.emit("send_message", msgData);
    appendMessage(msgData, "msg-sent");

    if (!chatHistory[currentTargetUid]) chatHistory[currentTargetUid] = [];
    chatHistory[currentTargetUid].push({ ...msgData, type: "msg-sent" });
    try {
        localStorage.setItem("zingTalkHistory", JSON.stringify(chatHistory));
    } catch (_) {}

    input.value = "";
}

function appendMessage(data, type) {
    const area = document.getElementById("messages-area");
    if (!area) return;

    const div = document.createElement("div");
    div.className = `tv-msg ${type === 'msg-sent' ? 'tv-msg-sent' : 'tv-msg-received'}`;
    div.innerHTML = `
        <div>${escapeHtml(data.text)}</div>
        <div class="tv-msg-meta">${data.timestamp || ''}</div>
    `;
    area.appendChild(div);
    area.scrollTop = area.scrollHeight;
}

function escapeHtml(text) {
    if (!text) return "";
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

// ----------------- WebRTC HD Calling (Google STUN + AWS Fallback) -----------------
async function startWebRTC(isCaller) {
    document.getElementById("full-call-screen")?.classList.remove("hidden");
    const localVideo = document.getElementById("local-video");
    const remoteVideo = document.getElementById("remote-video");
    const audioVisualizer = document.getElementById("audio-call-visualizer");
    const audioPeerName = document.getElementById("audio-call-peer-name");

    isStunFailoverActive = false;

    let peerNameToShow = "UID: " + activeCallTarget;
    const knownContact = myContacts.find(c => c.uid === activeCallTarget);
    if (knownContact) peerNameToShow = knownContact.name;

    if (currentCallType === "audio") {
        if (localVideo) localVideo.classList.add("hidden");
        if (remoteVideo) remoteVideo.style.opacity = "0";
        if (audioVisualizer) {
            audioVisualizer.classList.remove("hidden");
            if (audioPeerName) audioPeerName.innerText = peerNameToShow;
        }
    } else {
        if (localVideo) localVideo.classList.remove("hidden");
        if (remoteVideo) remoteVideo.style.opacity = "1";
        if (audioVisualizer) audioVisualizer.classList.add("hidden");
    }

    const constraints = { audio: true, video: currentCallType === "video" };
    try {
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
        showToast("Media access required: " + err.message);
        endCall();
        return;
    }

    if (localVideo && currentCallType === "video") {
        localVideo.srcObject = localStream;
    }

    peerConnection = new RTCPeerConnection(rtcConfig);
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    peerConnection.ontrack = (event) => {
        const remote = document.getElementById("remote-video");
        if (remote) {
            remote.srcObject = event.streams[0];
            remote.play().catch(() => {});
        }
    };

    peerConnection.onicecandidate = (event) => {
        if (event.candidate && socket) {
            socket.emit("webrtc_ice_candidate", { targetUid: activeCallTarget, candidate: event.candidate });
        }
    };

    // Background STUN Failover Monitoring
    peerConnection.onicecandidateerror = (event) => {
        if (event.url && event.url.includes("google.com")) {
            isStunFailoverActive = true;
        }
    };

    peerConnection.oniceconnectionstatechange = () => {
        const state = peerConnection ? peerConnection.iceConnectionState : "";
        if (state === "failed" || state === "disconnected") {
            isStunFailoverActive = true;
        }
    };

    // Call Duration Timer
    callSecondsElapsed = 0;
    clearInterval(callDurationTimer);
    const timerEl = document.getElementById("call-timer");
    callDurationTimer = setInterval(() => {
        callSecondsElapsed++;
        const mins = String(Math.floor(callSecondsElapsed / 60)).padStart(2, '0');
        const secs = String(callSecondsElapsed % 60).padStart(2, '0');
        const modeLabel = currentCallType === "video" ? "HD Video" : "Audio";
        if (timerEl) timerEl.innerText = `${mins}:${secs} • ${modeLabel}`;
    }, 1000);

    if (isCaller) {
        try {
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            socket.emit("webrtc_offer", { targetUid: activeCallTarget, offer });
        } catch (_) {}
    }
}

function endCallCleanup() {
    clearInterval(callDurationTimer);
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    activeCallTarget = null;
    iceCandidatesQueue = [];
    document.getElementById("full-call-screen")?.classList.add("hidden");
    document.getElementById("audio-call-visualizer")?.classList.add("hidden");
}

function endCall() {
    if (socket && activeCallTarget) {
        socket.emit("webrtc_end_call", { targetUid: activeCallTarget });
    }
    endCallCleanup();
}

function initiateDirectCall(targetUid, type) {
    if (!targetUid) return;
    if (targetUid === my10DigitUid) {
        showToast("You cannot call your own UID");
        return;
    }

    currentCallType = type || "video";
    activeCallTarget = targetUid;

    let targetNameToShow = "UID: " + targetUid;
    const contact = myContacts.find(c => c.uid === targetUid);
    if (contact) targetNameToShow = contact.name;

    const outgoingName = document.getElementById("outgoing-call-name");
    if (outgoingName) outgoingName.innerText = targetNameToShow;

    const outgoingType = document.getElementById("outgoing-call-type");
    if (outgoingType) {
        outgoingType.innerText = `Connecting ${currentCallType === 'video' ? 'HD Video' : 'Audio'} Call...`;
    }
    document.getElementById("outgoing-call-overlay")?.classList.remove("hidden");

    if (socket) {
        socket.emit("initiate_call", {
            callerUid: my10DigitUid,
            targetUid: targetUid,
            callerName: currentUser ? currentUser.displayName : "TV User",
            type: currentCallType
        });
    }
}

// ----------------- Alexa Skill Remote Command Handler -----------------
// Dispatched from the user's Fire TV physical remote via Alexa Skill Webhook (POST /api/alexa)
function handleAlexaIncomingCommand(cmd) {
    if (!cmd) return;
    const action = cmd.action;

    if (action === 'launch') {
        const loginScreen = document.getElementById("login-screen");
        if (loginScreen && !loginScreen.classList.contains("hidden")) {
            if (!currentUser) {
                const nameInput = document.getElementById("guest-name-input");
                const name = nameInput?.value.trim() || "Living Room TV";
                const email = `${name.toLowerCase().replace(/[^a-z0-9]/g, '')}@tv.local`;
                const user = {
                    displayName: name,
                    email: email,
                    uid: "tv_" + computeDeterministic10DigitUid(email)
                };
                localStorage.setItem("zingTalkTvSession", JSON.stringify(user));
                loginUserSession(user);
            }
        }
        document.getElementById("login-screen")?.classList.add("hidden");
        document.getElementById("tv-top-bar")?.classList.remove("hidden");
        document.getElementById("main-screen")?.classList.remove("hidden");
    } else if (action === 'audio_call' || action === 'video_call') {
        const mode = action === 'video_call' ? 'video' : 'audio';
        const targetUid = cmd.targetUid;
        if (targetUid) {
            initiateDirectCall(targetUid, mode);
        }
    } else if (action === 'end_call') {
        endCall();
    } else if (action === 'answer_call') {
        const acceptBtn = document.getElementById("accept-call-btn");
        if (acceptBtn) acceptBtn.click();
    } else if (action === 'reject_call') {
        const rejectBtn = document.getElementById("reject-call-btn");
        if (rejectBtn) rejectBtn.click();
    } else if (action === 'mute_mic') {
        if (localStream) {
            const track = localStream.getAudioTracks()[0];
            if (track) {
                isMicMuted = true;
                track.enabled = false;
                showToast("Microphone muted");
            }
        }
    } else if (action === 'unmute_mic') {
        if (localStream) {
            const track = localStream.getAudioTracks()[0];
            if (track) {
                isMicMuted = false;
                track.enabled = true;
                showToast("Microphone active");
            }
        }
    } else if (action === 'camera_off') {
        if (localStream) {
            const track = localStream.getVideoTracks()[0];
            if (track) {
                track.enabled = false;
                showToast("Camera turned off");
            }
        }
    } else if (action === 'camera_on') {
        if (localStream) {
            const track = localStream.getVideoTracks()[0];
            if (track) {
                track.enabled = true;
                showToast("Camera active");
            }
        }
    } else if (action === 'open_chat') {
        const targetUid = cmd.targetUid;
        if (targetUid) {
            const contact = myContacts.find(c => c.uid === targetUid) || { uid: targetUid, name: cmd.contact || ("UID " + targetUid) };
            openChat(contact);
        }
    } else if (action === 'clear_chat') {
        if (currentTargetUid) {
            chatHistory[currentTargetUid] = [];
            const messagesArea = document.getElementById("messages-area");
            if (messagesArea) messagesArea.innerHTML = "";
            try { localStorage.setItem("zingTalkHistory", JSON.stringify(chatHistory)); } catch (_) {}
            showToast("Chat cleared");
        }
    } else if (action === 'open_dialpad') {
        closeChat();
        document.getElementById("dial-uid-input")?.focus();
        showToast("Dialpad ready");
    } else if (action === 'open_contacts') {
        closeChat();
        autoFocusFirstElement();
        showToast("Contacts directory");
    } else if (action === 'open_profile') {
        showToast(`Your ZingTalk UID: ${my10DigitUid}`);
    } else if (action === 'type_message') {
        const text = cmd.message || "";
        const input = document.getElementById("message-input");
        if (input) {
            input.value = text;
            input.focus();
        }
    } else if (action === 'send_message') {
        const text = cmd.message || "";
        const input = document.getElementById("message-input");
        if (input && text) {
            input.value = text;
        }
        if (currentTargetUid) {
            sendMessageLogic();
        }
    } else if (action === 'navigate_home') {
        closeChat();
    }
}

// ----------------- Fire TV Remote Spatial Navigation Engine -----------------
function getVisibleFocusableElements() {
    return Array.from(document.querySelectorAll('.tv-focusable')).filter(el => {
        if (el.offsetParent === null) return false;
        if (el.closest('.hidden')) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    });
}

function autoFocusFirstElement() {
    const focusables = getVisibleFocusableElements();
    if (focusables.length > 0) {
        focusables[0].focus();
    }
}

function handleDpadNavigation(direction) {
    const focusables = getVisibleFocusableElements();
    if (focusables.length === 0) return;

    let current = document.activeElement;
    if (!current || !focusables.includes(current)) {
        focusables[0].focus();
        return;
    }

    const currentRect = current.getBoundingClientRect();
    const currentCenter = { 
        x: currentRect.left + currentRect.width / 2, 
        y: currentRect.top + currentRect.height / 2 
    };

    let bestElement = null;
    let bestDistance = Infinity;

    focusables.forEach(target => {
        if (target === current) return;
        const targetRect = target.getBoundingClientRect();
        const targetCenter = { 
            x: targetRect.left + targetRect.width / 2, 
            y: targetRect.top + targetRect.height / 2 
        };
        const dx = targetCenter.x - currentCenter.x;
        const dy = targetCenter.y - currentCenter.y;

        let isValidDirection = false;
        if (direction === 'up' && dy < -5) isValidDirection = true;
        if (direction === 'down' && dy > 5) isValidDirection = true;
        if (direction === 'left' && dx < -5) isValidDirection = true;
        if (direction === 'right' && dx > 5) isValidDirection = true;

        if (isValidDirection) {
            let dist = 0;
            if (direction === 'up' || direction === 'down') {
                dist = Math.abs(dy) + Math.abs(dx) * 1.4;
            } else {
                dist = Math.abs(dx) + Math.abs(dy) * 1.4;
            }

            if (dist < bestDistance) {
                bestDistance = dist;
                bestElement = target;
            }
        }
    });

    if (bestElement) {
        bestElement.focus();
        bestElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

function handleBackKey() {
    const openModal = document.querySelector('.tv-modal-backdrop:not(.hidden)');
    if (openModal) {
        openModal.classList.add("hidden");
        autoFocusFirstElement();
        return;
    }

    if (!document.getElementById("full-call-screen")?.classList.contains("hidden")) {
        endCall();
        return;
    }

    if (!document.getElementById("outgoing-call-overlay")?.classList.contains("hidden")) {
        document.getElementById("cancel-outgoing-btn")?.click();
        return;
    }

    if (!document.getElementById("incoming-call-overlay")?.classList.contains("hidden")) {
        document.getElementById("reject-call-btn")?.click();
        return;
    }

    if (!document.getElementById("tv-active-chat")?.classList.contains("hidden")) {
        closeChat();
        return;
    }
}

// Global Remote Keydown Event Listener
window.addEventListener("keydown", (e) => {
    const isTyping = document.activeElement && 
        (document.activeElement.tagName === "INPUT" || document.activeElement.tagName === "TEXTAREA");

    if (e.key === "ArrowUp") {
        if (!isTyping) { e.preventDefault(); handleDpadNavigation("up"); }
    } else if (e.key === "ArrowDown") {
        if (!isTyping) { e.preventDefault(); handleDpadNavigation("down"); }
    } else if (e.key === "ArrowLeft") {
        if (!isTyping) { e.preventDefault(); handleDpadNavigation("left"); }
    } else if (e.key === "ArrowRight") {
        if (!isTyping) { e.preventDefault(); handleDpadNavigation("right"); }
    } else if (e.key === "Escape" || e.keyCode === 10009 || (e.key === "Backspace" && !isTyping)) {
        e.preventDefault();
        handleBackKey();
    }
});

// ----------------- Global Clicks & UI Triggers -----------------
let isSignUpMode = false;

document.addEventListener("click", async (e) => {
    if (e.target.tagName === "BUTTON") e.preventDefault();

    // 1. Login Tabs Switching
    if (e.target.id === "tab-btn-google") {
        document.querySelectorAll(".tv-login-tab").forEach(t => t.classList.remove("active"));
        document.querySelectorAll(".tv-tab-pane").forEach(p => p.classList.add("hidden"));
        e.target.classList.add("active");
        document.getElementById("pane-google")?.classList.remove("hidden");
        document.getElementById("google-login-btn")?.focus();
        return;
    }

    if (e.target.id === "tab-btn-email") {
        document.querySelectorAll(".tv-login-tab").forEach(t => t.classList.remove("active"));
        document.querySelectorAll(".tv-tab-pane").forEach(p => p.classList.add("hidden"));
        e.target.classList.add("active");
        document.getElementById("pane-email")?.classList.remove("hidden");
        document.getElementById("login-email-input")?.focus();
        return;
    }

    if (e.target.id === "tab-btn-guest") {
        document.querySelectorAll(".tv-login-tab").forEach(t => t.classList.remove("active"));
        document.querySelectorAll(".tv-tab-pane").forEach(p => p.classList.add("hidden"));
        e.target.classList.add("active");
        document.getElementById("pane-guest")?.classList.remove("hidden");
        document.getElementById("guest-name-input")?.focus();
        return;
    }

    // Toggle Email Auth Mode (Sign In vs Sign Up)
    if (e.target.id === "toggle-auth-mode-btn") {
        isSignUpMode = !isSignUpMode;
        const nameGroup = document.getElementById("email-signup-name-group");
        const btnText = document.getElementById("email-btn-text");
        const toggleBtn = document.getElementById("toggle-auth-mode-btn");

        if (isSignUpMode) {
            nameGroup?.classList.remove("hidden");
            if (btnText) btnText.innerText = "Create Account";
            if (toggleBtn) toggleBtn.innerText = "Already have an account? Sign In";
        } else {
            nameGroup?.classList.add("hidden");
            if (btnText) btnText.innerText = "Sign In";
            if (toggleBtn) toggleBtn.innerText = "Don't have an account? Sign Up";
        }
        return;
    }

    // Google Login Action
    if (e.target.id === "google-login-btn" || e.target.closest("#google-login-btn")) {
        const errorEl = document.getElementById("login-message");
        if (errorEl) errorEl.style.display = "none";

        // Check if running in Native Capacitor Android App
        if (window.Capacitor?.isNativePlatform && window.Capacitor.isNativePlatform() && window.Capacitor.Plugins?.FirebaseAuthentication) {
            try {
                showToast("Opening Google Sign-In...");
                const result = await window.Capacitor.Plugins.FirebaseAuthentication.signInWithGoogle();
                if (result && result.user) {
                    const user = {
                        displayName: result.user.displayName || "Google User",
                        email: result.user.email,
                        uid: result.user.uid,
                        photoURL: result.user.photoUrl
                    };
                    localStorage.setItem("zingTalkTvSession", JSON.stringify(user));
                    loginUserSession(user);
                    return;
                }
            } catch (nativeErr) {
                console.warn("[Firebase] Native Google Sign-In failed:", nativeErr);
                const msg = nativeErr.message || "Google Sign-In cancelled or failed.";
                if (errorEl) {
                    errorEl.innerText = msg;
                    errorEl.style.display = "block";
                }
                showToast(msg);
                return;
            }
        }

        // Web / Browser Standard Firebase Google Sign-In
        if (auth && provider) {
            try {
                const result = await signInWithPopup(auth, provider);
                const user = {
                    displayName: result.user.displayName || "Google User",
                    email: result.user.email,
                    uid: result.user.uid,
                    photoURL: result.user.photoURL
                };
                localStorage.setItem("zingTalkTvSession", JSON.stringify(user));
                loginUserSession(user);
            } catch (err) {
                console.error("[Firebase] Google popup error:", err);
                let msg = err.message || "Google Sign-In failed.";
                if (err.code === "auth/popup-closed-by-user") {
                    msg = "Google sign-in popup was closed.";
                } else if (err.code === "auth/popup-blocked") {
                    msg = "Pop-up blocked by browser. Please allow popups for this site.";
                }
                if (errorEl) {
                    errorEl.innerText = msg;
                    errorEl.style.display = "block";
                }
                showToast(msg);
            }
        } else {
            if (errorEl) {
                errorEl.innerText = "Firebase Authentication is initializing. Please try again.";
                errorEl.style.display = "block";
            }
        }
        return;
    }

    // Email / Password Login Action
    if (e.target.id === "email-login-submit-btn" || e.target.closest("#email-login-submit-btn")) {
        const email = document.getElementById("login-email-input")?.value.trim();
        const password = document.getElementById("login-password-input")?.value.trim();
        const name = document.getElementById("login-name-input")?.value.trim() || "";
        const errorEl = document.getElementById("login-message");

        if (errorEl) errorEl.style.display = "none";

        if (!email || !password) {
            if (errorEl) {
                errorEl.innerText = "Please enter both email and password.";
                errorEl.style.display = "block";
            }
            return;
        }

        if (auth) {
            try {
                if (isSignUpMode) {
                    if (password.length < 6) {
                        if (errorEl) {
                            errorEl.innerText = "Password must be at least 6 characters long.";
                            errorEl.style.display = "block";
                        }
                        return;
                    }
                    const cred = await createUserWithEmailAndPassword(auth, email, password);
                    if (name) {
                        try { await updateProfile(cred.user, { displayName: name }); } catch (_) {}
                    }
                    const user = {
                        displayName: name || cred.user.displayName || email.split("@")[0],
                        email: cred.user.email,
                        uid: cred.user.uid
                    };
                    localStorage.setItem("zingTalkTvSession", JSON.stringify(user));
                    loginUserSession(user);
                    showToast("Account created successfully!");
                } else {
                    const cred = await signInWithEmailAndPassword(auth, email, password);
                    const user = {
                        displayName: cred.user.displayName || email.split("@")[0],
                        email: cred.user.email,
                        uid: cred.user.uid
                    };
                    localStorage.setItem("zingTalkTvSession", JSON.stringify(user));
                    loginUserSession(user);
                    showToast("Signed in successfully!");
                }
            } catch (err) {
                console.error("[Firebase Auth Error]:", err);
                let msg = err.message || "Authentication failed.";
                if (err.code === "auth/invalid-credential" || err.code === "auth/wrong-password" || err.code === "auth/user-not-found") {
                    msg = "Invalid email or password. Please verify your credentials.";
                } else if (err.code === "auth/email-already-in-use") {
                    msg = "This email is already registered. Please click 'Sign In' below.";
                } else if (err.code === "auth/weak-password") {
                    msg = "Password should be at least 6 characters.";
                } else if (err.code === "auth/invalid-email") {
                    msg = "Please enter a valid email address.";
                } else if (err.code === "auth/network-request-failed") {
                    msg = "Network error. Please check your internet connection.";
                }
                if (errorEl) {
                    errorEl.innerText = msg;
                    errorEl.style.display = "block";
                }
                showToast(msg);
            }
        } else {
            if (errorEl) {
                errorEl.innerText = "Firebase Authentication is unavailable. Please check your network.";
                errorEl.style.display = "block";
            }
        }
        return;
    }

    // Guest Mode Login Action
    if (e.target.id === "guest-login-btn" || e.target.closest("#guest-login-btn")) {
        const nameInput = document.getElementById("guest-name-input");
        const name = nameInput?.value.trim() || "Living Room TV";
        const email = `${name.toLowerCase().replace(/[^a-z0-9]/g, '')}@tv.local`;

        const user = {
            displayName: name,
            email: email,
            uid: "tv_" + computeDeterministic10DigitUid(email)
        };

        localStorage.setItem("zingTalkTvSession", JSON.stringify(user));
        loginUserSession(user);
        return;
    }

    // Direct Dial Quick Audio / Video Call
    if (e.target.id === "quick-audio-call-btn" || e.target.closest("#quick-audio-call-btn")) {
        const uid = document.getElementById("dial-uid-input")?.value.trim();
        if (!uid || uid.length !== 10) {
            showToast("Please enter a valid 10-digit UID");
            return;
        }
        initiateDirectCall(uid, "audio");
        return;
    }

    if (e.target.id === "quick-video-call-btn" || e.target.closest("#quick-video-call-btn")) {
        const uid = document.getElementById("dial-uid-input")?.value.trim();
        if (!uid || uid.length !== 10) {
            showToast("Please enter a valid 10-digit UID");
            return;
        }
        initiateDirectCall(uid, "video");
        return;
    }

    // Save Contact
    if (e.target.id === "save-contact-btn" || e.target.closest("#save-contact-btn")) {
        const uid = document.getElementById("contact-uid-input")?.value.trim();
        const name = document.getElementById("contact-name-input")?.value.trim();

        if (!uid || uid.length !== 10) {
            showToast("Please enter a valid 10-digit UID");
            return;
        }
        if (!name) {
            showToast("Please enter a contact name");
            return;
        }
        if (uid === my10DigitUid) {
            showToast("You cannot save your own UID");
            return;
        }

        const updated = myContacts.filter(c => c.uid !== uid);
        updated.push({ uid, name });
        myContacts = updated;
        localStorage.setItem("zingTalkContacts", JSON.stringify(myContacts));
        renderContacts(myContacts);
        showToast(`Saved contact: ${name}`);

        if (socket && socket.connected) {
            socket.emit("save_contact", { myUid: my10DigitUid, targetUid: uid, customName: name });
        }

        if (document.getElementById("contact-uid-input")) document.getElementById("contact-uid-input").value = "";
        if (document.getElementById("contact-name-input")) document.getElementById("contact-name-input").value = "";
        return;
    }

    // Chat Screen Triggers
    if (e.target.id === "chat-back-btn" || e.target.closest("#chat-back-btn")) {
        closeChat();
        return;
    }

    if (e.target.id === "send-btn" || e.target.closest("#send-btn")) {
        sendMessageLogic();
        return;
    }

    if (e.target.id === "chat-audio-call-btn" || e.target.closest("#chat-audio-call-btn")) {
        if (currentTargetUid) initiateDirectCall(currentTargetUid, "audio");
        return;
    }

    if (e.target.id === "chat-video-call-btn" || e.target.closest("#chat-video-call-btn")) {
        if (currentTargetUid) initiateDirectCall(currentTargetUid, "video");
        return;
    }

    // Call Screen Controls
    if (e.target.id === "mute-mic-btn" || e.target.closest("#mute-mic-btn")) {
        if (localStream) {
            const track = localStream.getAudioTracks()[0];
            if (track) {
                isMicMuted = !isMicMuted;
                track.enabled = !isMicMuted;
                showToast(isMicMuted ? "Microphone muted" : "Microphone active");
            }
        }
        return;
    }

    if (e.target.id === "toggle-video-btn" || e.target.closest("#toggle-video-btn")) {
        if (localStream) {
            const track = localStream.getVideoTracks()[0];
            if (track) {
                track.enabled = !track.enabled;
                showToast(track.enabled ? "Camera active" : "Camera turned off");
            }
        }
        return;
    }

    if (e.target.id === "end-call-btn" || e.target.closest("#end-call-btn")) {
        endCall();
        return;
    }

    // Call Response Overlays
    if (e.target.id === "accept-call-btn" || e.target.closest("#accept-call-btn")) {
        document.getElementById("incoming-call-overlay")?.classList.add("hidden");
        try {
            await startWebRTC(false);
            if (socket) socket.emit("call_response", { targetUid: activeCallTarget, status: "accepted" });
        } catch (_) {
            if (socket) socket.emit("call_response", { targetUid: activeCallTarget, status: "rejected" });
            activeCallTarget = null;
        }
        return;
    }

    if (e.target.id === "reject-call-btn" || e.target.closest("#reject-call-btn")) {
        document.getElementById("incoming-call-overlay")?.classList.add("hidden");
        if (socket && activeCallTarget) {
            socket.emit("call_response", { targetUid: activeCallTarget, status: "rejected" });
        }
        activeCallTarget = null;
        return;
    }

    if (e.target.id === "cancel-outgoing-btn" || e.target.closest("#cancel-outgoing-btn")) {
        document.getElementById("outgoing-call-overlay")?.classList.add("hidden");
        if (socket && activeCallTarget) {
            socket.emit("cancel_call", { targetUid: activeCallTarget });
        }
        activeCallTarget = null;
        return;
    }

    // Profile & Logout
    if (e.target.id === "my-profile-chip" || e.target.closest("#my-profile-chip")) {
        const name = (currentUser && currentUser.displayName) ? currentUser.displayName : "TV User";
        const email = (currentUser && currentUser.email) ? currentUser.email : "Local TV";
        document.getElementById("modal-avatar").innerText = name.charAt(0).toUpperCase();
        document.getElementById("modal-name").innerText = name;
        document.getElementById("modal-email").innerText = email;
        document.getElementById("modal-uid").innerText = my10DigitUid || "Generating...";
        document.getElementById("profile-modal")?.classList.remove("hidden");
        return;
    }

    if (e.target.id === "close-profile-btn") {
        document.getElementById("profile-modal")?.classList.add("hidden");
        return;
    }

    if (e.target.id === "header-logout-btn" || e.target.closest("#header-logout-btn") || e.target.id === "modal-logout-btn") {
        logoutUserSession();
        return;
    }

    if (e.target.id === "copy-uid-btn") {
        if (my10DigitUid) {
            navigator.clipboard.writeText(my10DigitUid).then(() => {
                showToast("10-Digit UID copied: " + my10DigitUid);
            }).catch(() => {
                showToast("UID: " + my10DigitUid);
            });
        }
        return;
    }

    // Policy Modal
    if (e.target.id === "open-policy-btn") {
        document.getElementById("policy-modal")?.classList.remove("hidden");
        return;
    }

    if (e.target.id === "close-policy-btn") {
        document.getElementById("policy-modal")?.classList.add("hidden");
        return;
    }
});

// Input Submission via Enter
document.addEventListener("keypress", (e) => {
    if (e.key === "Enter" && document.activeElement === document.getElementById("message-input")) {
        e.preventDefault();
        sendMessageLogic();
    } else if (e.key === "Enter" && document.activeElement === document.getElementById("login-password-input")) {
        e.preventDefault();
        document.getElementById("email-login-submit-btn")?.click();
    } else if (e.key === "Enter" && document.activeElement === document.getElementById("guest-name-input")) {
        e.preventDefault();
        document.getElementById("guest-login-btn")?.click();
    }
});
