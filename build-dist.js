const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, 'dist');
if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
}

const filesToCopy = [
    'index.html',
    'style.css',
    'app.js',
    'manifest.json',
    'service-worker.js'
];

const androidPublicDir = path.join(__dirname, 'android', 'app', 'src', 'main', 'assets', 'public');
if (!fs.existsSync(androidPublicDir)) {
    fs.mkdirSync(androidPublicDir, { recursive: true });
}

filesToCopy.forEach(file => {
    const srcPath = path.join(__dirname, file);
    const destPath = path.join(distDir, file);
    if (fs.existsSync(srcPath)) {
        fs.copyFileSync(srcPath, destPath);
        const androidDest = path.join(androidPublicDir, file);
        fs.copyFileSync(srcPath, androidDest);
    }
});

// Sync Packages (TV and Mobile)
const packages = ['tv', 'mobile'];
packages.forEach(pkg => {
    const pkgDir = path.join(__dirname, 'packages', pkg);
    const pkgDist = path.join(pkgDir, 'dist');
    if (!fs.existsSync(pkgDist)) {
        fs.mkdirSync(pkgDist, { recursive: true });
    }
    ['index.html', 'style.css', 'app.js'].forEach(f => {
        const src = path.join(pkgDir, f);
        if (fs.existsSync(src)) {
            fs.copyFileSync(src, path.join(pkgDist, f));
        }
    });
});

// Copy Capacitor runtime bundle
const capCorePath = path.join(__dirname, 'node_modules/@capacitor/core/dist/capacitor.js');
if (fs.existsSync(capCorePath)) {
    fs.copyFileSync(capCorePath, path.join(distDir, 'capacitor.js'));
    fs.copyFileSync(capCorePath, path.join(__dirname, 'capacitor.js'));
    fs.copyFileSync(capCorePath, path.join(androidPublicDir, 'capacitor.js'));
    packages.forEach(pkg => {
        fs.copyFileSync(capCorePath, path.join(__dirname, 'packages', pkg, 'dist', 'capacitor.js'));
        fs.copyFileSync(capCorePath, path.join(__dirname, 'packages', pkg, 'capacitor.js'));
    });
}

// Copy Socket.IO client runtime bundle
const socketIoPaths = [
    path.join(__dirname, 'node_modules/socket.io/client-dist/socket.io.min.js'),
    path.join(__dirname, 'node_modules/socket.io-client/dist/socket.io.min.js')
];
for (const sPath of socketIoPaths) {
    if (fs.existsSync(sPath)) {
        fs.copyFileSync(sPath, path.join(distDir, 'socket.io.min.js'));
        fs.copyFileSync(sPath, path.join(__dirname, 'socket.io.min.js'));
        fs.copyFileSync(sPath, path.join(androidPublicDir, 'socket.io.min.js'));
        packages.forEach(pkg => {
            fs.copyFileSync(sPath, path.join(__dirname, 'packages', pkg, 'dist', 'socket.io.min.js'));
            fs.copyFileSync(sPath, path.join(__dirname, 'packages', pkg, 'socket.io.min.js'));
        });
        break;
    }
}

// Copy assets folder
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

copyDirSync(path.join(__dirname, 'assets'), path.join(distDir, 'assets'));
copyDirSync(path.join(__dirname, 'assets'), path.join(androidPublicDir, 'assets'));
packages.forEach(pkg => {
    copyDirSync(path.join(__dirname, 'assets'), path.join(__dirname, 'packages', pkg, 'dist', 'assets'));
    copyDirSync(path.join(__dirname, 'assets'), path.join(__dirname, 'packages', pkg, 'assets'));
});

// Ensure Cordova stubs
const cordovaStubPath = path.join(androidPublicDir, 'cordova.js');
if (!fs.existsSync(cordovaStubPath)) {
    fs.writeFileSync(cordovaStubPath, '// Capacitor Cordova Stub\n', 'utf8');
}
const cordovaPluginsStubPath = path.join(androidPublicDir, 'cordova_plugins.js');
if (!fs.existsSync(cordovaPluginsStubPath)) {
    fs.writeFileSync(cordovaPluginsStubPath, 'cordova.define("cordova/plugin_list", function(require, exports, module) {\n  module.exports = [];\n  module.exports.metadata = {};\n});\n', 'utf8');
}

console.log('[build-dist] Distribution bundle built successfully for TV, Mobile, and Web.');
