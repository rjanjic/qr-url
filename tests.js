import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { generate, renderSVG } from './dist/index.js';
import QRDefault from './dist/index.js';
import qrcode from 'qrcode';
import jsQR from 'jsqr';

// ---------- helpers ----------

function renderPixels(qr, scale = 4) {
  const quiet = 4;
  const n = qr.size;
  const total = (n + 2 * quiet) * scale;
  const px = new Uint8ClampedArray(total * total * 4);
  for (let y = 0; y < total; y++) {
    for (let x = 0; x < total; x++) {
      const mx = ((x / scale) | 0) - quiet;
      const my = ((y / scale) | 0) - quiet;
      const dark = (mx >= 0 && mx < n && my >= 0 && my < n) ? qr.modules[my * n + mx] : 0;
      const v = dark ? 0 : 255;
      const i = (y * total + x) * 4;
      px[i] = v; px[i + 1] = v; px[i + 2] = v; px[i + 3] = 255;
    }
  }
  return { data: px, size: total };
}

function decode(qr) {
  const img = renderPixels(qr);
  const result = jsQR(img.data, img.size, img.size);
  return result ? result.data : null;
}

function refMatrix(text, ec) {
  const ref = qrcode.create(text, { errorCorrectionLevel: ec });
  return { modules: ref.modules.data, size: ref.modules.size, mask: ref.maskPattern, version: ref.version };
}

function matricesEqual(a, b) {
  if (a.size !== b.size) return false;
  for (let i = 0; i < a.modules.length; i++) if (a.modules[i] !== b.modules[i]) return false;
  return true;
}

// ---------- structural tests ----------

describe('structure', () => {
  test('size = 17 + 4 * version for v1..v10', () => {
    const caps = [17, 32, 53, 78, 106, 134, 154, 192, 230, 271];
    for (let v = 1; v <= 10; v++) {
      const qr = generate('x'.repeat(caps[v - 1]), 'L');
      assert.equal(qr.version, v, `expected v${v}`);
      assert.equal(qr.size, 17 + 4 * v);
    }
  });

  test('finder corners are dark, inner ring is light', () => {
    const qr = generate('https://example.com', 'M');
    const m = qr.modules, n = qr.size;
    assert.equal(m[0 * n + 0], 1, '(0,0) corner');
    assert.equal(m[0 * n + 6], 1, '(0,6) corner');
    assert.equal(m[6 * n + 0], 1, '(6,0) corner');
    assert.equal(m[6 * n + 6], 1, '(6,6) corner');
    assert.equal(m[1 * n + 1], 0, '(1,1) inner ring');
    assert.equal(m[3 * n + 3], 1, '(3,3) center');
    assert.equal(m[0 * n + (n - 7)], 1, 'top-right tl');
    assert.equal(m[0 * n + (n - 1)], 1, 'top-right tr');
    assert.equal(m[(n - 7) * n + 0], 1, 'bottom-left tl');
    assert.equal(m[(n - 1) * n + 0], 1, 'bottom-left bl');
  });

  test('separators around finders are light', () => {
    const qr = generate('hello', 'M');
    const m = qr.modules, n = qr.size;
    for (let c = 0; c <= 7; c++) assert.equal(m[7 * n + c], 0, `(7,${c})`);
    for (let r = 0; r <= 7; r++) assert.equal(m[r * n + 7], 0, `(${r},7)`);
  });

  test('timing patterns alternate starting from dark', () => {
    const qr = generate('x', 'L');
    const m = qr.modules, n = qr.size;
    for (let i = 8; i < n - 8; i++) {
      const expected = (i % 2 === 0) ? 1 : 0;
      assert.equal(m[6 * n + i], expected, `row-6 col ${i}`);
      assert.equal(m[i * n + 6], expected, `col-6 row ${i}`);
    }
  });

  test('dark module at (n-8, 8) is always 1', () => {
    const caps = { 1: 10, 2: 30, 5: 100, 10: 270, 20: 850, 40: 2900 };
    for (const expV of [1, 2, 5, 10, 20, 40]) {
      const qr = generate('x'.repeat(caps[expV]), 'L');
      const n = qr.size;
      assert.equal(qr.modules[(n - 8) * n + 8], 1, `v${qr.version}`);
    }
  });

  test('alignment pattern exists for v2+', () => {
    const qr = generate('https://example.com', 'M');
    const m = qr.modules, n = qr.size;
    assert.equal(m[18 * n + 18], 1, 'center');
    assert.equal(m[16 * n + 16], 1, 'NW corner');
    assert.equal(m[16 * n + 20], 1, 'NE corner');
    assert.equal(m[20 * n + 16], 1, 'SW corner');
    assert.equal(m[20 * n + 20], 1, 'SE corner');
    assert.equal(m[17 * n + 17], 0, 'inner ring');
  });
});

// ---------- version selection ----------

describe('version selection', () => {
  const cases = [
    [17, 'L', 1], [18, 'L', 2],
    [14, 'M', 1], [15, 'M', 2],
    [11, 'Q', 1], [12, 'Q', 2],
    [7, 'H', 1], [8, 'H', 2],
    [270, 'L', 10], [271, 'L', 10], [272, 'L', 11],
  ];
  for (const [len, ec, expV] of cases) {
    test(`${len} bytes at EC-${ec} → v${expV}`, () => {
      assert.equal(generate('x'.repeat(len), ec).version, expV);
    });
  }

  test('rejects too-long input', () => {
    assert.throws(() => generate('x'.repeat(10000), 'L'), /Data too long/);
  });

  test('rejects invalid EC level', () => {
    assert.throws(() => generate('hi', 'Z'), /Invalid EC level/);
  });
});

// ---------- determinism ----------

describe('determinism', () => {
  test('same input produces identical matrix', () => {
    for (const ec of ['L', 'M', 'Q', 'H']) {
      const a = generate('https://example.com', ec);
      const b = generate('https://example.com', ec);
      assert.equal(a.size, b.size);
      assert.equal(a.mask, b.mask);
      for (let i = 0; i < a.modules.length; i++) {
        assert.equal(a.modules[i], b.modules[i], `mismatch at ${i} (EC ${ec})`);
      }
    }
  });
});

// ---------- reference cross-check ----------

describe('matches qrcode reference lib (byte-exact)', () => {
  const cases = [
    ['https://example.com', 'M'],
    ['https://example.com', 'Q'],
    ['https://example.com', 'H'],
    ['https://google.com/?q=hello+world', 'L'],
    ['https://google.com/?q=hello+world', 'M'],
    ['https://google.com/?q=hello+world', 'Q'],
    ['https://google.com/?q=hello+world', 'H'],
    ['hi', 'L'],
    ['hi', 'M'],
    ['hi', 'Q'],
    ['hi', 'H'],
    ['https://github.com/anthropics/claude-code', 'L'],
    ['https://github.com/anthropics/claude-code', 'M'],
    ['https://github.com/anthropics/claude-code', 'Q'],
    ['https://github.com/anthropics/claude-code', 'H'],
  ];
  for (const [text, ec] of cases) {
    test(`${ec} ${JSON.stringify(text).slice(0, 50)}`, () => {
      const mine = generate(text, ec);
      const ref = refMatrix(text, ec);
      assert.equal(mine.size, ref.size, 'size');
      assert.equal(mine.version, ref.version, 'version');
      assert.ok(matricesEqual(mine, ref), 'matrices differ');
    });
  }
});

// ---------- decode round-trip ----------

describe('decode round-trip via jsqr', () => {
  const cases = [
    ['hi', 'L'], ['hi', 'M'], ['hi', 'Q'], ['hi', 'H'],
    ['https://example.com', 'L'],
    ['https://example.com', 'M'],
    ['https://example.com', 'Q'],
    ['https://example.com', 'H'],
    ['https://google.com/?q=hello+world', 'M'],
    ['https://github.com/anthropics/claude-code', 'H'],
    ['A'.repeat(100), 'M'],
    ['café', 'M'],
    ['日本語', 'M'],
    ['🎉 https://example.com', 'M'],
    ['https://example.com/' + 'a'.repeat(200), 'L'],
    ['x'.repeat(500), 'M'],
    ['x'.repeat(2000), 'L'],
  ];
  for (const [text, ec] of cases) {
    test(`[${ec}] ${JSON.stringify(text).slice(0, 60)}`, () => {
      const qr = generate(text, ec);
      assert.equal(decode(qr), text);
    });
  }
});

// Strong cross-check: every version 1..40 at max capacity, byte-identical to ref.
describe('byte-exact match vs reference at every version 1..40', () => {
  const maxByteCapAtL = [
    17, 32, 53, 78, 106, 134, 154, 192, 230, 271,
    321, 367, 425, 458, 520, 586, 644, 718, 792, 858,
    929, 1003, 1091, 1171, 1273, 1367, 1465, 1528, 1628, 1732,
    1840, 1952, 2068, 2188, 2303, 2431, 2563, 2699, 2809, 2953,
  ];
  for (let v = 1; v <= 40; v++) {
    test(`v${v} at max capacity (${maxByteCapAtL[v - 1]} bytes, EC L)`, () => {
      const text = 'x'.repeat(maxByteCapAtL[v - 1]);
      const mine = generate(text, 'L');
      const ref = refMatrix(text, 'L');
      assert.equal(mine.version, v);
      assert.equal(mine.size, ref.size);
      assert.ok(matricesEqual(mine, ref), `matrix differs at v${v}`);
    });
  }
});

// ---------- SVG renderer ----------

describe('SVG renderer', () => {
  test('returns a single <svg> root', () => {
    const svg = renderSVG(generate('hi', 'M'));
    assert.ok(svg.startsWith('<svg '), 'starts with <svg');
    assert.ok(svg.endsWith('</svg>'), 'ends with </svg>');
    assert.equal((svg.match(/<svg /g) || []).length, 1);
  });

  test('has viewBox sized n + 2*quiet', () => {
    const qr = generate('hi', 'M');
    const expected = qr.size + 8;
    const svg = renderSVG(qr);
    assert.ok(svg.includes(`viewBox="0 0 ${expected} ${expected}"`));
  });

  test('respects custom quiet zone and colors', () => {
    const qr = generate('hi', 'M');
    const svg = renderSVG(qr, { quiet: 0, fg: '#f00', bg: '#0f0' });
    assert.ok(svg.includes(`viewBox="0 0 ${qr.size} ${qr.size}"`));
    assert.ok(svg.includes('fill="#f00"'));
    assert.ok(svg.includes('fill="#0f0"'));
  });

  test('emits one <path> with merged horizontal runs', () => {
    const svg = renderSVG(generate('hi', 'M'));
    assert.equal((svg.match(/<path /g) || []).length, 1);
    assert.equal((svg.match(/<rect /g) || []).length, 1, 'only background rect');
  });
});

// ---------- exports surface ----------

describe('exports', () => {
  test('named exports are functions', () => {
    assert.equal(typeof generate, 'function');
    assert.equal(typeof renderSVG, 'function');
  });

  test('default export bundles both functions', () => {
    assert.equal(typeof QRDefault.generate, 'function');
    assert.equal(typeof QRDefault.renderSVG, 'function');
    const a = generate('hi', 'M');
    const b = QRDefault.generate('hi', 'M');
    assert.equal(a.size, b.size);
    assert.equal(a.mask, b.mask);
  });
});

// ---------- edge cases ----------

describe('edge cases', () => {
  test('empty string encodes (does not throw)', () => {
    const qr = generate('', 'M');
    assert.equal(qr.version, 1);
    assert.equal(qr.size, 21);
  });

  test('single character', () => {
    const qr = generate('A', 'L');
    assert.equal(qr.version, 1);
    assert.equal(decode(qr), 'A');
  });

  test('default EC level is M', () => {
    const a = generate('hello');
    const b = generate('hello', 'M');
    for (let i = 0; i < a.modules.length; i++) {
      assert.equal(a.modules[i], b.modules[i], `mismatch at ${i}`);
    }
  });

  test('high-bit / multi-byte UTF-8 chars encode to UTF-8 bytes', () => {
    assert.equal(decode(generate('é', 'L')), 'é');
  });
});
