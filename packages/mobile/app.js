import { initializeApp } from "https://www.gstatic.com/firebasejs/10.4.0/firebase-app.js";
import { 
    getAuth, 
    signInWithEmailAndPassword, 
    createUserWithEmailAndPassword,
    sendPasswordResetEmail,
    updateProfile
} from "https://www.gstatic.com/firebasejs/10.4.0/firebase-auth.js";
import { 
    getFirestore, 
    doc, 
    setDoc, 
    collection, 
    query, 
    where, 
    getDocs 
} from "https://www.gstatic.com/firebasejs/10.4.0/firebase-firestore.js";

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
} catch (_) {}

const DUCKDNS_SIGNALING_URL = "https://zingtalk.duckdns.org";

export function getEffectiveServerUrl() {
    const saved = localStorage.getItem("zingTalkServerUrl");
    if (saved && saved.trim()) return saved.trim();
    if (typeof window !== "undefined" && window.location) {
        const h = window.location.host || "";
        const p = window.location.protocol || "";
        if (p.startsWith("http") && (h.includes(":3000") || h.includes("run.app") || h.includes("ai.studio") || h.includes("duckdns"))) {
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

export async function lookupUserUidFromFirestore(email, authUid) {
    if (!firestoreDb) return null;
    try {
        const usersCol = collection(firestoreDb, "users");
        if (email) {
            const snap = await getDocs(query(usersCol, where("email", "==", email.toLowerCase().trim())));
            if (!snap.empty) {
                const d = snap.docs[0].data();
                if (d && d.uid && String(d.uid).length === 10) return String(d.uid);
            }
        }
        if (authUid) {
            const snap = await getDocs(query(usersCol, where("authUid", "==", authUid)));
            if (!snap.empty) {
                const d = snap.docs[0].data();
                if (d && d.uid && String(d.uid).length === 10) return String(d.uid);
            }
        }
    } catch (_) {}
    return null;
}

export async function saveUserUidToFirestore(user, uid) {
    if (!firestoreDb || !uid) return;
    try {
        const cleanUid = String(uid).trim().replace(/\D/g, '');
        if (cleanUid.length !== 10) return;
        const data = {
            uid: cleanUid,
            authUid: user?.uid || null,
            email: user?.email ? user.email.toLowerCase().trim() : "",
            displayName: user?.displayName || "Mobile User",
            platform: "Android Mobile",
            updatedAt: new Date().toISOString()
        };
        await setDoc(doc(firestoreDb, "users", cleanUid), data, { merge: true });
        if (user?.uid) {
            await setDoc(doc(firestoreDb, "user_profiles", user.uid), data, { merge: true });
        }
    } catch (_) {}
}

const rtcConfig = {
    iceServers: [
        { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
        { urls: ["stun:zingtalk.duckdns.org:3478"] },
        {
            urls: [
                "turn:zingtalk.duckdns.org:3478?transport=udp",
                "turn:zingtalk.duckdns.org:3478?transport=tcp"
            ],
            username: "zingtalk",
            credential: "zingtalkpassword"
        }
    ],
    iceCandidatePoolSize: 10
};

let currentUser = null;
let my10DigitUid = null;
let currentTargetUid = null;
let socket = null;
let myContacts = [];
let chatHistory = {};
let localStream = null;
let peerConnection = null;
let isMicMuted = false;
let isVideoDisabled = false;
let currentFacingMode = "user";
let callTimer = null;
let callDurationSeconds = 0;
let isSignUpMode = false;

function showToast(msg) {
    const toast = document.getElementById("mobile-toast");
    if (!toast) return;
    toast.textContent = msg;
    toast.style.opacity = "1";
    setTimeout(() => { toast.style.opacity = "0"; }, 3000);
}

function updateDisplays(uid) {
    my10DigitUid = uid ? String(uid) : null;
    const pill = document.getElementById("mobile-my-uid-pill");
    const full = document.getElementById("profile-uid-full");
    if (pill) pill.innerText = uid ? `UID: ${uid}` : "UID: Connecting...";
    if (full) full.innerText = uid ? `UID: ${uid}` : "UID: Connecting...";
}

function loadContacts() {
    try {
        const stored = localStorage.getItem("zingTalkMobileContacts");
        myContacts = stored ? JSON.parse(stored) : [];
    } catch (_) { myContacts = []; }
    renderContacts();
}

function saveContacts() {
    try {
        localStorage.setItem("zingTalkMobileContacts", JSON.stringify(myContacts));
    } catch (_) {}
    renderContacts();
}

function renderContacts() {
    const list = document.getElementById("mobile-contacts-list");
    if (!list) return;
    list.innerHTML = "";
    if (myContacts.length === 0) {
        list.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 40px 10px; font-size: 14px;">No contacts saved yet.<br>Tap "+ Add Contact" or use the Dialpad.</div>`;
        return;
    }
    myContacts.forEach(contact => {
        const card = document.createElement("div");
        card.className = "contact-card";
        const initial = (contact.name || "U").charAt(0).toUpperCase();
        card.innerHTML = `
            <div class="contact-avatar">${initial}</div>
            <div class="contact-info">
                <div class="contact-name">${contact.name}</div>
                <div class="contact-uid">UID: ${contact.uid}</div>
            </div>
            <div class="contact-actions">
                <button type="button" class="action-icon-btn chat-btn" title="Chat">
                    <svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z"/></svg>
                </button>
                <button type="button" class="action-icon-btn call-audio audio-btn" title="Audio Call">
                    <svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24"><path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56-.35-.12-.74-.03-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/></svg>
                </button>
                <button type="button" class="action-icon-btn call-video video-btn" title="Video Call">
                    <svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>
                </button>
            </div>
        `;
        // Whole card click opens chat
        card.addEventListener("click", (e) => {
            if (e.target.closest(".action-icon-btn")) return;
            openChat(contact);
        });
        card.querySelector(".chat-btn")?.addEventListener("click", (e) => {
            e.stopPropagation();
            openChat(contact);
        });
        card.querySelector(".audio-btn")?.addEventListener("click", (e) => {
            e.stopPropagation();
            initiateCall(contact.uid, "audio");
        });
        card.querySelector(".video-btn")?.addEventListener("click", (e) => {
            e.stopPropagation();
            initiateCall(contact.uid, "video");
        });
        list.appendChild(card);
    });
}

function connectSocket() {
    const serverUrl = getEffectiveServerUrl();
    if (socket && socket.connected) {
        if (currentUser) {
            socket.emit("login_user", {
                email: currentUser.email,
                name: currentUser.displayName,
                authUid: currentUser.uid,
                uid: my10DigitUid || currentUser.zingUid,
                isGuest: !currentUser.email,
                platform: "Mobile"
            });
        }
        return;
    }

    if (typeof io === "undefined") {
        console.warn("[ZingTalk Mobile] Socket.io client runtime not yet loaded");
        return;
    }
    socket = io(serverUrl, {
        transports: ["websocket", "polling"],
        reconnectionAttempts: 20,
        reconnectionDelay: 1500
    });

    socket.on("connect", () => {
        if (currentUser) {
            socket.emit("login_user", {
                email: currentUser.email,
                name: currentUser.displayName,
                authUid: currentUser.uid,
                uid: my10DigitUid || currentUser.zingUid,
                isGuest: !currentUser.email,
                platform: "Mobile"
            });
        }
    });

    socket.on("user_data", (data) => {
        if (data && data.uid) {
            updateDisplays(data.uid);
            if (currentUser) {
                currentUser.zingUid = data.uid;
                localStorage.setItem("zingTalkMobileSession", JSON.stringify(currentUser));
                saveUserUidToFirestore(currentUser, data.uid);
            }
        }
    });

    let incomingCallerUid = null;
    let incomingCallType = "video";
    let pendingOffer = null;
    let iceCandidatesQueue = [];

    function playMobileChime() {
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return;
            const ctx = new AudioCtx();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = "sine";
            osc.frequency.setValueAtTime(587.33, ctx.currentTime);
            osc.frequency.setValueAtTime(880.00, ctx.currentTime + 0.15);
            gain.gain.setValueAtTime(0.2, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
            osc.start();
            osc.stop(ctx.currentTime + 0.5);
        } catch (_) {}
    }

    socket.on("incoming_call", (data) => {
        incomingCallerUid = data.callerUid;
        incomingCallType = data.type || "video";

        const known = myContacts.find(c => c.uid === data.callerUid);
        const nameToShow = known ? known.name : `UID: ${data.callerUid}`;
        const avatarLetter = (known?.name || "U").charAt(0).toUpperCase();

        const nameEl = document.getElementById("incoming-name");
        const avatarEl = document.getElementById("incoming-avatar");
        const typeEl = document.getElementById("incoming-type");

        if (nameEl) nameEl.innerText = nameToShow;
        if (avatarEl) avatarEl.innerText = avatarLetter;
        if (typeEl) typeEl.innerText = `Incoming ${incomingCallType === 'video' ? 'HD Video' : 'Audio'} Call...`;

        document.getElementById("mobile-incoming-call-overlay")?.classList.remove("hidden");
        playMobileChime();
    });

    socket.on("call_cancelled", () => {
        document.getElementById("mobile-incoming-call-overlay")?.classList.add("hidden");
        document.getElementById("mobile-outgoing-call-overlay")?.classList.add("hidden");
        endCallCleanup();
        showToast("Call cancelled.");
    });

    socket.on("call_error", (data) => {
        document.getElementById("mobile-incoming-call-overlay")?.classList.add("hidden");
        document.getElementById("mobile-outgoing-call-overlay")?.classList.add("hidden");
        endCallCleanup();
        showToast("❌ " + (data?.message || "Call error"));
    });

    socket.on("call_response_received", async (data) => {
        document.getElementById("mobile-outgoing-call-overlay")?.classList.add("hidden");
        if (data && data.status === "accepted") {
            if (!peerConnection) {
                await startMobileWebRTC(true);
            }
        } else {
            showToast("Call declined.");
            endCallCleanup();
        }
    });

    socket.on("call_accepted", async () => {
        document.getElementById("mobile-outgoing-call-overlay")?.classList.add("hidden");
        if (!peerConnection) {
            await startMobileWebRTC(true);
        }
    });

    const handleWebRtcOffer = async (data) => {
        if (!data || !data.offer) return;
        if (!peerConnection) {
            pendingOffer = data.offer;
            return;
        }
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            socket.emit("webrtc_answer", { targetUid: currentTargetUid || data.callerUid, answer });
            while (iceCandidatesQueue.length > 0) {
                try {
                    await peerConnection.addIceCandidate(new RTCIceCandidate(iceCandidatesQueue.shift()));
                } catch (_) {}
            }
        } catch (err) {
            console.error("[Mobile WebRTC] Offer error:", err);
        }
    };
    socket.on("webrtc_offer_received", handleWebRtcOffer);
    socket.on("webrtc_offer", handleWebRtcOffer);

    const handleWebRtcAnswer = async (data) => {
        if (!peerConnection || !data || !data.answer) return;
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
            while (iceCandidatesQueue.length > 0) {
                try {
                    await peerConnection.addIceCandidate(new RTCIceCandidate(iceCandidatesQueue.shift()));
                } catch (_) {}
            }
        } catch (err) {
            console.error("[Mobile WebRTC] Answer error:", err);
        }
    };
    socket.on("webrtc_answer_received", handleWebRtcAnswer);
    socket.on("webrtc_answer", handleWebRtcAnswer);

    const handleWebRtcIce = async (data) => {
        if (!data || !data.candidate) return;
        if (peerConnection && peerConnection.remoteDescription) {
            try {
                await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
            } catch (_) {}
        } else {
            iceCandidatesQueue.push(data.candidate);
        }
    };
    socket.on("webrtc_ice_candidate_received", handleWebRtcIce);
    socket.on("webrtc_ice_candidate", handleWebRtcIce);

    const handleCallEnded = () => {
        endCallCleanup();
        showToast("Call ended.");
    };
    socket.on("webrtc_call_ended", handleCallEnded);
    socket.on("call_ended", handleCallEnded);

    socket.on("receive_message", (data) => {
        const sender = data.senderUid;
        if (!chatHistory[sender]) chatHistory[sender] = [];
        chatHistory[sender].push({ text: data.text, sent: false });
        if (currentTargetUid === sender) {
            renderChatMessages();
        }
        showToast(`💬 Message from ${sender}: ${data.text.slice(0, 24)}`);
    });
}

async function setupLocalMedia(videoWanted = true) {
    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
    }
    const constraints = {
        audio: true,
        video: videoWanted ? { facingMode: currentFacingMode, width: { ideal: 1280 }, height: { ideal: 720 } } : false
    };
    try {
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (_) {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    }
    const localVideo = document.getElementById("local-video");
    if (localVideo) localVideo.srcObject = localStream;
}

async function switchCamera() {
    currentFacingMode = currentFacingMode === "user" ? "environment" : "user";
    if (localStream) {
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) videoTrack.stop();
        try {
            const newStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: currentFacingMode }
            });
            const newVideoTrack = newStream.getVideoTracks()[0];
            if (peerConnection) {
                const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === "video");
                if (sender) sender.replaceTrack(newVideoTrack);
            }
            localStream.removeTrack(videoTrack);
            localStream.addTrack(newVideoTrack);
            const localVideo = document.getElementById("local-video");
            if (localVideo) localVideo.srcObject = localStream;
            showToast(`Switched to ${currentFacingMode === 'user' ? 'Front' : 'Back'} Camera`);
        } catch (_) {}
    }
}

async function setupPeerConnection() {
    peerConnection = new RTCPeerConnection(rtcConfig);
    if (localStream) {
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    }
    peerConnection.ontrack = (event) => {
        const remoteVideo = document.getElementById("remote-video");
        if (remoteVideo && event.streams[0]) {
            remoteVideo.srcObject = event.streams[0];
        }
    };
    peerConnection.onicecandidate = (event) => {
        if (event.candidate && currentTargetUid && socket) {
            socket.emit("webrtc_ice_candidate", { targetUid: currentTargetUid, candidate: event.candidate });
        }
    };
}

async function startMobileWebRTC(isCaller) {
    const outOverlay = document.getElementById("mobile-outgoing-call-overlay");
    if (outOverlay) {
        outOverlay.classList.add("hidden");
        outOverlay.style.display = "none";
    }
    const inOverlay = document.getElementById("mobile-incoming-call-overlay");
    if (inOverlay) {
        inOverlay.classList.add("hidden");
        inOverlay.style.display = "none";
    }
    const callScreen = document.getElementById("mobile-call-screen");
    if (callScreen) {
        callScreen.classList.remove("hidden");
        callScreen.style.display = "flex";
    }

    const known = myContacts.find(c => c.uid === currentTargetUid);
    const nameToShow = known ? known.name : `UID: ${currentTargetUid}`;
    const displayEl = document.getElementById("call-target-display");
    if (displayEl) displayEl.innerText = nameToShow;

    startTimer();
    await setupLocalMedia(incomingCallType === "video");
    await setupPeerConnection();

    if (isCaller) {
        try {
            const offer = await peerConnection.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: incomingCallType === "video"
            });
            await peerConnection.setLocalDescription(offer);
            socket.emit("webrtc_offer", { targetUid: currentTargetUid, offer });
        } catch (err) {
            console.error("[Mobile WebRTC] Offer error:", err);
        }
    } else if (pendingOffer) {
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(pendingOffer));
            pendingOffer = null;
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            socket.emit("webrtc_answer", { targetUid: currentTargetUid, answer });
            while (iceCandidatesQueue.length > 0) {
                try {
                    await peerConnection.addIceCandidate(new RTCIceCandidate(iceCandidatesQueue.shift()));
                } catch (_) {}
            }
        } catch (err) {
            console.error("[Mobile WebRTC] Pending offer execution error:", err);
        }
    }
}

async function initiateCall(targetUid, type = "video") {
    const cleanTarget = String(targetUid || "").trim().replace(/\D/g, "");
    const cleanCaller = String(my10DigitUid || currentUser?.zingUid || "").trim().replace(/\D/g, "");

    if (!cleanTarget || cleanTarget.length !== 10) {
        showToast("Please enter a valid 10-digit UID");
        return;
    }

    if (cleanTarget === cleanCaller) {
        showToast("You cannot call your own UID");
        return;
    }

    if (!socket || !socket.connected) {
        showToast("Connecting to server...");
        connectSocket();
        return;
    }

    currentTargetUid = cleanTarget;
    incomingCallType = type;

    const known = myContacts.find(c => c.uid === cleanTarget);
    const nameToShow = known ? known.name : `UID: ${cleanTarget}`;
    const avatarLetter = (known?.name || "U").charAt(0).toUpperCase();

    const outName = document.getElementById("outgoing-name");
    const outAvatar = document.getElementById("outgoing-avatar");
    const outStatus = document.getElementById("outgoing-status");

    if (outName) outName.innerText = nameToShow;
    if (outAvatar) outAvatar.innerText = avatarLetter;
    if (outStatus) outStatus.innerText = `Calling (${type === 'video' ? 'HD Video' : 'Audio'})...`;

    const outOverlay = document.getElementById("mobile-outgoing-call-overlay");
    if (outOverlay) {
        outOverlay.classList.remove("hidden");
        outOverlay.style.display = "flex";
    }

    socket.emit("initiate_call", {
        callerUid: cleanCaller,
        targetUid: cleanTarget,
        type: type,
        callerName: currentUser?.displayName || "Mobile User"
    });
}

async function answerCall(targetUid, type = "video") {
    const cleanTarget = String(targetUid || "").trim().replace(/\D/g, "");
    currentTargetUid = cleanTarget;
    incomingCallType = type;
    
    const inOverlay = document.getElementById("mobile-incoming-call-overlay");
    if (inOverlay) {
        inOverlay.classList.add("hidden");
        inOverlay.style.display = "none";
    }

    if (socket) {
        socket.emit("call_response", { targetUid: cleanTarget, status: "accepted" });
        socket.emit("answer_call", { callerUid: cleanTarget, answererUid: my10DigitUid });
    }
    await startMobileWebRTC(false);
}

function startTimer() {
    callDurationSeconds = 0;
    const timerEl = document.getElementById("call-duration-timer");
    if (callTimer) clearInterval(callTimer);
    callTimer = setInterval(() => {
        callDurationSeconds++;
        const mins = String(Math.floor(callDurationSeconds / 60)).padStart(2, '0');
        const secs = String(callDurationSeconds % 60).padStart(2, '0');
        if (timerEl) timerEl.innerText = `${mins}:${secs}`;
    }, 1000);
}

function endCall() {
    if (socket && currentTargetUid) {
        socket.emit("webrtc_end_call", { targetUid: currentTargetUid });
        socket.emit("end_call", { targetUid: currentTargetUid });
    }
    endCallCleanup();
}

function endCallCleanup() {
    if (callTimer) clearInterval(callTimer);
    callTimer = null;
    if (localStream) {
        localStream.getTracks().forEach(t => {
            try { t.stop(); } catch (_) {}
        });
        localStream = null;
    }
    if (peerConnection) {
        try { peerConnection.close(); } catch (_) {}
        peerConnection = null;
    }
    const localVideo = document.getElementById("local-video");
    const remoteVideo = document.getElementById("remote-video");
    if (localVideo) localVideo.srcObject = null;
    if (remoteVideo) remoteVideo.srcObject = null;

    const callScreen = document.getElementById("mobile-call-screen");
    if (callScreen) {
        callScreen.classList.add("hidden");
        callScreen.style.display = "none";
    }
    const inOverlay = document.getElementById("mobile-incoming-call-overlay");
    if (inOverlay) {
        inOverlay.classList.add("hidden");
        inOverlay.style.display = "none";
    }
    const outOverlay = document.getElementById("mobile-outgoing-call-overlay");
    if (outOverlay) {
        outOverlay.classList.add("hidden");
        outOverlay.style.display = "none";
    }

    currentTargetUid = null;
    pendingOffer = null;
    iceCandidatesQueue = [];
}

function openChat(contact) {
    currentTargetUid = contact.uid;
    const nameEl = document.getElementById("chat-contact-name");
    const uidEl = document.getElementById("chat-contact-uid");
    if (nameEl) nameEl.innerText = contact.name;
    if (uidEl) uidEl.innerText = `UID: ${contact.uid}`;
    
    const chatScreen = document.getElementById("mobile-chat-screen");
    if (chatScreen) {
        chatScreen.classList.remove("hidden");
        chatScreen.style.display = "flex";
    }
    renderChatMessages();
    const chatInput = document.getElementById("mobile-chat-input");
    if (chatInput) setTimeout(() => chatInput.focus(), 100);
}

function renderChatMessages() {
    const box = document.getElementById("mobile-chat-messages");
    if (!box || !currentTargetUid) return;
    box.innerHTML = "";
    const msgs = chatHistory[currentTargetUid] || [];
    msgs.forEach(m => {
        const b = document.createElement("div");
        b.className = `message-bubble ${m.sent ? 'sent' : 'received'}`;
        b.innerText = m.text;
        box.appendChild(b);
    });
    box.scrollTop = box.scrollHeight;
}

function sendChatMessage() {
    const input = document.getElementById("mobile-chat-input");
    const text = input?.value.trim();
    if (!text || !currentTargetUid) return;
    if (!chatHistory[currentTargetUid]) chatHistory[currentTargetUid] = [];
    chatHistory[currentTargetUid].push({ text, sent: true });
    renderChatMessages();
    
    const payload = {
        senderUid: my10DigitUid,
        receiverUid: currentTargetUid,
        targetUid: currentTargetUid,
        text: text,
        id: Date.now()
    };
    
    if (socket && socket.connected) {
        socket.emit("send_message", payload);
    }
    input.value = "";
}

function switchMobileView(viewId) {
    document.querySelectorAll(".mobile-nav-item").forEach(b => {
        b.classList.toggle("active", b.dataset.view === viewId);
    });
    document.querySelectorAll(".mobile-view").forEach(v => {
        if (v.id === viewId) {
            v.classList.remove("hidden");
            v.style.display = "flex";
        } else {
            v.classList.add("hidden");
            v.style.display = "none";
        }
    });
}

function loginUser(user) {
    currentUser = user;
    const authScreen = document.getElementById("mobile-auth-screen");
    if (authScreen) {
        authScreen.classList.add("hidden");
        authScreen.style.display = "none";
    }

    // Switch cleanly to Contacts View
    switchMobileView("view-contacts");

    const profName = document.getElementById("profile-name");
    const profEmail = document.getElementById("profile-email");
    const profAvatar = document.getElementById("profile-avatar");
    if (profName) profName.innerText = user.displayName || "Guest User";
    if (profEmail) profEmail.innerText = user.email || "Local Guest";
    if (profAvatar) profAvatar.innerText = (user.displayName || "G").charAt(0).toUpperCase();

    if (user.zingUid) {
        updateDisplays(user.zingUid);
    }
    connectSocket();
    loadContacts();
}

function logoutUser() {
    localStorage.removeItem("zingTalkMobileSession");
    currentUser = null;
    my10DigitUid = null;
    currentTargetUid = null;
    if (socket && socket.connected) {
        try {
            socket.emit("logout_user", { uid: my10DigitUid });
            socket.disconnect();
        } catch (_) {}
        socket = null;
    }
    const authScreen = document.getElementById("mobile-auth-screen");
    if (authScreen) {
        authScreen.classList.remove("hidden");
        authScreen.style.display = "flex";
    }
    document.querySelectorAll(".mobile-view").forEach(v => {
        v.classList.add("hidden");
        v.style.display = "none";
    });
    updateDisplays(null);
    showToast("Signed out successfully");
}

function initMobileApp() {
    // Navigation Tabs (Contacts, Dialpad, Profile)
    document.querySelectorAll(".mobile-nav-item").forEach(btn => {
        btn.addEventListener("click", () => {
            const viewId = btn.dataset.view;
            if (viewId) switchMobileView(viewId);
        });
    });

    // Dialpad Number & Action Clicks
    const dialInput = document.getElementById("mobile-dial-input");
    document.querySelectorAll(".dial-btn").forEach(b => {
        b.addEventListener("click", () => {
            const k = b.dataset.key;
            if (k === "C") {
                dialInput.value = "";
            } else if (k === "⌫") {
                dialInput.value = dialInput.value.slice(0, -1);
            } else if (dialInput.value.length < 10) {
                dialInput.value += k;
            }
        });
    });

    document.getElementById("mobile-dial-video-btn")?.addEventListener("click", () => {
        const val = dialInput.value.trim().replace(/\D/g, "");
        if (val.length === 10) initiateCall(val, "video");
        else showToast("Enter a 10-digit UID");
    });

    document.getElementById("mobile-dial-audio-btn")?.addEventListener("click", () => {
        const val = dialInput.value.trim().replace(/\D/g, "");
        if (val.length === 10) initiateCall(val, "audio");
        else showToast("Enter a 10-digit UID");
    });

    // Contacts Add Modal
    document.getElementById("open-add-contact-btn")?.addEventListener("click", () => {
        const modal = document.getElementById("add-contact-modal");
        if (modal) {
            modal.classList.remove("hidden");
            modal.style.display = "flex";
            document.getElementById("new-contact-name")?.focus();
        }
    });
    document.getElementById("cancel-contact-btn")?.addEventListener("click", () => {
        const modal = document.getElementById("add-contact-modal");
        if (modal) {
            modal.classList.add("hidden");
            modal.style.display = "none";
        }
    });
    document.getElementById("save-new-contact-btn")?.addEventListener("click", () => {
        const name = document.getElementById("new-contact-name")?.value.trim();
        const uid = document.getElementById("new-contact-uid")?.value.trim().replace(/\D/g, '');
        if (name && uid.length === 10) {
            myContacts.unshift({ name, uid });
            saveContacts();
            const modal = document.getElementById("add-contact-modal");
            if (modal) {
                modal.classList.add("hidden");
                modal.style.display = "none";
            }
            document.getElementById("new-contact-name").value = "";
            document.getElementById("new-contact-uid").value = "";
            showToast("Contact saved!");
        } else {
            showToast("Enter valid name and 10-digit UID");
        }
    });

    // Chat Screen Controls
    document.getElementById("close-chat-btn")?.addEventListener("click", () => {
        const chatScreen = document.getElementById("mobile-chat-screen");
        if (chatScreen) {
            chatScreen.classList.add("hidden");
            chatScreen.style.display = "none";
        }
        currentTargetUid = null;
    });
    document.getElementById("mobile-chat-send-btn")?.addEventListener("click", sendChatMessage);
    document.getElementById("mobile-chat-input")?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") sendChatMessage();
    });
    document.getElementById("chat-audio-btn")?.addEventListener("click", () => {
        if (currentTargetUid) initiateCall(currentTargetUid, "audio");
    });
    document.getElementById("chat-video-btn")?.addEventListener("click", () => {
        if (currentTargetUid) initiateCall(currentTargetUid, "video");
    });

    // Call Screen Controls
    document.getElementById("end-call-btn")?.addEventListener("click", endCall);
    document.getElementById("flip-camera-btn")?.addEventListener("click", switchCamera);
    document.getElementById("mute-mic-btn")?.addEventListener("click", () => {
        if (localStream) {
            const track = localStream.getAudioTracks()[0];
            if (track) {
                isMicMuted = !isMicMuted;
                track.enabled = !isMicMuted;
                showToast(isMicMuted ? "Microphone muted" : "Microphone active");
            }
        }
    });
    document.getElementById("toggle-video-btn")?.addEventListener("click", () => {
        if (localStream) {
            const track = localStream.getVideoTracks()[0];
            if (track) {
                isVideoDisabled = !isVideoDisabled;
                track.enabled = !isVideoDisabled;
                showToast(isVideoDisabled ? "Camera off" : "Camera on");
            }
        }
    });

    // Mobile Incoming & Outgoing Call Overlays
    document.getElementById("mobile-accept-call-btn")?.addEventListener("click", () => {
        if (incomingCallerUid) {
            answerCall(incomingCallerUid, incomingCallType);
        }
    });
    document.getElementById("mobile-decline-call-btn")?.addEventListener("click", () => {
        const inOverlay = document.getElementById("mobile-incoming-call-overlay");
        if (inOverlay) {
            inOverlay.classList.add("hidden");
            inOverlay.style.display = "none";
        }
        if (socket && incomingCallerUid) {
            socket.emit("call_response", { targetUid: incomingCallerUid, status: "rejected" });
            socket.emit("cancel_call", { targetUid: incomingCallerUid });
        }
        incomingCallerUid = null;
    });
    document.getElementById("mobile-cancel-outgoing-btn")?.addEventListener("click", () => {
        const outOverlay = document.getElementById("mobile-outgoing-call-overlay");
        if (outOverlay) {
            outOverlay.classList.add("hidden");
            outOverlay.style.display = "none";
        }
        if (socket && currentTargetUid) {
            socket.emit("cancel_call", { targetUid: currentTargetUid });
        }
        endCallCleanup();
    });

    // Mobile Privacy Policy Modal
    document.getElementById("open-mobile-policy-btn")?.addEventListener("click", () => {
        const pModal = document.getElementById("mobile-policy-modal");
        if (pModal) {
            pModal.classList.remove("hidden");
            pModal.style.display = "flex";
        }
    });
    document.getElementById("close-policy-btn")?.addEventListener("click", () => {
        const pModal = document.getElementById("mobile-policy-modal");
        if (pModal) {
            pModal.classList.add("hidden");
            pModal.style.display = "none";
        }
    });

    // Profile & Logout
    document.getElementById("mobile-logout-btn")?.addEventListener("click", logoutUser);
    document.getElementById("copy-my-uid-btn")?.addEventListener("click", () => {
        if (my10DigitUid) {
            navigator.clipboard.writeText(my10DigitUid).then(() => showToast(`Copied: ${my10DigitUid}`));
        }
    });

    // Guest Login Modal Flow (Prompt for Name)
    const guestBtn = document.getElementById("mobile-guest-btn");
    const guestModal = document.getElementById("mobile-guest-modal");
    const confirmGuestBtn = document.getElementById("mobile-confirm-guest-btn");
    const cancelGuestBtn = document.getElementById("mobile-cancel-guest-btn");
    const guestNameInput = document.getElementById("mobile-guest-name-input");

    guestBtn?.addEventListener("click", () => {
        if (guestModal) {
            guestModal.classList.remove("hidden");
            guestModal.style.display = "flex";
            if (guestNameInput) {
                guestNameInput.value = "";
                setTimeout(() => guestNameInput.focus(), 100);
            }
        }
    });

    cancelGuestBtn?.addEventListener("click", () => {
        if (guestModal) {
            guestModal.classList.add("hidden");
            guestModal.style.display = "none";
        }
    });

    const handleConfirmGuest = () => {
        const enteredName = guestNameInput?.value.trim() || "Guest User";
        const guestUid = computeDeterministic10DigitUid("guest_" + Date.now());
        const user = {
            displayName: enteredName,
            email: null,
            uid: "guest_" + guestUid,
            zingUid: guestUid,
            isGuest: true
        };
        if (guestModal) {
            guestModal.classList.add("hidden");
            guestModal.style.display = "none";
        }
        localStorage.setItem("zingTalkMobileSession", JSON.stringify(user));
        loginUser(user);
        showToast(`Welcome ${enteredName}!`);
    };

    confirmGuestBtn?.addEventListener("click", handleConfirmGuest);
    guestNameInput?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") handleConfirmGuest();
    });

    // Auth Form (Sign Up / Sign In)
    const toggleBtn = document.getElementById("mobile-auth-toggle-btn");
    const nameGroup = document.getElementById("mobile-auth-name-group");
    const submitBtn = document.getElementById("mobile-auth-submit-btn");

    toggleBtn?.addEventListener("click", () => {
        isSignUpMode = !isSignUpMode;
        if (isSignUpMode) {
            nameGroup?.classList.remove("hidden");
            if (nameGroup) nameGroup.style.display = "flex";
            submitBtn.innerText = "Create Account";
            toggleBtn.innerText = "Sign In";
            document.getElementById("mobile-auth-toggle-label").innerText = "Already have an account?";
        } else {
            nameGroup?.classList.add("hidden");
            if (nameGroup) nameGroup.style.display = "none";
            submitBtn.innerText = "Sign In";
            toggleBtn.innerText = "Sign Up";
            document.getElementById("mobile-auth-toggle-label").innerText = "Don't have an account?";
        }
    });

    submitBtn?.addEventListener("click", async () => {
        const email = document.getElementById("mobile-auth-email")?.value.trim();
        const pass = document.getElementById("mobile-auth-pass")?.value.trim();
        const name = document.getElementById("mobile-auth-name")?.value.trim();
        if (!email || !pass) {
            showToast("Enter email and password");
            return;
        }
        if (!auth) {
            showToast("Auth offline. Using guest.");
            return;
        }
        try {
            if (isSignUpMode) {
                const cred = await createUserWithEmailAndPassword(auth, email, pass);
                if (name) {
                    try { await updateProfile(cred.user, { displayName: name }); } catch (_) {}
                }
                let resolvedUid = await lookupUserUidFromFirestore(email, cred.user.uid);
                if (!resolvedUid) resolvedUid = computeDeterministic10DigitUid(email);
                const user = {
                    displayName: name || email.split("@")[0],
                    email: email,
                    uid: cred.user.uid,
                    zingUid: resolvedUid
                };
                localStorage.setItem("zingTalkMobileSession", JSON.stringify(user));
                saveUserUidToFirestore(user, resolvedUid);
                loginUser(user);
                showToast("Account created!");
            } else {
                const cred = await signInWithEmailAndPassword(auth, email, pass);
                let resolvedUid = await lookupUserUidFromFirestore(email, cred.user.uid);
                if (!resolvedUid) resolvedUid = computeDeterministic10DigitUid(email);
                const user = {
                    displayName: cred.user.displayName || email.split("@")[0],
                    email: email,
                    uid: cred.user.uid,
                    zingUid: resolvedUid
                };
                localStorage.setItem("zingTalkMobileSession", JSON.stringify(user));
                saveUserUidToFirestore(user, resolvedUid);
                loginUser(user);
                showToast("Signed in!");
            }
        } catch (err) {
            showToast(err.message || "Authentication failed");
        }
    });

    // Forgot Password Handlers
    const forgotBtn = document.getElementById("mobile-forgot-password-btn");
    const forgotModal = document.getElementById("mobile-forgot-modal");
    const cancelResetBtn = document.getElementById("mobile-cancel-reset-btn");
    const sendResetBtn = document.getElementById("mobile-send-reset-btn");
    const resetEmailInput = document.getElementById("mobile-reset-email");
    const resetStatus = document.getElementById("mobile-reset-status");

    forgotBtn?.addEventListener("click", () => {
        const currentEmail = document.getElementById("mobile-auth-email")?.value.trim() || "";
        if (resetEmailInput) resetEmailInput.value = currentEmail;
        if (resetStatus) {
            resetStatus.className = "hidden";
            resetStatus.textContent = "";
            resetStatus.style.display = "none";
        }
        if (forgotModal) {
            forgotModal.classList.remove("hidden");
            forgotModal.style.display = "flex";
            resetEmailInput?.focus();
        }
    });

    cancelResetBtn?.addEventListener("click", () => {
        if (forgotModal) {
            forgotModal.classList.add("hidden");
            forgotModal.style.display = "none";
        }
    });

    sendResetBtn?.addEventListener("click", async () => {
        const email = resetEmailInput?.value.trim();
        if (!email) {
            if (resetStatus) {
                resetStatus.className = "";
                resetStatus.style.display = "block";
                resetStatus.style.background = "rgba(239, 68, 68, 0.15)";
                resetStatus.style.color = "#f87171";
                resetStatus.style.border = "1px solid rgba(239, 68, 68, 0.4)";
                resetStatus.textContent = "Please enter your registered email address.";
            }
            return;
        }

        if (!auth) {
            if (resetStatus) {
                resetStatus.className = "";
                resetStatus.style.display = "block";
                resetStatus.style.background = "rgba(239, 68, 68, 0.15)";
                resetStatus.style.color = "#f87171";
                resetStatus.style.border = "1px solid rgba(239, 68, 68, 0.4)";
                resetStatus.textContent = "Authentication service is currently offline. Please try again later.";
            }
            return;
        }

        sendResetBtn.disabled = true;
        sendResetBtn.textContent = "Sending Link...";

        try {
            let sentViaCustomBrevo = false;
            try {
                const sUrl = getEffectiveServerUrl();
                const res = await fetch(`${sUrl}/api/auth/custom-reset-password`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email: email })
                });
                const data = await res.json();
                if (data && data.success) {
                    sentViaCustomBrevo = true;
                    console.log("[ZingTalk Mobile] Branded password reset dispatched via Brevo successfully!");
                } else {
                    console.warn("[ZingTalk Mobile] Custom reset mailer notice:", data?.message);
                }
            } catch (mailerErr) {
                console.warn("[ZingTalk Mobile] Mailer endpoint unreachable:", mailerErr.message);
            }

            if (!sentViaCustomBrevo) {
                await sendPasswordResetEmail(auth, email);
            }
            if (resetStatus) {
                resetStatus.className = "";
                resetStatus.style.display = "block";
                resetStatus.style.background = "rgba(0, 210, 157, 0.15)";
                resetStatus.style.color = "#00d29d";
                resetStatus.style.border = "1px solid rgba(0, 210, 157, 0.4)";
                resetStatus.innerHTML = "✅ Password reset email sent! Check your inbox and spam folder.";
            }
            showToast("Password reset link sent to " + email);
            setTimeout(() => {
                if (forgotModal) {
                    forgotModal.classList.add("hidden");
                    forgotModal.style.display = "none";
                }
                sendResetBtn.disabled = false;
                sendResetBtn.textContent = "Send Reset Link";
            }, 3000);
        } catch (err) {
            console.error("[Password Reset Error]:", err);
            let msg = err.message || "Failed to send reset link.";
            if (err.code === "auth/user-not-found") {
                msg = "No registered account found with this email.";
            } else if (err.code === "auth/invalid-email") {
                msg = "Please enter a valid email address.";
            }
            if (resetStatus) {
                resetStatus.className = "";
                resetStatus.style.display = "block";
                resetStatus.style.background = "rgba(239, 68, 68, 0.15)";
                resetStatus.style.color = "#f87171";
                resetStatus.style.border = "1px solid rgba(239, 68, 68, 0.4)";
                resetStatus.textContent = msg;
            }
            sendResetBtn.disabled = false;
            sendResetBtn.textContent = "Send Reset Link";
        }
    });

    // Check saved session
    const saved = localStorage.getItem("zingTalkMobileSession");
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            if (parsed) loginUser(parsed);
        } catch (_) {}
    }
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initMobileApp);
} else {
    initMobileApp();
}
