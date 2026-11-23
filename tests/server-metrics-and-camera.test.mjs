import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { detectPlatformFromClient, parseProcMemInfo, computeServerLoadReport } = require('../lib/server-metrics.js');
const { FixedWindowRateLimiter, timingSafeEqualString } = require('../lib/security.js');
const { computeLoadWavePlan } = require('../scripts/load-test.js');

test('detectPlatformFromClient prevents Desktop/Mobile browser tests from counting as Fire TV', () => {
  const desktopChromeUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
  const mobilePhoneUA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
  const fireTvUA = 'Mozilla/5.0 (Linux; Android 11; AFTMM Build/NS6296) AppleWebKit/537.36 (KHTML, like Gecko) Silk/120.0.0.0 Safari/537.36';

  // Even if an old cached web client claims platform: "Fire TV", desktop Chrome must be Web Browser
  assert.equal(
    detectPlatformFromClient({ data: { platform: 'Fire TV', isNativeApp: false }, userAgent: desktopChromeUA }),
    'Web Browser'
  );
  assert.equal(
    detectPlatformFromClient({ data: { platform: 'Web Browser', isNativeApp: false }, userAgent: desktopChromeUA }),
    'Web Browser'
  );

  // Mobile phone browser testing root website must be Mobile, not Fire TV
  assert.equal(
    detectPlatformFromClient({ data: { platform: 'Fire TV', isNativeApp: false }, userAgent: mobilePhoneUA }),
    'Mobile'
  );

  // Genuine Fire TV APK or Fire TV User-Agent must be classified as Fire TV
  assert.equal(
    detectPlatformFromClient({ data: { platform: 'Fire TV', isNativeApp: true }, userAgent: fireTvUA }),
    'Fire TV'
  );
  assert.equal(
    detectPlatformFromClient({ data: { platform: 'Fire TV', isNativeApp: true }, userAgent: '' }),
    'Fire TV'
  );
  assert.equal(
    detectPlatformFromClient({ data: {}, userAgent: fireTvUA }),
    'Fire TV'
  );

  // Mobile APK must be classified as Mobile
  assert.equal(
    detectPlatformFromClient({ data: { platform: 'Mobile', isNativeApp: true }, userAgent: mobilePhoneUA }),
    'Mobile'
  );
});

test('computeServerLoadReport accurately computes load used, remaining capacity, and status thresholds', () => {
  const healthy = computeServerLoadReport({
    cpuUsedPct: 20,
    totalMemBytes: 2048 * 1024 * 1024,
    freeMemBytes: 1433.6 * 1024 * 1024, // 30% used
    processRssBytes: 120 * 1024 * 1024,
    heapUsedBytes: 55 * 1024 * 1024,
    heapTotalBytes: 90 * 1024 * 1024,
    cpuCores: 2,
    loadAvg1m: 0.42,
    eventLoopLagMs: 4,
    liveSockets: 12,
    activePairings: 2,
    activeSplitCalls: 1,
    uptimeSeconds: 3600
  });

  assert.equal(healthy.overallLoadPct + healthy.remainingCapacityPct, 100);
  assert.equal(healthy.cpu.usedPct + healthy.cpu.remainingPct, 100);
  assert.equal(healthy.memory.usedPct + healthy.memory.remainingPct, 100);
  assert.equal(healthy.statusLevel, 'healthy');
  assert.equal(healthy.statusLabel, 'Healthy');
  assert.equal(healthy.cpu.cores, 2);
  assert.equal(healthy.memory.totalMb, 2048);
  assert.equal(healthy.runtime.liveSockets, 12);

  const moderate = computeServerLoadReport({
    cpuUsedPct: 72,
    totalMemBytes: 1000 * 1024 * 1024,
    freeMemBytes: 300 * 1024 * 1024, // 70% used
    eventLoopLagMs: 40
  });
  assert.equal(moderate.statusLevel, 'moderate');
  assert.equal(moderate.statusLabel, 'Moderate Load');
  assert.equal(moderate.overallLoadPct + moderate.remainingCapacityPct, 100);

  const heavy = computeServerLoadReport({
    cpuUsedPct: 95,
    totalMemBytes: 1000 * 1024 * 1024,
    freeMemBytes: 100 * 1024 * 1024, // 90% used
    eventLoopLagMs: 180
  });
  assert.equal(heavy.statusLevel, 'heavy');
  assert.equal(heavy.statusLabel, 'Heavy Load');
  assert.equal(heavy.overallLoadPct + heavy.remainingCapacityPct, 100);
});

test('Mobile and TV clients await native camera permissions, support fallbacks, and report dynamic platforms', () => {
  const mobileSrc = fs.readFileSync(path.resolve('packages/mobile/app.js'), 'utf8');
  assert.ok(mobileSrc.includes('ensureNativeCallPermissions'), 'Mobile app must await native call permissions');
  assert.ok(mobileSrc.includes('zing-permissions-result'), 'Mobile app must listen for zing-permissions-result');
  assert.ok(mobileSrc.includes('retryAttachMobileCameraIfMissing'), 'Mobile app must auto-attach camera after permission grant');
  assert.ok(mobileSrc.includes('acquireMobileVideoStream'), 'Mobile app must use progressive video fallback');
  assert.ok(mobileSrc.includes('platform: detectClientPlatform()'), 'Mobile app must send dynamic client platform');

  const tvSrc = fs.readFileSync(path.resolve('packages/tv/app.js'), 'utf8');
  assert.ok(tvSrc.includes('ensureTvNativeCallPermissions'), 'TV app must await native call permissions');
  assert.ok(tvSrc.includes('platform: detectClientPlatform()'), 'TV app must send dynamic client platform instead of hardcoded Fire TV');
  assert.equal(tvSrc.includes('platform: "Fire TV"'), false, 'TV app must not hardcode platform: "Fire TV" in login/session payloads');

  const serverSrc = fs.readFileSync(path.resolve('server.js'), 'utf8');
  assert.ok(serverSrc.includes('getServerLoadSnapshot'), 'server.js must expose real-time server load snapshot');
  assert.equal(serverSrc.includes('splitMeshRegistry'), false, 'server.js must reference splitMesh, never undefined splitMeshRegistry');
  assert.ok(serverSrc.includes('ephemeralLoadTest'), 'server.js must support zero-pollution ephemeral load-test guest sessions');
  assert.ok(serverSrc.includes('server-capacity-panel'), 'Admin panel must render Live Server Load & Remaining Capacity panel');
  assert.ok(serverSrc.includes('cap-overall-free'), 'Admin panel must show remaining server capacity headroom');

  const loadScript = fs.readFileSync(path.resolve('scripts/load-test.js'), 'utf8');
  assert.ok(loadScript.includes('ephemeralLoadTest: true'), 'Load test script must use ephemeralLoadTest flag');
  assert.ok(loadScript.includes('40000'), 'Load test script must allow up to 40,000 requests');
  assert.ok(loadScript.includes('X-Load-Test-Secret'), 'Load test script must attach X-Load-Test-Secret when configured');
  const loadWorkflow = fs.readFileSync(path.resolve('.github/workflows/load-test.yml'), 'utf8');
  assert.ok(loadWorkflow.includes('workflow_dispatch'), 'Load test workflow must be manual-only');
  assert.ok(loadWorkflow.includes("default: '1000'"), 'Load test workflow must default to 1000 starting load/rate');
  assert.ok(loadWorkflow.includes('LOAD_TEST_TOKEN'), 'Load test workflow must wire secrets.LOAD_TEST_TOKEN');

  assert.ok(serverSrc.includes('/api/admin/cleanup-memory'), 'server.js must expose POST /api/admin/cleanup-memory');
  assert.ok(serverSrc.includes('btn-cleanup-ram'), 'Admin panel must render Clean RAM button');
  assert.ok(serverSrc.includes('isValidLoadTestRequest'), 'server.js must support X-Load-Test-Secret verification');
});

test('parseProcMemInfo & computeServerLoadReport distinguish reclaimable Linux cache from real RAM pressure', () => {
  const sampleMemInfo = [
    'MemTotal:         930816 kB',
    'MemFree:          288768 kB',
    'MemAvailable:     612352 kB',
    'Buffers:           40960 kB',
    'Cached:           245760 kB',
    'SReclaimable:      36864 kB'
  ].join('\n');

  const parsed = parseProcMemInfo(sampleMemInfo);
  assert.ok(parsed);
  assert.equal(Math.round(parsed.memTotalBytes / (1024 * 1024)), 909);
  assert.equal(Math.round(parsed.memAvailableBytes / (1024 * 1024)), 598);

  const report = computeServerLoadReport({
    cpuUsedPct: 5,
    totalMemBytes: parsed.memTotalBytes,
    freeMemBytes: parsed.memFreeBytes,
    memAvailableBytes: parsed.memAvailableBytes,
    reclaimableCacheBytes: parsed.reclaimableCacheBytes
  });

  // 598 MB genuinely available out of 909 MB => ~34% used instead of false 69%
  assert.equal(report.memory.totalMb, 909);
  assert.equal(report.memory.freeMb, 598);
  assert.equal(report.memory.osFreeMb, 282);
  assert.equal(report.memory.reclaimableCacheMb, 316);
  assert.ok(report.memory.usedPct < 40, `Expected <40% real RAM used, got ${report.memory.usedPct}%`);
});

test('FixedWindowRateLimiter.pruneExpired clears expired buckets and timingSafeEqualString validates secrets safely', () => {
  let fakeNow = 1000;
  const limiter = new FixedWindowRateLimiter({ windowMs: 5000, maxRequests: 10, nowFn: () => fakeNow });
  limiter.check('sock:a');
  limiter.check('sock:b');
  assert.equal(limiter.buckets.size, 2);

  fakeNow += 6000;
  const removed = limiter.pruneExpired(fakeNow);
  assert.equal(removed, 2);
  assert.equal(limiter.buckets.size, 0);

  assert.equal(timingSafeEqualString('secret-123', 'secret-123'), true);
  assert.equal(timingSafeEqualString('secret-123', 'secret-124'), false);
  assert.equal(timingSafeEqualString('short', 'much-longer-token'), false);
  assert.equal(timingSafeEqualString('', ''), false);
});

test('computeLoadWavePlan defaults to 1,000 req/s and scales up to 40,000 requests across safe waves', () => {
  const def = computeLoadWavePlan();
  assert.equal(def.totalRequests, 1000);
  assert.equal(def.ratePerSec, 1000);
  assert.equal(def.waveCount, 1);

  const maxRun = computeLoadWavePlan({ totalRequests: 40000, ratePerSec: 1000, batchSize: 1000 });
  assert.equal(maxRun.totalRequests, 40000);
  assert.equal(maxRun.waveCount, 40);
  assert.equal(maxRun.waves[0].count, 1000);
  assert.equal(maxRun.waves[39].startIndex, 39000);

  const clamped = computeLoadWavePlan({ totalRequests: 999999, ratePerSec: 1000, batchSize: 1000 });
  assert.equal(clamped.totalRequests, 40000);
});
