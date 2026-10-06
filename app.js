import { initializeApp } from "https://www.gstatic.com/firebasejs/10.4.0/firebase-app.js";
import { 
    getAuth, 
    onAuthStateChanged,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    sendPasswordResetEmail,
    signInAnonymously,
    updateProfile,
    signOut
} from "https://www.gstatic.com/firebasejs/10.4.0/firebase-auth.js";
import {
    getFirestore,
    doc,
    setDoc,
    getDoc
} from "https://www.gstatic.com/firebasejs/10.4.0/firebase-firestore.js";

// Client Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyDDi5b_GBmRLSXQOXe-_ZA3bP6KuxHZvvQ",
    authDomain: "zing-talk-c6496.firebaseapp.com",
    projectId: "zing-talk-c6496",
    storageBucket: "zing-talk-c6496.firebasestorage.app",
    messagingSenderId: "214252384173",
    appId: "1:214252384173:web:c7af5b0d4c3c0f41f77b24",
    measurementId: "G-W87FM4ZNJ7"
};

let app, auth, firestoreDb;
try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    firestoreDb = getFirestore(app);
} catch (e) {
    // Initialized in offline fallback mode
}

// Zero-Knowledge Storage: Save ONLY Contact UID & Name to Firebase Firestore (Never chats, messages, or media)
export async function saveContactToFirebase(contactUid, contactName) {
    if (!contactUid || !contactName) return;
    const cleanUid = String(contactUid).trim().replace(/\D/g, '');
    const cleanName = String(contactName).trim();

    const updated = myContacts.filter(c => c.uid !== cleanUid);
    const newContact = { uid: cleanUid, name: cleanName };
    updated.unshift(newContact);
    myContacts = updated;
    try { localStorage.setItem("zingTalkContacts", JSON.stringify(myContacts)); } catch (_) {}
    renderContacts(myContacts);

    // Save strictly { uid, contacts: [{ uid, name }] } to Firebase Firestore
    if (firestoreDb && my10DigitUid) {
        try {
            const userDocRef = doc(firestoreDb, "users", my10DigitUid);
            await setDoc(userDocRef, {
                uid: my10DigitUid,
                contacts: myContacts.map(c => ({ uid: c.uid, name: c.name }))
            }, { merge: true });
            console.log("[Firebase Firestore] Contact saved successfully in users/" + my10DigitUid);
        } catch (fsErr) {
            console.warn("[Firebase Firestore] Notice:", fsErr.message);
        }
    }

    // Also sync to server so EC2 / local signaling instance knows the contact
    if (socket && socket.connected && my10DigitUid) {
        socket.emit("save_contact", { myUid: my10DigitUid, targetUid: cleanUid, customName: cleanName });
    }
}

export function showToast(message) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.style.opacity = "1";
    setTimeout(() => {
        toast.style.opacity = "0";
    }, 3200);
}

// Web Audio API Pleasant 2-Tone Notification Sound (Zero External Dependency)
export function playIncomingChime() {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        if (ctx.state === "suspended") {
            ctx.resume();
        }
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "sine";
        const now = ctx.currentTime;
        osc.frequency.setValueAtTime(587.33, now); // D5 Note
        osc.frequency.setValueAtTime(880.00, now + 0.09); // A5 Note
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        osc.start(now);
        osc.stop(now + 0.3);
    } catch (_) {}
}

window.addEventListener("submit", (e) => e.preventDefault());

// Application State
export let currentUser = null;
export let my10DigitUid = null;
export let currentTargetUid = null;
export let socket = null;

// Infrastructure Configuration (Handled directly on user's AWS EC2 server)
const AWS_SIGNALING_URL = "http://18.234.224.25:3000";
const PRIMARY_STUN = "stun:18.234.224.25:3478";
const BACKUP_STUN = "stun:stun.l.google.com:19302";
let isStunFailoverActive = false;

// Resolve backend signaling URL: defaults directly to user's AWS server
export function getEffectiveServerUrl() {
    const saved = localStorage.getItem("zingTalkServerUrl");
    if (saved && saved.trim()) return saved.trim();

    if (typeof window !== "undefined") {
        const origin = window.location.origin || "";
        const hostname = window.location.hostname || "";
        const port = window.location.port || "";

        // If explicitly running in local Node development on a PC on port 3000 (NOT inside Android / Capacitor)
        if (hostname === "localhost" && port === "3000" && !window.Capacitor?.isNativePlatform?.()) {
            return origin;
        }

        // If user accessed their EC2 IP directly in browser
        if (hostname === "18.234.224.25") {
            return AWS_SIGNALING_URL;
        }
    }

    // FOR ALL ANDROID APKS, APPETIZE.IO, EMULATORS, AND CLOUD CLIENTS:
    // ALWAYS CONNECT TO THE GLOBAL AWS EC2 SIGNALING SERVER!
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
    const label = document.getElementById("my-uid-label");
    const modalUid = document.getElementById("modal-uid");
    if (!uid) {
        my10DigitUid = null;
        if (label) label.innerText = "UID: Connecting...";
        if (modalUid) modalUid.innerText = "Connecting to Server...";
        return;
    }
    my10DigitUid = String(uid);
    if (label) label.innerText = "UID: " + my10DigitUid;
    if (modalUid) modalUid.innerText = my10DigitUid;
}

// WebRTC STUN/TURN Configuration (Google Primary + User AWS EC2 Port 3478 + Twilio/Mozilla Fallback)
const rtcConfig = {
    iceServers: [
        { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302", "stun:stun2.l.google.com:19302"] },
        { urls: ["stun:18.234.224.25:3478", "turn:18.234.224.25:3478"] },
        { urls: ["stun:global.stun.twilio.com:3478", "stun:stun.services.mozilla.com"] }
    ],
    iceCandidatePoolSize: 10
};

// Clean in-memory user states (isolated per user UID)
let myContacts = [];
let chatHistory = {};
let unreadCounts = {};

export function getHistoryKey(uid) {
    const id = uid || my10DigitUid;
    return id ? `zingTalkHistory_${id}` : "zingTalkHistory_guest";
}
export function getContactsKey(uid) {
    const id = uid || my10DigitUid;
    return id ? `zingTalkContacts_${id}` : "zingTalkContacts_guest";
}
export function getUnreadKey(uid) {
    const id = uid || my10DigitUid;
    return id ? `zingTalkUnread_${id}` : "zingTalkUnread_guest";
}

export function loadUserStorageData(uid) {
    const targetUid = uid || my10DigitUid;
    try {
        const hist = localStorage.getItem(getHistoryKey(targetUid));
        chatHistory = hist ? JSON.parse(hist) : {};
    } catch (_) { chatHistory = {}; }

    try {
        const cont = localStorage.getItem(getContactsKey(targetUid));
        myContacts = cont ? JSON.parse(cont) : [];
    } catch (_) { myContacts = []; }

    try {
        const unread = localStorage.getItem(getUnreadKey(targetUid));
        unreadCounts = unread ? JSON.parse(unread) : {};
    } catch (_) { unreadCounts = {}; }
}

export function saveUserHistoryToStorage() {
    try {
        localStorage.setItem(getHistoryKey(), JSON.stringify(chatHistory));
    } catch (_) {}
}

export function saveUserContactsToStorage() {
    try {
        localStorage.setItem(getContactsKey(), JSON.stringify(myContacts));
    } catch (_) {}
}

export function saveUserUnreadToStorage() {
    try {
        localStorage.setItem(getUnreadKey(), JSON.stringify(unreadCounts));
    } catch (_) {}
}

let ringtoneInterval = null;
export function startRingtone() {
    stopRingtone();
    playIncomingChime();
    ringtoneInterval = setInterval(() => {
        playIncomingChime();
    }, 2500);
}

export function stopRingtone() {
    if (ringtoneInterval) {
        clearInterval(ringtoneInterval);
        ringtoneInterval = null;
    }
}

let localStream = null;
let peerConnection = null;
let activeCallTarget = null;
let currentCallType = "video";
let isMicMuted = false;
let callDurationTimer = null;
let callSecondsElapsed = 0;
let iceCandidatesQueue = [];

// Auto-login from saved session (Dual-layer: LocalStorage + Native Preferences)
const savedSession = localStorage.getItem("zingTalkTvSession");
if (savedSession) {
    try {
        const sessionData = JSON.parse(savedSession);
        if (sessionData && (sessionData.displayName || sessionData.uid)) {
            loginUserSession(sessionData);
        }
    } catch (_) {}
}

// Native SharedPreferences Persistence Backup (Prevents Bug 37 & 48: WebView Storage Aggressive Clear)
async function persistSessionBackup(key, value) {
    try {
        localStorage.setItem(key, value);
        if (window.Capacitor?.Plugins?.Preferences) {
            await window.Capacitor.Plugins.Preferences.set({ key, value });
        }
    } catch (_) {}
}

async function restoreSessionFromNativeBackup() {
    try {
        if (!currentUser && window.Capacitor?.Plugins?.Preferences) {
            const { value } = await window.Capacitor.Plugins.Preferences.get({ key: "zingTalkTvSession" });
            if (value) {
                const sessionData = JSON.parse(value);
                if (sessionData && (sessionData.displayName || sessionData.uid)) {
                    loginUserSession(sessionData);
                }
            }
        }
    } catch (_) {}
}
restoreSessionFromNativeBackup();

function loginUserSession(user) {
    currentUser = user;
    document.getElementById("login-screen")?.classList.add("hidden");
    document.getElementById("tv-top-bar")?.classList.remove("hidden");
    document.getElementById("main-screen")?.classList.remove("hidden");

    persistSessionBackup("zingTalkTvSession", JSON.stringify(user));

    const displayName = user.displayName || (user.email ? user.email.split("@")[0] : "TV User");
    if (document.getElementById("my-name")) document.getElementById("my-name").innerText = displayName;
    if (document.getElementById("my-avatar")) document.getElementById("my-avatar").innerText = displayName.charAt(0).toUpperCase();

    // Close any previous open chat and clear message area so no old user's chat leaks!
    closeChat();
    const messagesArea = document.getElementById("messages-area");
    if (messagesArea) messagesArea.innerHTML = "";

    // Server-Authoritative UID: Do NOT generate fake local math UID.
    // Wait strictly for server response.
    if (!my10DigitUid) {
        updateUidDisplays(null); // Displays "UID: Connecting..."
    }

    if (socket && socket.connected) {
        socket.emit("login_user", {
            email: user.email,
            name: displayName,
            authUid: user.uid,
            uid: my10DigitUid,
            contacts: myContacts
        });
        if (my10DigitUid) {
            socket.emit("sync_contacts", { uid: my10DigitUid, contacts: myContacts });
        }
    } else {
        connectSocket();
    }

    renderContacts(myContacts);
    autoFocusFirstElement();
}

function logoutUserSession() {
    // 1. Notify server of logout
    if (socket && socket.connected && my10DigitUid) {
        try {
            socket.emit("logout_user", { uid: my10DigitUid });
        } catch (_) {}
    }

    // 2. Disconnect socket completely to tear down old rooms and mappings
    if (socket) {
        try { socket.disconnect(); } catch (_) {}
        socket = null;
    }

    // 3. Clear all in-memory user variables
    currentUser = null;
    my10DigitUid = null;
    currentTargetUid = null;
    chatHistory = {};
    myContacts = [];
    unreadCounts = {};

    // 4. Clear storage
    localStorage.removeItem("zingTalkTvSession");
    if (window.Capacitor?.Plugins?.Preferences) {
        window.Capacitor.Plugins.Preferences.remove({ key: "zingTalkTvSession" }).catch(() => {});
    }
    if (auth) {
        signOut(auth).catch(() => {});
    }

    // 5. Clean DOM elements
    closeChat();
    const messagesArea = document.getElementById("messages-area");
    if (messagesArea) messagesArea.innerHTML = "";
    const contactsList = document.getElementById("contacts-list");
    if (contactsList) contactsList.innerHTML = "";
    const myNameEl = document.getElementById("my-name");
    if (myNameEl) myNameEl.innerText = "TV User";
    const myAvatarEl = document.getElementById("my-avatar");
    if (myAvatarEl) myAvatarEl.innerText = "U";
    updateUidDisplays(null);

    // 6. Navigation
    document.getElementById("profile-modal")?.classList.add("hidden");
    document.getElementById("main-screen")?.classList.add("hidden");
    document.getElementById("tv-top-bar")?.classList.add("hidden");
    document.getElementById("login-screen")?.classList.remove("hidden");
    const loginError = document.getElementById("login-error");
    if (loginError) loginError.style.display = "none";
    
    showToast("Signed out successfully");
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

export function updateServerStatusBadge(connected, text) {
    const badges = document.querySelectorAll(".server-status-pill");
    badges.forEach(b => {
        const dot = b.querySelector(".server-status-dot");
        const txt = b.querySelector(".server-status-text");
        if (connected) {
            if (dot) {
                dot.style.background = "#00d29d";
                dot.style.boxShadow = "0 0 8px #00d29d";
            }
            if (txt) {
                txt.style.color = "#00d29d";
                txt.innerText = text || "AWS Cloud Online";
            }
            b.style.borderColor = "rgba(0, 210, 157, 0.4)";
        } else {
            if (dot) {
                dot.style.background = "#ff4444";
                dot.style.boxShadow = "0 0 8px #ff4444";
            }
            if (txt) {
                txt.style.color = "#ff8888";
                txt.innerText = text || "Connecting...";
            }
            b.style.borderColor = "rgba(255, 68, 68, 0.4)";
        }
    });
}

// ----------------- Socket Signaling & Alexa Webhook Commands -----------------
export function registerSocketListeners(s) {
    if (!s) return;

    s.on("connect", () => {
        console.log("[ZingTalk Socket] Connected to:", s.io.uri);
        updateServerStatusBadge(true, "AWS Cloud Online");

        const displayName = currentUser?.displayName || currentUser?.name || "TV User";
        const email = currentUser?.email || null;
        const authUid = currentUser?.uid || null;

        s.emit("login_user", {
            email: email,
            name: displayName,
            authUid: authUid,
            uid: my10DigitUid,
            contacts: myContacts
        });
        if (my10DigitUid) {
            s.emit("sync_contacts", { uid: my10DigitUid, contacts: myContacts });
        }

        if (pendingOutgoingMessages.length > 0) {
            pendingOutgoingMessages.forEach(msg => s.emit("send_message", msg));
            pendingOutgoingMessages = [];
        }
    });

    s.on("disconnect", (reason) => {
        console.warn("[ZingTalk Socket] Disconnected:", reason);
        updateServerStatusBadge(false, "Reconnecting...");
    });

    s.on("connect_error", (err) => {
        console.warn("[ZingTalk Socket] Connect error:", err.message);
        updateServerStatusBadge(false, "Connecting to AWS...");
    });

    s.on("user_data", (data) => {
        if (data && data.uid) {
            updateUidDisplays(data.uid);
            loadUserStorageData(data.uid);
        }
        if (data && data.contacts && Array.isArray(data.contacts) && data.contacts.length > 0) {
            myContacts = data.contacts;
            saveUserContactsToStorage();
        }
        renderContacts(myContacts);
        if (my10DigitUid) {
            s.emit("sync_contacts", { uid: my10DigitUid, contacts: myContacts });
        }
    });

    s.on("contact_saved", (contacts) => {
        if (Array.isArray(contacts)) {
            myContacts = contacts;
            saveUserContactsToStorage();
            renderContacts(myContacts);
            if (my10DigitUid) {
                s.emit("sync_contacts", { uid: my10DigitUid, contacts: myContacts });
            }
            showToast("Contact saved successfully");
        }
    });

    s.on("contact_error", (msg) => {
        showToast(msg);
    });

    s.on("receive_message", (data) => {
        const sender = data && data.senderUid ? String(data.senderUid).trim() : null;
        if (!sender) return;
        const senderName = data.senderName || ("User " + sender);

        // 1. WhatsApp Contact Logic:
        // If sender is NOT in myContacts, automatically add them to recent contacts list!
        let knownContact = myContacts.find(c => c.uid === sender);
        if (!knownContact) {
            knownContact = { uid: sender, name: senderName };
            myContacts.unshift(knownContact);
            saveUserContactsToStorage();
            if (my10DigitUid) {
                s.emit("sync_contacts", { uid: my10DigitUid, contacts: myContacts });
            }
            saveContactToFirebase(sender, senderName);
        } else {
            // Move conversation to the top of the contact list
            myContacts = [knownContact, ...myContacts.filter(c => c.uid !== sender)];
            saveUserContactsToStorage();
        }

        // 2. Save strictly locally in device (zero retention on server or Firebase)
        if (!chatHistory[sender]) chatHistory[sender] = [];
        chatHistory[sender].push({ ...data, type: "msg-received" });
        saveUserHistoryToStorage();

        // 3. Play incoming sound chime
        playIncomingChime();

        // 4. WhatsApp / TV Non-Intrusive Display Logic:
        // Do NOT automatically force open the chat window!
        if (currentTargetUid === sender) {
            // ONLY if user currently has this exact conversation open on screen, append message!
            appendMessage(data, "msg-received");
            unreadCounts[sender] = 0;
            saveUserUnreadToStorage();
        } else {
            // Increment unread count for this sender so the unread counter badge (1, 2, ...) appears on their contact card!
            unreadCounts[sender] = (unreadCounts[sender] || 0) + 1;
            saveUserUnreadToStorage();
            
            // Show toast preview notification
            showToast(`💬 ${knownContact.name} (${sender}): "${data.text ? data.text.slice(0, 30) : ''}"`);
        }

        // Re-render contacts list immediately so the badge count, last message snippet, and updated order reflect!
        renderContacts(myContacts);

        s.emit("message_seen", { receiverUid: my10DigitUid, msgId: data.id });
    });

    s.on("message_error", (data) => {
        const msg = data && data.message ? data.message : "Message delivery failed.";
        showToast("❌ " + msg);
        const messagesArea = document.getElementById("messages-area");
        if (messagesArea && currentTargetUid) {
            const errDiv = document.createElement("div");
            errDiv.style.cssText = "text-align: center; color: #ff5252; font-size: 13px; font-weight: 600; padding: 8px 14px; margin: 10px auto; background: rgba(255, 82, 82, 0.15); border: 1px solid rgba(255, 82, 82, 0.35); border-radius: 8px; max-width: 85%;";
            errDiv.innerText = "⚠️ " + msg;
            messagesArea.appendChild(errDiv);
            messagesArea.scrollTop = messagesArea.scrollHeight;
        }
    });

    s.on("call_error", (data) => {
        const msg = data && data.message ? data.message : "Call failed.";
        showToast("❌ " + msg);
        stopRingtone();
        document.getElementById("outgoing-call-overlay")?.classList.add("hidden");
        document.getElementById("incoming-call-overlay")?.classList.add("hidden");
        isCallInitiating = false;
        activeCallTarget = null;
        endCallCleanup();
    });

    s.on("uid_check_result", (data) => {
        if (!data.valid) {
            showToast("❌ " + (data.message || "UID not found."));
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
        startRingtone();
    });

    s.on("call_cancelled", () => {
        stopRingtone();
        document.getElementById("incoming-call-overlay")?.classList.add("hidden");
        document.getElementById("outgoing-call-overlay")?.classList.add("hidden");
        activeCallTarget = null;
        isCallInitiating = false;
        endCallCleanup();
        showToast("Call cancelled");
    });

    s.on("call_response_received", async (data) => {
        stopRingtone();
        document.getElementById("outgoing-call-overlay")?.classList.add("hidden");
        if (data.status === "accepted") {
            await startWebRTC(true);
        } else {
            showToast("Call declined");
            activeCallTarget = null;
            isCallInitiating = false;
            endCallCleanup();
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
        card.dataset.uid = contact.uid;

        // WhatsApp Unread Counter for this contact
        const unread = unreadCounts[contact.uid] || 0;
        
        // Latest message snippet from device local history
        const history = chatHistory[contact.uid] || [];
        const lastMsg = history.length > 0 ? history[history.length - 1] : null;
        const lastText = lastMsg ? (lastMsg.text || "") : "";
        const lastTime = lastMsg ? (lastMsg.timestamp || "") : "";

        card.innerHTML = `
            <div class="tv-contact-info-block" style="flex: 1; min-width: 0;">
                <div class="tv-avatar-circle" style="position: relative;">
                    ${(contact.name || "U").charAt(0).toUpperCase()}
                </div>
                <div style="flex: 1; min-width: 0; padding-right: 6px;">
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px;">
                        <span class="tv-contact-name-txt" style="font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(contact.name)}</span>
                        ${unread > 0 ? `<span class="tv-unread-pill" style="background: #00d29d; color: #081018; font-size: 11px; font-weight: 800; border-radius: 12px; padding: 2px 7px; min-width: 18px; text-align: center; box-shadow: 0 0 8px rgba(0,210,157,0.5);">${unread}</span>` : ''}
                    </div>
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 4px; margin-top: 2px;">
                        <span class="tv-contact-uid-txt" style="font-size: 12px; opacity: 0.75;">UID: ${contact.uid}</span>
                        ${lastTime ? `<span style="font-size: 10px; color: ${unread > 0 ? '#00d29d' : 'rgba(255,255,255,0.45)'};">${escapeHtml(lastTime)}</span>` : ''}
                    </div>
                    ${lastText ? `<div class="tv-contact-last-msg" style="font-size: 12px; color: ${unread > 0 ? '#00e5aa' : 'rgba(255,255,255,0.6)'}; font-weight: ${unread > 0 ? '600' : '400'}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 3px;">${unread > 0 ? '💬 ' : ''}${escapeHtml(lastText.slice(0, 32))}</div>` : ''}
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
    if (!contact) return;
    const uid = typeof contact === "object" ? contact.uid : contact;
    const name = (typeof contact === "object" && contact.name)
        ? contact.name
        : (myContacts.find(c => c.uid === uid)?.name || ("User " + uid));

    currentTargetUid = uid;

    // Clear unread counter for this contact when opened (WhatsApp standard)
    if (unreadCounts[uid]) {
        delete unreadCounts[uid];
        try { localStorage.setItem("zingTalkUnread", JSON.stringify(unreadCounts)); } catch (_) {}
        renderContacts(myContacts);
    }

    document.getElementById("tv-empty-stage")?.classList.add("hidden");
    document.getElementById("tv-active-chat")?.classList.remove("hidden");

    if (document.getElementById("chat-contact-name")) {
        document.getElementById("chat-contact-name").innerText = name;
    }
    if (document.getElementById("chat-contact-uid")) {
        document.getElementById("chat-contact-uid").innerText = "UID: " + uid;
    }
    if (document.getElementById("chat-avatar")) {
        document.getElementById("chat-avatar").innerText = (name || "U").charAt(0).toUpperCase();
    }

    const messagesArea = document.getElementById("messages-area");
    if (messagesArea) {
        messagesArea.innerHTML = "";
        if (chatHistory[uid]) {
            chatHistory[uid].forEach(msg => appendMessage(msg, msg.type));
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

let pendingOutgoingMessages = [];

function sendMessageLogic() {
    const input = document.getElementById("message-input");
    const text = input?.value.trim();
    if (!text || !currentTargetUid) return;

    if (!socket || !socket.connected) {
        showToast("❌ Server not connected. Waiting for AWS Cloud connection...");
        connectSocket();
        return;
    }

    if (!my10DigitUid) {
        showToast("❌ Waiting for official server UID assignment...");
        return;
    }

    if (!/^\d{10}$/.test(currentTargetUid)) {
        showToast(`❌ No user found with UID [${currentTargetUid}]. Please check the 10-digit number.`);
        return;
    }

    if (currentTargetUid === my10DigitUid) {
        showToast(`❌ You cannot send a message to your own UID [${currentTargetUid}].`);
        return;
    }

    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const myName = currentUser?.displayName || currentUser?.name || ("User " + my10DigitUid);
    const msgData = {
        id: "msg_" + Date.now(),
        senderUid: my10DigitUid,
        senderName: myName,
        receiverUid: currentTargetUid,
        text: text,
        timestamp: timeStr
    };

    appendMessage(msgData, "msg-sent");

    if (!chatHistory[currentTargetUid]) chatHistory[currentTargetUid] = [];
    chatHistory[currentTargetUid].push({ ...msgData, type: "msg-sent" });
    try {
        localStorage.setItem("zingTalkHistory", JSON.stringify(chatHistory));
    } catch (_) {}

    input.value = "";

    if (socket && socket.connected) {
        socket.emit("send_message", msgData);
    } else {
        showToast("⚠️ Connecting to AWS Cloud... Message will be delivered upon connection.");
        pendingOutgoingMessages.push(msgData);
        connectSocket();
    }
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

// Screen WakeLock for Android TV / Mobile (Prevents OEM Background Sleep & Media Disconnect)
let wakeLock = null;
async function acquireScreenWakeLock() {
    try {
        if ('wakeLock' in navigator && navigator.wakeLock) {
            wakeLock = await navigator.wakeLock.request('screen');
            wakeLock.addEventListener('release', () => {
                wakeLock = null;
            });
        }
    } catch (_) {}
}

function releaseScreenWakeLock() {
    if (wakeLock) {
        try { wakeLock.release(); } catch (_) {}
        wakeLock = null;
    }
}

// App Surface Lifecycle Handler (Prevents Minimization Video Freeze, HDMI Focus Loss, and GPU Context Loss)
function resumeMediaPlayback() {
    const remote = document.getElementById("remote-video");
    const local = document.getElementById("local-video");
    if (remote && remote.srcObject && remote.paused) {
        remote.play().catch(() => {});
    }
    if (local && local.srcObject && local.paused) {
        local.play().catch(() => {});
    }
    if (peerConnection) {
        acquireScreenWakeLock();
    }
}

document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
        resumeMediaPlayback();
    }
});

window.addEventListener("focus", () => {
    resumeMediaPlayback();
});

// Audio Hardware Hotplug Handler (Prevents Bug 69: Audio Jack Hotplug Crash)
if (navigator.mediaDevices && 'ondevicechange' in navigator.mediaDevices) {
    navigator.mediaDevices.ondevicechange = () => {
        resumeMediaPlayback();
    };
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

    // Acquire WakeLock so CPU & screen stay active during call
    await acquireScreenWakeLock();

    // Resilient Hardware Media Ladder:
    // 1. Mono, 48kHz, full software AEC + ANS + AGC (prevents TV howl and robot voice)
    // 2. 720p 30fps safe bounds (Safe for TV MediaCodec hardware decoders)
    const audioConstraints = {
        echoCancellation: { ideal: true },
        noiseSuppression: { ideal: true },
        autoGainControl: { ideal: true },
        channelCount: { ideal: 1 },
        sampleRate: { ideal: 48000 }
    };

    let streamObtained = null;
    if (currentCallType === "video") {
        try {
            streamObtained = await navigator.mediaDevices.getUserMedia({
                audio: audioConstraints,
                video: { width: { ideal: 1280, max: 1920 }, height: { ideal: 720, max: 1080 }, frameRate: { ideal: 30, max: 30 } }
            });
        } catch (vidErr) {
            console.warn("[WebRTC] Video media request failed, attempting standard video fallback:", vidErr);
            try {
                streamObtained = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: true });
            } catch (fallbackErr) {
                console.warn("[WebRTC] Camera unavailable on this device, gracefully falling back to Audio Call:", fallbackErr);
                currentCallType = "audio";
                showToast("Camera not available on this device. Switched to HD Audio Call.");
            }
        }
    }

    if (!streamObtained) {
        try {
            streamObtained = await navigator.mediaDevices.getUserMedia({
                audio: audioConstraints,
                video: false
            });
        } catch (audErr) {
            showToast("Microphone access required: " + audErr.message);
            endCall();
            return;
        }
    }
    localStream = streamObtained;

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

    if (localVideo && currentCallType === "video") {
        localVideo.srcObject = localStream;
        localVideo.play().catch(() => {});
    }

    peerConnection = new RTCPeerConnection(rtcConfig);
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    // Dynamic bandwidth floor and balanced resolution degradation (Prevents Minecraft pixels & MTU drops)
    try {
        const senders = peerConnection.getSenders();
        const videoSender = senders.find(s => s.track && s.track.kind === "video");
        if (videoSender && videoSender.getParameters) {
            const params = videoSender.getParameters();
            if (params) {
                if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
                params.degradationPreference = "balanced";
                params.encodings[0].maxBitrate = 2500000;
                params.encodings[0].minBitrate = 350000;
                videoSender.setParameters(params).catch(() => {});
            }
        }
    } catch (_) {}

    // Universal Codec Prioritization: VP8 & H.264 first (Prevents Bug 74: H.265 reject & Bug 75: VP9 CPU spikes)
    try {
        if ('RTCRtpSender' in window && 'getCapabilities' in RTCRtpSender) {
            const capabilities = RTCRtpSender.getCapabilities('video');
            if (capabilities && capabilities.codecs) {
                const sortedCodecs = [...capabilities.codecs].sort((a, b) => {
                    const aMime = (a.mimeType || "").toLowerCase();
                    const bMime = (b.mimeType || "").toLowerCase();
                    if (aMime.includes("vp8") || aMime.includes("h264")) return -1;
                    if (bMime.includes("vp8") || bMime.includes("h264")) return 1;
                    return 0;
                });
                peerConnection.getTransceivers().forEach(t => {
                    if (t.setCodecPreferences) {
                        try { t.setCodecPreferences(sortedCodecs); } catch (_) {}
                    }
                });
            }
        }
    } catch (_) {}

    peerConnection.ontrack = (event) => {
        const remote = document.getElementById("remote-video");
        if (remote) {
            remote.srcObject = event.streams[0];
            remote.play().catch(() => {});
            // Audio focus recovery: if OS transiently pauses remote playback (e.g. alarm/notification), auto-resume
            remote.onpause = () => {
                if (peerConnection && (peerConnection.iceConnectionState === "connected" || peerConnection.iceConnectionState === "completed")) {
                    remote.play().catch(() => {});
                }
            };
            // GPU context or buffer stall recovery (Bug 53 & 55)
            remote.onstalled = () => {
                if (peerConnection && (peerConnection.iceConnectionState === "connected" || peerConnection.iceConnectionState === "completed")) {
                    remote.play().catch(() => {});
                }
            };
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
    releaseScreenWakeLock();

    // 1. Unbind and safely close PeerConnection (prevents SIGSEGV / JNI / Context Leaks)
    if (peerConnection) {
        try {
            peerConnection.ontrack = null;
            peerConnection.onicecandidate = null;
            peerConnection.oniceconnectionstatechange = null;
            peerConnection.onicecandidateerror = null;
            peerConnection.onnegotiationneeded = null;
            peerConnection.close();
        } catch (_) {}
        peerConnection = null;
    }

    // 2. Stop and release all hardware camera/mic tracks
    if (localStream) {
        localStream.getTracks().forEach(track => {
            try {
                track.stop();
                localStream.removeTrack(track);
            } catch (_) {}
        });
        localStream = null;
    }

    // 3. Clear video element surfaces so OpenGL EglBase surfaces are cleanly released
    const remoteVideo = document.getElementById("remote-video");
    if (remoteVideo) {
        try { remoteVideo.pause(); remoteVideo.srcObject = null; } catch (_) {}
    }
    const localVideo = document.getElementById("local-video");
    if (localVideo) {
        try { localVideo.pause(); localVideo.srcObject = null; } catch (_) {}
    }

    activeCallTarget = null;
    isCallInitiating = false;
    iceCandidatesQueue = [];
    document.getElementById("full-call-screen")?.classList.add("hidden");
    document.getElementById("audio-call-visualizer")?.classList.add("hidden");
    document.getElementById("outgoing-call-overlay")?.classList.add("hidden");
    document.getElementById("incoming-call-overlay")?.classList.add("hidden");
}

function endCall() {
    if (socket && activeCallTarget) {
        socket.emit("webrtc_end_call", { targetUid: activeCallTarget });
    }
    endCallCleanup();
}

let isCallInitiating = false;

async function initiateDirectCall(targetUid, type) {
    if (!targetUid) return;
    if (!socket || !socket.connected) {
        showToast("❌ Server not connected. Please wait for AWS Cloud connection.");
        connectSocket();
        return;
    }
    if (!my10DigitUid) {
        showToast("❌ Waiting for official server UID assignment...");
        return;
    }
    if (targetUid === my10DigitUid) {
        showToast("❌ You cannot call your own UID");
        return;
    }
    if (isCallInitiating || peerConnection) {
        return;
    }

    currentCallType = type || "video";

    // 1. Request hardware permissions so the device/Android OS prompts the user with the system dialog!
    try {
        const testStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: currentCallType === "video"
        });
        testStream.getTracks().forEach(t => t.stop());
    } catch (permErr) {
        console.warn("[Media Permission Error]:", permErr);
        showToast("❌ Camera/Microphone permission required for call: " + (permErr.message || "Permission denied"));
        return;
    }

    isCallInitiating = true;
    setTimeout(() => { isCallInitiating = false; }, 2000);

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

    socket.emit("initiate_call", {
        callerUid: my10DigitUid,
        targetUid: targetUid,
        callerName: currentUser ? (currentUser.displayName || currentUser.name) : ("User " + my10DigitUid),
        type: currentCallType
    });
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

let backPressCount = 0;
let backPressTimer = null;

function handleBackKey(canGoBack) {
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

    // Graceful double-back exit to prevent accidental kills on TV/Phone
    backPressCount++;
    if (backPressCount === 1) {
        showToast("Press Back again to exit ZingTalk");
        clearTimeout(backPressTimer);
        backPressTimer = setTimeout(() => {
            backPressCount = 0;
        }, 2000);
    } else {
        if (window.Capacitor?.Plugins?.App?.exitApp) {
            window.Capacitor.Plugins.App.exitApp();
        }
    }
}

// Capacitor Native Hardware Back Button Event (Prevents Bug 44: Accidental Exit)
if (window.Capacitor?.Plugins?.App) {
    window.Capacitor.Plugins.App.addListener('backButton', ({ canGoBack }) => {
        handleBackKey(canGoBack);
    });
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
    } else if (e.key === "Escape" || e.keyCode === 4 || e.keyCode === 10009 || e.key === "GoBack" || e.key === "Back" || (e.key === "Backspace" && !isTyping)) {
        e.preventDefault();
        handleBackKey();
    }
});

// ----------------- Global Clicks & UI Triggers -----------------
let isSignUpMode = false;

document.addEventListener("click", async (e) => {
    if (e.target.tagName === "BUTTON") e.preventDefault();

    // 1. Login Tabs Switching (Email & Password / Guest Mode)
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

    // Forgot Password Link Click
    if (e.target.id === "forgot-password-link") {
        const loginEmail = document.getElementById("login-email-input")?.value.trim() || "";
        const resetInput = document.getElementById("reset-email-input");
        const statusEl = document.getElementById("reset-status-message");
        if (resetInput) resetInput.value = loginEmail;
        if (statusEl) {
            statusEl.style.display = "none";
            statusEl.innerText = "";
        }
        document.getElementById("forgot-password-modal")?.classList.remove("hidden");
        resetInput?.focus();
        return;
    }

    // Close Forgot Password Modal
    if (e.target.id === "close-forgot-modal-btn" || e.target.id === "cancel-reset-btn") {
        document.getElementById("forgot-password-modal")?.classList.add("hidden");
        document.getElementById("login-password-input")?.focus();
        return;
    }

    // Send Password Reset Link Action
    if (e.target.id === "send-reset-link-btn" || e.target.closest("#send-reset-link-btn")) {
        const email = document.getElementById("reset-email-input")?.value.trim();
        const statusEl = document.getElementById("reset-status-message");
        if (statusEl) statusEl.style.display = "none";

        if (!email) {
            if (statusEl) {
                statusEl.innerText = "Please enter your registered email address.";
                statusEl.style.display = "block";
            }
            return;
        }

        if (!auth) {
            if (statusEl) {
                statusEl.innerText = "Authentication service is currently offline. Please try again later.";
                statusEl.style.display = "block";
            }
            return;
        }

        try {
            showToast("Sending reset link...");
            await sendPasswordResetEmail(auth, email);
            if (statusEl) {
                statusEl.innerHTML = `<span style="color: #00d29d; font-weight: 700;">✅ Password reset email sent! Check your inbox and spam folder.</span>`;
                statusEl.style.display = "block";
            }
            showToast("Reset email sent to " + email);
            setTimeout(() => {
                document.getElementById("forgot-password-modal")?.classList.add("hidden");
                document.getElementById("login-password-input")?.focus();
            }, 3200);
        } catch (err) {
            console.error("[Password Reset Error]:", err);
            let msg = err.message || "Failed to send password reset email.";
            if (err.code === "auth/user-not-found") {
                msg = "No registered account found with this email.";
            } else if (err.code === "auth/invalid-email") {
                msg = "Please enter a valid email address.";
            }
            if (statusEl) {
                statusEl.innerText = msg;
                statusEl.style.display = "block";
            }
            showToast(msg);
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

    // Guest Mode Login Action (Official Firebase Anonymous Authentication)
    if (e.target.id === "guest-login-btn" || e.target.closest("#guest-login-btn")) {
        const nameInput = document.getElementById("guest-name-input");
        const name = nameInput?.value.trim() || "Guest User";
        const errorEl = document.getElementById("login-message");
        if (errorEl) errorEl.style.display = "none";

        // Check if running in Native Capacitor Android App
        if (window.Capacitor?.isNativePlatform && window.Capacitor.isNativePlatform() && window.Capacitor.Plugins?.FirebaseAuthentication) {
            try {
                showToast("Connecting to server...");
                const result = await window.Capacitor.Plugins.FirebaseAuthentication.signInAnonymously();
                if (result && result.user) {
                    const user = {
                        displayName: name,
                        email: null,
                        uid: result.user.uid,
                        isAnonymous: true
                    };
                    localStorage.setItem("zingTalkTvSession", JSON.stringify(user));
                    loginUserSession(user);
                    showToast(`Welcome ${name}!`);
                    return;
                }
            } catch (nativeErr) {
                console.warn("[Firebase] Native Anonymous Auth failed:", nativeErr);
            }
        }

        // Web / Browser Official Firebase Anonymous Authentication
        if (auth) {
            try {
                showToast("Connecting to server...");
                const cred = await signInAnonymously(auth);
                if (name) {
                    try { await updateProfile(cred.user, { displayName: name }); } catch (_) {}
                }
                const user = {
                    displayName: name || cred.user.displayName || "Guest User",
                    email: null,
                    uid: cred.user.uid,
                    isAnonymous: true
                };
                localStorage.setItem("zingTalkTvSession", JSON.stringify(user));
                loginUserSession(user);
                showToast(`Welcome ${name}!`);
            } catch (err) {
                console.error("[Firebase Anonymous Auth Error]:", err);
                const msg = err.message || "Failed to sign in as guest via Firebase.";
                if (errorEl) {
                    errorEl.innerText = msg;
                    errorEl.style.display = "block";
                }
                showToast(msg);
            }
        } else {
            const guestId = "guest_" + Date.now();
            const user = {
                displayName: name,
                email: null,
                uid: guestId,
                isAnonymous: true
            };
            localStorage.setItem("zingTalkTvSession", JSON.stringify(user));
            loginUserSession(user);
        }
        return;
    }

    // Direct Dial Quick Connect (Chat / Audio / Video)
    if (e.target.id === "quick-chat-btn" || e.target.closest("#quick-chat-btn")) {
        const uid = document.getElementById("dial-uid-input")?.value.trim().replace(/\D/g, '');
        if (!uid || uid.length !== 10) {
            showToast("❌ Please enter a valid 10-digit UID");
            return;
        }
        if (uid === my10DigitUid) {
            showToast(`❌ You cannot chat with your own UID [${uid}].`);
            return;
        }
        const known = myContacts.find(c => c.uid === uid);
        const contactObj = known || { uid: uid, name: "User " + uid };
        openChat(contactObj);
        return;
    }

    if (e.target.id === "quick-audio-call-btn" || e.target.closest("#quick-audio-call-btn")) {
        const uid = document.getElementById("dial-uid-input")?.value.trim().replace(/\D/g, '');
        if (!uid || uid.length !== 10) {
            showToast("❌ Please enter a valid 10-digit UID");
            return;
        }
        if (uid === my10DigitUid) {
            showToast(`❌ You cannot call your own UID [${uid}].`);
            return;
        }
        initiateDirectCall(uid, "audio");
        return;
    }

    if (e.target.id === "quick-video-call-btn" || e.target.closest("#quick-video-call-btn")) {
        const uid = document.getElementById("dial-uid-input")?.value.trim().replace(/\D/g, '');
        if (!uid || uid.length !== 10) {
            showToast("❌ Please enter a valid 10-digit UID");
            return;
        }
        if (uid === my10DigitUid) {
            showToast(`❌ You cannot call your own UID [${uid}].`);
            return;
        }
        initiateDirectCall(uid, "video");
        return;
    }

    // Save Contact
    if (e.target.id === "save-contact-btn" || e.target.closest("#save-contact-btn")) {
        const uid = document.getElementById("contact-uid-input")?.value.trim().replace(/\D/g, '');
        const name = document.getElementById("contact-name-input")?.value.trim();

        if (!uid || uid.length !== 10) {
            showToast("❌ Please enter a valid 10-digit UID");
            return;
        }
        if (!name) {
            showToast("❌ Please enter a contact name");
            return;
        }
        if (uid === my10DigitUid) {
            showToast("❌ You cannot save your own UID");
            return;
        }

        const newContact = { uid, name };
        const updated = myContacts.filter(c => c.uid !== uid);
        updated.push(newContact);
        myContacts = updated;
        localStorage.setItem("zingTalkContacts", JSON.stringify(myContacts));
        renderContacts(myContacts);
        showToast(`✅ Saved contact: ${name}`);

        if (socket && socket.connected) {
            socket.emit("save_contact", { myUid: my10DigitUid, targetUid: uid, customName: name });
        }

        if (document.getElementById("contact-uid-input")) document.getElementById("contact-uid-input").value = "";
        if (document.getElementById("contact-name-input")) document.getElementById("contact-name-input").value = "";

        // Automatically open the chat with this new contact right away!
        openChat(newContact);
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
        stopRingtone();
        document.getElementById("incoming-call-overlay")?.classList.add("hidden");
        try {
            await startWebRTC(false);
            if (socket) socket.emit("call_response", { targetUid: activeCallTarget, status: "accepted" });
        } catch (err) {
            console.error("[Call Accept Error]:", err);
            showToast("Failed to start media: " + err.message);
            if (socket) socket.emit("call_response", { targetUid: activeCallTarget, status: "rejected" });
            activeCallTarget = null;
            endCallCleanup();
        }
        return;
    }

    if (e.target.id === "reject-call-btn" || e.target.closest("#reject-call-btn")) {
        stopRingtone();
        document.getElementById("incoming-call-overlay")?.classList.add("hidden");
        if (socket && activeCallTarget) {
            socket.emit("call_response", { targetUid: activeCallTarget, status: "rejected" });
        }
        activeCallTarget = null;
        endCallCleanup();
        return;
    }

    if (e.target.id === "cancel-outgoing-btn" || e.target.closest("#cancel-outgoing-btn") || e.target.id === "cancel-outgoing-call-btn" || e.target.closest("#cancel-outgoing-call-btn")) {
        stopRingtone();
        document.getElementById("outgoing-call-overlay")?.classList.add("hidden");
        if (socket && activeCallTarget) {
            socket.emit("cancel_call", { targetUid: activeCallTarget });
        }
        activeCallTarget = null;
        isCallInitiating = false;
        endCallCleanup();
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
    if (e.target.id === "open-policy-btn" || e.target.id === "sidebar-policy-btn" || e.target.id === "profile-policy-btn" || e.target.closest(".tv-policy-btn-trigger")) {
        document.getElementById("profile-modal")?.classList.add("hidden");
        document.getElementById("policy-modal")?.classList.remove("hidden");
        return;
    }

    if (e.target.id === "close-policy-btn" || e.target.id === "policy-ok-btn") {
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
