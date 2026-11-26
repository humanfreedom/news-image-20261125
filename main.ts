// news-image-20261125 — a code-drawn newspaper front page summing up
// Wednesday 25 November 2026. Node 22, standard library only.
// Own PNG encoder (zlib DEFLATE + hand-written CRC32), own 5x7 bitmap
// font, everything drawn programmatically. Deterministic: no clock,
// no randomness — two runs produce byte-identical output.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const W = 1024;
const H = 1024;

// Palette: newsprint paper, black ink, red accent, grey deck text.
const PAPER: RGB = [253, 251, 242];
const INK: RGB = [17, 17, 17];
const RED: RGB = [166, 30, 30];
const ORANGE: RGB = [205, 92, 20];
const GREY: RGB = [64, 64, 64];
const STRIP: RGB = [238, 236, 228];

type RGB = [number, number, number];

// ---- CRC32 (table-based, IEEE polynomial) ----
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

// Encode an RGB framebuffer as a PNG (8-bit, color type 2, no interlace).
function encodePNG(width: number, height: number, rgb: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const rowBytes = width * 3;
  const raw = Buffer.alloc(height * (1 + rowBytes));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + rowBytes)] = 0; // filter: none
    rgb.copy(raw, y * (1 + rowBytes) + 1, y * rowBytes, (y + 1) * rowBytes);
  }
  const idat = deflateSync(raw, { level: 9 });

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- Framebuffer + drawing primitives ----
const fb = Buffer.alloc(W * H * 3);

function setPixel(x: number, y: number, c: RGB): void {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  fb[i] = c[0];
  fb[i + 1] = c[1];
  fb[i + 2] = c[2];
}

function fillRect(x: number, y: number, w: number, h: number, c: RGB): void {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(W, x + w);
  const y1 = Math.min(H, y + h);
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const i = (yy * W + xx) * 3;
      fb[i] = c[0];
      fb[i + 1] = c[1];
      fb[i + 2] = c[2];
    }
  }
}

function drawLine(x0: number, y0: number, x1: number, y1: number, c: RGB): void {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    setPixel(x, y, c);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

// Filled triangle by scanline edge-walking (flat-top / flat-bottom split).
function fillTriangle(
  ax: number, ay: number, bx: number, by: number, cx: number, cy: number, c: RGB,
): void {
  const pts = [[ax, ay], [bx, by], [cx, cy]].sort((p, q) => p[1] - q[1]);
  const [x0, y0] = pts[0];
  const [x1, y1] = pts[1];
  const [x2, y2] = pts[2];
  const fillSpan = (y: number, xa: number, xb: number) => {
    const lo = Math.min(xa, xb);
    const hi = Math.max(xa, xb);
    for (let x = Math.ceil(lo); x <= Math.floor(hi); x++) setPixel(x, y, c);
  };
  const edge = (xa: number, ya: number, xb: number, yb: number, y: number) =>
    ya === yb ? xa : xa + ((xb - xa) * (y - ya)) / (yb - ya);
  for (let y = Math.ceil(y0); y <= Math.floor(y1); y++) {
    fillSpan(y, edge(x0, y0, x2, y2, y), edge(x0, y0, x1, y1, y));
  }
  for (let y = Math.ceil(y1); y <= Math.floor(y2); y++) {
    fillSpan(y, edge(x0, y0, x2, y2, y), edge(x1, y1, x2, y2, y));
  }
}

// ---- 5x7 bitmap font: each glyph is 7 rows of 5 bits ('1' = ink) ----
const FONT: Record<string, string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01111', '10000', '10000', '10111', '10001', '10001', '01110'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['01110', '10000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00010', '00100', '00100', '00100'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00001', '01110'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  ',': ['00000', '00000', '00000', '00000', '00000', '01100', '01000'],
  ':': ['00000', '01100', '01100', '00000', '00000', '01100', '01100'],
  '-': ['00000', '00000', '00000', '01110', '00000', '00000', '00000'],
  "'": ['00100', '00100', '00000', '00000', '00000', '00000', '00000'],
  '(': ['00010', '00100', '01000', '01000', '01000', '00100', '00010'],
  ')': ['01000', '00100', '00010', '00010', '00010', '00100', '01000'],
  '%': ['10001', '10010', '00010', '00100', '01000', '01001', '10001'],
  $: ['00100', '01111', '10100', '01110', '00101', '11110', '00100'],
  '&': ['01100', '10010', '10100', '01000', '10101', '10010', '01101'],
  '+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000'],
  '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
  '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
  '?': ['01110', '10001', '00001', '00010', '00100', '00000', '00100'],
  '=': ['00000', '00000', '11111', '00000', '11111', '00000', '00000'],
};

// One glyph cell is 6 units wide (5 ink + 1 gap) and 7 tall, times scale.
function textWidth(text: string, scale: number): number {
  if (text.length === 0) return 0;
  return text.length * 6 * scale - scale;
}

function drawChar(ch: string, x: number, y: number, scale: number, c: RGB): void {
  const glyph = FONT[ch] ?? FONT[' '];
  for (let r = 0; r < 7; r++) {
    const row = glyph[r];
    for (let col = 0; col < 5; col++) {
      if (row[col] === '1') {
        fillRect(x + col * scale, y + r * scale, scale, scale, c);
      }
    }
  }
}

function drawText(text: string, x: number, y: number, scale: number, c: RGB): void {
  const upper = text.toUpperCase();
  for (let i = 0; i < upper.length; i++) {
    drawChar(upper[i], x + i * 6 * scale, y, scale, c);
  }
}

function drawTextCentered(text: string, cx: number, y: number, scale: number, c: RGB): void {
  drawText(text, cx - Math.floor(textWidth(text, scale) / 2), y, scale, c);
}

// Greedy word wrap to at most maxLines lines within maxWidth pixels.
function wrapText(text: string, maxWidth: number, scale: number, maxLines: number): string[] {
  const words = text.toUpperCase().split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const trial = cur === '' ? w : cur + ' ' + w;
    if (textWidth(trial, scale) <= maxWidth) {
      cur = trial;
    } else {
      if (cur !== '') lines.push(cur);
      cur = w;
      if (lines.length === maxLines) break;
    }
  }
  if (cur !== '' && lines.length < maxLines) lines.push(cur);
  return lines.slice(0, maxLines);
}

// ---- Geometric icons (drawn centered at cx, inside a 56px strip from y) ----
type IconFn = (cx: number, y: number) => void;

const iconTanker: IconFn = (cx, y) => {
  fillRect(cx - 38, y + 18, 22, 12, INK); // deck house
  fillRect(cx - 6, y + 12, 12, 18, RED); // funnel
  fillTriangle(cx - 6, y + 12, cx + 6, y + 12, cx, y + 1, ORANGE); // flame
  fillRect(cx - 52, y + 30, 104, 12, INK); // hull
  fillTriangle(cx + 52, y + 30, cx + 52, y + 42, cx + 66, y + 42, INK); // bow
  drawLine(cx - 58, y + 48, cx + 70, y + 48, INK); // waves
  drawLine(cx - 50, y + 52, cx + 62, y + 52, INK);
};

const iconRefinery: IconFn = (cx, y) => {
  fillRect(cx - 46, y + 16, 18, 34, INK); // tower 1
  fillRect(cx - 42, y + 8, 6, 8, INK); // chimney 1
  fillRect(cx - 22, y + 24, 18, 26, INK); // tower 2
  fillRect(cx - 18, y + 16, 6, 8, INK); // chimney 2
  fillTriangle(cx + 4, y + 36, cx + 28, y + 36, cx + 16, y + 2, RED); // flame
  fillTriangle(cx + 9, y + 36, cx + 23, y + 36, cx + 16, y + 14, ORANGE);
  drawLine(cx - 52, y + 50, cx + 52, y + 50, INK); // ground
};

const iconTower: IconFn = (cx, y) => {
  fillRect(cx - 14, y + 4, 28, 46, INK); // tower
  for (const wy of [10, 20, 30, 40]) {
    fillRect(cx - 9, y + wy, 6, 4, PAPER); // windows
    fillRect(cx + 3, y + wy, 6, 4, PAPER);
  }
  drawLine(cx + 28, y + 4, cx + 40, y + 16, RED); // drone (X)
  drawLine(cx + 40, y + 4, cx + 28, y + 16, RED);
  drawLine(cx + 14, y + 8, cx + 24, y + 2, RED); // impact burst
  drawLine(cx + 14, y + 12, cx + 26, y + 12, RED);
};

const iconChart: IconFn = (cx, y) => {
  drawLine(cx - 52, y + 8, cx - 52, y + 48, INK); // axes
  drawLine(cx - 52, y + 48, cx + 52, y + 48, INK);
  const pts: [number, number][] = [
    [cx - 44, y + 14], [cx - 28, y + 22], [cx - 12, y + 18],
    [cx + 4, y + 30], [cx + 20, y + 26], [cx + 38, y + 40],
  ];
  for (let i = 0; i < pts.length - 1; i++) {
    drawLine(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], RED);
  }
  fillTriangle(cx + 40, y + 42, cx + 30, y + 36, cx + 42, y + 32, RED); // arrowhead
};

const iconGavel: IconFn = (cx, y) => {
  fillRect(cx - 34, y + 12, 36, 12, INK); // gavel head
  fillRect(cx + 4, y + 16, 36, 5, INK); // handle
  drawLine(cx - 6, y + 30, cx - 2, y + 34, RED); // impact marks
  drawLine(cx + 30, y + 30, cx + 26, y + 34, RED);
  fillRect(cx - 14, y + 38, 48, 6, INK); // sound block
  fillRect(cx - 10, y + 44, 6, 4, INK);
  fillRect(cx + 26, y + 44, 6, 4, INK);
};

const iconRocket: IconFn = (cx, y) => {
  fillTriangle(cx - 13, y + 8, cx + 13, y + 8, cx, y - 2, INK); // nose
  fillRect(cx - 13, y + 8, 26, 26, INK); // body
  fillRect(cx - 4, y + 14, 8, 8, PAPER); // window
  fillTriangle(cx - 13, y + 26, cx - 13, y + 38, cx - 25, y + 40, INK); // fins
  fillTriangle(cx + 13, y + 26, cx + 13, y + 38, cx + 25, y + 40, INK);
  fillTriangle(cx - 9, y + 34, cx + 9, y + 34, cx, y + 52, ORANGE); // flame
  fillRect(cx - 48, y + 10, 3, 3, INK); // stars
  fillRect(cx + 44, y + 6, 3, 3, INK);
  fillRect(cx + 50, y + 24, 3, 3, INK);
};

// ---- The six stories of Wednesday 25 November 2026 ----
interface Story {
  kicker: string;
  headline: string;
  deck: string;
  icon: IconFn;
}

const STORIES: Story[] = [
  {
    kicker: 'HORMUZ STRAIT',
    headline: 'TWO TANKERS HIT MINES, ABLAZE',
    deck: "Ships struck in the Strait of Hormuz early Wednesday, Iran's IRGC says. Fires burn on both vessels.",
    icon: iconTanker,
  },
  {
    kicker: 'UKRAINE WAR',
    headline: 'DRONES SET TWO RUSSIAN REFINERIES ABLAZE',
    deck: 'Ukrainian drones hit Rosneft plants in Samara overnight. One killed as fires rage at Syzran and Kuibyshev.',
    icon: iconRefinery,
  },
  {
    kicker: 'SAUDI ARABIA',
    headline: 'HOUTHI DRONE HITS RIYADH TOWER, 11 HURT',
    deck: 'Blast strikes King Abdullah Financial District tower. Houthis also attack Ras Tanura oil refinery.',
    icon: iconTower,
  },
  {
    kicker: 'MARKETS',
    headline: 'DOW TOPS 50,000 AS ASIAN STOCKS TUMBLE',
    deck: 'KOSPI falls 6.16%, Nikkei down 2.78%. Dow closes at 50,018.70, a first.',
    icon: iconChart,
  },
  {
    kicker: 'TECH / COURTS',
    headline: 'HUAWEI CONVICTED IN U.S. FRAUD TRIAL',
    deck: 'Brooklyn jury finds Huawei guilty on 10 of 12 counts, including bank fraud and sanctions violations.',
    icon: iconGavel,
  },
  {
    kicker: 'SPACE',
    headline: 'CHINA DOCKS SHENZHOU-24, FIRST PAKISTANI IN ORBIT',
    deck: 'Shenzhou-24 docks with Tiangong station. A Pakistani astronaut flies aboard, a first for his country.',
    icon: iconRocket,
  },
];

// ---- Layout ----
const COL_W = 464;
const COL_GUTTER = 24;
const ROW_H = 242;
const ROW_GUTTER = 16;
const GRID_X = 36;
const GRID_Y = 176;
const HAIRLINE: RGB = [210, 208, 198];

function drawStory(cellX: number, cellY: number, s: Story): void {
  fillRect(cellX, cellY, COL_W, 56, STRIP);
  s.icon(cellX + Math.floor(COL_W / 2), cellY);
  drawText(s.kicker, cellX, cellY + 68, 2, RED);
  const head = wrapText(s.headline, COL_W, 3, 2);
  head.forEach((line, i) => drawText(line, cellX, cellY + 92 + i * 24, 3, INK));
  const deck = wrapText(s.deck, COL_W, 2, 3);
  deck.forEach((line, i) => drawText(line, cellX, cellY + 150 + i * 17, 2, GREY));
  fillRect(cellX, cellY + 232, COL_W, 2, HAIRLINE);
}

function main(): void {
  fillRect(0, 0, W, H, PAPER);

  // Masthead
  drawTextCentered('THE WORLD IN ONE DAY', W / 2, 30, 6, INK);
  fillRect(36, 88, 952, 6, INK);
  fillRect(36, 98, 952, 3, RED);
  drawTextCentered('WEDNESDAY 25 NOVEMBER 2026', W / 2, 112, 4, RED);
  fillRect(36, 152, 952, 2, INK);

  // 2 x 3 story grid
  STORIES.forEach((s, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    drawStory(
      GRID_X + col * (COL_W + COL_GUTTER),
      GRID_Y + row * (ROW_H + ROW_GUTTER),
      s,
    );
  });

  // Footer
  fillRect(36, 956, 952, 2, INK);
  drawTextCentered('25 NOVEMBER 2026 - THE DAY IN WORLD NEWS', W / 2, 972, 2, INK);

  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'entry.png'), encodePNG(W, H, fb));
}

main();
