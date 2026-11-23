/**
 * ZingTalk Server Metrics & Client Platform Detection Helpers
 * Pure, dependency-free functions for accurate platform classification
 * and real-time CPU / RAM / Event-Loop load & remaining capacity calculation.
 */

function clampPercent(val) {
    const num = Number(val);
    if (!Number.isFinite(num)) return 0;
    return Math.max(0, Math.min(100, Math.round(num)));
}

/**
 * Accurately classifies whether a socket/login connection comes from:
 * - "Fire TV" (Native Fire TV APK, Fire TV / Silk / Leanback device, or Android TV)
 * - "Mobile" (Native Mobile/Connector APK or mobile phone/tablet browser)
 * - "Web Browser" (Desktop / Laptop Chrome, Firefox, Safari, Edge, Linux, macOS, Windows)
 *
 * Prevents web bundles (like root/tv web builds) that default-tag "Fire TV" from
 * polluting Fire TV metrics when tested from a desktop or mobile browser.
 */
function detectPlatformFromClient({ data = {}, userAgent = '' } = {}) {
    const ua = String(userAgent || '');
    const rawPlatform = (data && typeof data.platform === 'string') ? data.platform.trim() : '';
    const pLower = rawPlatform.toLowerCase();

    const isNativeApp = Boolean(data && data.isNativeApp === true);
    const isFireTvUA = /AFT|FireTV|Silk|Leanback|GoogleTV|BRAVIA|MIBOX/i.test(ua);
    const isMobileUA = /Android.*Mobile|iPhone|iPad|iPod/i.test(ua);
    const isAndroidTabletOrTvUA = /Android/i.test(ua) && !/Mobile/i.test(ua);
    const isDesktopBrowserUA = /Windows NT|Macintosh|CrOS|X11|Win64|WOW64/i.test(ua) && !/Android/i.test(ua) && !isFireTvUA;

    if (rawPlatform) {
        if (pLower.includes('web') || pLower.includes('browser') || pLower.includes('desktop')) {
            return 'Web Browser';
        }
        if (pLower.includes('mob') || pLower.includes('ios') || pLower.includes('phone')) {
            return 'Mobile';
        }
        if (pLower.includes('fire') || pLower.includes('tv') || pLower.includes('leanback')) {
            // Only classify as Fire TV if running natively, on a real Fire TV / Android TV UA,
            // or when no browser desktop/mobile phone User-Agent contradicts it.
            if (isNativeApp || isFireTvUA || (!isDesktopBrowserUA && !isMobileUA)) {
                return 'Fire TV';
            }
            if (isMobileUA) return 'Mobile';
            return 'Web Browser';
        }
        if (pLower.includes('android')) {
            return isFireTvUA ? 'Fire TV' : 'Mobile';
        }
    }

    if (data && data.isTv === true && (isNativeApp || isFireTvUA || (!isDesktopBrowserUA && !isMobileUA))) {
        return 'Fire TV';
    }
    if (data && data.isMobile === true) {
        return 'Mobile';
    }

    if (isFireTvUA) return 'Fire TV';
    if (isMobileUA) return 'Mobile';
    if (isAndroidTabletOrTvUA) return 'Fire TV';
    if (isDesktopBrowserUA || /Chrome|Firefox|Safari|Edg/i.test(ua)) return 'Web Browser';

    return 'Web Browser';
}

/**
 * Parses Linux /proc/meminfo text into byte counts so true MemAvailable
 * (including reclaimable Page Cache / Buffers / SReclaimable) is distinguished
 * from raw MemFree.
 */
function parseProcMemInfo(rawText) {
    if (!rawText || typeof rawText !== 'string') return null;
    const kb = {};
    const lines = rawText.split('\n');
    for (const line of lines) {
        const match = /^([A-Za-z0-9_]+):\s+(\d+)\s*kB/i.exec(line.trim());
        if (match) {
            kb[match[1]] = Number(match[2]) * 1024;
        }
    }
    if (!kb.MemTotal) return null;

    const buffers = kb.Buffers || 0;
    const cached = kb.Cached || 0;
    const sReclaimable = kb.SReclaimable || 0;
    const memFree = kb.MemFree || 0;
    const reclaimableCacheBytes = buffers + cached + sReclaimable;
    const memAvailableBytes = Number.isFinite(kb.MemAvailable)
        ? Math.min(kb.MemTotal, Math.max(memFree, kb.MemAvailable))
        : Math.min(kb.MemTotal, memFree + reclaimableCacheBytes);

    return {
        memTotalBytes: kb.MemTotal,
        memFreeBytes: memFree,
        memAvailableBytes,
        reclaimableCacheBytes
    };
}

/**
 * Builds a structured server load + remaining headroom report from OS & runtime counters.
 */
function computeServerLoadReport({
    cpuUsedPct = 0,
    totalMemBytes = 0,
    freeMemBytes = 0,
    memAvailableBytes = null,
    reclaimableCacheBytes = null,
    processRssBytes = 0,
    heapUsedBytes = 0,
    heapTotalBytes = 0,
    cpuCores = 1,
    loadAvg1m = 0,
    loadAvg5m = 0,
    loadAvg15m = 0,
    eventLoopLagMs = 0,
    liveSockets = 0,
    activePairings = 0,
    activeSplitCalls = 0,
    uptimeSeconds = 0
} = {}) {
    const safeTotalMem = Math.max(1, Number(totalMemBytes) || 1);
    const safeOsFree = Math.max(0, Math.min(safeTotalMem, Number(freeMemBytes) || 0));
    const hasMemAvail = memAvailableBytes !== null && memAvailableBytes !== undefined && Number.isFinite(Number(memAvailableBytes)) && Number(memAvailableBytes) > 0;
    const effectiveFreeMem = hasMemAvail
        ? Math.max(safeOsFree, Math.min(safeTotalMem, Number(memAvailableBytes)))
        : safeOsFree;
    const derivedCacheBytes = reclaimableCacheBytes !== null && reclaimableCacheBytes !== undefined && Number.isFinite(Number(reclaimableCacheBytes))
        ? Math.max(0, Number(reclaimableCacheBytes))
        : Math.max(0, effectiveFreeMem - safeOsFree);

    const ramUsedBytes = Math.max(0, safeTotalMem - effectiveFreeMem);

    const cpuUsed = clampPercent(cpuUsedPct);
    const cpuRemaining = 100 - cpuUsed;

    const ramUsedPct = clampPercent((ramUsedBytes / safeTotalMem) * 100);
    const ramRemainingPct = 100 - ramUsedPct;

    const lagMs = Math.max(0, Math.round((Number(eventLoopLagMs) || 0) * 10) / 10);
    // 0ms -> 0%, 100ms -> 50%, >=200ms -> 100%
    const loopLoadPct = clampPercent((lagMs / 200) * 100);

    const overallLoadPct = clampPercent(
        cpuUsed * 0.50 +
        ramUsedPct * 0.35 +
        loopLoadPct * 0.15
    );
    const remainingCapacityPct = 100 - overallLoadPct;

    let statusLabel = 'Healthy';
    let statusLevel = 'healthy';
    if (overallLoadPct >= 85) {
        statusLabel = 'Heavy Load';
        statusLevel = 'heavy';
    } else if (overallLoadPct >= 60) {
        statusLabel = 'Moderate Load';
        statusLevel = 'moderate';
    }

    const toMb = (bytes) => Math.max(0, Math.round((Number(bytes) || 0) / (1024 * 1024)));

    return {
        overallLoadPct,
        remainingCapacityPct,
        statusLabel,
        statusLevel,
        cpu: {
            usedPct: cpuUsed,
            remainingPct: cpuRemaining,
            cores: Math.max(1, Number(cpuCores) || 1),
            loadAvg1m: Math.round((Number(loadAvg1m) || 0) * 100) / 100,
            loadAvg5m: Math.round((Number(loadAvg5m) || 0) * 100) / 100,
            loadAvg15m: Math.round((Number(loadAvg15m) || 0) * 100) / 100
        },
        memory: {
            usedPct: ramUsedPct,
            remainingPct: ramRemainingPct,
            usedMb: toMb(ramUsedBytes),
            freeMb: toMb(effectiveFreeMem),
            osFreeMb: toMb(safeOsFree),
            reclaimableCacheMb: toMb(derivedCacheBytes),
            totalMb: toMb(safeTotalMem),
            processRssMb: toMb(processRssBytes),
            heapUsedMb: toMb(heapUsedBytes),
            heapTotalMb: toMb(heapTotalBytes)
        },
        runtime: {
            eventLoopLagMs: lagMs,
            loopLoadPct,
            liveSockets: Math.max(0, Number(liveSockets) || 0),
            activePairings: Math.max(0, Number(activePairings) || 0),
            activeSplitCalls: Math.max(0, Number(activeSplitCalls) || 0),
            uptimeSeconds: Math.max(0, Math.floor(Number(uptimeSeconds) || 0))
        }
    };
}

module.exports = {
    detectPlatformFromClient,
    parseProcMemInfo,
    computeServerLoadReport
};
