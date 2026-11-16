import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const SUPPORT_DIR = path.resolve('support-site');
const PORTAL_FILES = ['index.html', 'infodeveloper.html', 'privacy.html', 'terms.html'];

test('support-site contains only the 4 HTML portal files and never touches ads.txt', () => {
  const entries = fs.readdirSync(SUPPORT_DIR).sort();
  assert.deepEqual(entries, [...PORTAL_FILES].sort());
  assert.equal(entries.includes('ads.txt'), false, 'ads.txt must remain untouched in Support-Zing/ZingTalk');
});

test('all support-site HTML pages use inline SVG favicons and avoid missing assets/icon.png', () => {
  for (const file of PORTAL_FILES) {
    const html = fs.readFileSync(path.join(SUPPORT_DIR, file), 'utf8');
    assert.ok(html.includes('data:image/svg+xml'), `${file} must inline SVG favicon`);
    assert.equal(html.includes('assets/icon.png'), false, `${file} must not reference non-existent assets/icon.png`);
  }
});

test('all support-site pages strictly enforce 18+ adult policy with zero 13+ contradictions and zero main-repo leaks', () => {
  for (const file of PORTAL_FILES) {
    const html = fs.readFileSync(path.join(SUPPORT_DIR, file), 'utf8');
    const htmlWithoutOsVer = html.replace(/Android\s+1[34]\+/gi, '');
    assert.ok(html.includes('18+'), `${file} must state 18+ restriction`);
    assert.equal(/\b13\+|\bunder 13\b|\bunder the age of 13\b/i.test(htmlWithoutOsVer), false, `${file} must not contain 13+ policy contradictions`);
    assert.equal(/zingarenaoffi1-sudo|ZingTalkv1/i.test(html), false, `${file} must never expose private repo/owner names`);
    assert.ok(html.includes('ZingTalk TV'), `${file} must reference ZingTalk TV`);
    assert.ok(html.includes('ZingTalk Mobile'), `${file} must reference ZingTalk Mobile`);
    assert.ok(html.includes('ZingTalk Connector'), `${file} must reference ZingTalk Connector`);
  }
});

test('index.html and infodeveloper.html showcase full 3-app architecture, TV+Connector pairing guide, and interactive tabs', () => {
  for (const file of ['index.html', 'infodeveloper.html']) {
    const html = fs.readFileSync(path.join(SUPPORT_DIR, file), 'utf8');
    assert.ok(html.includes('Option 2 Split-Mesh'), `${file} must document Option 2 Split-Mesh architecture`);
    assert.ok(html.includes('6-digit'), `${file} must document 6-digit pairing guide`);
    assert.ok(html.includes('QR'), `${file} must document QR pairing`);
    assert.ok(html.includes('Echo Guard'), `${file} must document Echo Guard audio separation`);
    assert.ok(html.includes('role="tab"'), `${file} must expose accessible tab buttons`);
    assert.ok(html.includes('href="privacy.html"'), `${file} must link to privacy.html`);
    assert.ok(html.includes('href="terms.html"'), `${file} must link to terms.html`);
  }
});

test('sync-support-site.yml securely syncs the 4 HTML files to Support-Zing/ZingTalk without touching ads.txt', () => {
  const wf = fs.readFileSync(path.resolve('.github/workflows/sync-support-site.yml'), 'utf8');
  assert.ok(wf.includes('repository: Support-Zing/ZingTalk'));
  assert.ok(wf.includes('${{ secrets.SYNC_TOKEN }}'));
  assert.ok(wf.includes('git add index.html infodeveloper.html privacy.html terms.html'));
  assert.equal(/cp[^\n]*ads\.txt|git add[^\n]*ads\.txt|rm[^\n]*ads\.txt/i.test(wf), false, 'Workflow must never copy, stage, or remove ads.txt');
  assert.ok(wf.includes('user.name "Support-Zing"'));
  assert.ok(wf.includes('user.email "support.zing.app@gmail.com"'));
  assert.equal(/zingarenaoffi1-sudo|ZingTalkv1/i.test(wf), false, 'Workflow must not embed private account/repo strings');
});
