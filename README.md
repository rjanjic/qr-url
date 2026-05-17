# qr-url

Tiny zero-dependency QR code generator with SVG output. Pure TypeScript, ESM.

- ~7 KB gzipped, no runtime dependencies
- All QR versions 1–40, all four error-correction levels (L/M/Q/H)
- UTF-8 byte mode (works for URLs and arbitrary text)
- Single merged `<path>` SVG output with crisp pixel rendering
- Works in Node 16+, modern browsers, and any bundler

## Install

```sh
npm install qr-url
```

## Usage

```ts
import { generate, renderSVG } from 'qr-url';

const qr = generate('https://example.com', 'M');
// → { modules: Uint8Array, size: 25, version: 2, mask: 2 }

const svg = renderSVG(qr);
// → '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 33 33" ...'
```

### Browser via `<script type="module">`

```html
<script type="importmap">
  { "imports": { "qr-url": "https://esm.sh/qr-url" } }
</script>
<script type="module">
  import { generate, renderSVG } from 'qr-url';
  document.body.innerHTML = renderSVG(generate('https://example.com'));
</script>
```

## API

### `generate(text, ecLevel?)`

| param      | type                          | default | description                            |
| ---------- | ----------------------------- | ------- | -------------------------------------- |
| `text`     | `string`                      | —       | Any UTF-8 text. URLs are byte-encoded. |
| `ecLevel`  | `'L' \| 'M' \| 'Q' \| 'H'`    | `'M'`   | Error correction level.                |

Returns `QRCode = { modules: Uint8Array, size: number, version: number, mask: number }`.
`modules[r * size + c]` is `1` for dark, `0` for light.

Throws if `ecLevel` is invalid or the input exceeds v40 capacity (~2953 bytes at EC-L).

### `renderSVG(qr, options?)`

| option   | type     | default | description                                  |
| -------- | -------- | ------- | -------------------------------------------- |
| `quiet`  | `number` | `4`     | Quiet-zone width in modules (spec min is 4). |
| `fg`     | `string` | `'#000'`| Foreground color.                            |
| `bg`     | `string` | `'#fff'`| Background color.                            |

Returns a complete `<svg>…</svg>` string sized in module units. Scale it with CSS (`width: 100%`).

## Error correction levels

| Level | Recovery | Use when                          |
| ----- | -------- | --------------------------------- |
| `L`   | ~7 %     | Pristine on-screen / web URLs.    |
| `M`   | ~15 %    | Default. Good general purpose.    |
| `Q`   | ~25 %    | Printed, may get scuffed.         |
| `H`   | ~30 %    | Stickers, harsh environments.     |

## Development

```sh
npm install
npm test        # builds + runs 102 tests (structural, byte-exact vs reference encoder, decode round-trip)
npm run serve   # serves demo/ on :8765
npm run build   # tsc → dist/
```

## License

MIT
