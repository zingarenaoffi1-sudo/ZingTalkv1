#!/usr/bin/env node
/**
 * ZingTalk Safe Cloud Load-Test Runner (GitHub Actions / CLI)
 *
 * Designed specifically to protect:
 * 1. User's laptop (runs in GitHub Actions cloud or ultra-lightweight CLI without Chrome).
 * 2. AWS Shield / DDoS limits (uses gentle ramp-up rate & hard safety caps).
 * 3. Firebase Free Plan & Admin Panel (uses ephemeralLoadTest guest signaling so 0 Firestore
 *    writes and 0 fake lifetime users are persisted while EC2 Live Online Sockets + CPU/RAM load
 *    are measured accurately in real time).
 */

const { io } = require('socket.io-client');

function parsePositiveInt(raw, fallback, min, max) {
    const n = parseInt(String(raw ?? ''), 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function percentile(sortedNums, p) {
    if (!sortedNums.length) return 0;
    const idx = Math.min(sortedNums.length - 1, Math.max(0, Math.ceil((p / 100) * sortedNums.length) - 1));
    return Math.round(sortedNums[idx]);
}

async function main() {
    const targetUrl = String(process.env.TARGET_URL || 'https://zingtalk.duckdns.org').trim().replace(/\/+$/, '');
    // Default starts at 99 users (respecting user's starting point & Firebase/AWS safety)
    const totalUsers = parsePositiveInt(process.env.LOAD_USERS, 99, 2, 500);
    const rampRatePerSec = parsePositiveInt(process.env.RAMP_RATE, 6, 1, 20);
    const holdSeconds = parsePositiveInt(process.env.HOLD_SECONDS, 25, 5, 120);
    const testCalls = String(process.env.TEST_CALLS ?? 'true').toLowerCase() !== 'false';

    console.log('==============================================================');
    console.log('  ZingTalk Safe Cloud Load Test');
    console.log('==============================================================');
    console.log(`  Target Server   : ${targetUrl}`);
    console.log(`  Virtual Users   : ${totalUsers} (Ephemeral Guest Signaling)`);
    console.log(`  Ramp-Up Speed   : ${rampRatePerSec} users/sec (AWS DDoS-Safe)`);
    console.log(`  Hold Duration   : ${holdSeconds}s (Watch Admin Panel Live!)`);
    console.log(`  Call + Chat Sim : ${testCalls ? 'Enabled' : 'Guest Login Only'}`);
    console.log('==============================================================\n');

    const clients = [];
    const loginLatenciesMs = [];
    let connectFailures = 0;
    let loginSuccessCount = 0;
    let callsCompleted = 0;
    let chatsDelivered = 0;

    const delayBetweenUsersMs = Math.max(50, Math.round(1000 / rampRatePerSec));

    // Phase 1: Gentle Ramp-Up Guest Login
    console.log(`[Phase 1] Gently connecting ${totalUsers} virtual guests (~${Math.ceil(totalUsers / rampRatePerSec)}s)...`);
    const spawnClient = (index) => new Promise((resolve) => {
        const startedAt = Date.now();
        let settled = false;
        const finish = (record) => {
            if (settled) return;
            settled = true;
            resolve(record);
        };

        const sock = io(targetUrl, {
            transports: ['websocket'],
            reconnection: false,
            timeout: 12000,
            extraHeaders: {
                'User-Agent': 'ZingTalk-LoadTest/1.0 (Web Browser)'
            }
        });

        const record = { index, socket: sock, uid: null, ok: false };

        const failTimer = setTimeout(() => {
            connectFailures++;
            try { sock.disconnect(); } catch (_) {}
            finish(record);
        }, 15000);

        sock.on('connect', () => {
            sock.emit('login_user', {
                name: `LoadTest_${index + 1}`,
                isGuest: true,
                isAnonymous: true,
                isNativeApp: false,
                platform: 'Web Browser',
                ephemeralLoadTest: true,
                contacts: []
            });
        });

        sock.on('user_data', (payload) => {
            if (payload && payload.uid) {
                clearTimeout(failTimer);
                record.uid = String(payload.uid);
                record.ok = true;
                loginSuccessCount++;
                loginLatenciesMs.push(Date.now() - startedAt);
                finish(record);
            }
        });

        sock.on('connect_error', () => {
            clearTimeout(failTimer);
            connectFailures++;
            finish(record);
        });

        sock.on('receive_message', () => {
            chatsDelivered++;
        });

        sock.on('incoming_call', (callData) => {
            if (callData && callData.callerUid) {
                sock.emit('call_response', { targetUid: callData.callerUid, status: 'accepted' });
            }
        });

        sock.on('webrtc_offer_received', (offerData) => {
            const peerUid = offerData && (offerData.senderUid || offerData.callerUid);
            if (peerUid) {
                sock.emit('webrtc_answer', {
                    targetUid: peerUid,
                    answer: { type: 'answer', sdp: 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=ZingTalkLoadTest\r\nt=0 0\r\n' }
                });
            }
        });

        sock.on('webrtc_answer_received', () => {
            callsCompleted++;
        });
    });

    const pending = [];
    for (let i = 0; i < totalUsers; i++) {
        pending.push(spawnClient(i));
        if ((i + 1) % 25 === 0 || i === totalUsers - 1) {
            console.log(`  -> Launched ${i + 1}/${totalUsers} sockets...`);
        }
        await sleep(delayBetweenUsersMs);
    }

    const settledClients = await Promise.all(pending);
    const activeClients = settledClients.filter((c) => c.ok && c.uid);
    clients.push(...settledClients);

    console.log(`[Phase 1 Complete] Logged in: ${loginSuccessCount}/${totalUsers} (Failed: ${connectFailures})\n`);

    // Phase 2: Simulated Paired Calls & Ephemeral Chat Signaling
    if (testCalls && activeClients.length >= 2) {
        const pairCount = Math.floor(activeClients.length / 2);
        console.log(`[Phase 2] Simulating ${pairCount} simultaneous call handshakes + chat messages...`);
        for (let p = 0; p < pairCount; p++) {
            const caller = activeClients[p * 2];
            const callee = activeClients[p * 2 + 1];

            caller.socket.once('call_response_received', (res) => {
                if (res && res.status === 'accepted') {
                    caller.socket.emit('webrtc_offer', {
                        targetUid: callee.uid,
                        callType: 'video',
                        offer: { type: 'offer', sdp: 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=ZingTalkLoadTest\r\nt=0 0\r\n' }
                    });
                }
            });

            caller.socket.emit('send_message', {
                senderUid: caller.uid,
                senderName: `LoadTest_${caller.index + 1}`,
                receiverUid: callee.uid,
                targetUid: callee.uid,
                text: 'Load test ping',
                timestamp: '00:00',
                id: `lt_${p}_${Date.now()}`
            });

            caller.socket.emit('initiate_call', {
                callerUid: caller.uid,
                targetUid: callee.uid,
                callerName: `LoadTest_${caller.index + 1}`,
                type: 'video'
            });

            await sleep(80);
        }
        console.log('[Phase 2 Dispatched] Waiting for call handshakes & holding load...\n');
    }

    // Phase 3: Hold Connections so User can inspect Admin Panel live CPU / RAM / Remaining Headroom
    console.log(`[Phase 3] Holding ${activeClients.length} live connections for ${holdSeconds}s — check your ZingTalk Admin Panel now!`);
    await sleep(holdSeconds * 1000);

    // Phase 4: Clean Disconnect
    console.log('\n[Phase 4] Gracefully disconnecting all load-test sockets...');
    for (const c of clients) {
        try {
            if (c.socket && c.socket.connected && c.uid) {
                c.socket.emit('webrtc_end_call', { targetUid: c.uid });
            }
            if (c.socket) c.socket.disconnect();
        } catch (_) {}
    }
    await sleep(500);

    loginLatenciesMs.sort((a, b) => a - b);
    const avgLatency = loginLatenciesMs.length
        ? Math.round(loginLatenciesMs.reduce((a, b) => a + b, 0) / loginLatenciesMs.length)
        : 0;
    const p95Latency = percentile(loginLatenciesMs, 95);
    const successRatePct = Math.round((loginSuccessCount / totalUsers) * 100);

    console.log('\n==============================================================');
    console.log('  ZingTalk Load Test Report');
    console.log('==============================================================');
    console.log(`  Target Users        : ${totalUsers}`);
    console.log(`  Guest Logins OK     : ${loginSuccessCount} (${successRatePct}%)`);
    console.log(`  Failures / Timeouts : ${connectFailures}`);
    console.log(`  Avg Login Latency   : ${avgLatency} ms`);
    console.log(`  P95 Login Latency   : ${p95Latency} ms`);
    if (testCalls) {
        console.log(`  Chats Delivered     : ${chatsDelivered}`);
        console.log(`  Call Handshakes OK  : ${callsCompleted} / ${Math.floor(activeClients.length / 2)} pairs`);
    }
    console.log(`  Verdict             : ${successRatePct >= 95 ? 'PASS - Server handled load cleanly!' : 'DEGRADED - Server approaching capacity limit'}`);
    console.log('==============================================================');

    if (successRatePct < 80) {
        process.exit(1);
    }
}

main().catch((err) => {
    console.error('[LoadTest Error]:', err);
    process.exit(1);
});
