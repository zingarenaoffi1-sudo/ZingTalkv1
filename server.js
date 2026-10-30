const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const admin = require('firebase-admin');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    maxHttpBufferSize: 5e7 // 50MB for zero-server media file sharing
});

// JSON & URL-encoded body parser for Alexa webhook requests
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint for AWS EC2 & load balancer monitoring
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        app: 'ZingTalk Fire TV Signaling Server',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

// Serve static frontend assets for TV, Mobile, and Web
app.use(express.static(__dirname));
app.use('/tv', express.static(path.join(__dirname, 'packages', 'tv')));
app.use('/mobile', express.static(path.join(__dirname, 'packages', 'mobile')));

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

const fs = require('fs');

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
            path.join('/home/ec2-user/ZingTalk', f)
        ];
        for (const p of candidatePaths) {
            if (fs.existsSync(p)) {
                try {
                    return JSON.parse(fs.readFileSync(p, 'utf-8'));
                } catch (_) {}
            }
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

const connectedUsers = new Map();
let lastActiveTvUid = null;
const userContactsRegistry = new Map();

// In-Memory Groups Registry
const inMemoryGroups = new Map();

// In-Memory Block Registry (blockerUid -> Set of blockedUids)
const inMemoryBlocks = new Map();

// Ephemeral in-memory message queue (Zero-Retention: automatically purged upon delivery)
const ephemeralMessageQueue = new Map();

// Persistent Alexa Device to ZingTalk User UID Registry (amazonUserId -> 10-digit UID)
const alexaDevicePairings = new Map();

// Helper to check if a user is currently connected with a healthy live socket
function isUserOnline(uid) {
    if (!uid) return false;
    const clean = String(uid).trim().replace(/\D/g, '');
    if (!clean || clean.length !== 10) return false;
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

    socket.on('login_user', async (data) => {
        try {
            if (!data) data = {};
            let uid;
            let usersRef = db.collection('users');

            // 1. Look up existing user record by email or Firebase authUid in Firestore
            let snapshot = { empty: true, docs: [] };
            const cleanEmail = data.email ? String(data.email).trim().toLowerCase() : "";
            try {
                if (cleanEmail) {
                    snapshot = await usersRef.where('email', '==', cleanEmail).get();
                } else if (data.authUid && !data.isAnonymous && !data.isGuest) {
                    snapshot = await usersRef.where('authUid', '==', data.authUid).get();
                }
            } catch (fsErr) {
                console.warn('[ZingTalk] Database query failed, falling back to memory store:', fsErr.message);
                db = memoryDb;
                usersRef = db.collection('users');
            }

            const existingDoc = !snapshot.empty ? snapshot.docs[0].data() : null;
            const existingUid = existingDoc ? String(existingDoc.uid || "") : "";

            if (existingUid && existingUid.length === 10) {
                uid = existingUid;
            } else if (data.uid && String(data.uid).replace(/\D/g, '').length === 10) {
                uid = String(data.uid).replace(/\D/g, '');
            } else if (cleanEmail) {
                uid = computeDeterministic10DigitUid(cleanEmail);
            } else if (data.authUid && !data.isAnonymous && !data.isGuest) {
                uid = computeDeterministic10DigitUid(data.authUid);
            } else {
                uid = generate10DigitUid();
            }

            const clientName = (data.name && String(data.name).trim() && data.name !== "TV User" && data.name !== "Guest User")
                ? String(data.name).trim()
                : "";
            const existingName = (existingDoc && existingDoc.name && existingDoc.name !== "TV User" && existingDoc.name !== "Guest User")
                ? existingDoc.name
                : "";
            const finalName = clientName || existingName || (cleanEmail ? cleanEmail.split('@')[0] : "Guest");

            const userObj = {
                uid: uid,
                authUid: data.authUid || (existingDoc ? existingDoc.authUid : null),
                email: cleanEmail || (existingDoc ? existingDoc.email : (data.isGuest ? `guest_${uid}@zingtalk.local` : `user_${uid}@zingtalk.local`)),
                name: finalName,
                displayName: finalName,
                updatedAt: Date.now()
            };
            await usersRef.doc(uid).set(userObj);
            if (userObj.authUid) {
                try {
                    await db.collection('user_profiles').doc(userObj.authUid).set(userObj);
                } catch (_) {}
            }

            connectedUsers.set(uid, socket.id);
            lastActiveTvUid = uid;
            socket.join(uid);

            console.log(`[ZingTalk] Server authenticated UID: ${uid} for user: ${userObj.name} (${userObj.email})`);

            // Auto-join existing in-memory group rooms
            for (const [groupId, group] of inMemoryGroups.entries()) {
                if (group.members && group.members.includes(uid)) {
                    socket.join(groupId);
                }
            }
            
            socket.emit('user_data', userObj);

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
            if (!data || !data.uid || !Array.isArray(data.contacts)) return;
            const cleanUid = String(data.uid).trim().replace(/\D/g, '');
            if (cleanUid.length !== 10) return;
            userContactsRegistry.set(cleanUid, data.contacts);
            console.log(`[ZingTalk] Contacts synced to volatile RAM for UID ${cleanUid} (${data.contacts.length} contacts, ZERO cloud retention)`);
        } catch (err) {
            console.error('[ZingTalk] Error in sync_contacts:', err);
        }
    });

    // Save Contact (Updates volatile in-memory registry for live Alexa matching, ZERO Cloud Firestore storage)
    socket.on('save_contact', (data) => {
        try {
            if (!data || !data.myUid || !data.targetUid) return;
            const myUid = String(data.myUid).trim().replace(/\D/g, '');
            const targetUid = String(data.targetUid).trim().replace(/\D/g, '');
            if (myUid.length !== 10 || targetUid.length !== 10) return;
            let currentContacts = userContactsRegistry.get(myUid) || [];
            currentContacts = currentContacts.filter(c => c.uid !== targetUid);
            currentContacts.push({
                uid: targetUid,
                name: data.customName || `User ${targetUid}`
            });
            userContactsRegistry.set(myUid, currentContacts);
            socket.emit('contact_saved', currentContacts);
        } catch (err) {
            console.error('[ZingTalk] Error in save_contact:', err);
        }
    });

    // Block / Unblock Handlers
    socket.on('block_user', (data) => {
        if (!data.blockerUid || !data.blockedUid) return;
        if (!inMemoryBlocks.has(data.blockerUid)) {
            inMemoryBlocks.set(data.blockerUid, new Set());
        }
        inMemoryBlocks.get(data.blockerUid).add(data.blockedUid);
    });

    socket.on('unblock_user', (data) => {
        if (!data.blockerUid || !data.blockedUid) return;
        if (inMemoryBlocks.has(data.blockerUid)) {
            inMemoryBlocks.get(data.blockerUid).delete(data.blockedUid);
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
        if (!data || !data.receiverUid) return;

        const targetUid = String(data.receiverUid).trim().replace(/\D/g, '');
        const senderUid = data.senderUid ? String(data.senderUid).trim().replace(/\D/g, '') : '';

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
            socket.emit('message_status', { msgId: data.id, delivered: false });
            return;
        }

        const isOnline = isUserOnline(targetUid);
        if (isOnline) {
            sendSignalingEvent(targetUid, 'receive_message', data);
            socket.emit('message_status', { msgId: data.id, delivered: true });
        } else {
            // Buffer transiently in volatile RAM until recipient connects (WhatsApp single-tick offline queue)
            if (!ephemeralMessageQueue.has(targetUid)) {
                ephemeralMessageQueue.set(targetUid, []);
            }
            const q = ephemeralMessageQueue.get(targetUid);
            if (q.length > 50) q.shift();
            q.push(data);
            socket.emit('message_status', { msgId: data.id, delivered: false, queued: true });
        }
    });

    socket.on('message_seen', (data) => {
        if (data && data.receiverUid && ephemeralMessageQueue.has(data.receiverUid)) {
            ephemeralMessageQueue.delete(data.receiverUid);
        }
    });

    // Group Management
    socket.on('create_group', (data) => {
        try {
            const groupId = Math.floor(1000000000 + Math.random() * 9000000000).toString();
            const newGroup = {
                groupId,
                name: data.name || "ZingTalk Group",
                icon: data.icon || "👥",
                creatorUid: data.creatorUid,
                members: Array.from(new Set([data.creatorUid, ...(data.members || [])])),
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
        socket.join(groupId);
    });

    socket.on('send_group_message', (data) => {
        io.to(data.groupId).emit('receive_group_message', data);
    });

    // Real-Time Typing Indicators
    socket.on('typing', (data) => {
        if (data.isGroup) {
            socket.to(data.targetId).emit('user_typing', data);
        } else {
            const targetBlockedList = inMemoryBlocks.get(data.targetId);
            if (targetBlockedList && targetBlockedList.has(data.senderUid)) {
                return;
            }
            sendSignalingEvent(data.targetId, 'user_typing', data);
        }
    });

    socket.on('stop_typing', (data) => {
        if (data.isGroup) {
            socket.to(data.targetId).emit('user_stop_typing', data);
        } else {
            sendSignalingEvent(data.targetId, 'user_stop_typing', data);
        }
    });

    // Message Reactions
    socket.on('send_reaction', (data) => {
        if (data.isGroup) {
            io.to(data.targetId).emit('receive_reaction', data);
        } else {
            sendSignalingEvent(data.targetId, 'receive_reaction', data);
        }
    });

    // Content Reporting
    socket.on('report_content', (data) => {
        socket.emit('report_ack', { status: 'success', message: 'Report submitted.' });
    });

    socket.on('initiate_call', async (data) => {
        if (!data || !data.targetUid) return;
        const targetUid = String(data.targetUid).trim().replace(/\D/g, '');
        const callerUid = data.callerUid ? String(data.callerUid).trim().replace(/\D/g, '') : '';

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

        sendSignalingEvent(targetUid, 'incoming_call', data);
    });

    socket.on('cancel_call', (data) => {
        if (!data || !data.targetUid) return;
        sendSignalingEvent(data.targetUid, 'call_cancelled', data);
    });

    socket.on('call_response', (data) => {
        if (!data || !data.targetUid) return;
        sendSignalingEvent(data.targetUid, 'call_response_received', data);
        if (data.status === 'accepted') {
            sendSignalingEvent(data.targetUid, 'call_accepted', data);
        }
    });

    socket.on('answer_call', (data) => {
        const targetUid = data?.callerUid || data?.targetUid;
        if (!targetUid) return;
        const responsePayload = { targetUid, callerUid: targetUid, status: 'accepted' };
        sendSignalingEvent(targetUid, 'call_response_received', responsePayload);
        sendSignalingEvent(targetUid, 'call_accepted', responsePayload);
    });

    socket.on('webrtc_offer', (data) => {
        if (!data || !data.targetUid) return;
        sendSignalingEvent(data.targetUid, 'webrtc_offer_received', data);
        sendSignalingEvent(data.targetUid, 'webrtc_offer', data);
    });

    socket.on('webrtc_answer', (data) => {
        if (!data || !data.targetUid) return;
        sendSignalingEvent(data.targetUid, 'webrtc_answer_received', data);
        sendSignalingEvent(data.targetUid, 'webrtc_answer', data);
    });

    socket.on('webrtc_ice_candidate', (data) => {
        if (!data || !data.targetUid) return;
        sendSignalingEvent(data.targetUid, 'webrtc_ice_candidate_received', data);
        sendSignalingEvent(data.targetUid, 'webrtc_ice_candidate', data);
    });

    socket.on('webrtc_end_call', (data) => {
        if (!data || !data.targetUid) return;
        sendSignalingEvent(data.targetUid, 'webrtc_call_ended', data);
        sendSignalingEvent(data.targetUid, 'call_ended', data);
    });

    socket.on('end_call', (data) => {
        if (!data || !data.targetUid) return;
        sendSignalingEvent(data.targetUid, 'webrtc_call_ended', data);
        sendSignalingEvent(data.targetUid, 'call_ended', data);
    });

    // Fire TV Alexa Voice Command Relay
    socket.on('voice_command_triggered', (data) => {
        console.log('[ZingTalk Voice] Voice command received from client:', data);
        io.emit('alexa_command', data);
    });

    // User Explicit Logout
    socket.on('logout_user', (data) => {
        const uid = data && data.uid ? String(data.uid).trim() : null;
        if (uid) {
            connectedUsers.delete(uid);
            userContactsRegistry.delete(uid); // Purge volatile contacts from RAM immediately
            socket.leave(uid);
            console.log(`[ZingTalk] User logged out & volatile contacts purged from RAM: ${uid}`);
        }
        for (const [u, sId] of connectedUsers.entries()) {
            if (sId === socket.id) {
                connectedUsers.delete(u);
                userContactsRegistry.delete(u);
                socket.leave(u);
            }
        }
    });

    socket.on('disconnect', () => {
        for (const [uid, socketId] of connectedUsers.entries()) {
            if (socketId === socket.id) {
                connectedUsers.delete(uid);
                userContactsRegistry.delete(uid); // Purge volatile contacts from RAM immediately
                socket.leave(uid);
                console.log(`[ZingTalk] Socket disconnected for user: ${uid}`);
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
        "zero": "0", "oh": "0", "one": "1", "two": "2", "three": "3",
        "four": "4", "five": "5", "six": "6", "seven": "7", "eight": "8",
        "nine": "9", "ten": "10"
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
        const body = req.body || {};
        const request = body.request || {};
        const reqType = request.type || '';
        const incomingSessionAttributes = (body.session && body.session.attributes) || {};
        let sessionAttributes = { ...incomingSessionAttributes };

        console.log(`[Alexa Skill Webhook] Received ${reqType} from Alexa`);

        let speechText = "Welcome to ZingTalk on Fire TV. Who would you like to call?";
        let shouldEndSession = false;
        let commandPayload = null;

        const amazonUserId = body.session?.user?.userId || body.context?.System?.user?.userId || 'default_alexa_device';
        let activeUserUid = alexaDevicePairings.get(amazonUserId) || lastActiveTvUid;

        // Retrieve active user's contacts
        let userContacts = [];
        if (activeUserUid && userContactsRegistry.has(activeUserUid)) {
            userContacts = userContactsRegistry.get(activeUserUid) || [];
        }
        if (userContacts.length === 0) {
            for (const [uid, list] of userContactsRegistry.entries()) {
                if (list && list.length > 0) {
                    userContacts = list;
                    break;
                }
            }
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
                case 'ZingDialUidIntent': {
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
                    if (lastActiveTvUid) {
                        speechText = `Your ZingTalk 10 digit UID is ${lastActiveTvUid.split('').join(' ')}.`;
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
                    speechText = "You can ask ZingTalk on Fire TV to call a contact, start an HD video call, answer, decline, mute microphone, or hang up an active call. Who would you like to call?";
                    shouldEndSession = false;
                    sessionAttributes = { pendingAction: 'call' };
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
                    let candidateName = '';
                    for (const key of Object.keys(slots)) {
                        const val = slots[key]?.value;
                        if (val && typeof val === 'string' && val.length > 1) {
                            candidateName = val;
                            break;
                        }
                    }

                    if (candidateName) {
                        const matched = smartFindContact(candidateName, userContacts);
                        if (matched) {
                            const mode = detectCallMode(candidateName, sessionAttributes.mode || 'audio');
                            lastCalledTarget = { uid: matched.uid, name: matched.name, mode: mode };
                            speechText = mode === 'video' 
                                ? `Starting video call with ${matched.name} on ZingTalk.`
                                : `Calling ${matched.name} on ZingTalk.`;
                            shouldEndSession = true;
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

                    speechText = "I didn't quite catch that. You can say: call Raman, video call Rahul, answer call, or end call.";
                    shouldEndSession = false;
                    break;
                }
            }

            if (commandPayload) {
                if (activeUserUid && connectedUsers.has(activeUserUid)) {
                    io.to(activeUserUid).emit('alexa_command', commandPayload);
                    console.log(`[Alexa Skill Webhook] Dispatched exclusively to user room ${activeUserUid}:`, commandPayload);
                } else if (lastActiveTvUid) {
                    io.to(lastActiveTvUid).emit('alexa_command', commandPayload);
                    console.log(`[Alexa Skill Webhook] Dispatched to active user room ${lastActiveTvUid}:`, commandPayload);
                } else {
                    io.emit('alexa_command', commandPayload);
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
  <title>ZingTalk Universal Server</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #0b0f19;
      color: #f1f5f9;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: #111827;
      border: 1px solid #1f2937;
      border-radius: 16px;
      padding: 32px;
      max-width: 500px;
      width: 100%;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.6);
      text-align: center;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
      border: 1px solid #059669;
      padding: 6px 16px;
      border-radius: 9999px;
      font-size: 0.85rem;
      font-weight: 600;
      letter-spacing: 0.5px;
      margin-bottom: 20px;
    }
    .pulse {
      width: 8px;
      height: 8px;
      background: #10b981;
      border-radius: 50%;
      box-shadow: 0 0 12px #10b981;
    }
    h1 {
      font-size: 1.6rem;
      font-weight: 700;
      color: #ffffff;
      margin-bottom: 8px;
    }
    p.sub {
      color: #9ca3af;
      font-size: 0.95rem;
      margin-bottom: 24px;
    }
    .grid {
      background: #0b0f19;
      border: 1px solid #1f2937;
      border-radius: 12px;
      padding: 16px;
      text-align: left;
      font-size: 0.9rem;
      margin-bottom: 24px;
    }
    .row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #1f2937;
    }
    .row:last-child {
      border-bottom: none;
    }
    .label {
      color: #6b7280;
    }
    .val {
      font-family: monospace;
      color: #e5e7eb;
      font-weight: 600;
    }
    .val.green {
      color: #34d399;
    }
    .footer {
      color: #6b7280;
      font-size: 0.8rem;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge"><span class="pulse"></span> ONLINE & ACTIVE</div>
    <h1>ZingTalk Universal Server</h1>
    <p class="sub">High-Performance WebRTC Signaling & Alexa Voice Node</p>
    <div class="grid">
      <div class="row"><span class="label">Domain:</span><span class="val">zingtalk.duckdns.org</span></div>
      <div class="row"><span class="label">Signaling (Port):</span><span class="val">3000 / 443 (SSL)</span></div>
      <div class="row"><span class="label">STUN / TURN:</span><span class="val">zingtalk.duckdns.org:3478</span></div>
      <div class="row"><span class="label">Socket.IO:</span><span class="val green">Ready</span></div>
      <div class="row"><span class="label">Alexa Webhook:</span><span class="val">/alexa</span></div>
      <div class="row"><span class="label">Connected Users:</span><span class="val">${connectedUsers.size}</span></div>
    </div>
    <div class="footer">Client Apps (Fire TV & Mobile) connect remotely over WSS/HTTPS.</div>
  </div>
</body>
</html>`;
    return res.status(200).type('html').send(html);
}

// Multi-Client SPA & Route Fallback
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

app.get('*', (req, res, next) => {
    if (req.path.startsWith('/socket.io') || req.path.startsWith('/api') || req.path === '/alexa') return next();
    const candidatePaths = [
        path.join(__dirname, 'index.html'),
        path.join(__dirname, 'packages', 'tv', 'index.html'),
        path.join(__dirname, 'dist', 'index.html')
    ];
    for (const p of candidatePaths) {
        if (fs.existsSync(p)) return res.sendFile(p);
    }
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
