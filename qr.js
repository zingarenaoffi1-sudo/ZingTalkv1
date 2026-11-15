// Lightweight self-contained ISO-18004 Byte-mode QR Code SVG Generator (Versions 1..6, ECC Level L)
// Zero external dependencies so QR pairing codes work offline & in sealed APKs.

const QR_VERSIONS = {
    1: { size: 21, totalCodewords: 26, ecCodewords: 7, dataCodewords: 19, align: [] },
    2: { size: 25, totalCodewords: 44, ecCodewords: 10, dataCodewords: 34, align: [6, 18] },
    3: { size: 29, totalCodewords: 70, ecCodewords: 15, dataCodewords: 55, align: [6, 22] },
    4: { size: 33, totalCodewords: 100, ecCodewords: 20, dataCodewords: 80, align: [6, 26] },
    5: { size: 37, totalCodewords: 134, ecCodewords: 26, dataCodewords: 108, align: [6, 30] },
    6: { size: 41, totalCodewords: 172, ecCodewords: 36, dataCodewords: 136, align: [6, 34] }
};

// GF(256) tables with primitive polynomial 0x11d (285)
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
    let x = 1;
    for (let i = 0; i < 255; i++) {
        GF_EXP[i] = x;
        GF_LOG[x] = i;
        x <<= 1;
        if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) {
        GF_EXP[i] = GF_EXP[i - 255];
    }
})();

function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function getGeneratorPoly(degree) {
    let poly = [1];
    for (let i = 0; i < degree; i++) {
        const next = new Array(poly.length + 1).fill(0);
        const factor = GF_EXP[i];
        for (let j = 0; j < poly.length; j++) {
            next[j] ^= poly[j];
            next[j + 1] ^= gfMul(poly[j], factor);
        }
        poly = next;
    }
    return poly;
}

function computeReedSolomon(dataBytes, ecCount) {
    const gen = getGeneratorPoly(ecCount);
    const res = new Array(dataBytes.length + ecCount).fill(0);
    for (let i = 0; i < dataBytes.length; i++) res[i] = dataBytes[i];
    for (let i = 0; i < dataBytes.length; i++) {
        const coef = res[i];
        if (coef !== 0) {
            for (let j = 1; j < gen.length; j++) {
                res[i + j] ^= gfMul(gen[j], coef);
            }
        }
    }
    return res.slice(dataBytes.length);
}

// Precomputed 15-bit BCH format strings for ECC Level L (01) and masks 0..7
const FORMAT_L_STRINGS = [
    0b111011111000100,
    0b111001011110011,
    0b111110110101010,
    0b111100010011101,
    0b110011000101111,
    0b110001100011000,
    0b110110001000001,
    0b110100101110110
];

function encodeBytePayload(text) {
    const encoder = new TextEncoder();
    const bytes = Array.from(encoder.encode(String(text || "")));
    let verNum = 1;
    while (verNum <= 6 && bytes.length + 2 > QR_VERSIONS[verNum].dataCodewords) {
        verNum++;
    }
    if (verNum > 6) {
        verNum = 6;
    }
    const spec = QR_VERSIONS[verNum];
    const maxBytes = spec.dataCodewords - 2;
    const payload = bytes.slice(0, maxBytes);

    const bits = [];
    const pushBits = (val, len) => {
        for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
    };

    // Byte mode indicator (0100) + 8-bit char count
    pushBits(0b0100, 4);
    pushBits(payload.length, 8);
    payload.forEach((b) => pushBits(b, 8));

    const maxDataBits = spec.dataCodewords * 8;
    const terminatorLen = Math.min(4, maxDataBits - bits.length);
    for (let i = 0; i < terminatorLen; i++) bits.push(0);
    while (bits.length % 8 !== 0) bits.push(0);

    const codewords = [];
    for (let i = 0; i < bits.length; i += 8) {
        let byte = 0;
        for (let b = 0; b < 8; b++) byte = (byte << 1) | bits[i + b];
        codewords.push(byte);
    }

    const padBytes = [0xec, 0x11];
    let padIdx = 0;
    while (codewords.length < spec.dataCodewords) {
        codewords.push(padBytes[padIdx % 2]);
        padIdx++;
    }

    const ecBytes = computeReedSolomon(codewords, spec.ecCodewords);
    const fullBytes = codewords.concat(ecBytes);
    return { verNum, spec, fullBytes };
}

export function generateQrMatrix(text) {
    const { spec, fullBytes } = encodeBytePayload(text);
    const size = spec.size;
    const grid = Array.from({ length: size }, () => Array(size).fill(null));
    const fixed = Array.from({ length: size }, () => Array(size).fill(false));

    const setMod = (r, c, dark, lock = true) => {
        if (r < 0 || c < 0 || r >= size || c >= size) return;
        grid[r][c] = dark ? 1 : 0;
        if (lock) fixed[r][c] = true;
    };

    const drawFinder = (top, left) => {
        for (let r = -1; r <= 7; r++) {
            for (let c = -1; c <= 7; c++) {
                const rr = top + r;
                const cc = left + c;
                if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
                const inOuter = r >= 0 && r <= 6 && c >= 0 && c <= 6;
                const isBorder = r === 0 || r === 6 || c === 0 || c === 6;
                const isCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
                setMod(rr, cc, inOuter && (isBorder || isCore), true);
            }
        }
    };

    drawFinder(0, 0);
    drawFinder(0, size - 7);
    drawFinder(size - 7, 0);

    // Alignment pattern (Version >= 2)
    if (spec.align.length >= 2) {
        const cr = spec.align[1];
        const cc = spec.align[1];
        for (let r = -2; r <= 2; r++) {
            for (let c = -2; c <= 2; c++) {
                const dark = Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0);
                setMod(cr + r, cc + c, dark, true);
            }
        }
    }

    // Timing patterns
    for (let i = 8; i < size - 8; i++) {
        if (!fixed[6][i]) setMod(6, i, i % 2 === 0, true);
        if (!fixed[i][6]) setMod(i, 6, i % 2 === 0, true);
    }

    // Reserve format information cells + dark module
    setMod(size - 8, 8, true, true);
    for (let i = 0; i < 9; i++) {
        if (i !== 6) {
            if (!fixed[8][i]) setMod(8, i, false, true);
            if (!fixed[i][8]) setMod(i, 8, false, true);
        }
    }
    for (let i = 0; i < 8; i++) {
        if (!fixed[8][size - 1 - i]) setMod(8, size - 1 - i, false, true);
        if (i < 7 && !fixed[size - 1 - i][8]) setMod(size - 1 - i, 8, false, true);
    }

    // Place data bits in zig-zag pattern
    const dataBits = [];
    fullBytes.forEach((byte) => {
        for (let i = 7; i >= 0; i--) dataBits.push((byte >> i) & 1);
    });

    let bitIdx = 0;
    let upward = true;
    for (let col = size - 1; col >= 1; col -= 2) {
        if (col === 6) col--;
        for (let step = 0; step < size; step++) {
            const row = upward ? size - 1 - step : step;
            for (let offset = 0; offset < 2; offset++) {
                const c = col - offset;
                if (!fixed[row][c]) {
                    const bit = bitIdx < dataBits.length ? dataBits[bitIdx++] : 0;
                    grid[row][c] = bit;
                }
            }
        }
        upward = !upward;
    }

    // Apply Mask 0 ((row + col) % 2 === 0) — fast, deterministic, high contrast
    const maskId = 0;
    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            if (!fixed[r][c] && ((r + c) % 2 === 0)) {
                grid[r][c] ^= 1;
            }
        }
    }

    // Write 15-bit format bits for ECC-L + Mask 0
    const fmt = FORMAT_L_STRINGS[maskId];
    for (let i = 0; i < 15; i++) {
        const bit = (fmt >> i) & 1;
        // Horizontal format strip
        if (i < 6) setMod(8, i, bit === 1, true);
        else if (i === 6) setMod(8, 7, bit === 1, true);
        else if (i === 7) setMod(8, 8, bit === 1, true);
        else if (i === 8) setMod(7, 8, bit === 1, true);
        else setMod(14 - i, 8, bit === 1, true);

        // Vertical format strip
        if (i < 7) setMod(size - 1 - i, 8, bit === 1, true);
        else if (i === 7) setMod(8, size - 8, bit === 1, true);
        else setMod(8, size - 15 + i, bit === 1, true);
    }

    return grid;
}

export function renderQrSvg(text, options = {}) {
    const matrix = generateQrMatrix(text);
    const quiet = Number.isInteger(options.quiet) ? options.quiet : 2;
    const size = matrix.length;
    const total = size + quiet * 2;
    const fg = options.fg || "#090d16";
    const bg = options.bg || "#ffffff";

    let paths = "";
    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            if (matrix[r][c] === 1) {
                paths += `M${c + quiet},${r + quiet}h1v1h-1z`;
            }
        }
    }

    return `<svg viewBox="0 0 ${total} ${total}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="TV Pairing QR Code" style="width:100%;height:100%;display:block;border-radius:10px;background:${bg};"><rect width="${total}" height="${total}" fill="${bg}"/><path d="${paths}" fill="${fg}"/></svg>`;
}
