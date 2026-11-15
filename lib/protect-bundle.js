const fs = require('fs');
const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');
const { minify: minifyHtmlAsync } = require('html-minifier-terser');
const CleanCSS = require('clean-css');

const ES_MODULE_EXACT_HINT = /\b(import|export)\b/;

/**
 * Obfuscates first-party JavaScript source for production APK & dist bundles.
 * Preserves ES module imports/exports and external browser/Capacitor/Bridge globals.
 */
function obfuscateJs(sourceCode, { isModule = false } = {}) {
    if (typeof sourceCode !== 'string' || !sourceCode.trim()) return sourceCode || '';

    const options = {
        compact: true,
        controlFlowFlattening: true,
        controlFlowFlatteningThreshold: 0.3,
        deadCodeInjection: true,
        deadCodeInjectionThreshold: 0.1,
        debugProtection: false,
        disableConsoleOutput: false,
        identifierNamesGenerator: 'hexadecimal',
        ignoreImports: Boolean(isModule),
        log: false,
        numbersToExpressions: true,
        renameGlobals: true,
        renameProperties: false,
        selfDefending: false,
        simplify: true,
        splitStrings: true,
        splitStringsChunkLength: 8,
        stringArray: true,
        stringArrayCallsTransform: true,
        stringArrayCallsTransformThreshold: 0.5,
        stringArrayEncoding: ['rc4'],
        stringArrayIndexShift: true,
        stringArrayRotate: true,
        stringArrayShuffle: true,
        stringArrayWrappersCount: 2,
        stringArrayWrappersChainedCalls: true,
        stringArrayWrappersParametersMaxCount: 4,
        stringArrayWrappersType: 'function',
        stringArrayThreshold: 0.75,
        target: 'browser',
        transformObjectKeys: false,
        unicodeEscapeSequence: false
    };

    return JavaScriptObfuscator.obfuscate(sourceCode, options).getObfuscatedCode();
}

/**
 * Minifies CSS and strips all comments and whitespace.
 */
function minifyCss(cssSource) {
    if (typeof cssSource !== 'string' || !cssSource.trim()) return cssSource || '';
    const result = new CleanCSS({ level: 2 }).minify(cssSource);
    if (result.errors && result.errors.length > 0) {
        throw new Error(`CSS minify error: ${result.errors.join('; ')}`);
    }
    return result.styles;
}

/**
 * Minifies HTML, strips comments, minifies inline <style>, and obfuscates inline <script>.
 */
async function minifyHtml(htmlSource) {
    if (typeof htmlSource !== 'string' || !htmlSource.trim()) return htmlSource || '';
    return minifyHtmlAsync(htmlSource, {
        collapseWhitespace: true,
        conservativeCollapse: false,
        removeComments: true,
        removeRedundantAttributes: true,
        removeEmptyAttributes: false,
        removeScriptTypeAttributes: false,
        removeStyleLinkTypeAttributes: false,
        minifyCSS: true,
        minifyJS: (text, inline) => {
            if (!text || !text.trim()) return text;
            try {
                const looksLikeModule = ES_MODULE_EXACT_HINT.test(text) && !inline;
                return obfuscateJs(text, { isModule: looksLikeModule });
            } catch (_) {
                return text;
            }
        }
    });
}

/**
 * Copies web-facing assets (icons/favicon/banner) while omitting Android mipmap-* folders
 * that belong only in android/app/src/main/res/.
 */
function copyWebAssetsDir(srcDir, destDir) {
    if (!fs.existsSync(srcDir)) return;
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    const entries = fs.readdirSync(srcDir, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.isDirectory() && entry.name.startsWith('mipmap-')) continue;
        const srcPath = path.join(srcDir, entry.name);
        const destPath = path.join(destDir, entry.name);
        if (entry.isDirectory()) {
            copyWebAssetsDir(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

/**
 * Builds a clean, obfuscated & minified production bundle for a specific ZingTalk platform
 * (`tv`, `mobile`, or `connector`) from `packages/<platform>` into `<outDir>`.
 */
async function buildProtectedPlatformBundle(platform, outDir, rootDir = path.resolve(__dirname, '..')) {
    const cleanPlatform = String(platform || 'tv').toLowerCase();
    const pkgDir = path.join(rootDir, 'packages', cleanPlatform);
    if (!fs.existsSync(pkgDir)) {
        throw new Error(`Unknown platform directory: ${pkgDir}`);
    }

    // Always purge output directory so zero stale or raw files remain
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });

    const resolveSrc = (filename) => {
        const pkgFile = path.join(pkgDir, filename);
        if (fs.existsSync(pkgFile)) return pkgFile;
        if (filename !== 'qr.js' && filename !== 'jsQR.js') {
            const rootFile = path.join(rootDir, filename);
            if (fs.existsSync(rootFile)) return rootFile;
        }
        return null;
    };

    // 1. Protect HTML files
    for (const htmlFile of ['index.html', 'privacy.html', 'terms.html']) {
        const srcPath = resolveSrc(htmlFile);
        if (srcPath) {
            const rawHtml = fs.readFileSync(srcPath, 'utf8');
            const minHtml = await minifyHtml(rawHtml);
            fs.writeFileSync(path.join(outDir, htmlFile), minHtml, 'utf8');
        }
    }

    // 2. Protect CSS files
    const cssSrc = resolveSrc('style.css');
    if (cssSrc) {
        const rawCss = fs.readFileSync(cssSrc, 'utf8');
        fs.writeFileSync(path.join(outDir, 'style.css'), minifyCss(rawCss), 'utf8');
    }

    // 3. Obfuscate first-party JavaScript files
    // Note: TV & Mobile use <script type="module" src="app.js"> + import './qr.js'
    const isEsModuleApp = cleanPlatform === 'tv' || cleanPlatform === 'mobile';
    const jsTargets = [
        { file: 'app.js', isModule: isEsModuleApp },
        { file: 'qr.js', isModule: true },
        { file: 'service-worker.js', isModule: false }
    ];

    for (const target of jsTargets) {
        const srcPath = resolveSrc(target.file);
        if (srcPath) {
            const rawJs = fs.readFileSync(srcPath, 'utf8');
            const obfJs = obfuscateJs(rawJs, { isModule: target.isModule });
            fs.writeFileSync(path.join(outDir, target.file), obfJs, 'utf8');
        }
    }

    // 4. Copy manifest.json cleanly (compact JSON)
    const manifestSrc = resolveSrc('manifest.json');
    if (manifestSrc) {
        try {
            const parsed = JSON.parse(fs.readFileSync(manifestSrc, 'utf8'));
            fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(parsed), 'utf8');
        } catch (_) {
            fs.copyFileSync(manifestSrc, path.join(outDir, 'manifest.json'));
        }
    }

    // 5. Copy third-party runtime vendor bundles (Capacitor, Socket.IO, jsQR)
    const capCorePath = path.join(rootDir, 'node_modules', '@capacitor', 'core', 'dist', 'capacitor.js');
    if (fs.existsSync(capCorePath)) {
        fs.copyFileSync(capCorePath, path.join(outDir, 'capacitor.js'));
    } else {
        const fallbackCap = resolveSrc('capacitor.js');
        if (fallbackCap) fs.copyFileSync(fallbackCap, path.join(outDir, 'capacitor.js'));
    }

    const socketIoPaths = [
        path.join(rootDir, 'node_modules', 'socket.io', 'client-dist', 'socket.io.min.js'),
        path.join(rootDir, 'node_modules', 'socket.io-client', 'dist', 'socket.io.min.js')
    ];
    let copiedSocket = false;
    for (const sPath of socketIoPaths) {
        if (fs.existsSync(sPath)) {
            fs.copyFileSync(sPath, path.join(outDir, 'socket.io.min.js'));
            copiedSocket = true;
            break;
        }
    }
    if (!copiedSocket) {
        const fallbackSock = resolveSrc('socket.io.min.js');
        if (fallbackSock) fs.copyFileSync(fallbackSock, path.join(outDir, 'socket.io.min.js'));
    }

    if (cleanPlatform === 'connector') {
        const jsqrPath = path.join(rootDir, 'node_modules', 'jsqr', 'dist', 'jsQR.js');
        if (fs.existsSync(jsqrPath)) {
            fs.copyFileSync(jsqrPath, path.join(outDir, 'jsQR.js'));
        } else {
            const fallbackJsqr = resolveSrc('jsQR.js');
            if (fallbackJsqr) fs.copyFileSync(fallbackJsqr, path.join(outDir, 'jsQR.js'));
        }
    }

    // 6. Copy web-facing icon assets (omitting res/mipmap-* and screenshots)
    const pkgAssetsSrc = path.join(pkgDir, 'assets');
    const fallbackAssetsSrc = path.join(rootDir, 'assets');
    copyWebAssetsDir(fs.existsSync(pkgAssetsSrc) ? pkgAssetsSrc : fallbackAssetsSrc, path.join(outDir, 'assets'));

    return outDir;
}

module.exports = {
    obfuscateJs,
    minifyCss,
    minifyHtml,
    copyWebAssetsDir,
    buildProtectedPlatformBundle
};
