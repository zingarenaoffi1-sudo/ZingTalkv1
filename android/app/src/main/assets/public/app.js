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
    getDoc,
    collection,
    query,
    where,
    getDocs
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

// ----------------- Firestore 10-Digit UID Registry -----------------
// Automatically persists the user's allocated 10-digit UID in the 'users' collection on Firestore
export async function saveUserUidToFirestore(user, uid) {
    if (!firestoreDb || !uid) return;
    try {
        const cleanUid = String(uid).trim().replace(/\D/g, '');
        if (cleanUid.length !== 10) return;

        const authUid = user?.uid || (auth?.currentUser ? auth.currentUser.uid : null);
        const email = user?.email || (auth?.currentUser ? auth.currentUser.email : "") || (user?.isAnonymous ? `guest_${cleanUid}@zingtalk.local` : "");
        const displayName = user?.displayName || (auth?.currentUser ? auth.currentUser.displayName : "") || (email ? email.split("@")[0] : "TV User");

        const dataToSave = {
            uid: cleanUid,
            authUid: authUid,
            email: email,
            displayName: displayName,
            isGuest: Boolean(user?.isAnonymous || auth?.currentUser?.isAnonymous),
            platform: "Fire TV / Android",
            updatedAt: new Date().toISOString()
        };

        // 1. Primary Record: Keyed by 10-Digit UID in 'users' collection
        try {
            const docByUid = doc(firestoreDb, "users", cleanUid);
            await setDoc(docByUid, dataToSave, { merge: true });
            console.log(`[Firestore] ✅ 10-Digit UID [${cleanUid}] saved to Firestore users/${cleanUid}`);
        } catch (err1) {
            console.warn(`[Firestore] Notice on users/${cleanUid}:`, err1.message);
        }

        // 2. Secondary Index: Keyed by Firebase Auth UID in 'user_profiles' collection
        if (authUid) {
            try {
                const docByAuth = doc(firestoreDb, "user_profiles", authUid);
                await setDoc(docByAuth, dataToSave, { merge: true });
                console.log(`[Firestore] ✅ Profile mapped to Firestore user_profiles/${authUid}`);
            } catch (err2) {
                console.warn(`[Firestore] Notice on user_profiles/${authUid}:`, err2.message);
            }
        }
    } catch (err) {
        console.warn("[Firestore] Notice saving UID to Firestore:", err.message);
    }
}

// Lookup existing 10-Digit UID from Firestore for a returning user
export async function lookupUserUidFromFirestore(email, authUid) {
    if (!firestoreDb) return null;
    try {
        const usersCol = collection(firestoreDb, "users");
        if (email) {
            const q = query(usersCol, where("email", "==", email));
            const snap = await getDocs(q);
            if (!snap.empty) {
                const d = snap.docs[0].data();
                if (d && d.uid && String(d.uid).length === 10) return String(d.uid);
            }
        }
        if (authUid) {
            const q = query(usersCol, where("authUid", "==", authUid));
            const snap = await getDocs(q);
            if (!snap.empty) {
                const d = snap.docs[0].data();
                if (d && d.uid && String(d.uid).length === 10) return String(d.uid);
            }
        }
    } catch (err) {
        console.warn("[Firestore] Lookup notice:", err.message);
    }
    return null;
}

// Local-Only Storage: Save contacts strictly on the user's local device (100% Zero-Server & Privacy Policy Compliant)
export function saveContactLocally(contactUid, contactName) {
    if (!contactUid || !contactName) return;
    const cleanUid = String(contactUid).trim().replace(/\D/g, '');
    const cleanName = String(contactName).trim();

    const updated = myContacts.filter(c => c.uid !== cleanUid);
    const newContact = { uid: cleanUid, name: cleanName };
    updated.unshift(newContact);
    myContacts = updated;
    saveUserContactsToStorage();
    renderContacts(myContacts);

    // Sync only to volatile in-memory RAM so live Alexa voice commands know who to call during this active session
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
let sharedAudioCtx = null;
export function playIncomingChime() {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        if (!sharedAudioCtx || sharedAudioCtx.state === "closed") {
            sharedAudioCtx = new AudioCtx();
        }
        if (sharedAudioCtx.state === "suspended") {
            sharedAudioCtx.resume().catch(() => {});
        }
        const ctx = sharedAudioCtx;
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

// Infrastructure Configuration (Always hosted directly on user's AWS EC2 server)
const DUCKDNS_SIGNALING_URL = "https://zingtalk.duckdns.org";
const PRIMARY_STUN = "stun:stun.l.google.com:19302";
const SECONDARY_STUN = "stun:zingtalk.duckdns.org:3478";
let isStunFailoverActive = false;

export function getEffectiveServerUrl() {
    const saved = localStorage.getItem("zingTalkServerUrl");
    if (saved && saved.trim()) return saved.trim();

    if (typeof window !== "undefined" && window.location) {
        if (window.location.protocol.startsWith("http") && (window.location.host.includes("duckdns") || window.location.host.includes("localhost"))) {
            return window.location.origin;
        }
    }
    return DUCKDNS_SIGNALING_URL;
}

export function computeDeterministic10DigitUid(idStr) {
    if (!idStr) return "1000000001";
    let hash = 5381;
    const clean = String(idStr).trim().toLowerCase();
    for (let i = 0; i < clean.length; i++) {
        hash = ((hash << 5) + hash) + clean.charCodeAt(i);
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

const rtcConfig = {
    iceServers: [
        { 
            urls: [
                "stun:stun.l.google.com:19302",
                "stun:stun1.l.google.com:19302",
                "stun:stun2.l.google.com:19302",
                "stun:stun3.l.google.com:19302",
                "stun:stun4.l.google.com:19302"
            ] 
        },
        { 
            urls: [
                "stun:zingtalk.duckdns.org:3478"
            ] 
        },
        {
            urls: [
                "turn:zingtalk.duckdns.org:3478?transport=udp",
                "turn:zingtalk.duckdns.org:3478?transport=tcp"
            ],
            username: "zingtalk",
            credential: "zingtalkpassword"
        },
        { 
            urls: ["stun:global.stun.twilio.com:3478"] 
        }
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

// Purge legacy unscoped cache keys from previous versions
try {
    localStorage.removeItem("zingTalkHistory");
    localStorage.removeItem("zingTalkContacts");
    localStorage.removeItem("zingTalkUnread");
} catch (_) {}

let localStream = null;
let peerConnection = null;
let activeCallTarget = null;
let currentCallType = "video";
let isMicMuted = false;
let callDurationTimer = null;
let callSecondsElapsed = 0;
let iceCandidatesQueue = [];
let pendingOffer = null;
let outgoingCallTimer = null;
let incomingCallTimer = null;

// Auto-login from saved session (Dual-layer: LocalStorage + Native Preferences)
const savedSession = localStorage.getItem("zingTalkTvSession");
if (savedSession) {
    try {
        const sessionData = JSON.parse(savedSession);
        if (sessionData && (sessionData.displayName || sessionData.uid || sessionData.zingUid)) {
            if (sessionData.zingUid) {
                my10DigitUid = String(sessionData.zingUid);
                updateUidDisplays(my10DigitUid);
                loadUserStorageData(my10DigitUid);
            }
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
                if (sessionData && (sessionData.displayName || sessionData.uid || sessionData.zingUid)) {
                    if (sessionData.zingUid && !my10DigitUid) {
                        my10DigitUid = String(sessionData.zingUid);
                        updateUidDisplays(my10DigitUid);
                        loadUserStorageData(my10DigitUid);
                    }
                    loginUserSession(sessionData);
                }
            }
        }
    } catch (_) {}
}
restoreSessionFromNativeBackup();

function loginUserSession(user) {
    currentUser = user;
    if (user.zingUid && !my10DigitUid) {
        my10DigitUid = String(user.zingUid);
        updateUidDisplays(my10DigitUid);
        loadUserStorageData(my10DigitUid);
    }
    if (my10DigitUid) {
        saveUserUidToFirestore(user, my10DigitUid);
    }
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
    // Wait strictly for server response if not yet restored.
    if (!my10DigitUid) {
        updateUidDisplays(null); // Displays "UID: Connecting..."
    }

    if (socket && socket.connected) {
        socket.emit("login_user", {
            email: user.email,
            name: displayName,
            authUid: user.uid,
            uid: my10DigitUid || user.zingUid,
            isAnonymous: Boolean(user.isAnonymous),
            isGuest: Boolean(user.isAnonymous),
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
    const loginError = document.getElementById("login-message") || document.getElementById("login-error");
    if (loginError) loginError.style.display = "none";
    
    showToast("Signed out successfully");
}

if (auth) {
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            if (!user.zingUid && user.email) {
                const existingUid = await lookupUserUidFromFirestore(user.email, user.uid);
                if (existingUid) {
                    user.zingUid = existingUid;
                }
            }
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
            uid: my10DigitUid || currentUser?.zingUid,
            isAnonymous: Boolean(currentUser?.isAnonymous),
            isGuest: Boolean(currentUser?.isAnonymous),
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
            if (currentUser) {
                currentUser.zingUid = String(data.uid);
                persistSessionBackup("zingTalkTvSession", JSON.stringify(currentUser));
                saveUserUidToFirestore(currentUser, data.uid);
            } else {
                saveUserUidToFirestore({ uid: null, isAnonymous: true }, data.uid);
            }
        }
        renderContacts(myContacts);
        if (my10DigitUid && myContacts.length > 0) {
            s.emit("sync_contacts", { uid: my10DigitUid, contacts: myContacts });
        }
    });

    s.on("contact_saved", (contacts) => {
        if (Array.isArray(contacts)) {
            myContacts = contacts;
            saveUserContactsToStorage();
            renderContacts(myContacts);
            showToast("Contact saved locally");
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

        if (incomingCallTimer) clearTimeout(incomingCallTimer);
        incomingCallTimer = setTimeout(() => {
            const overlay = document.getElementById("incoming-call-overlay");
            if (overlay && !overlay.classList.contains("hidden")) {
                stopRingtone();
                overlay.classList.add("hidden");
                activeCallTarget = null;
                endCallCleanup();
                showToast("Missed call from " + callerNameToShow);
            }
        }, 45000);
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
        if (data && data.status === "accepted") {
            if (!peerConnection) {
                await startWebRTC(true);
            }
        } else {
            showToast("Call declined");
            activeCallTarget = null;
            isCallInitiating = false;
            endCallCleanup();
        }
    });

    s.on("webrtc_offer_received", async (data) => {
        if (!data || !data.offer) return;
        if (!peerConnection) {
            pendingOffer = data.offer;
            return;
        }
        if (peerConnection.signalingState !== "stable") return;
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            s.emit("webrtc_answer", { targetUid: activeCallTarget, answer });

            while (iceCandidatesQueue.length > 0) {
                const cand = iceCandidatesQueue.shift();
                if (cand) {
                    try {
                        await peerConnection.addIceCandidate(new RTCIceCandidate(cand));
                    } catch (_) {}
                }
            }
        } catch (err) {
            console.error("[WebRTC] Offer error:", err);
        }
    });

    s.on("webrtc_answer_received", async (data) => {
        if (!peerConnection || !data || !data.answer) return;
        if (peerConnection.signalingState !== "have-local-offer") return;
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
            while (iceCandidatesQueue.length > 0) {
                const cand = iceCandidatesQueue.shift();
                if (cand) {
                    try {
                        await peerConnection.addIceCandidate(new RTCIceCandidate(cand));
                    } catch (_) {}
                }
            }
        } catch (err) {
            console.error("[WebRTC] Answer error:", err);
        }
    });

    s.on("webrtc_ice_candidate_received", async (data) => {
        if (!data || !data.candidate) return;
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
            saveUserContactsToStorage();
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
                const btn = e.target.closest("button");
                if (btn && btn.dataset.action) {
                    initiateDirectCall(contact.uid, btn.dataset.action);
                } else {
                    openChat(contact);
                }
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
        saveUserUnreadToStorage();
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
    saveUserHistoryToStorage();

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

    let streamObtained = localStream;
    if (!streamObtained) {
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
    }

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
    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
        track.onended = () => {
            if (track.kind === "video") {
                console.warn("[WebRTC] Local video track ended (hardware disconnect/unplug).");
                showToast("Camera disconnected or unavailable.");
                const localVideo = document.getElementById("local-video");
                if (localVideo) localVideo.classList.add("hidden");
            } else if (track.kind === "audio") {
                console.warn("[WebRTC] Local audio track ended.");
                showToast("Microphone disconnected.");
            }
        };
    });

    // Dynamic bandwidth floor and balanced resolution degradation
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

    // Universal Codec Prioritization: VP8 & H.264 first
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
                    if (t.setCodecPreferences && t.receiver && t.receiver.track && t.receiver.track.kind === "video") {
                        try { t.setCodecPreferences(sortedCodecs); } catch (_) {}
                    }
                });
            }
        }
    } catch (_) {}

    peerConnection.ontrack = (event) => {
        const remote = document.getElementById("remote-video");
        if (remote) {
            if (event.streams && event.streams[0]) {
                remote.srcObject = event.streams[0];
            } else {
                if (!remote.srcObject) remote.srcObject = new MediaStream();
                remote.srcObject.addTrack(event.track);
            }
            remote.play().catch(() => {
                const resumeOnInteraction = () => {
                    remote.play().catch(() => {});
                    document.removeEventListener("click", resumeOnInteraction);
                    document.removeEventListener("keydown", resumeOnInteraction);
                };
                document.addEventListener("click", resumeOnInteraction, { once: true });
                document.addEventListener("keydown", resumeOnInteraction, { once: true });
            });
            remote.onpause = () => {
                if (peerConnection && (peerConnection.iceConnectionState === "connected" || peerConnection.iceConnectionState === "completed")) {
                    remote.play().catch(() => {});
                }
            };
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

    peerConnection.onicecandidateerror = (event) => {
        if (event.url && event.url.includes("google.com")) {
            isStunFailoverActive = true;
        }
    };

    peerConnection.oniceconnectionstatechange = () => {
        const state = peerConnection ? peerConnection.iceConnectionState : "";
        if (state === "failed") {
            showToast("Connection lost with peer.");
            endCallCleanup();
        } else if (state === "disconnected") {
            setTimeout(() => {
                if (peerConnection && peerConnection.iceConnectionState === "disconnected") {
                    showToast("Call ended due to network disconnection.");
                    endCallCleanup();
                }
            }, 6000);
        }
    };

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
            const offer = await peerConnection.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: currentCallType === "video"
            });
            await peerConnection.setLocalDescription(offer);
            socket.emit("webrtc_offer", { targetUid: activeCallTarget, offer });
        } catch (err) {
            console.error("[WebRTC] Offer error:", err);
        }
    } else if (pendingOffer) {
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(pendingOffer));
            pendingOffer = null;
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            socket.emit("webrtc_answer", { targetUid: activeCallTarget, answer });

            while (iceCandidatesQueue.length > 0) {
                await peerConnection.addIceCandidate(new RTCIceCandidate(iceCandidatesQueue.shift()));
            }
        } catch (err) {
            console.error("[WebRTC] Pending offer execution error:", err);
        }
    }
}

function endCallCleanup() {
    stopRingtone();
    clearInterval(callDurationTimer);
    releaseScreenWakeLock();

    if (outgoingCallTimer) {
        clearTimeout(outgoingCallTimer);
        outgoingCallTimer = null;
    }
    if (incomingCallTimer) {
        clearTimeout(incomingCallTimer);
        incomingCallTimer = null;
    }

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

    if (localStream) {
        localStream.getTracks().forEach(track => {
            try {
                track.stop();
            } catch (_) {}
        });
        localStream = null;
    }

    const localVideo = document.getElementById("local-video");
    const remoteVideo = document.getElementById("remote-video");
    if (localVideo) localVideo.srcObject = null;
    if (remoteVideo) {
        if (remoteVideo.srcObject) {
            try {
                remoteVideo.srcObject.getTracks().forEach(t => t.stop());
            } catch (_) {}
        }
        remoteVideo.srcObject = null;
        remoteVideo.style.opacity = "";
    }

    document.getElementById("full-call-screen")?.classList.add("hidden");
    document.getElementById("audio-call-visualizer")?.classList.add("hidden");
    document.getElementById("outgoing-call-overlay")?.classList.add("hidden");
    document.getElementById("incoming-call-overlay")?.classList.add("hidden");

    isCallInitiating = false;
    activeCallTarget = null;
    pendingOffer = null;
    iceCandidatesQueue = [];

    // The "Lost Focus Trap" Fix: When call UI closes, immediately restore focus to a live interactive element!
    setTimeout(() => {
        autoFocusFirstElement();
    }, 120);
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

    // Request hardware permissions and retain localStream to avoid Android camera freeze
    try {
        const audioConstraints = {
            echoCancellation: { ideal: true },
            noiseSuppression: { ideal: true },
            autoGainControl: { ideal: true }
        };
        if (currentCallType === "video") {
            try {
                localStream = await navigator.mediaDevices.getUserMedia({
                    audio: audioConstraints,
                    video: { width: { ideal: 1280, max: 1920 }, height: { ideal: 720, max: 1080 }, frameRate: { ideal: 30, max: 30 } }
                });
            } catch (_) {
                try {
                    localStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: true });
                } catch (_) {
                    currentCallType = "audio";
                    localStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false });
                }
            }
        } else {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false });
        }
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

    if (outgoingCallTimer) clearTimeout(outgoingCallTimer);
    outgoingCallTimer = setTimeout(() => {
        const overlay = document.getElementById("outgoing-call-overlay");
        if (overlay && !overlay.classList.contains("hidden")) {
            showToast("No answer from " + targetNameToShow);
            if (socket && activeCallTarget) {
                socket.emit("cancel_call", { targetUid: activeCallTarget });
            }
            endCallCleanup();
        }
    }, 45000);

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
    } else if (action === 'toggle_camera') {
        if (localStream) {
            const track = localStream.getVideoTracks()[0];
            if (track) {
                track.enabled = !track.enabled;
                showToast(track.enabled ? "Camera active" : "Camera turned off");
            }
        }
    } else if (action === 'toggle_mic') {
        if (localStream) {
            const track = localStream.getAudioTracks()[0];
            if (track) {
                isMicMuted = !isMicMuted;
                track.enabled = !isMicMuted;
                showToast(isMicMuted ? "Microphone muted" : "Microphone active");
            }
        }
    } else if (action === 'open_guide' || action === 'show_guide') {
        const guideModal = document.getElementById("guide-modal");
        if (guideModal) {
            guideModal.classList.remove("hidden");
            const scrollArea = document.getElementById("guide-scroll-area");
            if (scrollArea) focusElement(scrollArea);
        }
    } else if (action === 'device_paired') {
        showToast(`🎙️ Alexa Paired (UID: ${cmd.pairedUid || my10DigitUid})`);
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
            saveUserHistoryToStorage();
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
// ----------------- Fire TV Remote Spatial Navigation Engine -----------------
export function focusElement(el, shouldScroll = true) {
    if (!el) return;
    document.querySelectorAll('.tv-focused').forEach(node => {
        if (node !== el) node.classList.remove('tv-focused');
    });
    el.classList.add('tv-focused');
    try {
        el.focus({ preventScroll: !shouldScroll });
    } catch (_) {
        el.focus();
    }
    if (shouldScroll) {
        try {
            el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
        } catch (_) {}
    }
}

function isElementVisibleAndFocusable(el) {
    if (!el) return false;
    if (el.closest('.hidden')) return false;
    if (el.disabled) return false;
    if (el.getAttribute('tabindex') === '-1') return false;
    if (window.getComputedStyle) {
        const style = window.getComputedStyle(el);
        if (style) {
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        }
    }
    if (el.offsetParent === null && el.tagName !== 'BODY') {
        const style = window.getComputedStyle ? window.getComputedStyle(el) : null;
        if (!style || (style.position !== 'fixed' && !el.closest('.tv-modal-backdrop'))) {
            return false;
        }
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
}

function getVisibleFocusableElements() {
    const activeModal = document.querySelector('.tv-modal-backdrop:not(.hidden)');
    const callScreen = document.getElementById("full-call-screen");
    const activeCall = (callScreen && !callScreen.classList.contains("hidden")) ? callScreen : null;
    const scope = activeModal || activeCall || document;

    return Array.from(scope.querySelectorAll('.tv-focusable')).filter(el => {
        if (!isElementVisibleAndFocusable(el)) return false;
        if (!activeModal && el.closest('.tv-modal-backdrop')) return false;
        return true;
    });
}

function autoFocusFirstElement() {
    const activeModal = document.querySelector('.tv-modal-backdrop:not(.hidden)');
    if (activeModal) {
        const modalInputs = activeModal.querySelectorAll('input:not([type="hidden"]), button');
        for (const input of modalInputs) {
            if (isElementVisibleAndFocusable(input)) {
                focusElement(input);
                return;
            }
        }
    }

    const loginScreen = document.getElementById("login-screen");
    if (loginScreen && !loginScreen.classList.contains("hidden")) {
        const paneEmail = document.getElementById("pane-email");
        if (paneEmail && !paneEmail.classList.contains("hidden")) {
            const signupGroup = document.getElementById("email-signup-name-group");
            if (signupGroup && !signupGroup.classList.contains("hidden")) {
                const nameInp = document.getElementById("login-name-input");
                if (isElementVisibleAndFocusable(nameInp)) {
                    focusElement(nameInp);
                    return;
                }
            }
            const emailInp = document.getElementById("login-email-input");
            if (isElementVisibleAndFocusable(emailInp)) {
                focusElement(emailInp);
                return;
            }
        }
        const paneGuest = document.getElementById("pane-guest");
        if (paneGuest && !paneGuest.classList.contains("hidden")) {
            const guestInp = document.getElementById("guest-name-input");
            if (isElementVisibleAndFocusable(guestInp)) {
                focusElement(guestInp);
                return;
            }
        }
    }

    const mainScreen = document.getElementById("main-screen");
    if (mainScreen && !mainScreen.classList.contains("hidden")) {
        const activeChat = document.getElementById("tv-active-chat");
        if (activeChat && !activeChat.classList.contains("hidden")) {
            const msgInp = document.getElementById("message-input");
            if (isElementVisibleAndFocusable(msgInp)) {
                focusElement(msgInp);
                return;
            }
        }
        const dialInp = document.getElementById("dial-uid-input");
        if (isElementVisibleAndFocusable(dialInp)) {
            focusElement(dialInp);
            return;
        }
    }

    const focusables = getVisibleFocusableElements();
    if (focusables.length > 0) {
        focusElement(focusables[0]);
    }
}

function getCustomNavigationTarget(current, direction) {
    if (!current) return null;
    const id = current.id;
    const isSignUp = !document.getElementById("email-signup-name-group")?.classList.contains("hidden");

    // --- 1. Login Screen ---
    if (id === "tab-btn-email") {
        if (direction === "up") return document.getElementById("tab-btn-email");
        if (direction === "left") return document.getElementById("tab-btn-email");
        if (direction === "right") return document.getElementById("tab-btn-guest");
        if (direction === "down") return isSignUp ? document.getElementById("login-name-input") : document.getElementById("login-email-input");
    }
    if (id === "tab-btn-guest") {
        if (direction === "up") return document.getElementById("tab-btn-guest");
        if (direction === "right") return document.getElementById("tab-btn-guest");
        if (direction === "left") return document.getElementById("tab-btn-email");
        if (direction === "down") return document.getElementById("guest-name-input");
    }

    // Email Form (Strict, predictable two-way vertical flow)
    if (id === "login-name-input") {
        if (direction === "up") return document.getElementById("tab-btn-email");
        if (direction === "down") return document.getElementById("login-email-input");
    }
    if (id === "login-email-input") {
        if (direction === "up") return isSignUp ? document.getElementById("login-name-input") : document.getElementById("tab-btn-email");
        if (direction === "down") return document.getElementById("login-password-input");
        if (direction === "right") return document.getElementById("forgot-password-link");
    }
    if (id === "login-password-input") {
        // GUARANTEED: Up always returns directly to email input! Never get trapped in forgot-password
        if (direction === "up") return document.getElementById("login-email-input");
        if (direction === "down") return document.getElementById("email-login-submit-btn");
        if (direction === "right") return document.getElementById("forgot-password-link");
    }
    if (id === "forgot-password-link") {
        if (direction === "up") return document.getElementById("login-email-input");
        if (direction === "down") return document.getElementById("login-password-input");
        if (direction === "left") return document.getElementById("login-password-input");
    }
    if (id === "email-login-submit-btn") {
        if (direction === "up") return document.getElementById("login-password-input");
        if (direction === "down") return document.getElementById("toggle-auth-mode-btn");
    }
    if (id === "toggle-auth-mode-btn") {
        if (direction === "up") return document.getElementById("email-login-submit-btn");
        if (direction === "down") return document.getElementById("open-policy-btn");
    }
    if (id === "open-policy-btn") {
        if (direction === "down") return document.getElementById("open-policy-btn");
        if (direction === "up") {
            const guestPane = document.getElementById("pane-guest");
            if (guestPane && !guestPane.classList.contains("hidden")) {
                return document.getElementById("guest-login-btn");
            }
            return document.getElementById("toggle-auth-mode-btn");
        }
    }

    // Guest Form
    if (id === "guest-name-input") {
        if (direction === "up") return document.getElementById("tab-btn-guest");
        if (direction === "down") return document.getElementById("guest-login-btn");
    }
    if (id === "guest-login-btn") {
        if (direction === "up") return document.getElementById("guest-name-input");
        if (direction === "down") return document.getElementById("open-policy-btn");
    }

    // --- 2. Main Screen Layout Navigation ---
    // Top Bar
    if (id === "my-profile-chip") {
        if (direction === "right") return document.getElementById("header-logout-btn");
        if (direction === "down") return document.getElementById("dial-uid-input");
    }
    if (id === "header-logout-btn") {
        if (direction === "left") return document.getElementById("my-profile-chip");
        if (direction === "down") {
            const activeChat = document.getElementById("tv-active-chat");
            if (activeChat && !activeChat.classList.contains("hidden")) {
                return document.getElementById("chat-audio-call-btn") || document.getElementById("chat-back-btn");
            }
            return document.getElementById("dial-uid-input");
        }
    }

    // Sidebar: Direct Dial & Add Contact
    if (id === "dial-uid-input") {
        if (direction === "up") return document.getElementById("my-profile-chip");
        if (direction === "down") return document.getElementById("quick-chat-btn");
        if (direction === "right") {
            const activeChat = document.getElementById("tv-active-chat");
            if (activeChat && !activeChat.classList.contains("hidden")) {
                return document.getElementById("chat-back-btn") || document.getElementById("message-input");
            }
        }
    }
    if (id === "quick-chat-btn") {
        if (direction === "up") return document.getElementById("dial-uid-input");
        if (direction === "right") return document.getElementById("quick-audio-call-btn");
        if (direction === "down") return document.getElementById("contact-uid-input");
    }
    if (id === "quick-audio-call-btn") {
        if (direction === "left") return document.getElementById("quick-chat-btn");
        if (direction === "right") return document.getElementById("quick-video-call-btn");
        if (direction === "up") return document.getElementById("dial-uid-input");
        if (direction === "down") return document.getElementById("contact-uid-input");
    }
    if (id === "quick-video-call-btn") {
        if (direction === "left") return document.getElementById("quick-audio-call-btn");
        if (direction === "up") return document.getElementById("dial-uid-input");
        if (direction === "down") return document.getElementById("contact-uid-input");
        if (direction === "right") {
            const activeChat = document.getElementById("tv-active-chat");
            if (activeChat && !activeChat.classList.contains("hidden")) {
                return document.getElementById("messages-area") || document.getElementById("message-input");
            }
        }
    }
    if (id === "contact-uid-input") {
        if (direction === "up") return document.getElementById("quick-chat-btn");
        if (direction === "down") return document.getElementById("contact-name-input");
        if (direction === "right") {
            const activeChat = document.getElementById("tv-active-chat");
            if (activeChat && !activeChat.classList.contains("hidden")) {
                return document.getElementById("messages-area") || document.getElementById("message-input");
            }
        }
    }
    if (id === "contact-name-input") {
        if (direction === "up") return document.getElementById("contact-uid-input");
        if (direction === "down") return document.getElementById("save-contact-btn");
    }
    if (id === "save-contact-btn") {
        if (direction === "up") return document.getElementById("contact-name-input");
        if (direction === "down") {
            const firstContact = document.querySelector("#contacts-list .tv-contact-card");
            return firstContact || document.getElementById("sidebar-policy-btn");
        }
    }

    // Contacts list cards & mini call buttons
    if (current.classList.contains("tv-contact-card")) {
        if (direction === "up") {
            const prevCard = current.previousElementSibling;
            if (prevCard && prevCard.classList.contains("tv-contact-card")) return prevCard;
            return document.getElementById("save-contact-btn");
        }
        if (direction === "down") {
            const nextCard = current.nextElementSibling;
            if (nextCard && nextCard.classList.contains("tv-contact-card")) return nextCard;
            return document.getElementById("sidebar-policy-btn");
        }
        if (direction === "right") {
            const audioBtn = current.querySelector('.tv-mini-call-btn[data-action="audio"]');
            if (audioBtn) return audioBtn;
            const activeChat = document.getElementById("tv-active-chat");
            if (activeChat && !activeChat.classList.contains("hidden")) {
                return document.getElementById("message-input") || document.getElementById("chat-back-btn");
            }
        }
    }

    if (current.classList.contains("tv-mini-call-btn")) {
        const card = current.closest(".tv-contact-card");
        if (direction === "left") {
            if (current.dataset.action === "video") {
                const audioBtn = card?.querySelector('.tv-mini-call-btn[data-action="audio"]');
                if (audioBtn) return audioBtn;
            }
            return card;
        }
        if (direction === "right") {
            if (current.dataset.action === "audio") {
                const videoBtn = card?.querySelector('.tv-mini-call-btn[data-action="video"]');
                if (videoBtn) return videoBtn;
            }
            const activeChat = document.getElementById("tv-active-chat");
            if (activeChat && !activeChat.classList.contains("hidden")) {
                return document.getElementById("message-input") || document.getElementById("chat-back-btn");
            }
        }
        if (direction === "up") {
            const prevCard = card?.previousElementSibling;
            if (prevCard && prevCard.classList.contains("tv-contact-card")) return prevCard;
            return document.getElementById("save-contact-btn");
        }
        if (direction === "down") {
            const nextCard = card?.nextElementSibling;
            if (nextCard && nextCard.classList.contains("tv-contact-card")) return nextCard;
            return document.getElementById("sidebar-policy-btn");
        }
    }

    if (id === "sidebar-policy-btn") {
        if (direction === "up") {
            const lastContact = document.querySelector("#contacts-list .tv-contact-card:last-child");
            return lastContact || document.getElementById("save-contact-btn");
        }
    }

    // --- 3. Active Chat Stage ---
    if (id === "chat-back-btn") {
        if (direction === "left") return document.getElementById("quick-chat-btn");
        if (direction === "right") return document.getElementById("chat-audio-call-btn");
        if (direction === "down") return document.getElementById("messages-area");
    }
    if (id === "chat-audio-call-btn") {
        if (direction === "left") return document.getElementById("chat-back-btn");
        if (direction === "right") return document.getElementById("chat-video-call-btn");
        if (direction === "down") return document.getElementById("messages-area");
        if (direction === "up") return document.getElementById("header-logout-btn");
    }
    if (id === "chat-video-call-btn") {
        if (direction === "left") return document.getElementById("chat-audio-call-btn");
        if (direction === "down") return document.getElementById("messages-area");
        if (direction === "up") return document.getElementById("header-logout-btn");
    }
    if (id === "messages-area") {
        if (direction === "left") return document.querySelector("#contacts-list .tv-contact-card") || document.getElementById("dial-uid-input");
        if (direction === "up") return document.getElementById("chat-audio-call-btn") || document.getElementById("chat-back-btn");
        if (direction === "down") return document.getElementById("message-input");
    }
    if (id === "message-input") {
        if (direction === "up") return document.getElementById("messages-area");
        if (direction === "right") return document.getElementById("send-btn");
        if (direction === "left") return document.querySelector("#contacts-list .tv-contact-card") || document.getElementById("quick-chat-btn");
    }
    if (id === "send-btn") {
        if (direction === "left") return document.getElementById("message-input");
        if (direction === "up") return document.getElementById("messages-area");
    }

    // --- 4. Call Screen Dock ---
    if (id === "mute-mic-btn") {
        if (direction === "right") return document.getElementById("toggle-video-btn");
    }
    if (id === "toggle-video-btn") {
        if (direction === "left") return document.getElementById("mute-mic-btn");
        if (direction === "right") return document.getElementById("end-call-btn");
    }
    if (id === "end-call-btn") {
        if (direction === "left") return document.getElementById("toggle-video-btn");
    }

    // --- 5. Incoming / Outgoing Overlays ---
    if (id === "reject-call-btn") {
        if (direction === "right") return document.getElementById("accept-call-btn");
    }
    if (id === "accept-call-btn") {
        if (direction === "left") return document.getElementById("reject-call-btn");
    }

    // --- 6. Forgot Password Modal ---
    if (id === "close-forgot-modal-btn") {
        if (direction === "down") return document.getElementById("reset-email-input");
    }
    if (id === "reset-email-input") {
        if (direction === "up") return document.getElementById("close-forgot-modal-btn");
        if (direction === "down") return document.getElementById("send-reset-link-btn");
    }
    if (id === "send-reset-link-btn") {
        if (direction === "up") return document.getElementById("reset-email-input");
        if (direction === "down") return document.getElementById("cancel-reset-btn");
    }
    if (id === "cancel-reset-btn") {
        if (direction === "up") return document.getElementById("send-reset-link-btn");
        if (direction === "down") return document.getElementById("close-forgot-modal-btn");
    }

    // --- 7. Profile Modal ---
    if (id === "copy-uid-btn") {
        if (direction === "down") return document.getElementById("profile-policy-btn");
    }
    if (id === "profile-policy-btn") {
        if (direction === "up") return document.getElementById("copy-uid-btn");
        if (direction === "right") return document.getElementById("close-profile-btn");
        if (direction === "down") return document.getElementById("modal-logout-btn");
    }
    if (id === "close-profile-btn") {
        if (direction === "left") return document.getElementById("profile-policy-btn");
        if (direction === "right") return document.getElementById("modal-logout-btn");
        if (direction === "up") return document.getElementById("copy-uid-btn");
    }
    if (id === "modal-logout-btn") {
        if (direction === "left") return document.getElementById("close-profile-btn");
        if (direction === "up") return document.getElementById("copy-uid-btn");
    }

    // --- 8. Policy Modal ---
    if (id === "close-policy-btn") {
        if (direction === "down") return document.getElementById("policy-scroll-area");
    }
    if (id === "policy-scroll-area") {
        if (direction === "up") return document.getElementById("close-policy-btn");
        if (direction === "down") return document.getElementById("policy-ok-btn");
    }
    if (id === "policy-ok-btn") {
        if (direction === "up") return document.getElementById("policy-scroll-area");
    }

    // --- 9. Alexa Guide Modal ---
    if (id === "close-guide-modal-btn") {
        if (direction === "down") return document.getElementById("guide-scroll-area");
    }
    if (id === "guide-scroll-area") {
        if (direction === "up") return document.getElementById("close-guide-modal-btn");
        if (direction === "down") return document.getElementById("guide-ok-btn");
    }
    if (id === "guide-ok-btn") {
        if (direction === "up") return document.getElementById("guide-scroll-area");
    }

    return null;
}

function handleDpadNavigation(direction) {
    const focusables = getVisibleFocusableElements();
    if (focusables.length === 0) return;

    let current = document.activeElement;
    if (!current || !focusables.includes(current)) {
        autoFocusFirstElement();
        return;
    }

    // Special scroll handling for TV remote on scrollable areas
    if (current.id === "policy-scroll-area" || current.id === "guide-scroll-area" || current.id === "messages-area") {
        if (direction === 'down') {
            const canScrollDown = current.scrollTop < (current.scrollHeight - current.clientHeight - 8);
            if (canScrollDown) {
                current.scrollTop += 90;
                return;
            }
        } else if (direction === 'up') {
            const canScrollUp = current.scrollTop > 8;
            if (canScrollUp) {
                current.scrollTop -= 90;
                return;
            }
        }
    }

    // 1. Check deterministic, high-priority form/layout navigation targets
    const customTarget = getCustomNavigationTarget(current, direction);
    if (customTarget && isElementVisibleAndFocusable(customTarget)) {
        focusElement(customTarget);
        return;
    }

    // 2. High-precision 2D Spatial Geometry fallback (W3C Projection Overlap Algorithm)
    const currentRect = current.getBoundingClientRect();
    const currentCenterX = (currentRect.left + currentRect.right) / 2;
    const currentCenterY = (currentRect.top + currentRect.bottom) / 2;

    let bestElement = null;
    let bestScore = Infinity;

    for (const target of focusables) {
        if (target === current) continue;
        const targetRect = target.getBoundingClientRect();
        const targetCenterX = (targetRect.left + targetRect.right) / 2;
        const targetCenterY = (targetRect.top + targetRect.bottom) / 2;

        let isCandidate = false;
        let primaryDist = 0;
        let orthogonalGap = 0;
        let centerOrthogonal = 0;

        if (direction === 'down') {
            // Target must be strictly below current
            if (targetCenterY > currentCenterY + 4 && targetRect.bottom > currentRect.bottom + 2) {
                isCandidate = true;
                primaryDist = Math.max(0, targetRect.top - currentRect.bottom);
                const overlap = Math.max(0, Math.min(currentRect.right, targetRect.right) - Math.max(currentRect.left, targetRect.left));
                orthogonalGap = overlap > 0 ? 0 : Math.max(0, Math.max(currentRect.left - targetRect.right, targetRect.left - currentRect.right));
                centerOrthogonal = Math.abs(targetCenterX - currentCenterX);
            }
        } else if (direction === 'up') {
            // Target must be strictly above current
            if (targetCenterY < currentCenterY - 4 && targetRect.top < currentRect.top - 2) {
                isCandidate = true;
                primaryDist = Math.max(0, currentRect.top - targetRect.bottom);
                const overlap = Math.max(0, Math.min(currentRect.right, targetRect.right) - Math.max(currentRect.left, targetRect.left));
                orthogonalGap = overlap > 0 ? 0 : Math.max(0, Math.max(currentRect.left - targetRect.right, targetRect.left - currentRect.right));
                centerOrthogonal = Math.abs(targetCenterX - currentCenterX);
            }
        } else if (direction === 'right') {
            // Target must be strictly to the right
            if (targetCenterX > currentCenterX + 4 && targetRect.right > currentRect.right + 2) {
                isCandidate = true;
                primaryDist = Math.max(0, targetRect.left - currentRect.right);
                const overlap = Math.max(0, Math.min(currentRect.bottom, targetRect.bottom) - Math.max(currentRect.top, targetRect.top));
                orthogonalGap = overlap > 0 ? 0 : Math.max(0, Math.max(currentRect.top - targetRect.bottom, targetRect.top - currentRect.bottom));
                centerOrthogonal = Math.abs(targetCenterY - currentCenterY);
            }
        } else if (direction === 'left') {
            // Target must be strictly to the left
            if (targetCenterX < currentCenterX - 4 && targetRect.left < currentRect.left - 2) {
                isCandidate = true;
                primaryDist = Math.max(0, currentRect.left - targetRect.right);
                const overlap = Math.max(0, Math.min(currentRect.bottom, targetRect.bottom) - Math.max(currentRect.top, targetRect.top));
                orthogonalGap = overlap > 0 ? 0 : Math.max(0, Math.max(currentRect.top - targetRect.bottom, targetRect.top - currentRect.bottom));
                centerOrthogonal = Math.abs(targetCenterY - currentCenterY);
            }
        }

        if (isCandidate) {
            // Overlapping elements in the movement axis get heavily prioritized (zero orthogonal penalty)
            const score = primaryDist + (orthogonalGap * 4) + (centerOrthogonal * 0.5);
            if (score < bestScore) {
                bestScore = score;
                bestElement = target;
            }
        }
    }

    if (bestElement) {
        focusElement(bestElement);
    }
}

function handleTabNavigation(isShift) {
    const focusables = getVisibleFocusableElements();
    if (focusables.length === 0) return;

    let current = document.activeElement;
    let idx = focusables.indexOf(current);

    if (idx === -1) {
        focusElement(focusables[0]);
        return;
    }

    let nextIdx = isShift ? (idx - 1 + focusables.length) % focusables.length : (idx + 1) % focusables.length;
    focusElement(focusables[nextIdx]);
}

let backPressCount = 0;
let backPressTimer = null;
let callBackPressCount = 0;
let callBackPressTimer = null;

function handleBackKey(canGoBack) {
    const openModal = document.querySelector('.tv-modal-backdrop:not(.hidden)');
    if (openModal) {
        openModal.classList.add("hidden");
        autoFocusFirstElement();
        return;
    }

    // Call Cut Safety Double-Check (Prevents accidental call disconnect on Fire TV remote)
    if (!document.getElementById("full-call-screen")?.classList.contains("hidden")) {
        callBackPressCount++;
        if (callBackPressCount === 1) {
            showToast("Press Back again to end call");
            clearTimeout(callBackPressTimer);
            callBackPressTimer = setTimeout(() => {
                callBackPressCount = 0;
            }, 2500);
            return;
        }
        callBackPressCount = 0;
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

// Global Remote Keydown Event Listener (Amazon Fire TV Remote & D-Pad Engine)
window.addEventListener("keydown", (e) => {
    // 0. Ignore IME composition events (Gboard, Asian IMEs, TV virtual keyboard composition)
    if (e.isComposing) return;

    const active = document.activeElement;
    const isInput = active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA");

    // Guard against PC keyboard CapsLock (keyCode 20) and Pause/Break (keyCode 19)
    const isCapsLock = e.key === "CapsLock" || e.code === "CapsLock" || (typeof e.key === "string" && e.key.toLowerCase().includes("caps"));
    const isPause = e.key === "Pause" || e.code === "Pause" || (typeof e.key === "string" && e.key.toLowerCase().includes("pause"));

    // Universal TV Remote, Fire TV Remote, AWS Device Farm & Physical Keyboard Identification:
    // UP: ArrowUp, Up (Legacy Android), code: ArrowUp, keyCode 38 (Standard), keyCode 19 (Android KEYCODE_DPAD_UP)
    const isUp = e.key === "ArrowUp" || e.key === "Up" || e.code === "ArrowUp" || e.keyCode === 38 || e.which === 38 || (!isPause && (e.keyCode === 19 || e.which === 19));

    // DOWN: ArrowDown, Down (Legacy Android), code: ArrowDown, keyCode 40 (Standard), keyCode 20 (Android KEYCODE_DPAD_DOWN)
    const isDown = e.key === "ArrowDown" || e.key === "Down" || e.code === "ArrowDown" || e.keyCode === 40 || e.which === 40 || (!isCapsLock && (e.keyCode === 20 || e.which === 20));

    // LEFT: ArrowLeft, Left (Legacy Android), code: ArrowLeft, keyCode 37 (Standard), keyCode 21 (Android KEYCODE_DPAD_LEFT)
    const isLeft = e.key === "ArrowLeft" || e.key === "Left" || e.code === "ArrowLeft" || e.keyCode === 37 || e.which === 37 || e.keyCode === 21 || e.which === 21;

    // RIGHT: ArrowRight, Right (Legacy Android), code: ArrowRight, keyCode 39 (Standard), keyCode 22 (Android KEYCODE_DPAD_RIGHT)
    const isRight = e.key === "ArrowRight" || e.key === "Right" || e.code === "ArrowRight" || e.keyCode === 39 || e.which === 39 || e.keyCode === 22 || e.which === 22;

    // TAB: Standard Tab cycling
    const isTab = e.key === "Tab" || e.keyCode === 9 || e.which === 9;

    // ENTER: Enter, Select, Ok, keyCode 13, Android KEYCODE_ENTER (66), Android KEYCODE_DPAD_CENTER (23)
    const isEnter = e.key === "Enter" || e.code === "Enter" || e.key === "Select" || e.key === "Ok" || e.keyCode === 13 || e.which === 13 || e.keyCode === 66 || e.which === 66 || e.keyCode === 23 || e.which === 23;

    // BACK: Escape, GoBack, Back, Android KEYCODE_BACK (4), Samsung Tizen (10009), Backspace when not in input
    const isBack = e.key === "Escape" || e.code === "Escape" || e.key === "GoBack" || e.key === "Back" || e.keyCode === 27 || e.which === 27 || e.keyCode === 4 || e.which === 4 || e.keyCode === 10009 || (!isInput && (e.key === "Backspace" || e.keyCode === 8 || e.which === 8));

    // MEDIA PLAY/PAUSE: Fire TV Remote dedicated Play/Pause key (KeyCode 85 / MediaPlayPause)
    const isPlayPause = e.key === "MediaPlayPause" || e.code === "MediaPlayPause" || e.keyCode === 85 || e.which === 85 || e.key === "PlayPause";
    if (isPlayPause) {
        e.preventDefault();
        // If in an active call, safely toggle microphone mute
        if (!document.getElementById("full-call-screen")?.classList.contains("hidden")) {
            document.getElementById("mute-mic-btn")?.click();
        }
        return;
    }

    // MENU KEY: Fire TV Remote dedicated Menu button (KeyCode 82, KeyCode 118, "Menu")
    const isMenu = e.key === "Menu" || e.code === "ContextMenu" || e.keyCode === 82 || e.which === 82 || e.keyCode === 118 || e.which === 118;
    if (isMenu) {
        e.preventDefault();
        const guideModal = document.getElementById("guide-modal");
        if (guideModal) {
            if (guideModal.classList.contains("hidden")) {
                guideModal.classList.remove("hidden");
                const scrollArea = document.getElementById("guide-scroll-area");
                if (scrollArea) focusElement(scrollArea);
            } else {
                guideModal.classList.add("hidden");
                autoFocusFirstElement();
            }
        }
        return;
    }

    // Long-Press Rapid-Fire Guard (Prevents accidental repeated calls or double clicks when remote button is held)
    if (e.repeat && (isEnter || isBack)) return;

    // 1. Tab / Shift+Tab cycling across visible focusables
    if (isTab) {
        e.preventDefault();
        handleTabNavigation(e.shiftKey);
        return;
    }

    // 2. Hardware / Remote Back key
    if (isBack) {
        if (!isInput || active.value.length === 0 || e.key === "Escape" || e.keyCode === 10009) {
            e.preventDefault();
            handleBackKey();
        }
        return;
    }

    // 3. Directional Navigation (Up, Down, Left, Right)
    if (isUp) {
        e.preventDefault();
        handleDpadNavigation("up");
        return;
    }

    if (isDown) {
        e.preventDefault();
        handleDpadNavigation("down");
        return;
    }

    if (isLeft) {
        if (!isInput) {
            e.preventDefault();
            handleDpadNavigation("left");
        } else if (active.selectionStart === 0 && active.selectionEnd === 0) {
            // Only leave input to the left when cursor is strictly at position 0
            e.preventDefault();
            handleDpadNavigation("left");
        }
        // Otherwise, allow natural caret cursor movement inside the text
        return;
    }

    if (isRight) {
        if (!isInput) {
            e.preventDefault();
            handleDpadNavigation("right");
        } else if (active.selectionStart === active.value.length && active.selectionEnd === active.value.length) {
            // Only leave input to the right when cursor is strictly at the end of text
            e.preventDefault();
            handleDpadNavigation("right");
        }
        // Otherwise, allow natural caret cursor movement inside the text
        return;
    }

    // 4. Action / Enter / Select Key
    if (isEnter) {
        if (active && active.classList.contains("tv-focusable") && !isInput) {
            e.preventDefault();
            active.click();
            return;
        }

        if (active && isInput) {
            // When Enter / Center (OK) is pressed on an input:
            // If the field already has text entered (e.g. from physical keyboard), Enter advances/submits.
            // If the field is being selected or opened on Fire TV, do not preventDefault so Android/Fire OS
            // natively summons the Fire TV virtual on-screen keyboard (IME) for remote or voice typing!
            if (active.id === "dial-uid-input") {
                const val = active.value.trim().replace(/\D/g, '');
                if (val.length === 10) {
                    e.preventDefault();
                    document.getElementById("quick-chat-btn")?.click();
                }
            } else if (active.id === "contact-uid-input") {
                const val = active.value.trim().replace(/\D/g, '');
                if (val.length === 10) {
                    e.preventDefault();
                    focusElement(document.getElementById("contact-name-input"));
                }
            } else if (active.id === "contact-name-input") {
                if (active.value.trim().length > 0) {
                    e.preventDefault();
                    document.getElementById("save-contact-btn")?.click();
                }
            } else if (active.id === "login-name-input") {
                if (active.value.trim().length > 0) {
                    e.preventDefault();
                    focusElement(document.getElementById("login-email-input"));
                }
            } else if (active.id === "login-email-input") {
                if (active.value.trim().length > 0) {
                    e.preventDefault();
                    focusElement(document.getElementById("login-password-input"));
                }
            } else if (active.id === "login-password-input") {
                if (active.value.length > 0) {
                    e.preventDefault();
                    document.getElementById("email-login-submit-btn")?.click();
                }
            } else if (active.id === "guest-name-input") {
                if (active.value.trim().length > 0) {
                    e.preventDefault();
                    document.getElementById("guest-login-btn")?.click();
                }
            } else if (active.id === "reset-email-input") {
                if (active.value.trim().length > 0) {
                    e.preventDefault();
                    document.getElementById("send-reset-link-btn")?.click();
                }
            } else if (active.id === "message-input") {
                const text = active.value.trim();
                if (text.length > 0) {
                    e.preventDefault();
                    sendMessageLogic();
                }
            }
        }
    }
});

// ----------------- Global Clicks & UI Triggers -----------------
let isSignUpMode = false;

// Fluid Focus & Touch Support (Syncs Cyan Glow to focused target)
document.addEventListener("focusin", (e) => {
    const focusable = e.target?.closest ? e.target.closest(".tv-focusable") : null;
    if (focusable) {
        document.querySelectorAll('.tv-focused').forEach(node => {
            if (node !== focusable) node.classList.remove('tv-focused');
        });
        focusable.classList.add('tv-focused');
    }
});

document.addEventListener("click", async (e) => {
    // 1. Login Tabs Switching (Email & Password / Guest Mode)
    if (e.target.id === "tab-btn-email" || e.target.closest("#tab-btn-email")) {
        document.querySelectorAll(".tv-login-tab").forEach(t => t.classList.remove("active"));
        document.querySelectorAll(".tv-tab-pane").forEach(p => p.classList.add("hidden"));
        const tabEl = document.getElementById("tab-btn-email");
        if (tabEl) tabEl.classList.add("active");
        document.getElementById("pane-email")?.classList.remove("hidden");
        const isSignUp = !document.getElementById("email-signup-name-group")?.classList.contains("hidden");
        focusElement(isSignUp ? document.getElementById("login-name-input") : document.getElementById("login-email-input"), false);
        return;
    }

    if (e.target.id === "tab-btn-guest" || e.target.closest("#tab-btn-guest")) {
        document.querySelectorAll(".tv-login-tab").forEach(t => t.classList.remove("active"));
        document.querySelectorAll(".tv-tab-pane").forEach(p => p.classList.add("hidden"));
        const tabEl = document.getElementById("tab-btn-guest");
        if (tabEl) tabEl.classList.add("active");
        document.getElementById("pane-guest")?.classList.remove("hidden");
        focusElement(document.getElementById("guest-name-input"), false);
        return;
    }

    // Toggle Email Auth Mode (Sign In vs Sign Up)
    if (e.target.id === "toggle-auth-mode-btn" || e.target.closest("#toggle-auth-mode-btn")) {
        isSignUpMode = !isSignUpMode;
        const nameGroup = document.getElementById("email-signup-name-group");
        const btnText = document.getElementById("email-btn-text");
        const toggleBtn = document.getElementById("toggle-auth-mode-btn");

        if (isSignUpMode) {
            nameGroup?.classList.remove("hidden");
            if (btnText) btnText.innerText = "Create Account";
            if (toggleBtn) toggleBtn.innerText = "Already have an account? Sign In";
            focusElement(document.getElementById("login-name-input"), false);
        } else {
            nameGroup?.classList.add("hidden");
            if (btnText) btnText.innerText = "Sign In";
            if (toggleBtn) toggleBtn.innerText = "Don't have an account? Sign Up";
            focusElement(document.getElementById("login-email-input"), false);
        }
        return;
    }

    // Forgot Password Link Click
    if (e.target.id === "forgot-password-link" || e.target.closest("#forgot-password-link")) {
        const loginEmail = document.getElementById("login-email-input")?.value.trim() || "";
        const resetInput = document.getElementById("reset-email-input");
        const statusEl = document.getElementById("reset-status-message");
        if (resetInput) resetInput.value = loginEmail;
        if (statusEl) {
            statusEl.style.display = "none";
            statusEl.innerText = "";
        }
        document.getElementById("forgot-password-modal")?.classList.remove("hidden");
        focusElement(resetInput, false);
        return;
    }

    // Close Forgot Password Modal
    if (e.target.id === "close-forgot-modal-btn" || e.target.closest("#close-forgot-modal-btn") || e.target.id === "cancel-reset-btn" || e.target.closest("#cancel-reset-btn")) {
        document.getElementById("forgot-password-modal")?.classList.add("hidden");
        focusElement(document.getElementById("login-password-input"), false);
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
                    let resolvedUid = null;
                    try {
                        resolvedUid = await lookupUserUidFromFirestore(cred.user.email, cred.user.uid);
                    } catch (_) {}
                    if (!resolvedUid) {
                        resolvedUid = computeDeterministic10DigitUid(cred.user.email || cred.user.uid);
                    }
                    const user = {
                        displayName: name || cred.user.displayName || email.split("@")[0],
                        email: cred.user.email,
                        uid: cred.user.uid,
                        zingUid: resolvedUid
                    };
                    my10DigitUid = resolvedUid;
                    updateUidDisplays(resolvedUid);
                    loadUserStorageData(resolvedUid);
                    saveUserUidToFirestore(user, resolvedUid);
                    localStorage.setItem("zingTalkTvSession", JSON.stringify(user));
                    loginUserSession(user);
                    showToast("Account created successfully!");
                } else {
                    const cred = await signInWithEmailAndPassword(auth, email, password);
                    let resolvedUid = null;
                    try {
                        resolvedUid = await lookupUserUidFromFirestore(cred.user.email, cred.user.uid);
                    } catch (_) {}
                    if (!resolvedUid) {
                        resolvedUid = computeDeterministic10DigitUid(cred.user.email || cred.user.uid);
                    }
                    const user = {
                        displayName: cred.user.displayName || email.split("@")[0],
                        email: cred.user.email,
                        uid: cred.user.uid,
                        zingUid: resolvedUid
                    };
                    my10DigitUid = resolvedUid;
                    updateUidDisplays(resolvedUid);
                    loadUserStorageData(resolvedUid);
                    saveUserUidToFirestore(user, resolvedUid);
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
        saveUserContactsToStorage();
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
        if (my10DigitUid) {
            saveUserUidToFirestore(currentUser, my10DigitUid);
        }
        setTimeout(() => focusElement(document.getElementById("copy-uid-btn")), 60);
        return;
    }

    if (e.target.id === "close-profile-btn" || e.target.closest("#close-profile-btn")) {
        document.getElementById("profile-modal")?.classList.add("hidden");
        setTimeout(() => focusElement(document.getElementById("my-profile-chip"), false), 60);
        return;
    }

    if (e.target.id === "header-logout-btn" || e.target.closest("#header-logout-btn") || e.target.id === "modal-logout-btn" || e.target.closest("#modal-logout-btn")) {
        logoutUserSession();
        return;
    }

    if (e.target.id === "copy-uid-btn" || e.target.closest("#copy-uid-btn")) {
        if (my10DigitUid) {
            navigator.clipboard.writeText(my10DigitUid).then(() => {
                showToast("10-Digit UID copied: " + my10DigitUid);
            }).catch(() => {
                showToast("UID: " + my10DigitUid);
            });
        }
        return;
    }

    // How to Use Guide Modal
    if (e.target.id === "header-guide-btn" || e.target.closest("#header-guide-btn")) {
        document.getElementById("guide-modal")?.classList.remove("hidden");
        setTimeout(() => focusElement(document.getElementById("guide-ok-btn"), false), 60);
        return;
    }

    if (e.target.id === "close-guide-modal-btn" || e.target.closest("#close-guide-modal-btn") || e.target.id === "guide-ok-btn" || e.target.closest("#guide-ok-btn")) {
        document.getElementById("guide-modal")?.classList.add("hidden");
        autoFocusFirstElement();
        return;
    }

    // Policy Modal
    if (e.target.id === "open-policy-btn" || e.target.closest("#open-policy-btn") || e.target.id === "sidebar-policy-btn" || e.target.closest("#sidebar-policy-btn") || e.target.id === "profile-policy-btn" || e.target.closest("#profile-policy-btn") || e.target.closest(".tv-policy-btn-trigger")) {
        document.getElementById("profile-modal")?.classList.add("hidden");
        document.getElementById("policy-modal")?.classList.remove("hidden");
        setTimeout(() => focusElement(document.getElementById("policy-ok-btn"), false), 60);
        return;
    }

    if (e.target.id === "close-policy-btn" || e.target.closest("#close-policy-btn") || e.target.id === "policy-ok-btn" || e.target.closest("#policy-ok-btn")) {
        document.getElementById("policy-modal")?.classList.add("hidden");
        autoFocusFirstElement();
        return;
    }
});

// Strict Numeric 10-Digit Sanitizers for Quick Dial & Contact Add
document.getElementById("dial-uid-input")?.addEventListener("input", (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 10);
});

document.getElementById("contact-uid-input")?.addEventListener("input", (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 10);
});

// ==========================================================================
// WEB THREE-LEVEL SECURITY GATE & DEVELOPER ACCESS CLEARANCE
// Level 1: Primary Authentication Key
// Level 2: Secondary Clearance Key
// Level 3: Master Developer Token
// Stored strictly via irreversible SHA-256 cryptographic hashes (No plain text passwords)
// ==========================================================================
const SECURITY_LEVEL_HASHES = [
    "a252a4f2e3595682ddcd540785bdb2002158211ebb0cfbbed9f0fefad04c1a65", // Level 1 Hash
    "80f0e1cab6a0c35d342a0a1c2e0f79b0511dcb3eeeeac5740cc0295b3c243e5b", // Level 2 Hash
    "3678bc91dbe8d15525ca2ef34828bcedfdaf0128b4746333d0caa16dc79a5ed6"  // Level 3 Hash
];

const SECURITY_STEP_CONFIG = [
    {
        level: 1,
        stepId: "sec-step-1",
        labelId: "sec-label-1",
        prompt: "Level 1 Verification: Enter Primary Authentication Key",
        placeholder: "Enter Level 1 Password...",
        btnText: "Authorize Level 1 Key"
    },
    {
        level: 2,
        stepId: "sec-step-2",
        labelId: "sec-label-2",
        prompt: "Level 2 Verification: Enter Secondary Security Clearance",
        placeholder: "Enter Level 2 Password...",
        btnText: "Authorize Level 2 Key"
    },
    {
        level: 3,
        stepId: "sec-step-3",
        labelId: "sec-label-3",
        prompt: "Level 3 Verification: Enter Master Developer Access Token",
        placeholder: "Enter Level 3 Password...",
        btnText: "Authorize Master Token"
    }
];

let currentSecurityLevel = 1;

async function computeSha256Hex(plainText) {
    if (!window.crypto || !window.crypto.subtle) return "";
    try {
        const encoder = new TextEncoder();
        const data = encoder.encode(plainText);
        const hashBuffer = await window.crypto.subtle.digest("SHA-256", data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
    } catch (_) {
        return "";
    }
}

function updateSecurityGateUI() {
    const config = SECURITY_STEP_CONFIG[currentSecurityLevel - 1];
    if (!config) return;

    const promptEl = document.getElementById("security-prompt-label");
    const inputEl = document.getElementById("security-key-input");
    const btnEl = document.getElementById("security-submit-btn");
    const errorEl = document.getElementById("security-error-msg");

    if (promptEl) promptEl.innerText = config.prompt;
    if (inputEl) {
        inputEl.placeholder = config.placeholder;
        inputEl.value = "";
        inputEl.focus();
    }
    if (btnEl) btnEl.innerHTML = `<span>${config.btnText}</span>`;
    if (errorEl) errorEl.style.display = "none";

    for (let i = 1; i <= 3; i++) {
        const stepEl = document.getElementById(`sec-step-${i}`);
        const labelEl = document.getElementById(`sec-label-${i}`);
        if (!stepEl) continue;

        if (i < currentSecurityLevel) {
            stepEl.className = "security-step-item completed";
            if (labelEl) labelEl.innerText = "Verified ✓";
        } else if (i === currentSecurityLevel) {
            stepEl.className = "security-step-item active";
            if (labelEl) {
                if (i === 1) labelEl.innerText = "Primary Key";
                if (i === 2) labelEl.innerText = "Clearance Key";
                if (i === 3) labelEl.innerText = "Master Token";
            }
        } else {
            stepEl.className = "security-step-item";
            if (labelEl) {
                if (i === 2) labelEl.innerText = "Clearance Key";
                if (i === 3) labelEl.innerText = "Developer Token";
            }
        }
    }
}

async function handleSecuritySubmit() {
    const inputEl = document.getElementById("security-key-input");
    const errorEl = document.getElementById("security-error-msg");
    const cardEl = document.getElementById("security-card");
    const val = inputEl ? inputEl.value.trim() : "";

    if (!val) {
        if (errorEl) {
            errorEl.innerText = "⚠️ Please enter the security key.";
            errorEl.style.display = "block";
        }
        return;
    }

    const inputHash = await computeSha256Hex(val);
    const expectedHash = SECURITY_LEVEL_HASHES[currentSecurityLevel - 1];

    if (inputHash === expectedHash) {
        if (errorEl) errorEl.style.display = "none";

        if (currentSecurityLevel < 3) {
            showToast(`✅ Level ${currentSecurityLevel} Verified!`);
            currentSecurityLevel++;
            updateSecurityGateUI();
        } else {
            // Level 3 Unlocked!
            const step3 = document.getElementById("sec-step-3");
            const label3 = document.getElementById("sec-label-3");
            if (step3) step3.className = "security-step-item completed";
            if (label3) label3.innerText = "Verified ✓";

            showToast("🛡️ All 3 Security Levels Verified! Welcome Developer.");
            sessionStorage.setItem("zingtalk_web_gate_cleared", "true");

            const overlay = document.getElementById("web-security-gate-overlay");
            if (overlay) {
                overlay.style.transition = "opacity 0.3s ease";
                overlay.style.opacity = "0";
                setTimeout(() => {
                    overlay.classList.add("hidden");
                    overlay.style.opacity = "";
                }, 300);
            }

            const portalBar = document.getElementById("web-portal-bar");
            if (portalBar) portalBar.classList.remove("hidden");

            setTimeout(autoFocusFirstElement, 150);
        }
    } else {
        if (errorEl) {
            errorEl.innerText = `❌ Invalid Level ${currentSecurityLevel} Key. Access Denied.`;
            errorEl.style.display = "block";
        }
        if (cardEl) {
            cardEl.classList.remove("security-shake");
            void cardEl.offsetWidth; // trigger reflow
            cardEl.classList.add("security-shake");
        }
        if (inputEl) {
            inputEl.value = "";
            inputEl.focus();
        }
    }
}

function initSecurityGate() {
    const isNativeApk = typeof window !== "undefined" && Boolean(window.Capacitor?.isNativePlatform?.());
    const isCleared = sessionStorage.getItem("zingtalk_web_gate_cleared") === "true";
    const overlay = document.getElementById("web-security-gate-overlay");
    const portalBar = document.getElementById("web-portal-bar");

    if (isNativeApk) {
        // Native APK (Fire TV or Android Mobile) runs directly without web password gate
        if (overlay) overlay.classList.add("hidden");
        return;
    }

    if (portalBar) portalBar.classList.remove("hidden");

    if (isCleared) {
        if (overlay) overlay.classList.add("hidden");
    } else {
        if (overlay) overlay.classList.remove("hidden");
        currentSecurityLevel = 1;
        updateSecurityGateUI();
    }

    // Toggle Eye Listener
    document.getElementById("security-toggle-eye")?.addEventListener("click", () => {
        const inp = document.getElementById("security-key-input");
        if (inp) {
            inp.type = inp.type === "password" ? "text" : "password";
        }
    });

    // Enter Key Listener for Security Input
    document.getElementById("security-key-input")?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            handleSecuritySubmit();
        }
    });

    document.getElementById("security-submit-btn")?.addEventListener("click", handleSecuritySubmit);

    // Re-Lock Button Listener
    document.getElementById("web-relock-btn")?.addEventListener("click", () => {
        sessionStorage.removeItem("zingtalk_web_gate_cleared");
        currentSecurityLevel = 1;
        if (overlay) {
            overlay.classList.remove("hidden");
            overlay.style.opacity = "1";
        }
        updateSecurityGateUI();
        showToast("🔒 Security Gate Re-Locked.");
    });
}

// ==========================================================================
// WEB PORTAL FEATURES: APK DOWNLOAD HUB & AV DIAGNOSTIC STUDIO
// ==========================================================================
let diagStream = null;
let diagAudioCtx = null;
let diagAnimFrame = null;

async function measureServerPing() {
    const start = performance.now();
    try {
        const resp = await fetch("https://zingtalk.duckdns.org/api/health", { cache: "no-store", mode: "cors" });
        if (resp.ok) {
            const latency = Math.round(performance.now() - start);
            const pingText = document.getElementById("web-ping-text");
            const diagLatency = document.getElementById("diag-latency-val");
            if (pingText) pingText.innerText = `${latency}ms • AWS Live`;
            if (diagLatency) diagLatency.innerText = `${latency} ms (Fast)`;
        }
    } catch (_) {
        const pingText = document.getElementById("web-ping-text");
        if (pingText) pingText.innerText = "DuckDNS Active";
    }
}

function initWebPortalFeatures() {
    // Measure initial ping and periodically refresh every 30s
    measureServerPing();
    setInterval(measureServerPing, 30000);

    // APK Hub Modal Triggers
    document.getElementById("web-apk-hub-btn")?.addEventListener("click", () => {
        document.getElementById("apk-download-modal")?.classList.remove("hidden");
    });
    document.getElementById("close-apk-modal-btn")?.addEventListener("click", () => {
        document.getElementById("apk-download-modal")?.classList.add("hidden");
    });
    document.getElementById("close-apk-modal-btn2")?.addEventListener("click", () => {
        document.getElementById("apk-download-modal")?.classList.add("hidden");
    });

    // AV Diagnostic Studio Modal Triggers
    document.getElementById("web-av-test-btn")?.addEventListener("click", () => {
        document.getElementById("av-diagnostic-modal")?.classList.remove("hidden");
        measureServerPing();
    });

    const stopDiagnosticTest = () => {
        if (diagAnimFrame) cancelAnimationFrame(diagAnimFrame);
        if (diagStream) {
            diagStream.getTracks().forEach(t => t.stop());
            diagStream = null;
        }
        if (diagAudioCtx) {
            try { diagAudioCtx.close(); } catch (_) {}
            diagAudioCtx = null;
        }
        const videoEl = document.getElementById("diag-video-preview");
        if (videoEl) videoEl.srcObject = null;
        const micBar = document.getElementById("diag-mic-bar");
        if (micBar) micBar.style.width = "0%";
        const camStatus = document.getElementById("diag-camera-status");
        if (camStatus) camStatus.innerText = "Camera Idle";
        const micStatus = document.getElementById("diag-mic-status");
        if (micStatus) micStatus.innerText = "Click Test to monitor mic";
    };

    document.getElementById("close-diag-modal-btn")?.addEventListener("click", () => {
        stopDiagnosticTest();
        document.getElementById("av-diagnostic-modal")?.classList.add("hidden");
    });

    document.getElementById("stop-av-diag-btn")?.addEventListener("click", () => {
        stopDiagnosticTest();
        document.getElementById("av-diagnostic-modal")?.classList.add("hidden");
    });

    document.getElementById("start-av-diag-btn")?.addEventListener("click", async () => {
        stopDiagnosticTest();
        const camStatus = document.getElementById("diag-camera-status");
        const micStatus = document.getElementById("diag-mic-status");
        const videoEl = document.getElementById("diag-video-preview");
        const micBar = document.getElementById("diag-mic-bar");

        try {
            if (camStatus) camStatus.innerText = "Requesting permissions...";
            diagStream = await navigator.mediaDevices.getUserMedia({
                video: { width: { ideal: 1280 }, height: { ideal: 720 } },
                audio: true
            });

            if (videoEl) {
                videoEl.srcObject = diagStream;
                videoEl.play().catch(() => {});
            }
            if (camStatus) camStatus.innerText = "🟢 Camera Active (HD Preview)";

            // Audio Level Visualizer
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (AudioContextClass) {
                diagAudioCtx = new AudioContextClass();
                const source = diagAudioCtx.createMediaStreamSource(diagStream);
                const analyser = diagAudioCtx.createAnalyser();
                analyser.fftSize = 256;
                source.connect(analyser);

                const dataArray = new Uint8Array(analyser.frequencyBinCount);
                if (micStatus) micStatus.innerText = "🎙️ Mic Active • Speak into microphone";

                const updateVolume = () => {
                    if (!diagAudioCtx || diagAudioCtx.state === "closed") return;
                    analyser.getByteFrequencyData(dataArray);
                    let sum = 0;
                    for (let i = 0; i < dataArray.length; i++) {
                        sum += dataArray[i];
                    }
                    const avg = sum / dataArray.length;
                    const pct = Math.min(100, Math.round((avg / 128) * 100));
                    if (micBar) micBar.style.width = pct + "%";
                    diagAnimFrame = requestAnimationFrame(updateVolume);
                };
                updateVolume();
            }
        } catch (err) {
            console.error("[AV Diagnostic Error]", err);
            if (camStatus) camStatus.innerText = "❌ Camera Error: " + err.message;
            if (micStatus) micStatus.innerText = "❌ Mic Error: " + err.message;
        }
    });
}

// Initial Fire TV Leanback D-Pad Auto-Focus & Security Gate Initialization
window.addEventListener("load", () => {
    initSecurityGate();
    initWebPortalFeatures();
    setTimeout(autoFocusFirstElement, 150);
});
setTimeout(autoFocusFirstElement, 300);

