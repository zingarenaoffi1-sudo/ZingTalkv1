import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function readPngHeader(filePath) {
    const buf = fs.readFileSync(filePath);
    assert.equal(buf.slice(0, 8).toString('hex'), '89504e470d0a1a0a', `${filePath} must have PNG signature`);
    assert.equal(buf.slice(12, 16).toString('ascii'), 'IHDR', `${filePath} must have IHDR chunk`);
    return {
        width: buf.readUInt32BE(16),
        height: buf.readUInt32BE(20),
        bitDepth: buf.readUInt8(24),
        colorType: buf.readUInt8(25)
    };
}

test('ZingTalk Connector has a distinct 512x512 RGB icon and all Android mipmap densities', () => {
    const tvIcon = fs.readFileSync('packages/tv/assets/icon.png');
    const mobileIcon = fs.readFileSync('packages/mobile/assets/icon.png');
    const connectorIconPath = 'packages/connector/assets/icon.png';
    const connectorIcon = fs.readFileSync(connectorIconPath);

    assert.notEqual(Buffer.compare(connectorIcon, tvIcon), 0, 'Connector icon must differ from TV icon');
    assert.notEqual(Buffer.compare(connectorIcon, mobileIcon), 0, 'Connector icon must differ from Mobile icon');

    const hdr = readPngHeader(connectorIconPath);
    assert.equal(hdr.width, 512);
    assert.equal(hdr.height, 512);
    assert.equal(hdr.colorType, 2, 'Connector Store icon.png must be 24-bit RGB without alpha');

    const mipmaps = [
        ['mdpi', 48],
        ['hdpi', 72],
        ['xhdpi', 96],
        ['xxhdpi', 144],
        ['xxxhdpi', 192]
    ];
    for (const [density, size] of mipmaps) {
        for (const variant of ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png']) {
            const p = path.join('packages/connector/assets', `mipmap-${density}`, variant);
            assert.equal(fs.existsSync(p), true, `Missing ${p}`);
            const mHdr = readPngHeader(p);
            assert.equal(mHdr.width, size, `${p} width mismatch`);
            assert.equal(mHdr.height, size, `${p} height mismatch`);
        }
    }
});

test('prepare-android.js sets TV version 1.1 (versionCode 2) and Mobile/Connector version 1.0 (versionCode 1)', () => {
    const script = fs.readFileSync('scripts/prepare-android.js', 'utf8');
    assert.match(script, /const\s+versionCode\s*=\s*targetPlatform\s*===\s*'tv'\s*\?\s*2\s*:\s*1/);
    assert.match(script, /const\s+versionName\s*=\s*targetPlatform\s*===\s*'tv'\s*\?\s*'1\.1'\s*:\s*'1\.0'/);
    assert.match(script, /versionCode\\s\+\\d\+/);
    assert.match(script, /versionName\\s\+"\[\^"\]\+"/);
});

test('Amazon Appstore screenshots exist (4-8 real PNGs per APK) with exact non-alpha RGB dimensions', () => {
    const specs = [
        { dir: 'screenshots/firetv', width: 1920, height: 1080 },
        { dir: 'screenshots/mobile', width: 1080, height: 1920 },
        { dir: 'screenshots/connector', width: 1080, height: 1920 }
    ];

    for (const { dir, width, height } of specs) {
        assert.equal(fs.existsSync(dir), true, `Missing directory ${dir}`);
        const files = fs.readdirSync(dir).filter(f => f.endsWith('.png')).sort();
        assert.ok(files.length >= 4 && files.length <= 8, `${dir} must have 4-8 PNG screenshots (found ${files.length})`);

        for (const file of files) {
            const fullPath = path.join(dir, file);
            const hdr = readPngHeader(fullPath);
            assert.equal(hdr.width, width, `${fullPath} must be ${width}px wide`);
            assert.equal(hdr.height, height, `${fullPath} must be ${height}px tall`);
            assert.equal(hdr.colorType, 2, `${fullPath} must be 24-bit RGB without alpha transparency`);
        }
    }
});

test('screenshots directory is never leaked into APK web bundles', () => {
    assert.equal(fs.existsSync('dist/screenshots'), false, 'dist/screenshots must not exist');
    assert.equal(fs.existsSync('android/app/src/main/assets/public/screenshots'), false, 'APK assets must not bundle screenshots');
});
