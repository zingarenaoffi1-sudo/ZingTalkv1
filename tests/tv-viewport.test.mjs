import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function generateDeterministic10DigitUid(seedString) {
  let hash1 = 5381;
  let hash2 = 52711;
  for (let i = 0; i < seedString.length; i++) {
    const char = seedString.charCodeAt(i);
    hash1 = (hash1 * 33) ^ char;
    hash2 = (hash2 * 33) ^ char;
  }
  const combined = (Math.abs(hash1) * 4096 + Math.abs(hash2)).toString();
  let tenDigit = combined.replace(/\D/g, '');
  while (tenDigit.length < 10) {
    tenDigit += '7391826450';
  }
  if (tenDigit.charAt(0) === '0') {
    tenDigit = '9' + tenDigit.slice(1);
  }
  return tenDigit.slice(0, 10);
}

function sanitizeUidInput(raw) {
  return String(raw || '').replace(/\D/g, '').slice(0, 10);
}

test('Deterministic 10-Digit UID generator produces valid non-zero-leading 10-digit UIDs', () => {
  const uid1 = generateDeterministic10DigitUid('user@example.com');
  const uid2 = generateDeterministic10DigitUid('user@example.com');
  const uid3 = generateDeterministic10DigitUid('other@example.com');

  assert.equal(uid1.length, 10);
  assert.match(uid1, /^[1-9]\d{9}$/);
  assert.equal(uid1, uid2, 'Same seed must produce identical 10-digit UID');
  assert.notEqual(uid1, uid3, 'Different seeds must produce distinct UIDs');
});

test('UID sanitizer strips non-digits and caps length at 10 digits', () => {
  assert.equal(sanitizeUidInput('987-654-3210-999'), '9876543210');
  assert.equal(sanitizeUidInput('abc12345xyz'), '12345');
  assert.equal(sanitizeUidInput(''), '');
});

test('Android native launch theme and MainActivity enforce dark #090d16 background (no white flash)', () => {
  const stylesXml = fs.readFileSync(path.resolve('android/app/src/main/res/values/styles.xml'), 'utf8');
  assert.ok(stylesXml.includes('#090d16'), 'styles.xml must set #090d16 dark windowBackground');
  assert.ok(!stylesXml.includes('@drawable/splash'), 'styles.xml must not use bright splash drawable');

  const mainActivity = fs.readFileSync(path.resolve('android/app/src/main/java/com/zingtalktv/com/MainActivity.java'), 'utf8');
  assert.ok(
    mainActivity.includes('Color.parseColor("#090d16")'),
    'MainActivity.java must set window and WebView background to #090d16'
  );
});

test('Fire TV HTML and CSS include YouTube TV-style startup splash and 540px viewport-safe rules', () => {
  const tvHtml = fs.readFileSync(path.resolve('packages/tv/index.html'), 'utf8');
  const tvCss = fs.readFileSync(path.resolve('packages/tv/style.css'), 'utf8');

  assert.ok(tvHtml.includes('id="tv-startup-splash"'), 'packages/tv/index.html must include #tv-startup-splash');
  assert.ok(tvHtml.includes('background-color: #090d16 !important'), 'packages/tv/index.html must inline #090d16 background');
  assert.ok(tvCss.includes('.tv-startup-splash'), 'packages/tv/style.css must style .tv-startup-splash');
  assert.ok(tvCss.includes('max-height: calc(100vh - 36px)'), '.tv-auth-card must be bounded to viewport height');
  assert.ok(tvCss.includes('height: calc(100vh - 58px)'), '.tv-main-screen must match compact 58px TV header');
});
