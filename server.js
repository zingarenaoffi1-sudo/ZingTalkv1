const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
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

// Global connected users registry (UID -> socket.id)
const connectedUsers = new Map();

// ==========================================================================
// SERVER ADMIN & ANALYTICS PERSISTENCE ENGINE
// Tracks: Daily New Users, Daily Returning Users, Platform Breakdown
// ==========================================================================
const ANALYTICS_FILE_PATH = path.join(__dirname, 'analytics_store.json');
let analyticsStore = {
    allUsers: {},    // uid -> { uid, name, platform, firstSeenDate, lastSeenDate, firstSeenTime, lastSeenTime, totalConnections }
    dailyStats: {}   // YYYY-MM-DD -> { newUsers: [uid, ...], returningUsers: [uid, ...], totalConnections: 0 }
};

function loadAnalyticsFromDisk() {
    try {
        if (fs.existsSync(ANALYTICS_FILE_PATH)) {
            const raw = fs.readFileSync(ANALYTICS_FILE_PATH, 'utf-8');
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
                analyticsStore.allUsers = parsed.allUsers || {};
                analyticsStore.dailyStats = parsed.dailyStats || {};
            }
        }
    } catch (e) {
        console.warn('[Analytics] Failed to load store, using fresh in-memory store:', e.message);
    }
}
loadAnalyticsFromDisk();

let saveAnalyticsTimer = null;
function saveAnalyticsDebounced() {
    if (saveAnalyticsTimer) clearTimeout(saveAnalyticsTimer);
    saveAnalyticsTimer = setTimeout(() => {
        try {
            fs.writeFileSync(ANALYTICS_FILE_PATH, JSON.stringify(analyticsStore, null, 2), 'utf-8');
        } catch (_) {}
    }, 1500);
}

function getTodayDateStr() {
    const now = new Date();
    return now.toISOString().split('T')[0];
}

function recordUserConnection(uid, name, platform = 'Fire TV') {
    if (!uid) return;
    const cleanUid = String(uid).trim().replace(/\D/g, '');
    if (cleanUid.length !== 10) return;

    const today = getTodayDateStr();
    const nowIso = new Date().toISOString();

    if (!analyticsStore.dailyStats[today]) {
        analyticsStore.dailyStats[today] = { newUsers: [], returningUsers: [], totalConnections: 0 };
    }
    const todayLog = analyticsStore.dailyStats[today];
    todayLog.totalConnections++;

    if (!analyticsStore.allUsers[cleanUid]) {
        // Brand New User! First time ever recorded on ZingTalk
        analyticsStore.allUsers[cleanUid] = {
            uid: cleanUid,
            name: name || `User ${cleanUid}`,
            platform: platform || 'Fire TV',
            firstSeenDate: today,
            lastSeenDate: today,
            firstSeenTime: nowIso,
            lastSeenTime: nowIso,
            totalConnections: 1
        };
        if (!todayLog.newUsers.includes(cleanUid)) {
            todayLog.newUsers.push(cleanUid);
        }
    } else {
        // Existing / Returning User
        const existing = analyticsStore.allUsers[cleanUid];
        existing.lastSeenDate = today;
        existing.lastSeenTime = nowIso;
        existing.totalConnections = (existing.totalConnections || 0) + 1;
        if (name && name !== `User ${cleanUid}`) existing.name = name;
        if (platform) existing.platform = platform;

        if (existing.firstSeenDate !== today) {
            // User registered on a previous day and is returning today!
            if (!todayLog.returningUsers.includes(cleanUid)) {
                todayLog.returningUsers.push(cleanUid);
            }
        } else {
            // User registered earlier today
            if (!todayLog.newUsers.includes(cleanUid)) {
                todayLog.newUsers.push(cleanUid);
            }
        }
    }
    saveAnalyticsDebounced();
}

function getAnalyticsSummary() {
    const today = getTodayDateStr();
    const todayLog = analyticsStore.dailyStats[today] || { newUsers: [], returningUsers: [], totalConnections: 0 };

    let fireTvCount = 0;
    let mobileCount = 0;
    let otherCount = 0;

    for (const u of Object.values(analyticsStore.allUsers)) {
        const p = (u.platform || '').toLowerCase();
        if (p.includes('tv') || p.includes('fire')) fireTvCount++;
        else if (p.includes('mobile') || p.includes('phone') || p.includes('android')) mobileCount++;
        else otherCount++;
    }

    const totalLifetime = Object.keys(analyticsStore.allUsers).length;

    return {
        today,
        newUsersTodayCount: todayLog.newUsers.length,
        returningUsersTodayCount: todayLog.returningUsers.length,
        totalActiveTodayCount: todayLog.newUsers.length + todayLog.returningUsers.length,
        totalLifetimeUsersCount: totalLifetime,
        liveConnectedNowCount: connectedUsers.size,
        platformBreakdown: {
            fireTv: fireTvCount,
            mobile: mobileCount,
            other: otherCount
        },
        system: {
            uptimeSeconds: Math.floor(process.uptime()),
            memoryUsageMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
            domain: "zingtalk.duckdns.org",
            port: process.env.PORT || 3000,
            stunTurn: "zingtalk.duckdns.org:3478",
            alexaWebhook: "/alexa & /api/alexa"
        }
    };
}

function getRecentUsersList() {
    const today = getTodayDateStr();
    const list = Object.values(analyticsStore.allUsers).map(u => {
        const isNewToday = (u.firstSeenDate === today);
        return {
            uid: u.uid,
            name: u.name,
            platform: u.platform,
            type: isNewToday ? 'New User (Today)' : 'Returning User',
            isNewToday,
            firstSeenTime: u.firstSeenTime,
            lastSeenTime: u.lastSeenTime,
            totalConnections: u.totalConnections || 1
        };
    });

    list.sort((a, b) => new Date(b.lastSeenTime) - new Date(a.lastSeenTime));
    return list.slice(0, 30); // Top 30 recent users
}

// ==========================================================================
// SERVER ADMIN THREE-LEVEL SECURITY GATE
// Level 1: Primary Authentication Key
// Level 2: Secondary Clearance Key
// Level 3: Master Developer Token
// Stored strictly via irreversible SHA-256 cryptographic hashes (No plain text passwords in code)
// ==========================================================================
const ADMIN_LEVEL_HASHES = [
    "a252a4f2e3595682ddcd540785bdb2002158211ebb0cfbbed9f0fefad04c1a65", // Level 1 Hash
    "80f0e1cab6a0c35d342a0a1c2e0f79b0511dcb3eeeeac5740cc0295b3c243e5b", // Level 2 Hash
    "3678bc91dbe8d15525ca2ef34828bcedfdaf0128b4746333d0caa16dc79a5ed6"  // Level 3 Hash
];

const adminSessions = new Map(); // token -> { expires: timestamp }

app.post('/api/admin/verify-gate', (req, res) => {
    try {
        const { level, key } = req.body;
        const lvl = parseInt(level, 10);
        if (!lvl || lvl < 1 || lvl > 3 || !key) {
            return res.status(400).json({ success: false, message: 'Invalid verification parameters' });
        }

        const inputHash = crypto.createHash('sha256').update(String(key).trim()).digest('hex');
        const expectedHash = ADMIN_LEVEL_HASHES[lvl - 1];

        if (inputHash !== expectedHash) {
            return res.status(401).json({ success: false, message: `Invalid security key for Level ${lvl}` });
        }

        if (lvl < 3) {
            return res.json({ success: true, nextLevel: lvl + 1 });
        } else {
            // Level 3 Verified! Generate secure 24-hour admin session token
            const token = crypto.randomBytes(32).toString('hex');
            adminSessions.set(token, { expires: Date.now() + 24 * 60 * 60 * 1000 });
            return res.json({ success: true, authorized: true, token });
        }
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/admin/analytics', (req, res) => {
    const token = req.query.token || req.headers['x-admin-token'];
    if (!token || !adminSessions.has(token) || adminSessions.get(token).expires < Date.now()) {
        return res.status(401).json({ success: false, message: 'Unauthorized. Security gate clearance required.' });
    }
    return res.json({
        success: true,
        summary: getAnalyticsSummary(),
        recentUsers: getRecentUsersList()
    });
});

app.post('/api/admin/logout', (req, res) => {
    const token = req.body.token || req.headers['x-admin-token'];
    if (token) adminSessions.delete(token);
    return res.json({ success: true, message: 'Admin session closed' });
});

// Health check endpoint for AWS EC2 & load balancer monitoring
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        app: 'ZingTalk Fire TV Signaling Server',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

// Serve static frontend assets for TV, Mobile, and Web (Disable auto-index so root / renders Server Status Panel)
app.use(express.static(__dirname, { index: false }));
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

            const platformDetected = data.platform || (data.isTv ? 'Fire TV' : (data.isMobile ? 'Mobile' : 'Fire TV'));
            recordUserConnection(uid, userObj.name, platformDetected);

            console.log(`[ZingTalk] Server authenticated UID: ${uid} for user: ${userObj.name} (${userObj.email}) [Platform: ${platformDetected}]`);

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
  <title>ZingTalk Universal Server | Admin & Analytics</title>
  <link rel="icon" type="image/png" href="/assets/favicon.png">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #070a13;
      color: #f1f5f9;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px;
      position: relative;
      overflow-x: hidden;
    }
    .ambient-glow {
      position: fixed;
      top: -20%;
      left: 50%;
      transform: translateX(-50%);
      width: 700px;
      height: 400px;
      background: radial-gradient(ellipse at center, rgba(0, 210, 255, 0.12) 0%, rgba(16, 185, 129, 0.08) 50%, transparent 70%);
      pointer-events: none;
      z-index: 0;
    }
    .hidden { display: none !important; }

    /* GATE VIEW */
    #gate-view {
      position: relative;
      z-index: 1;
      width: 100%;
      max-width: 480px;
      background: #0d1322;
      border: 1px solid #1e293b;
      border-radius: 20px;
      padding: 36px 32px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
      text-align: center;
      transition: all 0.3s ease;
    }
    .gate-icon {
      width: 64px;
      height: 64px;
      margin: 0 auto 16px;
      background: rgba(0, 210, 255, 0.1);
      border: 1px solid rgba(0, 210, 255, 0.3);
      border-radius: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #00d2ff;
    }
    .gate-title {
      font-size: 1.6rem;
      font-weight: 800;
      color: #ffffff;
      margin-bottom: 6px;
      letter-spacing: -0.5px;
    }
    .gate-subtitle {
      color: #94a3b8;
      font-size: 0.9rem;
      margin-bottom: 24px;
    }
    .level-tabs {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      margin-bottom: 24px;
    }
    .level-tab {
      padding: 10px 6px;
      background: #131b2e;
      border: 1px solid #1e293b;
      border-radius: 10px;
      font-size: 0.75rem;
      font-weight: 700;
      color: #64748b;
      text-align: center;
      transition: all 0.25s ease;
    }
    .level-tab.active {
      background: rgba(0, 210, 255, 0.12);
      border-color: #00d2ff;
      color: #00d2ff;
      box-shadow: 0 0 14px rgba(0, 210, 255, 0.2);
    }
    .level-tab.done {
      background: rgba(16, 185, 129, 0.12);
      border-color: #10b981;
      color: #34d399;
    }
    .gate-instruction {
      font-size: 0.85rem;
      font-weight: 600;
      color: #00d2ff;
      text-align: left;
      margin-bottom: 10px;
    }
    .input-wrapper {
      position: relative;
      margin-bottom: 16px;
    }
    .gate-input {
      width: 100%;
      background: #131b2e;
      border: 1.5px solid #1e293b;
      border-radius: 12px;
      padding: 14px 46px 14px 16px;
      color: #ffffff;
      font-size: 0.95rem;
      outline: none;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .gate-input:focus {
      border-color: #00d2ff;
      box-shadow: 0 0 0 3px rgba(0, 210, 255, 0.2);
    }
    .toggle-eye {
      position: absolute;
      right: 14px;
      top: 50%;
      transform: translateY(-50%);
      background: none;
      border: none;
      color: #64748b;
      cursor: pointer;
      padding: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .toggle-eye:hover { color: #cbd5e1; }
    .gate-error {
      background: rgba(239, 68, 68, 0.15);
      border: 1px solid rgba(239, 68, 68, 0.4);
      color: #f87171;
      font-size: 0.85rem;
      padding: 10px 14px;
      border-radius: 10px;
      margin-bottom: 16px;
      text-align: left;
    }
    .gate-btn {
      width: 100%;
      background: linear-gradient(135deg, #00d2ff 0%, #0099ff 100%);
      color: #050b14;
      font-weight: 800;
      font-size: 0.95rem;
      padding: 14px;
      border: none;
      border-radius: 12px;
      cursor: pointer;
      box-shadow: 0 4px 14px rgba(0, 210, 255, 0.35);
      transition: transform 0.15s, box-shadow 0.15s, opacity 0.15s;
    }
    .gate-btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 6px 20px rgba(0, 210, 255, 0.5);
    }
    .gate-btn:active {
      transform: translateY(1px);
    }
    .gate-btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .gate-footer {
      color: #64748b;
      font-size: 0.75rem;
      margin-top: 24px;
      line-height: 1.4;
    }

    /* DASHBOARD VIEW */
    #dashboard-view {
      position: relative;
      z-index: 1;
      width: 100%;
      max-width: 1100px;
      margin: 0 auto;
    }
    .dash-topbar {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      background: #0d1322;
      border: 1px solid #1e293b;
      border-radius: 16px;
      padding: 16px 24px;
      margin-bottom: 24px;
    }
    .dash-brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .dash-logo {
      width: 36px;
      height: 36px;
      border-radius: 10px;
      background: rgba(0, 210, 255, 0.15);
      border: 1px solid rgba(0, 210, 255, 0.3);
      display: flex;
      align-items: center;
      justify-content: center;
      color: #00d2ff;
      font-weight: 900;
      font-size: 1.1rem;
    }
    .dash-title {
      font-size: 1.25rem;
      font-weight: 800;
      color: #ffffff;
    }
    .dash-subtitle {
      font-size: 0.8rem;
      color: #94a3b8;
    }
    .dash-actions {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .badge-status {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
      border: 1px solid #059669;
      padding: 6px 14px;
      border-radius: 9999px;
      font-size: 0.8rem;
      font-weight: 700;
    }
    .pulse-dot {
      width: 8px;
      height: 8px;
      background: #10b981;
      border-radius: 50%;
      box-shadow: 0 0 10px #10b981;
      animation: pulseAnim 2s infinite;
    }
    @keyframes pulseAnim {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(1.2); }
    }
    .btn-secondary {
      background: #131b2e;
      border: 1px solid #1e293b;
      color: #cbd5e1;
      padding: 8px 16px;
      border-radius: 10px;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn-secondary:hover {
      background: #1e293b;
      color: #ffffff;
    }
    .btn-lock {
      background: rgba(239, 68, 68, 0.15);
      border: 1px solid rgba(239, 68, 68, 0.4);
      color: #f87171;
      padding: 8px 16px;
      border-radius: 10px;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn-lock:hover {
      background: rgba(239, 68, 68, 0.3);
      color: #ffffff;
    }

    /* STATS GRID */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .stat-card {
      background: #0d1322;
      border: 1px solid #1e293b;
      border-radius: 16px;
      padding: 20px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      position: relative;
      overflow: hidden;
    }
    .stat-card::after {
      content: "";
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 3px;
    }
    .card-new::after { background: linear-gradient(90deg, #10b981, #34d399); }
    .card-returning::after { background: linear-gradient(90deg, #00d2ff, #0099ff); }
    .card-live::after { background: linear-gradient(90deg, #f59e0b, #fbbf24); }
    .card-total::after { background: linear-gradient(90deg, #8b5cf6, #a855f7); }

    .stat-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }
    .stat-label {
      font-size: 0.85rem;
      font-weight: 600;
      color: #94a3b8;
    }
    .stat-badge {
      font-size: 0.7rem;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 6px;
    }
    .badge-green { background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }
    .badge-cyan { background: rgba(0, 210, 255, 0.15); color: #00d2ff; border: 1px solid rgba(0, 210, 255, 0.3); }
    .badge-yellow { background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); }
    .badge-purple { background: rgba(139, 92, 246, 0.15); color: #c084fc; border: 1px solid rgba(139, 92, 246, 0.3); }

    .stat-num {
      font-size: 2.4rem;
      font-weight: 800;
      color: #ffffff;
      font-family: monospace;
      letter-spacing: -1px;
      line-height: 1;
      margin-bottom: 8px;
    }
    .stat-desc {
      font-size: 0.78rem;
      color: #64748b;
    }

    /* MIDDLE ROW */
    .middle-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      margin-bottom: 24px;
    }
    @media (max-width: 800px) {
      .middle-grid { grid-template-columns: 1fr; }
    }
    .panel {
      background: #0d1322;
      border: 1px solid #1e293b;
      border-radius: 16px;
      padding: 20px;
    }
    .panel-title {
      font-size: 1rem;
      font-weight: 700;
      color: #ffffff;
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .diag-row {
      display: flex;
      justify-content: space-between;
      padding: 10px 0;
      border-bottom: 1px solid #131b2e;
      font-size: 0.85rem;
    }
    .diag-row:last-child { border-bottom: none; }
    .diag-label { color: #94a3b8; }
    .diag-val {
      font-family: monospace;
      color: #e2e8f0;
      font-weight: 600;
    }
    .bar-item {
      margin-bottom: 14px;
    }
    .bar-header {
      display: flex;
      justify-content: space-between;
      font-size: 0.82rem;
      margin-bottom: 6px;
    }
    .bar-label { color: #cbd5e1; font-weight: 600; }
    .bar-count { color: #94a3b8; font-family: monospace; }
    .progress-track {
      background: #131b2e;
      border-radius: 9999px;
      height: 8px;
      overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      border-radius: 9999px;
      transition: width 0.5s ease;
    }
    .fill-tv { background: linear-gradient(90deg, #ff9900, #ffb84d); }
    .fill-mobile { background: linear-gradient(90deg, #00d2ff, #0099ff); }
    .fill-web { background: linear-gradient(90deg, #10b981, #34d399); }

    /* TABLE SECTION */
    .table-container {
      background: #0d1322;
      border: 1px solid #1e293b;
      border-radius: 16px;
      padding: 20px;
      overflow-x: auto;
    }
    .table-header-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      flex-wrap: wrap;
      gap: 12px;
    }
    .search-input {
      background: #131b2e;
      border: 1px solid #1e293b;
      border-radius: 8px;
      padding: 8px 14px;
      color: #ffffff;
      font-size: 0.85rem;
      outline: none;
      min-width: 220px;
    }
    .search-input:focus { border-color: #00d2ff; }
    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 0.85rem;
    }
    th {
      color: #64748b;
      font-weight: 600;
      padding: 10px 12px;
      border-bottom: 1px solid #1e293b;
    }
    td {
      padding: 12px;
      border-bottom: 1px solid #131b2e;
      color: #cbd5e1;
    }
    tr:last-child td { border-bottom: none; }
    .user-uid-cell {
      font-family: monospace;
      color: #00d2ff;
      font-weight: 700;
    }
    .tag-new {
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.3);
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 0.72rem;
      font-weight: 700;
      display: inline-block;
    }
    .tag-returning {
      background: rgba(0, 210, 255, 0.15);
      color: #00d2ff;
      border: 1px solid rgba(0, 210, 255, 0.3);
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 0.72rem;
      font-weight: 700;
      display: inline-block;
    }
    .tag-platform {
      background: #131b2e;
      color: #cbd5e1;
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 0.75rem;
      font-weight: 600;
      border: 1px solid #1e293b;
    }
    .empty-state {
      text-align: center;
      padding: 36px 16px;
      color: #64748b;
      font-size: 0.9rem;
    }
  </style>
</head>
<body>
  <div class="ambient-glow"></div>

  <!-- VIEW 1: THREE-LEVEL SECURITY GATE -->
  <div id="gate-view">
    <div class="gate-icon">
      <svg width="32" height="32" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
      </svg>
    </div>
    <h1 class="gate-title">ZingTalk Security Gate</h1>
    <p class="gate-subtitle">Three-Level Developer Clearance Required for Server Panel</p>

    <div class="level-tabs">
      <div id="tab-lvl-1" class="level-tab active">LEVEL 1<br>Primary Key</div>
      <div id="tab-lvl-2" class="level-tab">LEVEL 2<br>Clearance Key</div>
      <div id="tab-lvl-3" class="level-tab">LEVEL 3<br>Developer Token</div>
    </div>

    <div id="gate-instruction" class="gate-instruction">Level 1 Verification: Enter Primary Authentication Key</div>

    <div class="input-wrapper">
      <input type="password" id="gate-input" class="gate-input" placeholder="Enter Level 1 Password..." autocomplete="off">
      <button type="button" id="toggle-eye-btn" class="toggle-eye" title="Show / Hide Password">
        <svg id="eye-icon" width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
        </svg>
      </button>
    </div>

    <div id="gate-error" class="gate-error hidden"></div>

    <button type="button" id="gate-submit-btn" class="gate-btn">Authorize Level 1 Key</button>

    <div class="gate-footer">
      Protected with Server-Side SHA-256 Multi-Factor Cryptographic Hashing<br>
      Authorized for ZingTalk Developer Team • zingarenaoffi1@gmail.com
    </div>
  </div>

  <!-- VIEW 2: LIVE ANALYTICS & PRODUCTION DASHBOARD -->
  <div id="dashboard-view" class="hidden">
    <div class="dash-topbar">
      <div class="dash-brand">
        <div class="dash-logo">Z</div>
        <div>
          <div class="dash-title">ZingTalk Universal Server</div>
          <div class="dash-subtitle">High-Performance WebRTC Signaling & Alexa Voice Node • zingtalk.duckdns.org</div>
        </div>
      </div>
      <div class="dash-actions">
        <div class="badge-status"><span class="pulse-dot"></span> ONLINE & ACTIVE</div>
        <button type="button" id="btn-refresh" class="btn-secondary">🔄 Refresh Data</button>
        <button type="button" id="btn-lock" class="btn-lock">🔒 Lock Gate</button>
      </div>
    </div>

    <!-- STATS CARDS GRID -->
    <div class="stats-grid">
      <!-- Card 1: New Users Today -->
      <div class="stat-card card-new">
        <div class="stat-top">
          <span class="stat-label">Daily New Users (Today)</span>
          <span class="stat-badge badge-green">🆕 Fresh Users</span>
        </div>
        <div id="stat-new-today" class="stat-num">0</div>
        <div class="stat-desc">Users who opened ZingTalk for the first time today</div>
      </div>

      <!-- Card 2: Returning Users Today -->
      <div class="stat-card card-returning">
        <div class="stat-top">
          <span class="stat-label">Returning Users (Today)</span>
          <span class="stat-badge badge-cyan">🔁 Active Retention</span>
        </div>
        <div id="stat-returning-today" class="stat-num">0</div>
        <div class="stat-desc">Existing registered users who re-opened the app today</div>
      </div>

      <!-- Card 3: Live Online Sockets -->
      <div class="stat-card card-live">
        <div class="stat-top">
          <span class="stat-label">Live Online Sockets</span>
          <span class="stat-badge badge-yellow">🟢 Connected Now</span>
        </div>
        <div id="stat-live-now" class="stat-num">${connectedUsers.size}</div>
        <div class="stat-desc">Active real-time WebRTC & Socket.IO connections</div>
      </div>

      <!-- Card 4: Total Lifetime Users -->
      <div class="stat-card card-total">
        <div class="stat-top">
          <span class="stat-label">Total Lifetime Users</span>
          <span class="stat-badge badge-purple">👥 Registered Database</span>
        </div>
        <div id="stat-total-users" class="stat-num">0</div>
        <div class="stat-desc">Unique 10-digit UIDs across all sessions</div>
      </div>
    </div>

    <!-- MIDDLE ROW: PLATFORMS & SYSTEM INFO -->
    <div class="middle-grid">
      <!-- Platform Distribution -->
      <div class="panel">
        <div class="panel-title">📱 App Platform Distribution</div>
        
        <div class="bar-item">
          <div class="bar-header">
            <span class="bar-label">Amazon Fire TV</span>
            <span id="label-tv-count" class="bar-count">0 users (0%)</span>
          </div>
          <div class="progress-track">
            <div id="bar-tv" class="progress-fill fill-tv" style="width: 0%;"></div>
          </div>
        </div>

        <div class="bar-item">
          <div class="bar-header">
            <span class="bar-label">Android Mobile</span>
            <span id="label-mob-count" class="bar-count">0 users (0%)</span>
          </div>
          <div class="progress-track">
            <div id="bar-mob" class="progress-fill fill-mobile" style="width: 0%;"></div>
          </div>
        </div>

        <div class="bar-item">
          <div class="bar-header">
            <span class="bar-label">Web / Other</span>
            <span id="label-web-count" class="bar-count">0 users (0%)</span>
          </div>
          <div class="progress-track">
            <div id="bar-web" class="progress-fill fill-web" style="width: 0%;"></div>
          </div>
        </div>
      </div>

      <!-- System Diagnostics -->
      <div class="panel">
        <div class="panel-title">⚙️ Server Infrastructure Diagnostics</div>
        <div class="diag-row"><span class="diag-label">Public Domain:</span><span class="diag-val">zingtalk.duckdns.org</span></div>
        <div class="diag-row"><span class="diag-label">Signaling Ports:</span><span class="diag-val">3000 (HTTP) / 443 (HTTPS)</span></div>
        <div class="diag-row"><span class="diag-label">coturn STUN / TURN:</span><span class="diag-val">zingtalk.duckdns.org:3478</span></div>
        <div class="diag-row"><span class="diag-label">Alexa Voice Webhook:</span><span class="diag-val">/alexa & /api/alexa</span></div>
        <div class="diag-row"><span class="diag-label">Server Uptime:</span><span id="diag-uptime" class="diag-val">--</span></div>
        <div class="diag-row"><span class="diag-label">Node Memory RSS:</span><span id="diag-mem" class="diag-val">-- MB</span></div>
      </div>
    </div>

    <!-- RECENT USERS LOG TABLE -->
    <div class="table-container">
      <div class="table-header-row">
        <div class="panel-title" style="margin-bottom: 0;">📊 Recent Connected Users & Live Traffic Log</div>
        <input type="text" id="user-search" class="search-input" placeholder="Search by UID or Name...">
      </div>

      <table>
        <thead>
          <tr>
            <th>10-Digit UID</th>
            <th>Display Name</th>
            <th>User Status</th>
            <th>Platform</th>
            <th>Total Sessions</th>
            <th>Last Active</th>
          </tr>
        </thead>
        <tbody id="users-tbody">
          <tr>
            <td colspan="6" class="empty-state">Loading user telemetry data...</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <script>
    (function() {
      const gateView = document.getElementById('gate-view');
      const dashView = document.getElementById('dashboard-view');
      const gateInput = document.getElementById('gate-input');
      const gateSubmitBtn = document.getElementById('gate-submit-btn');
      const gateError = document.getElementById('gate-error');
      const gateInstruction = document.getElementById('gate-instruction');
      const toggleEyeBtn = document.getElementById('toggle-eye-btn');
      const btnRefresh = document.getElementById('btn-refresh');
      const btnLock = document.getElementById('btn-lock');
      const userSearch = document.getElementById('user-search');

      const tab1 = document.getElementById('tab-lvl-1');
      const tab2 = document.getElementById('tab-lvl-2');
      const tab3 = document.getElementById('tab-lvl-3');

      let currentLevel = 1;
      let cachedUsersList = [];

      // Check for saved session token
      const savedToken = sessionStorage.getItem('zingtalk_admin_session');
      if (savedToken) {
        verifySessionToken(savedToken);
      }

      // Show/Hide password toggle
      toggleEyeBtn.addEventListener('click', function() {
        if (gateInput.type === 'password') {
          gateInput.type = 'text';
          toggleEyeBtn.innerHTML = '<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24M1 1l22 22"/></svg>';
        } else {
          gateInput.type = 'password';
          toggleEyeBtn.innerHTML = '<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
        }
      });

      // Enter key submits
      gateInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') handleGateSubmit();
      });
      gateSubmitBtn.addEventListener('click', handleGateSubmit);

      async function handleGateSubmit() {
        const val = gateInput.value.trim();
        if (!val) {
          showError('Please enter the security password');
          return;
        }

        gateError.classList.add('hidden');
        gateSubmitBtn.disabled = true;
        gateSubmitBtn.textContent = 'Verifying Clearance...';

        try {
          const res = await fetch('/api/admin/verify-gate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ level: currentLevel, key: val })
          });
          const data = await res.json();

          if (!res.ok || !data.success) {
            showError(data.message || 'Invalid security key. Clearance denied.');
            gateSubmitBtn.disabled = false;
            updateLevelUI();
            return;
          }

          if (data.nextLevel) {
            currentLevel = data.nextLevel;
            gateInput.value = '';
            gateSubmitBtn.disabled = false;
            updateLevelUI();
          } else if (data.authorized && data.token) {
            sessionStorage.setItem('zingtalk_admin_session', data.token);
            gateInput.value = '';
            showDashboard(data.token);
          }
        } catch (err) {
          showError('Verification error: ' + err.message);
          gateSubmitBtn.disabled = false;
        }
      }

      function updateLevelUI() {
        if (currentLevel === 1) {
          tab1.className = 'level-tab active';
          tab2.className = 'level-tab';
          tab3.className = 'level-tab';
          gateInstruction.textContent = 'Level 1 Verification: Enter Primary Authentication Key';
          gateInput.placeholder = 'Enter Level 1 Password...';
          gateSubmitBtn.textContent = 'Authorize Level 1 Key';
        } else if (currentLevel === 2) {
          tab1.className = 'level-tab done';
          tab2.className = 'level-tab active';
          tab3.className = 'level-tab';
          gateInstruction.textContent = 'Level 2 Verification: Enter Secondary Clearance Key';
          gateInput.placeholder = 'Enter Level 2 Password...';
          gateSubmitBtn.textContent = 'Authorize Level 2 Key';
        } else if (currentLevel === 3) {
          tab1.className = 'level-tab done';
          tab2.className = 'level-tab done';
          tab3.className = 'level-tab active';
          gateInstruction.textContent = 'Level 3 Verification: Enter Master Developer Token';
          gateInput.placeholder = 'Enter Level 3 Password...';
          gateSubmitBtn.textContent = 'Authorize Developer Token';
        }
        gateInput.focus();
      }

      function showError(msg) {
        gateError.textContent = msg;
        gateError.classList.remove('hidden');
      }

      async function verifySessionToken(token) {
        try {
          const res = await fetch('/api/admin/analytics?token=' + encodeURIComponent(token));
          if (res.ok) {
            showDashboard(token);
          } else {
            sessionStorage.removeItem('zingtalk_admin_session');
          }
        } catch (_) {}
      }

      function showDashboard(token) {
        gateView.classList.add('hidden');
        dashView.classList.remove('hidden');
        loadAnalyticsData(token);
      }

      async function loadAnalyticsData(token, isSilent = false) {
        if (!token) token = sessionStorage.getItem('zingtalk_admin_session');
        if (!token) return;

        if (!isSilent) {
          btnRefresh.textContent = 'Loading...';
        }

        try {
          const res = await fetch('/api/admin/analytics?token=' + encodeURIComponent(token));
          if (!res.ok) {
            if (res.status === 401) {
              sessionStorage.removeItem('zingtalk_admin_session');
              dashView.classList.add('hidden');
              gateView.classList.remove('hidden');
              currentLevel = 1;
              updateLevelUI();
              showError('Session expired. Please re-authenticate.');
            }
            return;
          }
          const data = await res.json();
          renderAnalyticsUI(data);
        } catch (err) {
          console.error('[Dashboard Error]', err);
        } finally {
          btnRefresh.textContent = '🔄 Refresh Data';
        }
      }

      function formatUptime(seconds) {
        const d = Math.floor(seconds / (3600*24));
        const h = Math.floor((seconds % (3600*24)) / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const parts = [];
        if (d > 0) parts.push(d + 'd');
        if (h > 0) parts.push(h + 'h');
        parts.push(m + 'm');
        return parts.join(' ');
      }

      function renderAnalyticsUI(data) {
        if (!data || !data.summary) return;
        const s = data.summary;

        document.getElementById('stat-new-today').textContent = s.newUsersTodayCount || 0;
        document.getElementById('stat-returning-today').textContent = s.returningUsersTodayCount || 0;
        document.getElementById('stat-live-now').textContent = s.liveConnectedNowCount || 0;
        document.getElementById('stat-total-users').textContent = s.totalLifetimeUsersCount || 0;

        // Platform breakdown
        const pb = s.platformBreakdown || { fireTv: 0, mobile: 0, other: 0 };
        const total = (pb.fireTv + pb.mobile + pb.other) || 1;
        const tvPct = Math.round((pb.fireTv / total) * 100);
        const mobPct = Math.round((pb.mobile / total) * 100);
        const webPct = Math.max(0, 100 - tvPct - mobPct);

        document.getElementById('label-tv-count').textContent = pb.fireTv + ' users (' + tvPct + '%)';
        document.getElementById('bar-tv').style.width = tvPct + '%';

        document.getElementById('label-mob-count').textContent = pb.mobile + ' users (' + mobPct + '%)';
        document.getElementById('bar-mob').style.width = mobPct + '%';

        document.getElementById('label-web-count').textContent = pb.other + ' users (' + webPct + '%)';
        document.getElementById('bar-web').style.width = webPct + '%';

        if (s.system) {
          document.getElementById('diag-uptime').textContent = formatUptime(s.system.uptimeSeconds || 0);
          document.getElementById('diag-mem').textContent = (s.system.memoryUsageMb || 0) + ' MB';
        }

        // Table
        cachedUsersList = data.recentUsers || [];
        renderUsersTable(cachedUsersList);
      }

      function renderUsersTable(list) {
        const tbody = document.getElementById('users-tbody');
        const query = (userSearch.value || '').trim().toLowerCase();
        const filtered = list.filter(u => {
          if (!query) return true;
          return (u.uid && u.uid.includes(query)) || (u.name && u.name.toLowerCase().includes(query));
        });

        if (filtered.length === 0) {
          tbody.innerHTML = '<tr><td colspan="6" class="empty-state">' +
            (list.length === 0 ? 'No user sessions recorded yet today. Launch Fire TV or Mobile APK to see live traffic.' : 'No matching users found for "' + query + '"') +
            '</td></tr>';
          return;
        }

        tbody.innerHTML = filtered.map(u => {
          const isNew = u.isNewToday || (u.type && u.type.includes('New'));
          const statusTag = isNew
            ? '<span class="tag-new">New User (Today)</span>'
            : '<span class="tag-returning">Returning User</span>';
          const platformTag = '<span class="tag-platform">' + (u.platform || 'Fire TV') + '</span>';
          const lastSeen = u.lastSeenTime ? new Date(u.lastSeenTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--';

          return '<tr>' +
            '<td class="user-uid-cell">' + (u.uid || '----------') + '</td>' +
            '<td><strong>' + (escapeHtml(u.name) || 'User') + '</strong></td>' +
            '<td>' + statusTag + '</td>' +
            '<td>' + platformTag + '</td>' +
            '<td>' + (u.totalConnections || 1) + '</td>' +
            '<td style="font-family: monospace; color: #94a3b8;">' + lastSeen + '</td>' +
            '</tr>';
        }).join('');
      }

      function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      }

      userSearch.addEventListener('input', function() {
        renderUsersTable(cachedUsersList);
      });

      btnRefresh.addEventListener('click', function() {
        loadAnalyticsData();
      });

      btnLock.addEventListener('click', async function() {
        const token = sessionStorage.getItem('zingtalk_admin_session');
        if (token) {
          try {
            await fetch('/api/admin/logout', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token })
            });
          } catch (_) {}
        }
        sessionStorage.removeItem('zingtalk_admin_session');
        dashView.classList.add('hidden');
        gateView.classList.remove('hidden');
        currentLevel = 1;
        gateInput.value = '';
        gateError.classList.add('hidden');
        updateLevelUI();
      });

      // Auto poll analytics every 8 seconds when dashboard is active
      setInterval(function() {
        const token = sessionStorage.getItem('zingtalk_admin_session');
        if (token && !dashView.classList.contains('hidden')) {
          loadAnalyticsData(token, true);
        }
      }, 8000);

    })();
  </script>
</body>
</html>`;
    return res.status(200).type('html').send(html);
}

// Multi-Client SPA & Route Fallback
app.get('/', (req, res) => renderServerStatus(req, res));
app.get('/admin', (req, res) => renderServerStatus(req, res));
app.get('/status', (req, res) => renderServerStatus(req, res));

app.get('/web*', (req, res) => {
    const rootPath = path.join(__dirname, 'index.html');
    if (fs.existsSync(rootPath)) return res.sendFile(rootPath);
    return renderServerStatus(req, res);
});

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
