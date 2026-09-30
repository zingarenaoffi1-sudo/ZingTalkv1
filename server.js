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

// Initialize Firebase Admin with Firestore if credentials are provided
const rawSdkConfig = process.env.Firebase_Admin_SDK || process.env.FIREBASE_ADMIN_SDK;

if (rawSdkConfig) {
    try {
        let serviceAccount;
        if (typeof rawSdkConfig === 'string') {
            const trimmed = rawSdkConfig.trim();
            if (trimmed.startsWith('{')) {
                serviceAccount = JSON.parse(trimmed);
            } else {
                try {
                    const decoded = Buffer.from(trimmed, 'base64').toString('utf-8');
                    serviceAccount = JSON.parse(decoded);
                } catch (_) {
                    serviceAccount = JSON.parse(trimmed.replace(/\\n/g, '\n'));
                }
            }
        } else {
            serviceAccount = rawSdkConfig;
        }

        if (serviceAccount && serviceAccount.private_key) {
            serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
        }

        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        db = admin.firestore();
    } catch (err) {
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
    } catch (err) {
        db = memoryDb;
    }
}

// Unique 10-digit UID generator
function generate10DigitUid() {
    return Math.floor(1000000000 + Math.random() * 9000000000).toString();
}

const connectedUsers = new Map();
let lastActiveTvUid = null;
const userContactsRegistry = new Map();

const defaultSeedContacts = [
    { uid: "1000000002", name: "Aman" },
    { uid: "1000000003", name: "Rahul" },
    { uid: "1000000005", name: "Raman" }
];

// In-Memory Groups Registry
const inMemoryGroups = new Map();

// In-Memory Block Registry (blockerUid -> Set of blockedUids)
const inMemoryBlocks = new Map();

io.on('connection', (socket) => {
    socket.on('login_user', async (data) => {
        try {
            if (!data) data = {};
            let uid;
            let usersRef = db.collection('users');
            let snapshot = { empty: true, docs: [] };
            
            try {
                if (data.email) {
                    snapshot = await usersRef.where('email', '==', data.email).get();
                } else if (data.uid) {
                    const docSnap = await usersRef.doc(String(data.uid)).get();
                    if (docSnap.exists) {
                        snapshot = { empty: false, docs: [{ data: () => docSnap.data() }] };
                    }
                }
            } catch (fsErr) {
                console.warn('[ZingTalk] Database query failed, falling back to memory store:', fsErr.message);
                db = memoryDb;
                usersRef = db.collection('users');
                if (data.email) {
                    snapshot = await usersRef.where('email', '==', data.email).get();
                }
            }

            const existingDoc = !snapshot.empty ? snapshot.docs[0].data() : null;
            const existingUid = existingDoc ? String(existingDoc.uid || "") : "";

            // Strict enforcement: UID MUST be exactly 10 digits and strictly unique across all users
            if (snapshot.empty || !existingUid || existingUid.length !== 10) {
                let isUnique = false;
                let attempts = 0;
                while (!isUnique && attempts < 30) {
                    attempts++;
                    uid = generate10DigitUid();
                    // Double check doc existence AND where query to guarantee NO two users get same UID
                    const docCheck = await usersRef.doc(uid).get();
                    if (!docCheck.exists) {
                        const uidCheck = await usersRef.where('uid', '==', uid).get();
                        if (uidCheck.empty) isUnique = true;
                    }
                }
                const newUser = {
                    ...(existingDoc || {}),
                    uid: uid,
                    email: data.email || (existingDoc && existingDoc.email) || `guest_${uid}@zingtalk.local`,
                    name: data.name || (existingDoc && existingDoc.name) || "User",
                    contacts: (existingDoc && existingDoc.contacts) || []
                };
                await usersRef.doc(uid).set(newUser, { merge: true });
                console.log(`[ZingTalk] New 10-digit UID assigned: ${uid} for ${newUser.email}`);
            } else {
                uid = existingUid;
            }

            connectedUsers.set(uid, socket.id);
            lastActiveTvUid = uid;
            socket.join(uid);

            if (data.contacts && Array.isArray(data.contacts)) {
                userContactsRegistry.set(uid, data.contacts);
            }

            // Auto-join existing in-memory group rooms
            for (const [groupId, group] of inMemoryGroups.entries()) {
                if (group.members && group.members.includes(uid)) {
                    socket.join(groupId);
                }
            }
            
            const userDoc = await usersRef.doc(uid).get();
            socket.emit('user_data', userDoc.data());
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

// ----------------- Alexa Skill Webhook Endpoint -----------------
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
        console.log(`[Alexa Skill Webhook] Received ${reqType} from Alexa`);

        let speechText = "Welcome to ZingTalk on Fire TV. Who would you like to call?";
        let shouldEndSession = false;
        let commandPayload = null;

        // Retrieve active TV user's contacts
        let userContacts = [];
        if (lastActiveTvUid && userContactsRegistry.has(lastActiveTvUid)) {
            userContacts = userContactsRegistry.get(lastActiveTvUid) || [];
        }
        if (userContacts.length === 0) {
            for (const [uid, list] of userContactsRegistry.entries()) {
                if (list && list.length > 0) {
                    userContacts = list;
                    break;
                }
            }
        }
        if (userContacts.length === 0 && lastActiveTvUid) {
            try {
                const userDoc = await db.collection('users').doc(lastActiveTvUid).get();
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
        if (userContacts.length === 0) {
            userContacts = defaultSeedContacts;
        }

        if (reqType === 'LaunchRequest') {
            speechText = "Welcome to ZingTalk on Fire TV. Who would you like to call?";
            shouldEndSession = false;
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
                case 'ZingaudioCallIntent': {
                    const rawName = extractSlotVal(slots, 'contact', 'name', 'person', 'user', 'Contact', 'Name', 'target');
                    if (!rawName) {
                        speechText = "Who would you like to call on ZingTalk?";
                        shouldEndSession = false;
                        break;
                    }

                    const cleanTarget = rawName.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
                    let matched = userContacts.find(c => {
                        const cName = (c.name || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();
                        return cName === cleanTarget || c.uid === cleanTarget;
                    });
                    if (!matched) {
                        matched = userContacts.find(c => {
                            const cName = (c.name || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();
                            return cName.startsWith(cleanTarget) || cName.includes(cleanTarget);
                        });
                    }

                    if (!matched && /^\d{10}$/.test(cleanTarget)) {
                        matched = { uid: cleanTarget, name: "User " + cleanTarget };
                    }

                    if (matched) {
                        speechText = `Calling ${matched.name} on ZingTalk.`;
                        shouldEndSession = true;
                        commandPayload = {
                            intent: 'ZingaudioCallIntent',
                            action: 'audio_call',
                            contact: matched.name,
                            targetUid: matched.uid,
                            timestamp: Date.now()
                        };
                    } else {
                        speechText = `Sorry, ${rawName} is not saved in your ZingTalk contacts.`;
                        shouldEndSession = true;
                    }
                    break;
                }
                case 'ZingvideoIntent': {
                    const rawName = extractSlotVal(slots, 'name', 'contact', 'person', 'user', 'Name', 'Contact', 'target');
                    if (!rawName) {
                        speechText = "Who would you like to video call on ZingTalk?";
                        shouldEndSession = false;
                        break;
                    }

                    const cleanTarget = rawName.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
                    let matched = userContacts.find(c => {
                        const cName = (c.name || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();
                        return cName === cleanTarget || c.uid === cleanTarget;
                    });
                    if (!matched) {
                        matched = userContacts.find(c => {
                            const cName = (c.name || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();
                            return cName.startsWith(cleanTarget) || cName.includes(cleanTarget);
                        });
                    }

                    if (!matched && /^\d{10}$/.test(cleanTarget)) {
                        matched = { uid: cleanTarget, name: "User " + cleanTarget };
                    }

                    if (matched) {
                        speechText = `Starting video call with ${matched.name} on ZingTalk.`;
                        shouldEndSession = true;
                        commandPayload = {
                            intent: 'ZingvideoIntent',
                            action: 'video_call',
                            contact: matched.name,
                            targetUid: matched.uid,
                            timestamp: Date.now()
                        };
                    } else {
                        speechText = `Sorry, ${rawName} is not saved in your ZingTalk contacts.`;
                        shouldEndSession = true;
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
                    speechText = "You can ask ZingTalk to start an audio call, video call, send a text message, or hang up an active call.";
                    shouldEndSession = false;
                    break;
                }
                case 'AMAZON.CancelIntent':
                case 'AMAZON.StopIntent': {
                    speechText = "Goodbye from ZingTalk!";
                    shouldEndSession = true;
                    break;
                }
                default: {
                    speechText = "ZingTalk heard your request.";
                    shouldEndSession = false;
                }
            }

            if (commandPayload) {
                // Broadcast to connected Fire TV client
                io.emit('alexa_command', commandPayload);
                console.log('[Alexa Skill Webhook] Dispatched alexa_command to TV client:', commandPayload);
            }
        } else if (reqType === 'SessionEndedRequest') {
            speechText = "";
            shouldEndSession = true;
        }

        // Return standard ASK JSON response format
        return res.json({
            version: "1.0",
            response: {
                outputSpeech: {
                    type: "PlainText",
                    text: speechText
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

// SPA fallback
app.get('*', (req, res, next) => {
    if (req.path.startsWith('/socket.io')) return next();
    res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`[ZingTalk] Server running on http://0.0.0.0:${PORT}`);
});
