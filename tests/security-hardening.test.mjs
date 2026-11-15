import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  timingSafeEqualHex,
  FixedWindowRateLimiter,
  issueSessionToken,
  verifySessionToken,
  generateTurnCredentials,
  sanitizeServerUrl,
  isCorsOriginAllowed,
  validateAlexaWebhookRequest
} = require('../lib/security.js');
const { SplitMeshRegistry } = require('../lib/split-mesh.js');

test('timingSafeEqualHex performs constant-time hex digest validation', () => {
  const digest = 'a252a4f2e3595682ddcd540785bdb2002158211ebb0cfbbed9f0fefad04c1a65';
  assert.equal(timingSafeEqualHex(digest, digest.toUpperCase()), true);
  assert.equal(timingSafeEqualHex(digest, digest.slice(0, -1) + '0'), false);
  assert.equal(timingSafeEqualHex('abc', 'abc'), false); // odd length
  assert.equal(timingSafeEqualHex(null, digest), false);
});

test('FixedWindowRateLimiter enforces request limits and window resets', () => {
  let fakeNow = 10_000;
  const limiter = new FixedWindowRateLimiter({ windowMs: 5000, maxRequests: 3, nowFn: () => fakeNow });

  assert.equal(limiter.check('ip1').allowed, true);
  assert.equal(limiter.check('ip1').allowed, true);
  assert.equal(limiter.check('ip1').allowed, true);

  const blocked = limiter.check('ip1');
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds >= 1);

  fakeNow += 5001;
  assert.equal(limiter.check('ip1').allowed, true);

  limiter.reset('ip1');
  assert.equal(limiter.check('ip1').remaining, 2);
});

test('issueSessionToken and verifySessionToken detect tampering and expiration', () => {
  let fakeNow = 1_000_000;
  const secret = 'test_super_secret_hmac_key_123456';
  const token = issueSessionToken({ uid: '9876543210', isGuest: true }, secret, 5000, () => fakeNow);

  const verified = verifySessionToken(token, secret, () => fakeNow + 1000);
  assert.equal(verified.uid, '9876543210');
  assert.equal(verified.isGuest, true);

  // Tampered payload rejected
  const [payloadPart, sigPart] = token.split('.');
  const forgedPayload = Buffer.from(JSON.stringify({ uid: '1111111111', isGuest: false, exp: fakeNow + 99999 }), 'utf8').toString('base64url');
  assert.equal(verifySessionToken(`${forgedPayload}.${sigPart}`, secret, () => fakeNow), null);
  assert.equal(verifySessionToken(`${payloadPart}.wrongsig`, secret, () => fakeNow), null);

  // Wrong secret rejected
  assert.equal(verifySessionToken(token, 'wrong_secret', () => fakeNow), null);

  // Expired token rejected
  assert.equal(verifySessionToken(token, secret, () => fakeNow + 6000), null);
});

test('generateTurnCredentials produces time-limited coturn HMAC credentials', () => {
  const creds = generateTurnCredentials('9876543210', 'my_turn_secret', 3600, () => 1_700_000_000_000);
  assert.equal(creds.mode, 'hmac-ephemeral');
  assert.equal(creds.username, '1700003600:9876543210');
  assert.ok(creds.credential && creds.credential.length > 10);
  assert.ok(creds.urls.some((u) => u.startsWith('turn:zingtalk.duckdns.org:3478')));
});

test('sanitizeServerUrl & isCorsOriginAllowed enforce trusted origins only', () => {
  assert.equal(sanitizeServerUrl('https://zingtalk.duckdns.org/abc'), 'https://zingtalk.duckdns.org');
  assert.equal(sanitizeServerUrl('http://localhost:3000'), 'http://localhost:3000');
  assert.equal(sanitizeServerUrl('javascript:alert(1)'), 'https://zingtalk.duckdns.org');
  assert.equal(sanitizeServerUrl('https://evil-attacker.example.com'), 'https://zingtalk.duckdns.org');

  assert.equal(isCorsOriginAllowed(undefined), true); // Native HTTP client
  assert.equal(isCorsOriginAllowed('capacitor://localhost'), true);
  assert.equal(isCorsOriginAllowed('https://zingtalk.duckdns.org'), true);
  assert.equal(isCorsOriginAllowed('http://localhost:3000'), true);
  assert.equal(isCorsOriginAllowed('https://evil.example.com'), false);
  assert.equal(isCorsOriginAllowed('null'), false);
});

test('validateAlexaWebhookRequest checks replay timestamps, Skill ID, and cert chain URL', () => {
  const now = 1_700_000_000_000;
  const freshIso = new Date(now - 5000).toISOString();
  const staleIso = new Date(now - 200_000).toISOString();

  const okRes = validateAlexaWebhookRequest(
    { signaturecertchainurl: 'https://s3.amazonaws.com/echo.api/echo-api-cert-18.pem' },
    {
      session: { application: { applicationId: 'amzn1.ask.skill.test' } },
      request: { type: 'IntentRequest', timestamp: freshIso }
    },
    { expectedSkillId: 'amzn1.ask.skill.test', requireCertUrl: true, nowFn: () => now }
  );
  assert.equal(okRes.ok, true);

  const staleRes = validateAlexaWebhookRequest(
    { signaturecertchainurl: 'https://s3.amazonaws.com/echo.api/echo-api-cert-18.pem' },
    { request: { type: 'IntentRequest', timestamp: staleIso } },
    { requireCertUrl: true, nowFn: () => now }
  );
  assert.equal(staleRes.ok, false);

  const badCertRes = validateAlexaWebhookRequest(
    { signaturecertchainurl: 'https://attacker.com/echo.api/cert.pem' },
    { request: { type: 'IntentRequest', timestamp: freshIso } },
    { requireCertUrl: true, nowFn: () => now }
  );
  assert.equal(badCertRes.ok, false);

  const badSkillRes = validateAlexaWebhookRequest(
    {},
    {
      session: { application: { applicationId: 'amzn1.ask.skill.other' } },
      request: { type: 'IntentRequest', timestamp: freshIso }
    },
    { expectedSkillId: 'amzn1.ask.skill.test', nowFn: () => now }
  );
  assert.equal(badSkillRes.ok, false);
});

test('SplitMeshRegistry blocks UID-only pairing and rejects mismatched tvUid', () => {
  const registry = new SplitMeshRegistry();
  registry.registerTvPairing('9876543210', 'Living Room TV', '654321');

  // UID-only without 6-digit code MUST fail
  const uidOnly = registry.pairConnector({
    tvUid: '9876543210',
    code: '',
    connectorSocketId: 'sock_attacker',
    isTvOnlineFn: () => true
  });
  assert.equal(uidOnly.ok, false);
  assert.match(uidOnly.error, /6-digit Pairing Code/i);

  // Code belonging to another TV UID MUST fail
  const mismatch = registry.pairConnector({
    tvUid: '1111111111',
    code: '654321',
    connectorSocketId: 'sock_attacker',
    isTvOnlineFn: () => true
  });
  assert.equal(mismatch.ok, false);
  assert.match(mismatch.error, /does not match/i);
});

test('Zero hardcoded TURN passwords & full server/Android security protections verified statically', () => {
  const serverSrc = fs.readFileSync(path.resolve('server.js'), 'utf8');
  assert.equal(serverSrc.includes('express.static(__dirname'), false, 'Root __dirname static exposure must be removed');
  assert.ok(serverSrc.includes('/api/turn-credentials'), 'Dynamic TURN endpoint must exist');
  assert.ok(serverSrc.includes('request_turn_credentials'), 'Socket TURN credential event must exist');
  assert.ok(serverSrc.includes('timingSafeEqualHex'), 'Admin gate must use timing-safe hash check');
  assert.ok(!serverSrc.includes('default_alexa_device'), 'Unauthenticated default_alexa_device fallback must be removed');
  assert.ok(!serverSrc.includes('activeCallPeers.'), 'Per-socket activeCallPeers shadowing must not exist');

  for (const clientPath of ['packages/tv/app.js', 'packages/mobile/app.js', 'packages/connector/app.js']) {
    const src = fs.readFileSync(path.resolve(clientPath), 'utf8');
    assert.equal(src.includes('zingtalkpassword'), false, `${clientPath} must not contain hardcoded TURN password`);
    assert.ok(src.includes('sanitizeServerUrl'), `${clientPath} must sanitize server URL overrides`);
    assert.ok(src.includes('request_turn_credentials'), `${clientPath} must request dynamic TURN credentials`);
  }

  const prepAndroid = fs.readFileSync(path.resolve('scripts/prepare-android.js'), 'utf8');
  assert.ok(prepAndroid.includes('android:usesCleartextTraffic="false"'));
  assert.ok(prepAndroid.includes('android:allowBackup="false"'));
  assert.ok(prepAndroid.includes('setAllowUniversalAccessFromFileURLs(false)'));
  assert.ok(prepAndroid.includes('setAllowFileAccessFromFileURLs(false)'));
  assert.ok(prepAndroid.includes('setGeolocationEnabled(false)'));
  assert.ok(prepAndroid.includes('MIXED_CONTENT_NEVER_ALLOW'));
});
