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

// Serve static frontend assets
app.use(express.static(__dirname));

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

    const files = ['serviceAccountKey.json', 'firebase-adminsdk.json', 'firebase-admin.json', 'admin.json'];
    for (const f of files) {
        const p = path.join(__dirname, f);
        if (fs.existsSync(p)) {
            try {
                return JSON.parse(fs.readFileSync(p, 'utf-8'));
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

// Unique 10-digit UID generator
function generate10DigitUid() {
    return Math.floor(1000000000 + Math.random() * 9000000000).toString();
}

const connectedUsers = new Map();
let lastActiveTvUid = null;
const userContactsRegistry = new Map();

// In-Memory Groups Registry
const inMemoryGroups = new Map();

// In-Memory Block Registry (blockerUid -> Set of blockedUids)
const inMemoryBlocks = new Map();

// Persistent Alexa Device to ZingTalk User UID Registry (amazonUserId -> 10-digit UID)
const alexaDevicePairings = new Map();

io.on('connection', (socket) => {
    socket.on('login_user', async (data) => {
        try {
            if (!data) data = {};
            let uid;
            let usersRef = db.collection('users');

            // 1. Look up existing user record by email or Firebase authUid in Firestore
            let snapshot = { empty: true, docs: [] };
            try {
                if (data.email) {
                    snapshot = await usersRef.where('email', '==', data.email).get();
                } else if (data.authUid) {
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
            } else {
                // Server generates unique 10-digit UID
                uid = generate10DigitUid();
            }

            const userObj = {
                uid: uid,
                authUid: data.authUid || (existingDoc ? existingDoc.authUid : null),
                email: data.email || (existingDoc ? existingDoc.email : `user_${uid}@zingtalk.local`),
                name: data.name || (existingDoc ? existingDoc.name : "TV User"),
                contacts: (data.contacts && Array.isArray(data.contacts) && data.contacts.length > 0) 
                    ? data.contacts 
                    : (existingDoc && existingDoc.contacts ? existingDoc.contacts : []),
                updatedAt: Date.now()
            };
            await usersRef.doc(uid).set(userObj, { merge: true });

            // Guarantee socket joins private room for this exact 10-digit UID
            connectedUsers.set(uid, socket.id);
            lastActiveTvUid = uid;
            socket.join(uid);

            if (userObj.contacts && userObj.contacts.length > 0) {
                userContactsRegistry.set(uid, userObj.contacts);
            }

            console.log(`[ZingTalk] Server authenticated UID: ${uid} for user: ${userObj.name} (${userObj.email})`);

            // Auto-join existing in-memory group rooms
            for (const [groupId, group] of inMemoryGroups.entries()) {
                if (group.members && group.members.includes(uid)) {
                    socket.join(groupId);
                }
            }
            
            socket.emit('user_data', userObj);
        } catch (err) {
            console.error('[ZingTalk] Error in login_user:', err);
        }
    });

    // Sync Contacts Handler
    socket.on('sync_contacts', (data) => {
        if (data && data.uid) {
            lastActiveTvUid = data.uid;
            if (Array.isArray(data.contacts)) {
                userContactsRegistry.set(data.uid, data.contacts);
            }
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

    socket.on('save_contact', async (data) => {
        try {
            if (!data.myUid || !data.targetUid || !data.customName) return;
            const newContact = { uid: data.targetUid, name: data.customName };

            // Update in-memory registry immediately so Alexa webhook finds it instantly
            let currentContacts = userContactsRegistry.get(data.myUid) || [];
            currentContacts = currentContacts.filter(c => c.uid !== data.targetUid);
            currentContacts.push(newContact);
            userContactsRegistry.set(data.myUid, currentContacts);
            lastActiveTvUid = data.myUid;

            let userRef = db.collection('users').doc(data.myUid);
            try {
                await db.runTransaction(async (t) => {
                    const doc = await t.get(userRef);
                    const existingContacts = (doc.data() && doc.data().contacts) || [];
                    const updated = existingContacts.filter(c => c.uid !== data.targetUid);
                    updated.push(newContact);
                    t.update(userRef, { contacts: updated });
                });
            } catch (_) {
                const memDoc = await memoryDb.collection('users').doc(data.myUid).get();
                const existingContacts = (memDoc.data() && memDoc.data().contacts) || [];
                const updated = existingContacts.filter(c => c.uid !== data.targetUid);
                updated.push(newContact);
                await memoryDb.collection('users').doc(data.myUid).update({ contacts: updated });
            }

            socket.emit('contact_saved', currentContacts);
        } catch (err) {
            console.error('[ZingTalk] Error saving contact:', err);
            socket.emit('contact_error', 'Failed to save contact.');
        }
    });

    socket.on('send_message', (data) => {
        // Block check: If receiver has blocked sender, do not deliver
        const receiverBlockedList = inMemoryBlocks.get(data.receiverUid);
        if (receiverBlockedList && receiverBlockedList.has(data.senderUid)) {
            socket.emit('message_status', { msgId: data.id, delivered: false });
            return;
        }
        io.to(data.receiverUid).emit('receive_message', data);
        socket.emit('message_status', { msgId: data.id, delivered: true });
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
            io.to(data.targetId).emit('user_typing', data);
        }
    });

    socket.on('stop_typing', (data) => {
        if (data.isGroup) {
            socket.to(data.targetId).emit('user_stop_typing', data);
        } else {
            io.to(data.targetId).emit('user_stop_typing', data);
        }
    });

    // Message Reactions
    socket.on('send_reaction', (data) => {
        if (data.isGroup) {
            io.to(data.targetId).emit('receive_reaction', data);
        } else {
            io.to(data.targetId).emit('receive_reaction', data);
        }
    });

    // Content Reporting
    socket.on('report_content', (data) => {
        socket.emit('report_ack', { status: 'success', message: 'Report submitted.' });
    });

    socket.on('initiate_call', (data) => {
        // Block check: If target has blocked caller, decline immediately
        const targetBlockedList = inMemoryBlocks.get(data.targetUid);
        if (targetBlockedList && targetBlockedList.has(data.callerUid)) {
            socket.emit('call_response_received', { targetUid: data.targetUid, status: 'declined', reason: 'blocked' });
            return;
        }
        io.to(data.targetUid).emit('incoming_call', data);
    });

    socket.on('cancel_call', (data) => {
        io.to(data.targetUid).emit('call_cancelled');
    });

    socket.on('call_response', (data) => {
        io.to(data.targetUid).emit('call_response_received', data);
    });

    socket.on('webrtc_offer', (data) => {
        io.to(data.targetUid).emit('webrtc_offer_received', data);
    });

    socket.on('webrtc_answer', (data) => {
        io.to(data.targetUid).emit('webrtc_answer_received', data);
    });

    socket.on('webrtc_ice_candidate', (data) => {
        io.to(data.targetUid).emit('webrtc_ice_candidate_received', data);
    });

    socket.on('webrtc_end_call', (data) => {
        io.to(data.targetUid).emit('webrtc_call_ended');
    });

    // Fire TV Alexa Voice Command Relay
    socket.on('voice_command_triggered', (data) => {
        console.log('[ZingTalk Voice] Voice command received from client:', data);
        io.emit('alexa_command', data);
    });

    socket.on('disconnect', () => {
        for (const [uid, socketId] of connectedUsers.entries()) {
            if (socketId === socket.id) {
                connectedUsers.delete(uid);
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
    // Strip common conversational prefixes (English & Hinglish)
    text = text.replace(/^(?:please\s+)?(?:call\s+to|call\s+my\s+friend|call\s+my|call|audio\s+call\s+to|audio\s+call|video\s+call\s+to|video\s+call|dial|connect\s+with|connect\s+to|start\s+call\s+with|start\s+video\s+call\s+with|phone\s+karo|lagao|milao)\s+/i, "");
    // Strip trailing conversational suffixes / noise
    text = text.replace(/\s+(?:ko|se|par|pe|toll|tell|please|now|call|video\s+call|audio\s+call)$/i, "");
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

app.post('/api/alexa', async (req, res) => {
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
        if (userContacts.length === 0 && activeUserUid) {
            try {
                const userDoc = await db.collection('users').doc(activeUserUid).get();
                if (userDoc && userDoc.exists && userDoc.data() && userDoc.data().contacts) {
                    userContacts = userDoc.data().contacts;
                }
            } catch (_) {}
        }
        if (userContacts.length === 0) {
            for (const [id, u] of inMemoryUsers.entries()) {
                if (u.contacts && u.contacts.length > 0) {
                    userContacts = u.contacts;
                    break;
                }
            }
        }
        if (reqType === 'LaunchRequest') {
            const isPaired = alexaDevicePairings.has(amazonUserId);
            if (userContacts.length > 0) {
                const sampleNames = userContacts.slice(0, 3).map(c => c.name).join(', ');
                speechText = `Welcome to ZingTalk! Who would you like to call? You have ${sampleNames} in your saved contacts.`;
            } else {
                speechText = isPaired
                    ? "Welcome to ZingTalk! You do not have any saved contacts yet. You can say: call UID followed by any 10-digit number to place a call."
                    : "Welcome to ZingTalk! To link this Alexa to your screen, say: pair UID followed by your 10-digit number. Or say: call UID followed by the digits to dial.";
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
                case 'ZingaudioCallIntent':
                case 'ZingvideoIntent': {
                    const defaultMode = intentName === 'ZingvideoIntent' ? 'video' : 'audio';
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

                    // Support direct digit dialing if user spoke a 10-digit number
                    const digitsSpoken = wordsToDigits(rawName).replace(/[^0-9]/g, '');
                    if (digitsSpoken.length === 10) {
                        lastCalledTarget = { uid: digitsSpoken, name: "UID " + digitsSpoken, mode: mode };
                        speechText = `${mode === 'video' ? 'Starting video call with' : 'Calling'} UID ${digitsSpoken.split('').join(' ')} on ZingTalk.`;
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
                            ? `Starting video call with ${matched.name} on ZingTalk.`
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
                        speechText = `Sorry, ${rawName} is not saved in your ZingTalk contacts. You can add them in the app with their 10-digit UID, or say: call UID followed by their 10 digits.`;
                        shouldEndSession = true;
                        sessionAttributes = {};
                    }
                    break;
                }
                case 'ZingPairAccountIntent': {
                    let rawUid = extractSlotVal(slots, 'uid', 'number', 'target', 'UID', 'Number');
                    const digits = wordsToDigits(rawUid || '').replace(/[^0-9]/g, '');
                    const cleanDigits = (digits.length === 10) ? digits : (rawUid || '').replace(/[^0-9]/g, '');
                    if (cleanDigits.length === 10) {
                        alexaDevicePairings.set(amazonUserId, cleanDigits);
                        activeUserUid = cleanDigits;
                        speechText = `Successfully paired this Alexa device with ZingTalk account UID ${cleanDigits.split('').join(' ')}! Your voice commands are now linked exclusively to your screen.`;
                        shouldEndSession = true;
                        commandPayload = {
                            intent: 'ZingPairAccountIntent',
                            action: 'device_paired',
                            pairedUid: cleanDigits,
                            timestamp: Date.now()
                        };
                        io.to(cleanDigits).emit('alexa_paired', { uid: cleanDigits });
                    } else {
                        speechText = "Please provide your 10 digit ZingTalk UID to pair. You can say: pair UID, followed by your 10 digits.";
                        shouldEndSession = false;
                    }
                    break;
                }
                case 'ZingAnswerCallIntent': {
                    speechText = "Answering incoming call on ZingTalk.";
                    shouldEndSession = true;
                    commandPayload = {
                        intent: 'ZingAnswerCallIntent',
                        action: 'answer_call',
                        timestamp: Date.now()
                    };
                    break;
                }
                case 'ZingRejectCallIntent': {
                    speechText = "Declining incoming call on ZingTalk.";
                    shouldEndSession = true;
                    commandPayload = {
                        intent: 'ZingRejectCallIntent',
                        action: 'reject_call',
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
                        speechText = "Please provide a valid 10 digit UID number to call.";
                        shouldEndSession = false;
                    }
                    break;
                }
                case 'ZingMuteMicIntent': {
                    speechText = "Microphone muted on ZingTalk.";
                    shouldEndSession = true;
                    commandPayload = {
                        intent: 'ZingMuteMicIntent',
                        action: 'mute_mic',
                        timestamp: Date.now()
                    };
                    break;
                }
                case 'ZingUnmuteMicIntent': {
                    speechText = "Microphone unmuted on ZingTalk.";
                    shouldEndSession = true;
                    commandPayload = {
                        intent: 'ZingUnmuteMicIntent',
                        action: 'unmute_mic',
                        timestamp: Date.now()
                    };
                    break;
                }
                case 'ZingTurnOffCameraIntent': {
                    speechText = "Camera turned off on ZingTalk.";
                    shouldEndSession = true;
                    commandPayload = {
                        intent: 'ZingTurnOffCameraIntent',
                        action: 'camera_off',
                        timestamp: Date.now()
                    };
                    break;
                }
                case 'ZingTurnOnCameraIntent': {
                    speechText = "Camera turned on on ZingTalk.";
                    shouldEndSession = true;
                    commandPayload = {
                        intent: 'ZingTurnOnCameraIntent',
                        action: 'camera_on',
                        timestamp: Date.now()
                    };
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
                case 'ZingOpenDialpadIntent': {
                    speechText = "Opening dialpad on ZingTalk.";
                    shouldEndSession = true;
                    commandPayload = {
                        intent: 'ZingOpenDialpadIntent',
                        action: 'open_dialpad',
                        timestamp: Date.now()
                    };
                    break;
                }
                case 'ZingOpenContactsIntent': {
                    speechText = "Opening contacts directory on ZingTalk.";
                    shouldEndSession = true;
                    commandPayload = {
                        intent: 'ZingOpenContactsIntent',
                        action: 'open_contacts',
                        timestamp: Date.now()
                    };
                    break;
                }
                case 'ZingOpenProfileIntent': {
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
                case 'ZingListContactsIntent':
                case 'ZingWhoCanICallIntent': {
                    if (userContacts.length === 0) {
                        speechText = "You do not have any contacts saved on ZingTalk yet. You can add a contact using a 10-digit UID in the app.";
                    } else {
                        const names = userContacts.map(c => c.name).join(', ');
                        speechText = `You have ${userContacts.length} contacts on ZingTalk: ${names}. Say: call, followed by a name to start.`;
                    }
                    shouldEndSession = false;
                    sessionAttributes = { pendingAction: 'call' };
                    break;
                }
                case 'ZingRedialIntent':
                case 'ZingCallLastIntent': {
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
                case 'ZingEndCallIntent': {
                    speechText = "Ending call on ZingTalk.";
                    shouldEndSession = true;
                    commandPayload = {
                        intent: 'ZingEndCallIntent',
                        action: 'end_call',
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
                    speechText = "You can ask ZingTalk to call a contact, start a video call, redial, or hang up an active call. Who would you like to call?";
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
                    // Smart fallback: check if any slot contains a contact name
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

                    speechText = "I didn't quite catch that. You can say: call Raman, video call Rahul, or end call.";
                    shouldEndSession = false;
                    break;
                }
            }

            if (commandPayload) {
                if (activeUserUid && connectedUsers.has(activeUserUid)) {
                    // Dispatched EXCLUSIVELY to this paired user's device/screen
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

        // Return standard ASK JSON response format with sessionAttributes & reprompt
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
});

// SPA fallback & Server Status
app.get('*', (req, res, next) => {
    if (req.path.startsWith('/socket.io')) return next();
    const indexPath = path.join(__dirname, 'index.html');
    const distIndexPath = path.join(__dirname, 'dist', 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else if (fs.existsSync(distIndexPath)) {
        res.sendFile(distIndexPath);
    } else {
        res.json({
            status: "online",
            server: "ZingTalk Backend Signaling Server",
            port: PORT,
            connectedUsers: connectedUsers.size,
            message: "ZingTalk server is 100% active and listening for Socket.IO connections."
        });
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`[ZingTalk] Server running on http://0.0.0.0:${PORT}`);
});
