#!/usr/bin/env node
/**
 * ZingTalk Cloud Load-Test Runner (GitHub Actions / CLI)
 *
 * Upgraded capabilities:
 * - Default start: 1,000 requests at 1,000 req/s (1k in 1 second)
 * - Configurable max: up to 40,000 (40k) total requests across rolling safe waves
 * - Supports custom secret header `X-Load-Test-Secret` (from LOAD_TEST_SECRET / LOAD_TEST_TOKEN)
 *   for AWS WAF bypass + app-level burst bypass
 * - Zero Firestore writes & zero fake lifetime users via `ephemeralLoadTest: true`
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

function computeLoadWavePlan({ totalRequests = 1000, ratePerSec = 1000, batchSize = 1000 } = {}) {
    const safeTotal = parsePositiveInt(totalRequests, 1000, 2, 40000);
    const safeRate = parsePositiveInt(ratePerSec, 1000, 1, 5000);
    const safeBatch = parsePositiveInt(batchSize, 1000, 10, 2000);

    const waves = [];
    let remaining = safeTotal;
    let indexOffset = 0;
    while (remaining > 0) {
        const count = Math.min(remaining, safeBatch);
        waves.push({
            waveNumber: waves.length + 1,
            count,
            startIndex: indexOffset
        });
        remaining -= count;
        indexOffset += count;
    }

    return {
        totalRequests: safeTotal,
        ratePerSec: safeRate,
        batchSize: safeBatch,
        waveCount: waves.length,
        waves
    };
}

async function runWave({
    wave,
    ratePerSec,
    holdSeconds,
    testCalls,
    targetUrl,
    extraHeaders,
    globalCounters
}) {
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
            timeout: 15000,
            extraHeaders
        });

        const record = { index, socket: sock, uid: null, ok: false };

        const failTimer = setTimeout(() => {
            globalCounters.connectFailures++;
            try { sock.disconnect(); } catch (_) {}
            finish(record);
        }, 16000);

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
                globalCounters.loginSuccessCount++;
                globalCounters.loginLatenciesMs.push(Date.now() - startedAt);
                finish(record);
            }
        });

        sock.on('connect_error', () => {
            clearTimeout(failTimer);
            globalCounters.connectFailures++;
            finish(record);
        });

        sock.on('receive_message', () => {
            globalCounters.chatsDelivered++;
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
            globalCounters.callsCompleted++;
        });
    });

    // Tick every 50ms to faithfully deliver ratePerSec (e.g., 1000/sec = 50 clients every 50ms)
    const tickMs = 50;
    const perTick = Math.max(1, Math.ceil((ratePerSec * tickMs) / 1000));
    const pending = [];

    console.log(`[Wave ${wave.waveNumber}] Dispatching ${wave.count} sockets at ~${ratePerSec} req/s...`);
    const dispatchStart = Date.now();
    for (let i = 0; i < wave.count; i += perTick) {
        const chunkEnd = Math.min(wave.count, i + perTick);
        for (let j = i; j < chunkEnd; j++) {
            pending.push(spawnClient(wave.startIndex + j));
        }
        if (chunkEnd < wave.count) {
            await sleep(tickMs);
        }
    }
    const dispatchElapsed = Date.now() - dispatchStart;
    console.log(`[Wave ${wave.waveNumber}] Dispatched ${wave.count} requests in ${dispatchElapsed}ms. Waiting for acknowledgements...`);

    const settledClients = await Promise.all(pending);
    const activeClients = settledClients.filter((c) => c.ok && c.uid);

    if (testCalls && activeClients.length >= 2) {
        const pairCount = Math.floor(activeClients.length / 2);
        globalCounters.totalPairsAttempted += pairCount;
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

            if ((p + 1) % 50 === 0) await sleep(20);
        }
    }

    if (holdSeconds > 0 && activeClients.length > 0) {
        console.log(`[Wave ${wave.waveNumber}] Holding ${activeClients.length} live connections for ${holdSeconds}s...`);
        await sleep(holdSeconds * 1000);
    }

    for (const c of settledClients) {
        try {
            if (c.socket && c.socket.connected && c.uid) {
                c.socket.emit('webrtc_end_call', { targetUid: c.uid });
            }
            if (c.socket) c.socket.disconnect();
        } catch (_) {}
    }
    await sleep(300);
}

async function main() {
    const targetUrl = String(process.env.TARGET_URL || 'https://zingtalk.duckdns.org').trim().replace(/\/+$/, '');
    const loadTestSecret = String(process.env.LOAD_TEST_SECRET || process.env.LOAD_TEST_TOKEN || '').trim();

    const plan = computeLoadWavePlan({
        totalRequests: process.env.LOAD_USERS ?? 1000,
        ratePerSec: process.env.RAMP_RATE ?? 1000,
        batchSize: process.env.BATCH_SIZE ?? 1000
    });
    const holdSeconds = parsePositiveInt(process.env.HOLD_SECONDS, 15, 1, 120);
    const testCalls = String(process.env.TEST_CALLS ?? 'true').toLowerCase() !== 'false';

    const extraHeaders = {
        'User-Agent': 'ZingTalk-LoadTest/2.0 (Web Browser)'
    };
    if (loadTestSecret) {
        extraHeaders['X-Load-Test-Secret'] = loadTestSecret;
    }

    console.log('==============================================================');
    console.log('  ZingTalk High-Throughput Cloud Load Test (1k - 40k)');
    console.log('==============================================================');
    console.log(`  Target Server      : ${targetUrl}`);
    console.log(`  Total Requests     : ${plan.totalRequests} (Max allowed: 40,000)`);
    console.log(`  Dispatch Speed     : ${plan.ratePerSec} req/sec`);
    console.log(`  Wave Concurrency   : ${plan.batchSize} concurrent sockets/wave (${plan.waveCount} wave${plan.waveCount === 1 ? '' : 's'})`);
    console.log(`  Hold Per Wave      : ${holdSeconds}s`);
    console.log(`  X-Load-Test-Secret : ${loadTestSecret ? 'Configured (Header attached)' : 'Not set (optional)'}`);
    console.log(`  Call + Chat Sim    : ${testCalls ? 'Enabled' : 'Guest Login Only'}`);
    console.log('==============================================================\n');

    const globalCounters = {
        loginLatenciesMs: [],
        connectFailures: 0,
        loginSuccessCount: 0,
        callsCompleted: 0,
        chatsDelivered: 0,
        totalPairsAttempted: 0
    };

    const perWaveHold = plan.waveCount > 1 ? Math.min(holdSeconds, 3) : holdSeconds;
    for (const wave of plan.waves) {
        await runWave({
            wave,
            ratePerSec: plan.ratePerSec,
            holdSeconds: perWaveHold,
            testCalls,
            targetUrl,
            extraHeaders,
            globalCounters
        });
    }

    globalCounters.loginLatenciesMs.sort((a, b) => a - b);
    const avgLatency = globalCounters.loginLatenciesMs.length
        ? Math.round(globalCounters.loginLatenciesMs.reduce((a, b) => a + b, 0) / globalCounters.loginLatenciesMs.length)
        : 0;
    const p95Latency = percentile(globalCounters.loginLatenciesMs, 95);
    const successRatePct = Math.round((globalCounters.loginSuccessCount / plan.totalRequests) * 100);

    console.log('\n==============================================================');
    console.log('  ZingTalk Load Test Report');
    console.log('==============================================================');
    console.log(`  Total Dispatched    : ${plan.totalRequests}`);
    console.log(`  Guest Logins OK     : ${globalCounters.loginSuccessCount} (${successRatePct}%)`);
    console.log(`  Failures / Timeouts : ${globalCounters.connectFailures}`);
    console.log(`  Avg Login Latency   : ${avgLatency} ms`);
    console.log(`  P95 Login Latency   : ${p95Latency} ms`);
    if (testCalls) {
        console.log(`  Chats Delivered     : ${globalCounters.chatsDelivered}`);
        console.log(`  Call Handshakes OK  : ${globalCounters.callsCompleted} / ${globalCounters.totalPairsAttempted} pairs`);
    }
    console.log(`  Verdict             : ${successRatePct >= 95 ? 'PASS - Server handled load cleanly!' : 'DEGRADED - Server approaching capacity limit'}`);
    console.log('==============================================================');

    if (successRatePct < 80) {
        process.exit(1);
    }
}

if (require.main === module) {
    main().catch((err) => {
        console.error('[LoadTest Error]:', err);
        process.exit(1);
    });
}

module.exports = {
    parsePositiveInt,
    computeLoadWavePlan
};
