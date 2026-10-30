import { initializeApp } from "https://www.gstatic.com/firebasejs/10.4.0/firebase-app.js";
import { 
    getAuth, 
    signInWithEmailAndPassword, 
    createUserWithEmailAndPassword,
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
        card.querySelector(".chat-btn").addEventListener("click", () => openChat(contact));
        card.querySelector(".audio-btn").addEventListener("click", () => initiateCall(contact.uid, "audio"));
        card.querySelector(".video-btn").addEventListener("click", () => initiateCall(contact.uid, "video"));
        list.appendChild(card);
    });
}

function connectSocket() {
    const serverUrl = getEffectiveServerUrl();
    if (socket && socket.connected) return;

    if (typeof io === "undefined") return;
    socket = io(serverUrl, {
        transports: ["websocket", "polling"],
        reconnectionAttempts: 15,
        reconnectionDelay: 1500
    });

    socket.on("connect", () => {
        if (currentUser) {
            socket.emit("login_user", {
                email: currentUser.email,
                name: currentUser.displayName,
                authUid: currentUser.uid,
                uid: my10DigitUid
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

    socket.on("incoming_call", (data) => {
        const accept = window.confirm(`Incoming ${data.type || 'video'} call from UID: ${data.callerUid}. Accept?`);
        if (accept) {
            currentTargetUid = data.callerUid;
            answerCall(data.callerUid, data.type || "video");
        } else {
            socket.emit("cancel_call", { targetUid: data.callerUid });
        }
    });

    socket.on("call_accepted", async (data) => {
        await setupPeerConnection();
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit("webrtc_offer", { targetUid: currentTargetUid, offer: offer });
    });

    socket.on("webrtc_offer", async (data) => {
        await setupPeerConnection();
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        socket.emit("webrtc_answer", { targetUid: data.callerUid, answer: answer });
    });

    socket.on("webrtc_answer", async (data) => {
        if (peerConnection) {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
        }
    });

    socket.on("webrtc_ice_candidate", async (data) => {
        if (peerConnection && data.candidate) {
            try {
                await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
            } catch (_) {}
        }
    });

    socket.on("call_ended", () => {
        endCallCleanup();
        showToast("Call ended.");
    });

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
    localStream = await navigator.mediaDevices.getUserMedia(constraints);
    const localVideo = document.getElementById("local-video");
    if (localVideo) localVideo.srcObject = localStream;
}

async function switchCamera() {
    currentFacingMode = currentFacingMode === "user" ? "environment" : "user";
    if (localStream) {
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) videoTrack.stop();
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

async function initiateCall(targetUid, type = "video") {
    currentTargetUid = targetUid;
    await setupLocalMedia(type === "video");
    document.getElementById("mobile-call-screen")?.classList.remove("hidden");
    document.getElementById("call-target-display").innerText = `Calling ${targetUid}...`;
    startTimer();
    socket.emit("initiate_call", {
        callerUid: my10DigitUid,
        targetUid: targetUid,
        type: type,
        callerName: currentUser?.displayName || "Mobile User"
    });
}

async function answerCall(targetUid, type = "video") {
    currentTargetUid = targetUid;
    await setupLocalMedia(type === "video");
    document.getElementById("mobile-call-screen")?.classList.remove("hidden");
    document.getElementById("call-target-display").innerText = `In call with ${targetUid}`;
    startTimer();
    socket.emit("answer_call", { callerUid: targetUid, answererUid: my10DigitUid });
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
        socket.emit("end_call", { targetUid: currentTargetUid });
    }
    endCallCleanup();
}

function endCallCleanup() {
    if (callTimer) clearInterval(callTimer);
    callTimer = null;
    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
    }
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    document.getElementById("mobile-call-screen")?.classList.add("hidden");
    currentTargetUid = null;
}

function openChat(contact) {
    currentTargetUid = contact.uid;
    document.getElementById("chat-contact-name").innerText = contact.name;
    document.getElementById("chat-contact-uid").innerText = `UID: ${contact.uid}`;
    document.getElementById("mobile-chat-screen")?.classList.remove("hidden");
    renderChatMessages();
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
    socket.emit("send_message", {
        senderUid: my10DigitUid,
        targetUid: currentTargetUid,
        text: text,
        id: Date.now()
    });
    input.value = "";
}

function loginUser(user) {
    currentUser = user;
    document.getElementById("mobile-auth-screen")?.classList.add("hidden");
    document.getElementById("profile-name").innerText = user.displayName || "User";
    document.getElementById("profile-email").innerText = user.email || "Local Guest";
    document.getElementById("profile-avatar").innerText = (user.displayName || "U").charAt(0).toUpperCase();

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
    document.getElementById("mobile-auth-screen")?.classList.remove("hidden");
}

document.addEventListener("DOMContentLoaded", () => {
    // Navigation Tabs
    document.querySelectorAll(".mobile-nav-item").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".mobile-nav-item").forEach(b => b.classList.remove("active"));
            document.querySelectorAll(".mobile-view").forEach(v => v.classList.add("hidden"));
            btn.classList.add("active");
            const viewId = btn.dataset.view;
            document.getElementById(viewId)?.classList.remove("hidden");
        });
    });

    // Dialpad Number Clicks
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
        const val = dialInput.value.trim();
        if (val.length === 10) initiateCall(val, "video");
        else showToast("Enter a 10-digit UID");
    });

    document.getElementById("mobile-dial-audio-btn")?.addEventListener("click", () => {
        const val = dialInput.value.trim();
        if (val.length === 10) initiateCall(val, "audio");
        else showToast("Enter a 10-digit UID");
    });

    // Contacts
    document.getElementById("open-add-contact-btn")?.addEventListener("click", () => {
        document.getElementById("add-contact-modal")?.classList.remove("hidden");
    });
    document.getElementById("cancel-contact-btn")?.addEventListener("click", () => {
        document.getElementById("add-contact-modal")?.classList.add("hidden");
    });
    document.getElementById("save-new-contact-btn")?.addEventListener("click", () => {
        const name = document.getElementById("new-contact-name")?.value.trim();
        const uid = document.getElementById("new-contact-uid")?.value.trim().replace(/\D/g, '');
        if (name && uid.length === 10) {
            myContacts.unshift({ name, uid });
            saveContacts();
            document.getElementById("add-contact-modal")?.classList.add("hidden");
            document.getElementById("new-contact-name").value = "";
            document.getElementById("new-contact-uid").value = "";
            showToast("Contact saved!");
        } else {
            showToast("Enter valid name and 10-digit UID");
        }
    });

    // Chat Controls
    document.getElementById("close-chat-btn")?.addEventListener("click", () => {
        document.getElementById("mobile-chat-screen")?.classList.add("hidden");
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
                showToast(isMicMuted ? "Microphone muted" : "Microphone unmuted");
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

    // Profile & Logout
    document.getElementById("mobile-logout-btn")?.addEventListener("click", logoutUser);
    document.getElementById("copy-my-uid-btn")?.addEventListener("click", () => {
        if (my10DigitUid) {
            navigator.clipboard.writeText(my10DigitUid).then(() => showToast(`Copied: ${my10DigitUid}`));
        }
    });

    // Auth Form
    const toggleBtn = document.getElementById("mobile-auth-toggle-btn");
    const nameGroup = document.getElementById("mobile-auth-name-group");
    const submitBtn = document.getElementById("mobile-auth-submit-btn");

    toggleBtn?.addEventListener("click", () => {
        isSignUpMode = !isSignUpMode;
        if (isSignUpMode) {
            nameGroup?.classList.remove("hidden");
            submitBtn.innerText = "Create Account";
            toggleBtn.innerText = "Sign In";
            document.getElementById("mobile-auth-toggle-label").innerText = "Already have an account?";
        } else {
            nameGroup?.classList.add("hidden");
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

    document.getElementById("mobile-guest-btn")?.addEventListener("click", () => {
        const guestUid = computeDeterministic10DigitUid("guest_" + Date.now());
        const user = {
            displayName: "Guest User",
            email: null,
            uid: "guest_" + guestUid,
            zingUid: guestUid
        };
        localStorage.setItem("zingTalkMobileSession", JSON.stringify(user));
        loginUser(user);
        showToast("Logged in as Guest");
    });

    // Check saved session
    const saved = localStorage.getItem("zingTalkMobileSession");
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            if (parsed) loginUser(parsed);
        } catch (_) {}
    }
});
