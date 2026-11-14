import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  PAIR_CODE_TTL_MS,
  normalizeUid,
  normalizePairCode,
  parseQrPairingPayload,
  SplitMeshRegistry
} = require('../lib/split-mesh.js');

import { generateQrMatrix, renderQrSvg } from '../packages/tv/qr.js';

test('Split-Mesh normalizers validate 10-digit UIDs and 6-digit pairing codes', () => {
  assert.equal(normalizeUid('98765 43210'), '9876543210');
  assert.equal(normalizeUid('12345'), '');
  assert.equal(normalizeUid(''), '');

  assert.equal(normalizePairCode('654-321'), '654321');
  assert.equal(normalizePairCode('12345'), '');
  assert.equal(normalizePairCode('1234567'), '');
});

test('parseQrPairingPayload handles zingtalk URI, JSON payload, and raw numeric strings', () => {
  assert.deepEqual(
    parseQrPairingPayload('zingtalk://pair?uid=9876543210&code=654321'),
    { tvUid: '9876543210', code: '654321' }
  );
  assert.deepEqual(
    parseQrPairingPayload('{"tvUid":"1234567890","pairCode":"112233"}'),
    { tvUid: '1234567890', code: '112233' }
  );
  assert.deepEqual(
    parseQrPairingPayload('445566'),
    { tvUid: '', code: '445566' }
  );
  assert.deepEqual(
    parseQrPairingPayload('9988776655'),
    { tvUid: '9988776655', code: '' }
  );
  assert.deepEqual(parseQrPairingPayload('invalid'), { tvUid: '', code: '' });
});

test('SplitMeshRegistry registers TV pairing codes, expires old codes, and enforces online TV checks', () => {
  let fakeNow = 1_000_000;
  const registry = new SplitMeshRegistry({ ttlMs: 5000, nowFn: () => fakeNow });

  assert.equal(PAIR_CODE_TTL_MS, 30 * 60 * 1000);

  const reg = registry.registerTvPairing('9876543210', 'Living Room TV', '654321');
  assert.equal(reg.ok, true);
  assert.equal(reg.tvUid, '9876543210');
  assert.equal(reg.code, '654321');
  assert.equal(reg.qrPayload, 'zingtalk://pair?uid=9876543210&code=654321');

  // Re-registering without preferredCode reuses active code and extends timestamp
  fakeNow += 2000;
  const reg2 = registry.registerTvPairing('9876543210', 'Living Room TV');
  assert.equal(reg2.code, '654321');

  // Offline TV rejects pairing
  const offlineRes = registry.pairConnector({
    code: '654321',
    connectorSocketId: 'sock_phone_1',
    deviceName: 'Pixel Phone',
    isTvOnlineFn: () => false
  });
  assert.equal(offlineRes.ok, false);
  assert.match(offlineRes.error, /offline/i);

  // Advance past TTL and verify expired code fails
  fakeNow += 6000;
  const expiredRes = registry.pairConnector({
    code: '654321',
    connectorSocketId: 'sock_phone_1',
    isTvOnlineFn: () => true
  });
  assert.equal(expiredRes.ok, false);
  assert.match(expiredRes.error, /expired/i);
});

test('SplitMeshRegistry manages single active connector per TV, replacement, unpair, and split call sessions', () => {
  const registry = new SplitMeshRegistry();
  registry.registerTvPairing('1112223334', 'Bedroom Fire TV', '123456');

  const p1 = registry.pairConnector({
    code: '123456',
    connectorSocketId: 'conn_sock_a',
    deviceName: 'Phone A',
    resolution: '1080p',
    facingMode: 'environment',
    isTvOnlineFn: () => true
  });
  assert.equal(p1.ok, true);
  assert.equal(p1.tvUid, '1112223334');
  assert.equal(p1.replacedSocketId, null);

  // Pairing a second phone replaces the first and returns its socketId
  const p2 = registry.pairConnector({
    code: '123456',
    connectorSocketId: 'conn_sock_b',
    deviceName: 'Phone B',
    isTvOnlineFn: () => true
  });
  assert.equal(p2.ok, true);
  assert.equal(p2.replacedSocketId, 'conn_sock_a');
  assert.equal(registry.getConnectorForTv('1112223334').socketId, 'conn_sock_b');
  assert.equal(registry.getTvForConnector('conn_sock_b'), '1112223334');

  // Register Split Call Session (Option 2: Phone -> Friend, Friend -> TV)
  const callSession = registry.registerSplitCallSession({
    tvUid: '1112223334',
    friendUid: '5556667778',
    friendName: 'Rahul',
    callType: 'video',
    tvAsCaller: true
  });
  assert.ok(callSession);
  assert.equal(callSession.connectorSocketId, 'conn_sock_b');
  assert.equal(registry.getSplitCallSessionByTv('1112223334').friendUid, '5556667778');
  assert.equal(registry.getSplitCallSessionByFriend('5556667778').tvUid, '1112223334');

  const cleared = registry.clearSplitCallForUid('5556667778');
  assert.equal(cleared.length, 1);
  assert.equal(registry.getSplitCallSessionByTv('1112223334'), null);

  const unpaired = registry.unpairByConnector('conn_sock_b');
  assert.equal(unpaired.tvUid, '1112223334');
  assert.equal(registry.getConnectorForTv('1112223334'), null);
});

test('Zero-CDN QR SVG generator renders valid ISO-18004 matrix and SVG markup', () => {
  const payload = 'zingtalk://pair?uid=9876543210&code=654321';
  const matrix = generateQrMatrix(payload);
  assert.ok(Array.isArray(matrix));
  assert.ok(matrix.length >= 21);
  assert.equal(matrix.length, matrix[0].length);

  const svg = renderQrSvg(payload);
  assert.ok(svg.startsWith('<svg '));
  assert.ok(svg.includes('<path d="M'));
  assert.ok(svg.includes('TV Pairing QR Code'));
});

test('All 3 APKs, How to Use guides, and Connector CI pipeline files are properly wired', () => {
  const connectorDir = path.resolve('packages/connector');
  for (const file of ['index.html', 'style.css', 'app.js', 'manifest.json', 'privacy.html', 'terms.html']) {
    assert.ok(fs.existsSync(path.join(connectorDir, file)), `Missing connector file: ${file}`);
  }

  const connectorHtml = fs.readFileSync(path.join(connectorDir, 'index.html'), 'utf8');
  assert.ok(connectorHtml.includes('id="tab-pair"'));
  assert.ok(connectorHtml.includes('id="tab-studio"'));
  assert.ok(connectorHtml.includes('id="tab-remote"'));
  assert.ok(connectorHtml.includes('id="tab-guide"'));
  assert.ok(connectorHtml.includes('How to Use'));
  assert.match(connectorHtml, /strictly 18\+ adults only/i);

  const tvHtml = fs.readFileSync(path.resolve('packages/tv/index.html'), 'utf8');
  assert.ok(tvHtml.includes('id="header-connector-btn"'));
  assert.ok(tvHtml.includes('id="connector-pair-modal"'));
  assert.ok(tvHtml.includes('id="guide-modal"'));
  assert.ok(tvHtml.includes('Wireless Phone Camera'));
  assert.ok(tvHtml.includes('Echo-Free Placement Tips'));

  const mobileApp = fs.readFileSync(path.resolve('packages/mobile/app.js'), 'utf8');
  assert.ok(mobileApp.includes('split_webrtc_offer_received'));
  assert.ok(mobileApp.includes('split_webrtc_answer'));
  assert.ok(mobileApp.includes('connectorPeerConnection'));

  const buildWorkflow = fs.readFileSync(path.resolve('.github/workflows/build-connector.yml'), 'utf8');
  assert.ok(buildWorkflow.includes('node scripts/prepare-android.js connector'));
  assert.ok(buildWorkflow.includes('ZingTalk-Connector.apk'));
});
