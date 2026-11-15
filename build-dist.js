const fs = require('fs');
const path = require('path');
const { buildProtectedPlatformBundle } = require('./lib/protect-bundle');

function copyDirSync(src, dest) {
    if (!fs.existsSync(src)) return;
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDirSync(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

async function main() {
    const rootDir = __dirname;
    const packages = ['tv', 'mobile', 'connector'];

    // 1. Keep root TV files synced from packages/tv for GitHub Pages & security test parity
    const tvPkgDir = path.join(rootDir, 'packages', 'tv');
    ['index.html', 'style.css', 'app.js', 'qr.js', 'manifest.json', 'service-worker.js', 'privacy.html', 'terms.html'].forEach(file => {
        const tvFile = path.join(tvPkgDir, file);
        const rootFile = path.join(rootDir, file);
        if (fs.existsSync(tvFile)) {
            fs.copyFileSync(tvFile, rootFile);
        }
    });

    // 2. Keep vendor runtime bundles synced inside each package folder for web preview (/tv, /mobile, /connector)
    const capCorePath = path.join(rootDir, 'node_modules/@capacitor/core/dist/capacitor.js');
    if (fs.existsSync(capCorePath)) {
        fs.copyFileSync(capCorePath, path.join(rootDir, 'capacitor.js'));
        packages.forEach(pkg => {
            fs.copyFileSync(capCorePath, path.join(rootDir, 'packages', pkg, 'capacitor.js'));
        });
    }

    const socketIoPaths = [
        path.join(rootDir, 'node_modules/socket.io/client-dist/socket.io.min.js'),
        path.join(rootDir, 'node_modules/socket.io-client/dist/socket.io.min.js')
    ];
    for (const sPath of socketIoPaths) {
        if (fs.existsSync(sPath)) {
            fs.copyFileSync(sPath, path.join(rootDir, 'socket.io.min.js'));
            packages.forEach(pkg => {
                fs.copyFileSync(sPath, path.join(rootDir, 'packages', pkg, 'socket.io.min.js'));
            });
            break;
        }
    }

    const jsqrPath = path.join(rootDir, 'node_modules/jsqr/dist/jsQR.js');
    if (fs.existsSync(jsqrPath)) {
        fs.copyFileSync(jsqrPath, path.join(rootDir, 'packages', 'connector', 'jsQR.js'));
    }

    // 3. Build obfuscated & minified production bundles for all 3 platforms
    for (const pkg of packages) {
        const pkgDist = path.join(rootDir, 'packages', pkg, 'dist');
        await buildProtectedPlatformBundle(pkg, pkgDist, rootDir);
        console.log(`[build-dist] Protected obfuscated bundle ready: packages/${pkg}/dist`);
    }

    // 4. Populate root dist/ cleanly with protected TV bundle as default
    const distDir = path.join(rootDir, 'dist');
    fs.rmSync(distDir, { recursive: true, force: true });
    copyDirSync(path.join(rootDir, 'packages', 'tv', 'dist'), distDir);

    // 5. Populate android/app/src/main/assets/public cleanly with protected TV bundle + Cordova stubs
    const androidPublicDir = path.join(rootDir, 'android', 'app', 'src', 'main', 'assets', 'public');
    fs.rmSync(androidPublicDir, { recursive: true, force: true });
    copyDirSync(distDir, androidPublicDir);

    fs.writeFileSync(path.join(androidPublicDir, 'cordova.js'), '// Capacitor Cordova Stub\n', 'utf8');
    fs.writeFileSync(
        path.join(androidPublicDir, 'cordova_plugins.js'),
        'cordova.define("cordova/plugin_list", function(require, exports, module) {\n  module.exports = [];\n  module.exports.metadata = {};\n});\n',
        'utf8'
    );

    console.log('[build-dist] Protected distribution bundles built successfully for TV, Mobile, Connector, and Web.');
}

main().catch((err) => {
    console.error('[build-dist] Build failed:', err);
    process.exit(1);
});
