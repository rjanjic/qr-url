// Hand-rolled QR encoder + SVG renderer. Zero runtime dependencies.
// Implements ISO/IEC 18004 byte mode for QR versions 1-40.

export type ErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H';

export interface QRCode {
  /** Square boolean matrix in row-major order. 1 = dark, 0 = light. */
  modules: Uint8Array;
  /** Width (and height) of the matrix in modules. */
  size: number;
  /** QR version (1-40). */
  version: number;
  /** Mask pattern reference (0-7) chosen by penalty scoring. */
  mask: number;
}

export interface RenderOptions {
  /** Quiet-zone width in modules. Default 4 (per spec minimum). */
  quiet?: number;
  /** Foreground color. Default `#000`. */
  fg?: string;
  /** Background color. Default `#fff`. */
  bg?: string;
}

// ---------- spec tables ----------

const EC_BITS: Record<ErrorCorrectionLevel, number> = { L: 0b01, M: 0b00, Q: 0b11, H: 0b10 };
const EC_INDEX: Record<ErrorCorrectionLevel, number> = { L: 0, M: 1, Q: 2, H: 3 };

// [version-1][ec_index] = [ec_per_block, g1_blocks, g1_data, g2_blocks, g2_data]
const EC_BLOCKS: readonly (readonly [number, number, number, number, number])[][] = [
  [[7,1,19,0,0],[10,1,16,0,0],[13,1,13,0,0],[17,1,9,0,0]],
  [[10,1,34,0,0],[16,1,28,0,0],[22,1,22,0,0],[28,1,16,0,0]],
  [[15,1,55,0,0],[26,1,44,0,0],[18,2,17,0,0],[22,2,13,0,0]],
  [[20,1,80,0,0],[18,2,32,0,0],[26,2,24,0,0],[16,4,9,0,0]],
  [[26,1,108,0,0],[24,2,43,0,0],[18,2,15,2,16],[22,2,11,2,12]],
  [[18,2,68,0,0],[16,4,27,0,0],[24,4,19,0,0],[28,4,15,0,0]],
  [[20,2,78,0,0],[18,4,31,0,0],[18,2,14,4,15],[26,4,13,1,14]],
  [[24,2,97,0,0],[22,2,38,2,39],[22,4,18,2,19],[26,4,14,2,15]],
  [[30,2,116,0,0],[22,3,36,2,37],[20,4,16,4,17],[24,4,12,4,13]],
  [[18,2,68,2,69],[26,4,43,1,44],[24,6,19,2,20],[28,6,15,2,16]],
  [[20,4,81,0,0],[30,1,50,4,51],[28,4,22,4,23],[24,3,12,8,13]],
  [[24,2,92,2,93],[22,6,36,2,37],[26,4,20,6,21],[28,7,14,4,15]],
  [[26,4,107,0,0],[22,8,37,1,38],[24,8,20,4,21],[22,12,11,4,12]],
  [[30,3,115,1,116],[24,4,40,5,41],[20,11,16,5,17],[24,11,12,5,13]],
  [[22,5,87,1,88],[24,5,41,5,42],[30,5,24,7,25],[24,11,12,7,13]],
  [[24,5,98,1,99],[28,7,45,3,46],[24,15,19,2,20],[30,3,15,13,16]],
  [[28,1,107,5,108],[28,10,46,1,47],[28,1,22,15,23],[28,2,14,17,15]],
  [[30,5,120,1,121],[26,9,43,4,44],[28,17,22,1,23],[28,2,14,19,15]],
  [[28,3,113,4,114],[26,3,44,11,45],[26,17,21,4,22],[26,9,13,16,14]],
  [[28,3,107,5,108],[26,3,41,13,42],[30,15,24,5,25],[28,15,15,10,16]],
  [[28,4,116,4,117],[26,17,42,0,0],[28,17,22,6,23],[30,19,16,6,17]],
  [[28,2,111,7,112],[28,17,46,0,0],[30,7,24,16,25],[24,34,13,0,0]],
  [[30,4,121,5,122],[28,4,47,14,48],[30,11,24,14,25],[30,16,15,14,16]],
  [[30,6,117,4,118],[28,6,45,14,46],[30,11,24,16,25],[30,30,16,2,17]],
  [[26,8,106,4,107],[28,8,47,13,48],[30,7,24,22,25],[30,22,15,13,16]],
  [[28,10,114,2,115],[28,19,46,4,47],[28,28,22,6,23],[30,33,16,4,17]],
  [[30,8,122,4,123],[28,22,45,3,46],[30,8,23,26,24],[30,12,15,28,16]],
  [[30,3,117,10,118],[28,3,45,23,46],[30,4,24,31,25],[30,11,15,31,16]],
  [[30,7,116,7,117],[28,21,45,7,46],[30,1,23,37,24],[30,19,15,26,16]],
  [[30,5,115,10,116],[28,19,47,10,48],[30,15,24,25,25],[30,23,15,25,16]],
  [[30,13,115,3,116],[28,2,46,29,47],[30,42,24,1,25],[30,23,15,28,16]],
  [[30,17,115,0,0],[28,10,46,23,47],[30,10,24,35,25],[30,19,15,35,16]],
  [[30,17,115,1,116],[28,14,46,21,47],[30,29,24,19,25],[30,11,15,46,16]],
  [[30,13,115,6,116],[28,14,46,23,47],[30,44,24,7,25],[30,59,16,1,17]],
  [[30,12,121,7,122],[28,12,47,26,48],[30,39,24,14,25],[30,22,15,41,16]],
  [[30,6,121,14,122],[28,6,47,34,48],[30,46,24,10,25],[30,2,15,64,16]],
  [[30,17,122,4,123],[28,29,46,14,47],[30,49,24,10,25],[30,24,15,46,16]],
  [[30,4,122,18,123],[28,13,46,32,47],[30,48,24,14,25],[30,42,15,32,16]],
  [[30,20,117,4,118],[28,40,47,7,48],[30,43,24,22,25],[30,10,15,67,16]],
  [[30,19,118,6,119],[28,18,47,31,48],[30,34,24,34,25],[30,20,15,61,16]],
];

const ALIGN_POS: readonly (readonly number[])[] = [
  [], [6,18], [6,22], [6,26], [6,30], [6,34],
  [6,22,38], [6,24,42], [6,26,46], [6,28,50], [6,30,54], [6,32,58], [6,34,62],
  [6,26,46,66], [6,26,48,70], [6,26,50,74], [6,30,54,78], [6,30,56,82], [6,30,58,86], [6,34,62,90],
  [6,28,50,72,94], [6,26,50,74,98], [6,30,54,78,102], [6,28,54,80,106], [6,32,58,84,110], [6,30,58,86,114], [6,34,62,90,118],
  [6,26,50,74,98,122], [6,30,54,78,102,126], [6,26,52,78,104,130], [6,30,56,82,108,134], [6,34,60,86,112,138], [6,30,58,86,114,142], [6,34,62,90,118,146],
  [6,30,54,78,102,126,150], [6,24,50,76,102,128,154], [6,28,54,80,106,132,158], [6,32,58,84,110,136,162], [6,26,54,82,110,138,166], [6,30,58,86,114,142,170],
];

// ---------- Galois Field GF(256) ----------

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255]!;
}

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a]! + GF_LOG[b]!]!;
}

function rsGenPoly(degree: number): number[] {
  let poly: number[] = [1];
  for (let i = 0; i < degree; i++) {
    const next: number[] = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j]!;
      next[j + 1] ^= gfMul(poly[j]!, GF_EXP[i]!);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data: readonly number[], ecLen: number): number[] {
  const gen = rsGenPoly(ecLen);
  const buf: number[] = new Array(data.length + ecLen).fill(0);
  for (let i = 0; i < data.length; i++) buf[i] = data[i]!;
  for (let i = 0; i < data.length; i++) {
    const coef = buf[i]!;
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j++) {
        buf[i + j] ^= gfMul(gen[j]!, coef);
      }
    }
  }
  return buf.slice(data.length);
}

// ---------- BCH for format / version info ----------

function bch(data: number, dataBits: number, genPoly: number): number {
  const genBits = 32 - Math.clz32(genPoly);
  let d = data << (genBits - 1);
  for (let i = dataBits - 1; i >= 0; i--) {
    if ((d >> (i + genBits - 1)) & 1) d ^= genPoly << i;
  }
  return (data << (genBits - 1)) | d;
}

function formatInfoBits(ecLevel: ErrorCorrectionLevel, mask: number): number {
  const data = (EC_BITS[ecLevel] << 3) | mask;
  return bch(data, 5, 0x537) ^ 0x5412;
}

function versionInfoBits(version: number): number {
  return bch(version, 6, 0x1f25);
}

// ---------- mask functions ----------

function maskAt(m: number, r: number, c: number): boolean {
  switch (m) {
    case 0: return ((r + c) & 1) === 0;
    case 1: return (r & 1) === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (((r >> 1) + ((c / 3) | 0)) & 1) === 0;
    case 5: return ((r * c) & 1) + (r * c) % 3 === 0;
    case 6: return ((((r * c) & 1) + (r * c) % 3) & 1) === 0;
    case 7: return ((((r + c) & 1) + (r * c) % 3) & 1) === 0;
    default: throw new Error(`invalid mask ${m}`);
  }
}

// ---------- data encoding ----------

function dataCodewords(version: number, ecLevel: ErrorCorrectionLevel): number {
  const b = EC_BLOCKS[version - 1]![EC_INDEX[ecLevel]]!;
  return b[1] * b[2] + b[3] * b[4];
}

function pickVersion(byteLen: number, ecLevel: ErrorCorrectionLevel): number | null {
  for (let v = 1; v <= 40; v++) {
    const cap = dataCodewords(v, ecLevel) * 8;
    const cc = v < 10 ? 8 : 16;
    if (4 + cc + byteLen * 8 <= cap) return v;
  }
  return null;
}

function encodeBitstream(bytes: Uint8Array, version: number, ecLevel: ErrorCorrectionLevel): Uint8Array {
  const totalCw = dataCodewords(version, ecLevel);
  const totalBits = totalCw * 8;
  const cc = version < 10 ? 8 : 16;
  const bits: number[] = [];
  const put = (v: number, n: number): void => {
    for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1);
  };

  put(0b0100, 4);             // byte mode
  put(bytes.length, cc);      // character count
  for (const b of bytes) put(b, 8);

  // Terminator (up to 4 zero bits)
  put(0, Math.min(4, totalBits - bits.length));
  // Pad to byte boundary
  while (bits.length % 8 !== 0) bits.push(0);
  // Pad bytes 0xEC, 0x11 alternating
  const pad = [0xec, 0x11];
  let pi = 0;
  while (bits.length < totalBits) {
    put(pad[pi]!, 8);
    pi ^= 1;
  }

  const out = new Uint8Array(totalCw);
  for (let i = 0; i < totalCw; i++) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i * 8 + j]!;
    out[i] = b;
  }
  return out;
}

function ecInterleave(dataCw: Uint8Array, version: number, ecLevel: ErrorCorrectionLevel): number[] {
  const [ecLen, g1c, g1d, g2c, g2d] = EC_BLOCKS[version - 1]![EC_INDEX[ecLevel]]!;
  const blocks: number[][] = [];
  let p = 0;
  for (let i = 0; i < g1c; i++) { blocks.push(Array.from(dataCw.slice(p, p + g1d))); p += g1d; }
  for (let i = 0; i < g2c; i++) { blocks.push(Array.from(dataCw.slice(p, p + g2d))); p += g2d; }
  const ecBlocks = blocks.map(b => rsEncode(b, ecLen));

  const out: number[] = [];
  const maxData = Math.max(g1d, g2d);
  for (let i = 0; i < maxData; i++) {
    for (const b of blocks) if (i < b.length) out.push(b[i]!);
  }
  for (let i = 0; i < ecLen; i++) {
    for (const b of ecBlocks) out.push(b[i]!);
  }
  return out;
}

// ---------- matrix construction ----------

function placeFunctionPatterns(modules: Uint8Array, reserved: Uint8Array, version: number, n: number): void {
  const finder = (r0: number, c0: number): void => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = r0 + r, cc = c0 + c;
        if (rr < 0 || rr >= n || cc < 0 || cc >= n) continue;
        let dark = 0;
        if (r >= 0 && r <= 6 && c >= 0 && c <= 6) {
          if (r === 0 || r === 6 || c === 0 || c === 6) dark = 1;
          else if (r >= 2 && r <= 4 && c >= 2 && c <= 4) dark = 1;
        }
        modules[rr * n + cc] = dark;
        reserved[rr * n + cc] = 1;
      }
    }
  };
  finder(0, 0);
  finder(0, n - 7);
  finder(n - 7, 0);

  for (let i = 8; i < n - 8; i++) {
    const bit = (i & 1) === 0 ? 1 : 0;
    modules[6 * n + i] = bit; reserved[6 * n + i] = 1;
    modules[i * n + 6] = bit; reserved[i * n + 6] = 1;
  }

  if (version >= 2) {
    const pos = ALIGN_POS[version - 1]!;
    for (const r of pos) {
      for (const c of pos) {
        if ((r === 6 && c === 6) || (r === 6 && c === n - 7) || (r === n - 7 && c === 6)) continue;
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const rr = r + dr, cc = c + dc;
            const dark = (Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0)) ? 1 : 0;
            modules[rr * n + cc] = dark;
            reserved[rr * n + cc] = 1;
          }
        }
      }
    }
  }

  modules[(n - 8) * n + 8] = 1;
  reserved[(n - 8) * n + 8] = 1;
}

function reserveFormatInfo(reserved: Uint8Array, n: number): void {
  for (let i = 0; i < 9; i++) {
    if (i !== 6) reserved[8 * n + i] = 1;
    if (i !== 6) reserved[i * n + 8] = 1;
  }
  for (let i = n - 8; i < n; i++) {
    reserved[8 * n + i] = 1;
    reserved[i * n + 8] = 1;
  }
}

function reserveVersionInfo(reserved: Uint8Array, n: number): void {
  for (let r = 0; r < 6; r++) {
    for (let c = n - 11; c < n - 8; c++) reserved[r * n + c] = 1;
  }
  for (let r = n - 11; r < n - 8; r++) {
    for (let c = 0; c < 6; c++) reserved[r * n + c] = 1;
  }
}

function placeDataBits(modules: Uint8Array, reserved: Uint8Array, n: number, codewords: number[]): void {
  let bitIdx = 0;
  let upward = true;
  const totalDataBits = codewords.length * 8;

  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let i = 0; i < n; i++) {
      const r = upward ? n - 1 - i : i;
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        if (!reserved[r * n + c]) {
          let bit = 0;
          if (bitIdx < totalDataBits) {
            bit = (codewords[bitIdx >> 3]! >>> (7 - (bitIdx & 7))) & 1;
          }
          modules[r * n + c] = bit;
          bitIdx++;
        }
      }
    }
    upward = !upward;
  }
}

function applyMask(modules: Uint8Array, reserved: Uint8Array, n: number, m: number): void {
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!reserved[r * n + c] && maskAt(m, r, c)) {
        modules[r * n + c] ^= 1;
      }
    }
  }
}

function writeFormatInfo(modules: Uint8Array, n: number, ecLevel: ErrorCorrectionLevel, mask: number): void {
  const bits = formatInfoBits(ecLevel, mask);
  for (let i = 0; i < 15; i++) {
    const bit = (bits >> i) & 1;
    let r: number, c: number;
    if (i < 6) { r = i; c = 8; }
    else if (i < 8) { r = i + 1; c = 8; }
    else { r = n - 15 + i; c = 8; }
    modules[r * n + c] = bit;
  }
  for (let i = 0; i < 15; i++) {
    const bit = (bits >> i) & 1;
    const r = 8;
    let c: number;
    if (i < 8) c = n - i - 1;
    else if (i < 9) c = 15 - i;
    else c = 14 - i;
    modules[r * n + c] = bit;
  }
}

function writeVersionInfo(modules: Uint8Array, n: number, version: number): void {
  const bits = versionInfoBits(version);
  for (let i = 0; i < 18; i++) {
    const bit = (bits >> i) & 1;
    const a = (i / 3) | 0;
    const b = i % 3;
    modules[a * n + (b + n - 11)] = bit;
    modules[(b + n - 11) * n + a] = bit;
  }
}

// ---------- penalty scoring (4 rules from ISO/IEC 18004 §7.8.3) ----------

function penalty(modules: Uint8Array, n: number): number {
  let p = 0;

  // Rule 1: runs of 5+ same color in rows and columns
  for (let r = 0; r < n; r++) {
    let run = 1;
    for (let c = 1; c < n; c++) {
      if (modules[r * n + c] === modules[r * n + c - 1]) run++;
      else { if (run >= 5) p += run - 2; run = 1; }
    }
    if (run >= 5) p += run - 2;
  }
  for (let c = 0; c < n; c++) {
    let run = 1;
    for (let r = 1; r < n; r++) {
      if (modules[r * n + c] === modules[(r - 1) * n + c]) run++;
      else { if (run >= 5) p += run - 2; run = 1; }
    }
    if (run >= 5) p += run - 2;
  }

  // Rule 2: 2x2 same-color blocks
  for (let r = 0; r < n - 1; r++) {
    for (let c = 0; c < n - 1; c++) {
      const v = modules[r * n + c];
      if (v === modules[r * n + c + 1] &&
          v === modules[(r + 1) * n + c] &&
          v === modules[(r + 1) * n + c + 1]) {
        p += 3;
      }
    }
  }

  // Rule 3: finder-like 1011101 with 4-light buffer
  const pat1 = [1,0,1,1,1,0,1,0,0,0,0];
  const pat2 = [0,0,0,0,1,0,1,1,1,0,1];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c <= n - 11; c++) {
      let m1 = true, m2 = true;
      for (let k = 0; k < 11; k++) {
        const v = modules[r * n + c + k];
        if (v !== pat1[k]) m1 = false;
        if (v !== pat2[k]) m2 = false;
        if (!m1 && !m2) break;
      }
      if (m1) p += 40;
      if (m2) p += 40;
    }
  }
  for (let c = 0; c < n; c++) {
    for (let r = 0; r <= n - 11; r++) {
      let m1 = true, m2 = true;
      for (let k = 0; k < 11; k++) {
        const v = modules[(r + k) * n + c];
        if (v !== pat1[k]) m1 = false;
        if (v !== pat2[k]) m2 = false;
        if (!m1 && !m2) break;
      }
      if (m1) p += 40;
      if (m2) p += 40;
    }
  }

  // Rule 4: dark/light balance
  let dark = 0;
  for (let i = 0; i < n * n; i++) if (modules[i]) dark++;
  const pct = (dark * 100) / (n * n);
  p += ((Math.abs(pct - 50) / 5) | 0) * 10;

  return p;
}

// ---------- public API ----------

/**
 * Encode text as a QR code matrix.
 *
 * Always uses byte mode (UTF-8). Picks the smallest QR version that fits.
 *
 * @throws if `ecLevel` is invalid or input exceeds v40 capacity (~2953 bytes at EC-L).
 */
export function generate(text: string, ecLevel: ErrorCorrectionLevel = 'M'): QRCode {
  if (!(ecLevel in EC_INDEX)) throw new Error('Invalid EC level');
  const bytes = new TextEncoder().encode(text);
  const version = pickVersion(bytes.length, ecLevel);
  if (version === null) throw new Error('Data too long for QR (max ~2953 bytes at EC-L)');

  const dataCw = encodeBitstream(bytes, version, ecLevel);
  const codewords = ecInterleave(dataCw, version, ecLevel);

  const n = 17 + 4 * version;
  const modules = new Uint8Array(n * n);
  const reserved = new Uint8Array(n * n);

  placeFunctionPatterns(modules, reserved, version, n);
  reserveFormatInfo(reserved, n);
  if (version >= 7) reserveVersionInfo(reserved, n);
  placeDataBits(modules, reserved, n, codewords);

  let bestScore = Infinity;
  let bestMask = 0;
  let bestModules = modules;
  for (let m = 0; m < 8; m++) {
    const test = new Uint8Array(modules);
    applyMask(test, reserved, n, m);
    writeFormatInfo(test, n, ecLevel, m);
    if (version >= 7) writeVersionInfo(test, n, version);
    const score = penalty(test, n);
    if (score < bestScore) {
      bestScore = score;
      bestMask = m;
      bestModules = test;
    }
  }

  return { modules: bestModules, size: n, version, mask: bestMask };
}

/**
 * Render a QR matrix as a standalone SVG string.
 *
 * Output uses a single merged `<path>` (one subpath per horizontal run of dark modules)
 * plus a background `<rect>`, with `shape-rendering="crispEdges"` for pixel-perfect output.
 */
export function renderSVG(qr: QRCode, opts: RenderOptions = {}): string {
  const quiet = opts.quiet ?? 4;
  const fg = opts.fg ?? '#000';
  const bg = opts.bg ?? '#fff';
  const n = qr.size;
  const total = n + 2 * quiet;
  const m = qr.modules;

  let d = '';
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (m[r * n + c]) {
        const start = c;
        while (c < n && m[r * n + c]) c++;
        const len = c - start;
        d += `M${start + quiet} ${r + quiet}h${len}v1h-${len}z`;
      } else {
        c++;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}"`
    + ` shape-rendering="crispEdges" preserveAspectRatio="xMidYMid meet">`
    + `<rect width="${total}" height="${total}" fill="${bg}"/>`
    + `<path d="${d}" fill="${fg}"/></svg>`;
}

export default { generate, renderSVG };
