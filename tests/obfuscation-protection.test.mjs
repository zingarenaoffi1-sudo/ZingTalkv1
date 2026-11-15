import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { obfuscateJs, minifyCss, minifyHtml } = require('../lib/protect-bundle');

test('obfuscateJs scrambles identifiers, hides strings/comments, and preserves ES imports/exports', () => {
  const sampleModule = `
    // Top secret comment
    import { renderQrSvg } from "./qr.js";
    const SECRET_SIGNALING = "https://zingtalk.duckdns.org";
    export function buildPairingPayload(tvUid) {
      return SECRET_SIGNALING + "/pair?uid=" + String(tvUid);
    }
  `;

  const output = obfuscateJs(sampleModule, { isModule: true });
  assert.ok(output.includes('_0x'), 'Obfuscated output must use hex identifier mangling');
  assert.equal(output.includes('Top secret comment'), false, 'Comments must be stripped');
  assert.equal(output.includes('https://zingtalk.duckdns.org'), false, 'String literals must be encrypted');
  assert.equal(output.includes('SECRET_SIGNALING'), false, 'Local constants must be renamed');
  assert.match(output, /import\s*\{.*\}\s*from\s*['"]\.\/qr\.js['"]/, 'Static ES import must stay valid');
  assert.match(output, /export\s+function\s+buildPairingPayload/, 'Exported function signature must stay callable');
});

test('minifyCss and minifyHtml remove comments, whitespace, and scramble inline scripts', async () => {
  const rawCss = `
    /* Developer comment about layout */
    .tv-header {
      display: flex;
      background-color: #090d16;
    }
  `;
  const minCss = minifyCss(rawCss);
  assert.equal(minCss.includes('Developer comment'), false);
  assert.equal(minCss.includes('\n'), false);
  assert.ok(minCss.includes('.tv-header{display:flex;background-color:#090d16}'));

  const rawHtml = `
    <!DOCTYPE html>
    <html>
      <body>
        <!-- Secret UI hint -->
        <div id="conn-toast">Hello</div>
        <script>
          const secretBannerMsg = "zingtalk_internal_banner";
          console.log(secretBannerMsg);
        </script>
      </body>
    </html>
  `;
  const minHtml = await minifyHtml(rawHtml);
  assert.equal(minHtml.includes('Secret UI hint'), false);
  assert.equal(minHtml.includes('zingtalk_internal_banner'), false);
  assert.ok(minHtml.includes('id="conn-toast"') || minHtml.includes('id=conn-toast'));
});

test('Protected packages/*/dist and Android assets/public contain obfuscated bundles with zero leaks', () => {
  for (const platform of ['tv', 'mobile', 'connector']) {
    const distDir = path.resolve('packages', platform, 'dist');
    assert.ok(fs.existsSync(distDir), `packages/${platform}/dist must exist`);
    assert.equal(fs.existsSync(path.join(distDir, 'dist')), false, `packages/${platform}/dist must not contain nested dist/`);
    assert.equal(fs.existsSync(path.join(distDir, 'screenshots')), false, `packages/${platform}/dist must not contain screenshots/`);
    assert.equal(fs.existsSync(path.join(distDir, 'connector-logic.js')), false, `packages/${platform}/dist must not leak test-only connector-logic.js`);
    assert.equal(fs.existsSync(path.join(distDir, 'assets', 'mipmap-hdpi')), false, `packages/${platform}/dist/assets must omit mipmap-* folders`);

    const appJs = fs.readFileSync(path.join(distDir, 'app.js'), 'utf8');
    assert.ok(appJs.includes('_0x'), `${platform}/dist/app.js must be obfuscated`);
    assert.equal(appJs.includes('https://zingtalk.duckdns.org'), false, `${platform}/dist/app.js must not expose raw signaling URL string`);
    assert.equal(appJs.includes('AIzaSyDDi5b_GBmRLSXQOXe'), false, `${platform}/dist/app.js must not expose raw Firebase API key string`);
    assert.equal(appJs.includes('PRODUCTION_SERVER_URL'), false, `${platform}/dist/app.js must rename top-level constants`);
    assert.equal(appJs.includes('firebaseConfig'), false, `${platform}/dist/app.js must rename config identifiers`);
    assert.equal(appJs.includes('Ephemeral TURN credentials'), false, `${platform}/dist/app.js must strip developer comments`);

    if (platform === 'tv' || platform === 'mobile') {
      assert.match(appJs, /firebase-app\.js/, `${platform}/dist/app.js must retain Firebase ESM import`);
    }
    if (platform === 'tv') {
      const qrJs = fs.readFileSync(path.join(distDir, 'qr.js'), 'utf8');
      assert.ok(qrJs.includes('_0x'), 'tv/dist/qr.js must be obfuscated');
      assert.ok(qrJs.includes('export function renderQrSvg'), 'tv/dist/qr.js must keep ESM export');
    }

    const indexHtml = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
    assert.equal(indexHtml.includes('<!--'), false, `${platform}/dist/index.html must strip HTML comments`);

    const styleCss = fs.readFileSync(path.join(distDir, 'style.css'), 'utf8');
    assert.equal(styleCss.includes('/*'), false, `${platform}/dist/style.css must strip CSS comments`);
  }

  const androidPublic = path.resolve('android', 'app', 'src', 'main', 'assets', 'public');
  assert.ok(fs.existsSync(androidPublic), 'android/app/src/main/assets/public must exist');
  assert.equal(fs.existsSync(path.join(androidPublic, 'dist')), false, 'APK assets/public must never contain nested dist/ folder');
  assert.equal(fs.existsSync(path.join(androidPublic, 'screenshots')), false, 'APK assets/public must never contain screenshots/');
  assert.equal(fs.existsSync(path.join(androidPublic, 'connector-logic.js')), false, 'APK assets/public must never leak connector-logic.js');
  assert.ok(fs.readFileSync(path.join(androidPublic, 'app.js'), 'utf8').includes('_0x'), 'APK assets/public/app.js must be obfuscated');

  const buildGradle = fs.readFileSync(path.resolve('android', 'app', 'build.gradle'), 'utf8');
  assert.match(buildGradle, /minifyEnabled\s+true/, 'build.gradle release must enable R8 minifyEnabled true');
  assert.match(buildGradle, /shrinkResources\s+true/, 'build.gradle release must enable shrinkResources true');

  const proguardRules = fs.readFileSync(path.resolve('android', 'app', 'proguard-rules.pro'), 'utf8');
  assert.ok(proguardRules.includes('-repackageclasses'), 'proguard-rules.pro must enable R8 class repackaging');
  assert.ok(proguardRules.includes('JavascriptInterface'), 'proguard-rules.pro must protect ZingNativeBridge @JavascriptInterface');
  assert.ok(proguardRules.split('\n').length < 60, 'proguard-rules.pro must remain clean and deduplicated');
});
