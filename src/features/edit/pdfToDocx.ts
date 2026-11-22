import { Encodings, Font as StandardFont, FontNames } from '@pdf-lib/standard-fonts';
import { strFromU8, strToU8, unzlibSync, zipSync } from 'fflate';
import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, type PDFObject, PDFRawStream, PDFStream, PDFString } from 'pdf-lib';

import { pngFromIdat, pngFromScanlines } from './imageBytes';
import { escapeXml } from './xml';

export interface PdfToDocxReport {
  bytes: Uint8Array;
  pages: number;
  paragraphs: number;
  headings: number;
  images: number;
  emptyPages: number;
}

export class PdfHasNoText extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdfHasNoText';
  }
}

interface TextItem {
  text: string;
  x: number;
  y: number;
  end: number;
  size: number;
  bold: boolean;
  italic: boolean;
  family: string;
  color: string | null;
  underline: boolean;
}

interface ImageItem {
  x: number;
  top: number;
  width: number;
  height: number;
  stream: PDFStream;
}

// A horizontal stroke or hairline rectangle; text sitting just above one is underlined.
interface Rule {
  x1: number;
  x2: number;
  y: number;
  width: number;
  color: string;
  used: boolean;
}

// A filled rectangle that is not white: header bars, shaded cells, highlights.
interface Fill {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
}

interface Edge {
  width: number;
  space: number;
  color: string;
}

interface Line {
  items: TextItem[];
  x: number;
  end: number;
  y: number;
  size: number;
}

interface Run {
  text: string;
  bold: boolean;
  italic: boolean;
  size: number;
  family: string;
  color: string | null;
  underline: boolean;
  tab: boolean;
}

interface Stop {
  pos: number;
  right: boolean;
}

interface OutPara {
  lines: Line[];
  size: number;
  shade: Fill | null;
  top: Edge | null;
  bottom: Edge | null;
}

interface Scan {
  width: number;
  height: number;
  lines: Line[];
  images: ImageItem[];
  rules: Rule[];
  fills: Fill[];
}

// Where the text column sits, so indents, centring and tab stops can be measured against it.
interface Geometry {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  body: number;
  pitch: number | null;
}

type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const TWIPS = 20;
const EMU = 12700;
const BULLET = /^[•●▪■◦○◆♦➢➤►▶✓✔\-–*·]$/;

function mul(m: Matrix, n: Matrix): Matrix {
  return [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
}

export async function pdfToDocx(input: Uint8Array): Promise<PdfToDocxReport> {
  const doc = await PDFDocument.load(input, { ignoreEncryption: true, updateMetadata: false });
  const pages = doc.getPages();
  const scans: Scan[] = [];
  for (const page of pages) {
    const box = page.getMediaBox();
    const node = page.node;
    const resources = node.Resources() ?? null;
    const items: TextItem[] = [];
    const images: ImageItem[] = [];
    const rules: Rule[] = [];
    const fills: Fill[] = [];
    const contents = node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray().map((r) => doc.context.lookup(r)) : [contents];
    const chunks: Uint8Array[] = [];
    for (const s of streams) if (s instanceof PDFStream) chunks.push(streamBytes(s));
    runContent(concat(chunks), resources, doc, [1, 0, 0, 1, -box.x, -box.y], { items, images, rules, fills }, 0);
    const lines = toLines(readingOrder(items));
    underline(lines, rules);
    // A picture covering the page under a text layer is a scan with OCR on top; the text is what the reader wants.
    const area = box.width * box.height;
    const kept = images.filter((im) => im.width > 4 && im.height > 4 && !(lines.length > 0 && im.width * im.height > area * 0.8));
    const shaded = fills.filter((f) => (f.x2 - f.x1) * (f.y2 - f.y1) < area * 0.9);
    scans.push({ width: box.width, height: box.height, lines, images: kept, rules, fills: shaded });
  }
  if (scans.every((s) => s.lines.length === 0 && s.images.length === 0)) throw new PdfHasNoText('This PDF has no text layer and no pictures to carry over, so there is nothing to turn into Word.');

  const g = geometry(scans);
  const media: Media = [];
  const parts: string[] = [];
  let paragraphs = 0;
  let headings = 0;
  let emptyPages = 0;
  let pending = false;
  for (const scan of scans) {
    const paras = toParagraphs(scan.lines, g);
    decorate(paras, scan, g);
    if (paras.length === 0 && scan.images.length === 0) {
      emptyPages++;
      continue;
    }
    const under = (im: ImageItem) => scan.lines.some((l) => l.x < im.x + im.width && l.end > im.x && l.y + l.size * 0.7 > im.top - im.height && l.y < im.top);
    const behind = paras.length > 0 ? scan.images.filter(under) : [];
    const pics = scan.images.filter((im) => !behind.includes(im)).sort((a, b) => b.top - a.top);
    // Everything is placed by the gap to whatever came before it on the page.
    let cursor = g.height - g.top;
    let first = true;
    const pageBreak = () => {
      const out = pending && first;
      first = false;
      return out;
    };
    const flushPictures = (above: number) => {
      while (pics.length > 0 && pics[0].top > above) {
        const row = [pics.shift()!];
        while (pics.length > 0 && pics[0].top > row[0].top - row[0].height / 2) row.push(pics.shift()!);
        row.sort((a, b) => a.x - b.x);
        const top = Math.max(...row.map((p) => p.top));
        const xml = pictureXml(row, g, Math.max(0, cursor - top), pageBreak(), media, doc);
        if (xml) parts.push(xml);
        cursor = Math.min(...row.map((p) => p.top - p.height));
      }
    };
    for (const p of paras) {
      const head = p.lines[0];
      flushPictures(head.y + head.size);
      // Word sits a baseline about a fifth of the line height above the bottom of its line box.
      const pitch = pitchOf(p, g);
      const ruled = p.top ? p.top.space + p.top.width : 0;
      const out = paragraphXml(p, g, Math.max(0, cursor - head.y - pitch * 0.8 - ruled), pageBreak());
      if (behind.length > 0) out.xml = out.xml.replace('</w:pPr>', `</w:pPr>${behind.splice(0).map((im) => anchorXml(im, g, media, doc)).join('')}`);
      if (out.heading) headings++;
      parts.push(out.xml);
      paragraphs++;
      cursor = paraBottom(p) - pitch * 0.2 - (p.bottom ? p.bottom.space + p.bottom.width : 0);
    }
    flushPictures(-Infinity);
    pending = true;
  }
  return { bytes: buildDocx(parts.join(''), g, media), pages: pages.length, paragraphs, headings, images: media.length, emptyPages };
}

function paraBottom(p: OutPara): number {
  return p.lines[p.lines.length - 1].y;
}

function streamBytes(s: PDFStream): Uint8Array {
  if (s instanceof PDFRawStream) {
    try {
      return decodePDFRawStream(s).decode();
    } catch {
      return new Uint8Array(0);
    }
  }
  return s.getContents();
}

// fflate inflates far faster than pdf-lib's own decoder, which matters for screenshots of a few megapixels.
function inflate(s: PDFStream): Uint8Array {
  const f = filters(s.dict);
  if (s instanceof PDFRawStream && f.length === 1 && (f[0] === 'FlateDecode' || f[0] === 'Fl')) {
    try {
      return unzlibSync(s.getContents());
    } catch {
      // Damaged or truncated streams still decode partway with pdf-lib.
    }
  }
  return streamBytes(s);
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((a, c) => a + c.length + 1, 0));
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
    out[o++] = 0x0a;
  }
  return out;
}

type Token = number | string | { name: string } | { str: Uint8Array } | Token[] | { op: string } | null;

function* tokenize(b: Uint8Array): Generator<Token> {
  let i = 0;
  const n = b.length;
  const ws = (c: number) => c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09 || c === 0x0c || c === 0x00;
  const delim = (c: number) => c === 0x28 || c === 0x29 || c === 0x3c || c === 0x3e || c === 0x5b || c === 0x5d || c === 0x7b || c === 0x7d || c === 0x2f || c === 0x25;
  const stack: Token[][] = [];
  const emit = function* (t: Token): Generator<Token> {
    if (stack.length > 0) stack[stack.length - 1].push(t);
    else yield t;
  };
  while (i < n) {
    const c = b[i];
    if (ws(c)) {
      i++;
      continue;
    }
    if (c === 0x25) {
      while (i < n && b[i] !== 0x0a && b[i] !== 0x0d) i++;
      continue;
    }
    if (c === 0x28) {
      const out: number[] = [];
      let depth = 1;
      i++;
      while (i < n && depth > 0) {
        const d = b[i++];
        if (d === 0x5c) {
          const e = b[i++];
          if (e === 0x6e) out.push(0x0a);
          else if (e === 0x72) out.push(0x0d);
          else if (e === 0x74) out.push(0x09);
          else if (e === 0x62) out.push(0x08);
          else if (e === 0x66) out.push(0x0c);
          else if (e >= 0x30 && e <= 0x37) {
            let v = e - 0x30;
            for (let k = 0; k < 2 && b[i] >= 0x30 && b[i] <= 0x37; k++) v = v * 8 + (b[i++] - 0x30);
            out.push(v & 0xff);
          } else if (e === 0x0d) {
            if (b[i] === 0x0a) i++;
          } else if (e !== 0x0a) out.push(e);
        } else if (d === 0x28) {
          depth++;
          out.push(d);
        } else if (d === 0x29) {
          depth--;
          if (depth > 0) out.push(d);
        } else out.push(d);
      }
      yield* emit({ str: Uint8Array.from(out) });
      continue;
    }
    if (c === 0x3c && b[i + 1] === 0x3c) {
      let depth = 0;
      while (i < n) {
        if (b[i] === 0x3c && b[i + 1] === 0x3c) {
          depth++;
          i += 2;
        } else if (b[i] === 0x3e && b[i + 1] === 0x3e) {
          depth--;
          i += 2;
          if (depth === 0) break;
        } else i++;
      }
      yield* emit(null);
      continue;
    }
    if (c === 0x3c) {
      let hex = '';
      i++;
      while (i < n && b[i] !== 0x3e) {
        if (!ws(b[i])) hex += String.fromCharCode(b[i]);
        i++;
      }
      i++;
      if (hex.length % 2) hex += '0';
      const out = new Uint8Array(hex.length / 2);
      for (let k = 0; k < out.length; k++) out[k] = parseInt(hex.slice(k * 2, k * 2 + 2), 16) || 0;
      yield* emit({ str: out });
      continue;
    }
    if (c === 0x5b) {
      stack.push([]);
      i++;
      continue;
    }
    if (c === 0x5d) {
      i++;
      const arr = stack.pop() ?? [];
      yield* emit(arr);
      continue;
    }
    if (c === 0x2f) {
      let s = '';
      i++;
      while (i < n && !ws(b[i]) && !delim(b[i])) s += String.fromCharCode(b[i++]);
      yield* emit({ name: s.replace(/#([0-9a-fA-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16))) });
      continue;
    }
    let s = '';
    while (i < n && !ws(b[i]) && !delim(b[i])) s += String.fromCharCode(b[i++]);
    if (s === '') {
      i++;
      continue;
    }
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) {
      yield* emit(parseFloat(s));
      continue;
    }
    if (s === 'ID') {
      while (i < n && !(ws(b[i - 1]) && b[i] === 0x45 && b[i + 1] === 0x49 && (i + 2 >= n || ws(b[i + 2])))) i++;
      i += 2;
      continue;
    }
    if (stack.length > 0) {
      stack[stack.length - 1].push(s === 'true' || s === 'false' || s === 'null' ? null : s);
      continue;
    }
    yield { op: s };
  }
}

interface Font {
  decode: (bytes: Uint8Array) => { text: string; width: number }[];
  bold: boolean;
  italic: boolean;
  family: string;
}

const fontCache = new WeakMap<PDFDict, Font>();

interface Sink {
  items: TextItem[];
  images: ImageItem[];
  rules: Rule[];
  fills: Fill[];
}

interface GState {
  ctm: Matrix;
  fill: string;
  stroke: string;
  lineWidth: number;
}

function runContent(bytes: Uint8Array, resources: PDFDict | null, doc: PDFDocument, ctm0: Matrix, sink: Sink, depth: number) {
  if (depth > 6) return;
  const fresh = (): GState => ({ ctm: ctm0, fill: '000000', stroke: '000000', lineWidth: 1 });
  let gs: GState = fresh();
  const gstack: GState[] = [];
  let tm: Matrix = IDENTITY;
  let tlm: Matrix = IDENTITY;
  let font: Font | null = null;
  let size = 0;
  let leading = 0;
  let charSpace = 0;
  let wordSpace = 0;
  let hScale = 1;
  let rise = 0;
  let path: Omit<Rule, 'color' | 'width' | 'used'>[] = [];
  let boxes: Omit<Fill, 'color'>[] = [];
  // Corners of drawn outlines, so a bar drawn as m/l/l/l/f counts as a filled box too.
  let outline: [number, number][] = [];
  let at: [number, number] = [0, 0];
  const operands: Token[] = [];

  const lookupDict = (dict: PDFDict | null, key: string): PDFDict | null => {
    const v = dict?.lookup(PDFName.of(key));
    return v instanceof PDFDict ? v : null;
  };
  const fonts = lookupDict(resources, 'Font');
  const xobjects = lookupDict(resources, 'XObject');
  const point = (x: number, y: number): [number, number] => [gs.ctm[0] * x + gs.ctm[2] * y + gs.ctm[4], gs.ctm[1] * x + gs.ctm[3] * y + gs.ctm[5]];
  const segment = (a: [number, number], b: [number, number]) => {
    if (Math.abs(a[1] - b[1]) < 1.5 && Math.abs(a[0] - b[0]) > 2) path.push({ x1: Math.min(a[0], b[0]), x2: Math.max(a[0], b[0]), y: (a[1] + b[1]) / 2 });
  };

  const show = (str: Uint8Array) => {
    if (!font) return;
    for (const g of font.decode(str)) {
      const trm = mul([size * hScale, 0, 0, size, 0, rise], mul(tm, gs.ctm));
      const eff = Math.hypot(trm[2], trm[3]) || size;
      const tx = (g.width * size + charSpace + (g.text === ' ' ? wordSpace : 0)) * hScale;
      const x = trm[4];
      const y = trm[5];
      tm = mul([1, 0, 0, 1, tx, 0], tm);
      const endX = mul(mul([size * hScale, 0, 0, size, 0, rise], tm), gs.ctm)[4];
      if (g.text !== '') sink.items.push({ text: g.text, x, y, end: endX, size: eff, bold: font.bold, italic: font.italic, family: font.family, color: gs.fill, underline: false });
    }
  };
  const nextLine = () => {
    tlm = mul([1, 0, 0, 1, 0, -leading], tlm);
    tm = tlm;
  };
  const nums = () => operands.filter((o): o is number => typeof o === 'number');

  for (const tok of tokenize(bytes)) {
    if (tok === null || typeof tok !== 'object' || !('op' in tok)) {
      operands.push(tok);
      continue;
    }
    const num = (k: number) => {
      const v = operands[operands.length - k];
      return typeof v === 'number' ? v : 0;
    };
    switch (tok.op) {
      case 'q':
        gstack.push(gs);
        gs = { ...gs };
        break;
      case 'Q':
        gs = gstack.pop() ?? fresh();
        break;
      case 'cm':
        gs.ctm = mul([num(6), num(5), num(4), num(3), num(2), num(1)], gs.ctm);
        break;
      case 'g':
      case 'rg':
      case 'k':
      case 'sc':
      case 'scn':
        gs.fill = colorOf(nums()) ?? gs.fill;
        break;
      case 'G':
      case 'RG':
      case 'K':
      case 'SC':
      case 'SCN':
        gs.stroke = colorOf(nums()) ?? gs.stroke;
        break;
      case 'cs':
        gs.fill = '000000';
        break;
      case 'CS':
        gs.stroke = '000000';
        break;
      case 'w':
        gs.lineWidth = num(1);
        break;
      case 'm':
        at = point(num(2), num(1));
        outline.push(at);
        break;
      case 'l': {
        const to = point(num(2), num(1));
        segment(at, to);
        at = to;
        outline.push(to);
        break;
      }
      case 'c':
      case 'v':
      case 'y':
        at = point(num(2), num(1));
        outline.push(at);
        break;
      case 're': {
        const [x, y, w, h] = [num(4), num(3), num(2), num(1)];
        const a = point(x, y);
        const b = point(x + w, y + h);
        if (Math.abs(b[1] - a[1]) < 1.5) segment(a, [b[0], a[1]]);
        else boxes.push({ x1: Math.min(a[0], b[0]), y1: Math.min(a[1], b[1]), x2: Math.max(a[0], b[0]), y2: Math.max(a[1], b[1]) });
        break;
      }
      case 'S':
      case 's':
      case 'f':
      case 'F':
      case 'f*':
      case 'B':
      case 'B*':
      case 'b':
      case 'b*': {
        const stroked = /^[SsBb]/.test(tok.op);
        const filled = tok.op !== 'S' && tok.op !== 's';
        const scale = Math.hypot(gs.ctm[0], gs.ctm[1]) || 1;
        for (const r of path) sink.rules.push({ ...r, width: stroked ? Math.max(0.25, gs.lineWidth * scale) : 0.75, color: stroked ? gs.stroke : gs.fill, used: false });
        if (filled && outline.length >= 3) {
          const xs = outline.map((pt) => pt[0]);
          const ys = outline.map((pt) => pt[1]);
          const box = { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
          if (box.y2 - box.y1 > 1.5 && box.x2 - box.x1 > 2) boxes.push(box);
        }
        if (filled && gs.fill !== 'FFFFFF') for (const b of boxes) sink.fills.push({ ...b, color: gs.fill });
        path = [];
        boxes = [];
        outline = [];
        break;
      }
      case 'n':
        path = [];
        boxes = [];
        outline = [];
        break;
      case 'BT':
        tm = IDENTITY;
        tlm = IDENTITY;
        break;
      case 'Tf': {
        const name = operands[operands.length - 2];
        size = num(1);
        const dict = name && typeof name === 'object' && 'name' in name ? fonts?.lookup(PDFName.of(name.name)) : undefined;
        font = dict instanceof PDFDict ? loadFont(dict, doc) : null;
        break;
      }
      case 'Tc':
        charSpace = num(1);
        break;
      case 'Tw':
        wordSpace = num(1);
        break;
      case 'Tz':
        hScale = num(1) / 100;
        break;
      case 'TL':
        leading = num(1);
        break;
      case 'Ts':
        rise = num(1);
        break;
      case 'Td':
        tlm = mul([1, 0, 0, 1, num(2), num(1)], tlm);
        tm = tlm;
        break;
      case 'TD':
        leading = -num(1);
        tlm = mul([1, 0, 0, 1, num(2), num(1)], tlm);
        tm = tlm;
        break;
      case 'Tm':
        tlm = [num(6), num(5), num(4), num(3), num(2), num(1)];
        tm = tlm;
        break;
      case 'T*':
        nextLine();
        break;
      case 'Tj': {
        const s = operands[operands.length - 1];
        if (s && typeof s === 'object' && 'str' in s) show(s.str);
        break;
      }
      case "'":
      case '"': {
        if (tok.op === '"') {
          wordSpace = num(3);
          charSpace = num(2);
        }
        nextLine();
        const s = operands[operands.length - 1];
        if (s && typeof s === 'object' && 'str' in s) show(s.str);
        break;
      }
      case 'TJ': {
        const arr = operands[operands.length - 1];
        if (!Array.isArray(arr)) break;
        for (const part of arr) {
          if (typeof part === 'number') tm = mul([1, 0, 0, 1, (-part / 1000) * size * hScale, 0], tm);
          else if (part && typeof part === 'object' && 'str' in part) show(part.str);
        }
        break;
      }
      case 'Do': {
        const name = operands[operands.length - 1];
        const xo = name && typeof name === 'object' && 'name' in name ? xobjects?.lookup(PDFName.of(name.name)) : undefined;
        if (!(xo instanceof PDFStream)) break;
        const subtype = xo.dict.lookup(PDFName.of('Subtype'));
        if (subtype === PDFName.of('Image')) {
          // An image fills the unit square of the current matrix.
          const corners = [point(0, 0), point(1, 0), point(0, 1), point(1, 1)];
          const xs = corners.map((c) => c[0]);
          const ys = corners.map((c) => c[1]);
          const x = Math.min(...xs);
          const top = Math.max(...ys);
          sink.images.push({ x, top, width: Math.max(...xs) - x, height: top - Math.min(...ys), stream: xo });
          break;
        }
        if (subtype !== PDFName.of('Form')) break;
        const m = xo.dict.lookup(PDFName.of('Matrix'));
        const fm: Matrix = m instanceof PDFArray && m.size() === 6 ? (m.asArray().map((v) => numberOf(doc.context.lookup(v))) as Matrix) : IDENTITY;
        const res = xo.dict.lookup(PDFName.of('Resources'));
        runContent(streamBytes(xo), res instanceof PDFDict ? res : resources, doc, mul(fm, gs.ctm), sink, depth + 1);
        break;
      }
      default:
        break;
    }
    operands.length = 0;
  }
}

function colorOf(v: number[]): string | null {
  let rgbValue: [number, number, number];
  if (v.length === 1) rgbValue = [v[0], v[0], v[0]];
  else if (v.length === 3) rgbValue = [v[0], v[1], v[2]];
  else if (v.length === 4) rgbValue = [(1 - v[0]) * (1 - v[3]), (1 - v[1]) * (1 - v[3]), (1 - v[2]) * (1 - v[3])];
  else return null;
  const bytes = rgbValue.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255));
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function familyOf(base: string): string {
  const name = base
    .replace(/^[A-Z]{6}\+/, '')
    .split(/[-,]/)[0]
    .replace(/(PSMT|MT|PS)$/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2');
  const alias: Record<string, string> = { Helvetica: 'Arial', Times: 'Times New Roman', 'Times Roman': 'Times New Roman', Courier: 'Courier New', Symbol: 'Symbol' };
  if (alias[name]) return alias[name];
  return name === '' || /^(F|TT|T|C)\d+$/i.test(name) ? 'Calibri' : name;
}

function loadFont(dict: PDFDict, doc: PDFDocument): Font {
  const cached = fontCache.get(dict);
  if (cached) return cached;
  const name = (v: PDFObject | undefined) => (v instanceof PDFName ? v.decodeText() : '');
  const base = name(dict.lookup(PDFName.of('BaseFont')));
  const subtype = name(dict.lookup(PDFName.of('Subtype')));
  const type0 = subtype === 'Type0';
  const descendant = type0 ? (() => {
    const arr = dict.lookup(PDFName.of('DescendantFonts'));
    const d = arr instanceof PDFArray ? doc.context.lookup(arr.get(0)) : undefined;
    return d instanceof PDFDict ? d : null;
  })() : null;
  const descriptor = (descendant ?? dict).lookup(PDFName.of('FontDescriptor'));
  const flags = descriptor instanceof PDFDict ? numberOf(descriptor.lookup(PDFName.of('Flags'))) : 0;
  const weight = descriptor instanceof PDFDict ? numberOf(descriptor.lookup(PDFName.of('FontWeight'))) : 0;
  const bold = /bold|black|heavy|semibold|demi/i.test(base) || weight >= 600 || (flags & (1 << 18)) !== 0;
  const italic = /italic|oblique/i.test(base) || (flags & (1 << 6)) !== 0;

  const tu = dict.lookup(PDFName.of('ToUnicode'));
  const cmap = tu instanceof PDFStream ? parseCMap(strFromU8(streamBytes(tu), true)) : null;
  const twoByte = type0 && (cmap === null || cmap.codeBytes === 2);

  const widths = new Map<number, number>();
  let defaultWidth = type0 ? 1000 : 500;
  if (type0 && descendant) {
    defaultWidth = numberOf(descendant.lookup(PDFName.of('DW'))) || 1000;
    const w = descendant.lookup(PDFName.of('W'));
    if (w instanceof PDFArray) {
      const a = w.asArray().map((v) => doc.context.lookup(v));
      for (let k = 0; k < a.length; ) {
        const first = numberOf(a[k]);
        const next = a[k + 1];
        if (next instanceof PDFArray) {
          next.asArray().forEach((v, j) => widths.set(first + j, numberOf(doc.context.lookup(v))));
          k += 2;
        } else {
          const last = numberOf(next);
          const width = numberOf(a[k + 2]);
          for (let c = first; c <= last && c - first < 65536; c++) widths.set(c, width);
          k += 3;
        }
      }
    }
  } else {
    const firstChar = numberOf(dict.lookup(PDFName.of('FirstChar')));
    const w = dict.lookup(PDFName.of('Widths'));
    if (w instanceof PDFArray) w.asArray().forEach((v, j) => widths.set(firstChar + j, numberOf(doc.context.lookup(v))));
  }

  const simpleMap = type0 ? null : simpleEncoding(dict);
  if (simpleMap && widths.size === 0) {
    const metrics = standardMetrics(base);
    if (metrics) {
      defaultWidth = metrics.get('space') ?? 500;
      simpleMap.forEach((ch, code) => {
        const cp = ch.codePointAt(0);
        if (cp === undefined || !Encodings.WinAnsi.canEncodeUnicodeCodePoint(cp)) return;
        const wx = metrics.get(Encodings.WinAnsi.encodeUnicodeCodePoint(cp).name);
        if (wx !== undefined) widths.set(code, wx);
      });
    }
  }
  const font: Font = {
    bold,
    italic,
    family: familyOf(base),
    decode: (bytes) => {
      const out: { text: string; width: number }[] = [];
      const step = twoByte ? 2 : 1;
      for (let k = 0; k + step <= bytes.length; k += step) {
        const code = step === 2 ? (bytes[k] << 8) | bytes[k + 1] : bytes[k];
        const text = cmap?.map.get(code) ?? (simpleMap ? simpleMap[code] : '');
        out.push({ text: text ?? '', width: (widths.get(code) ?? defaultWidth) / 1000 });
      }
      return out;
    },
  };
  fontCache.set(dict, font);
  return font;
}

const STANDARD: Record<string, FontNames> = {
  Helvetica: FontNames.Helvetica,
  'Helvetica-Bold': FontNames.HelveticaBold,
  'Helvetica-Oblique': FontNames.HelveticaOblique,
  'Helvetica-BoldOblique': FontNames.HelveticaBoldOblique,
  Arial: FontNames.Helvetica,
  'Arial-Bold': FontNames.HelveticaBold,
  'Arial-BoldMT': FontNames.HelveticaBold,
  ArialMT: FontNames.Helvetica,
  'Times-Roman': FontNames.TimesRoman,
  'Times-Bold': FontNames.TimesRomanBold,
  'Times-Italic': FontNames.TimesRomanItalic,
  'Times-BoldItalic': FontNames.TimesRomanBoldItalic,
  TimesNewRoman: FontNames.TimesRoman,
  Courier: FontNames.Courier,
  'Courier-Bold': FontNames.CourierBold,
  'Courier-Oblique': FontNames.CourierOblique,
  'Courier-BoldOblique': FontNames.CourierBoldOblique,
};
const metricsCache = new Map<FontNames, Map<string, number>>();

function standardMetrics(base: string): Map<string, number> | null {
  const name = STANDARD[base.replace(/^[A-Z]{6}\+/, '').replace(/,/g, '-')];
  if (!name) return null;
  let m = metricsCache.get(name);
  if (!m) {
    m = new Map(StandardFont.load(name).CharMetrics.map((c) => [c.N, c.WX]));
    metricsCache.set(name, m);
  }
  return m;
}

function numberOf(v: PDFObject | undefined): number {
  return v instanceof PDFNumber ? v.asNumber() : 0;
}

export function parseCMap(text: string): { map: Map<number, string>; codeBytes: number } {
  const map = new Map<number, string>();
  let codeBytes = 1;
  const range = /begincodespacerange([\s\S]*?)endcodespacerange/.exec(text);
  if (range) {
    const first = /<([0-9a-fA-F]+)>/.exec(range[1]);
    if (first) codeBytes = Math.max(1, first[1].length / 2);
  }
  const utf16 = (hex: string) => {
    const units: number[] = [];
    for (let k = 0; k + 4 <= hex.length; k += 4) units.push(parseInt(hex.slice(k, k + 4), 16));
    if (hex.length === 2) units.push(parseInt(hex, 16));
    return String.fromCharCode(...units);
  };
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) map.set(parseInt(m[1], 16), utf16(m[2]));
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]*>|\[[^\]]*\])/g)) {
      const lo = parseInt(m[1], 16);
      const hi = Math.min(parseInt(m[2], 16), lo + 65535);
      if (m[3].startsWith('[')) {
        const list = [...m[3].matchAll(/<([0-9a-fA-F]*)>/g)].map((x) => x[1]);
        for (let c = lo; c <= hi && c - lo < list.length; c++) map.set(c, utf16(list[c - lo]));
      } else {
        const hex = m[3].slice(1, -1);
        const head = hex.slice(0, -4);
        const tail = parseInt(hex.slice(-4) || '0', 16);
        for (let c = lo; c <= hi; c++) map.set(c, utf16(head + (tail + c - lo).toString(16).padStart(4, '0')));
      }
    }
  }
  return { map, codeBytes };
}

const CP1252: Record<number, string> = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž',
  0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ',
};

const GLYPHS: Record<string, string> = {
  space: ' ', exclam: '!', quotedbl: '"', numbersign: '#', dollar: '$', percent: '%', ampersand: '&', quotesingle: "'", quoteright: '’', quoteleft: '‘',
  parenleft: '(', parenright: ')', asterisk: '*', plus: '+', comma: ',', hyphen: '-', minus: '-', period: '.', slash: '/', colon: ':', semicolon: ';',
  less: '<', equal: '=', greater: '>', question: '?', at: '@', bracketleft: '[', backslash: '\\', bracketright: ']', underscore: '_', grave: '`',
  braceleft: '{', bar: '|', braceright: '}', asciitilde: '~', bullet: '•', endash: '–', emdash: '—', quotedblleft: '“', quotedblright: '”',
  ellipsis: '…', fi: 'fi', fl: 'fl', ff: 'ff', ffi: 'ffi', ffl: 'ffl', zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6',
  seven: '7', eight: '8', nine: '9', degree: '°', copyright: '©', registered: '®', trademark: '™', section: '§', paragraph: '¶', Euro: '€', nbspace: ' ',
};

function glyphToText(name: string): string {
  if (GLYPHS[name] !== undefined) return GLYPHS[name];
  if (/^[A-Za-z]$/.test(name)) return name;
  const uni = /^uni([0-9A-Fa-f]{4})/.exec(name) ?? /^u([0-9A-Fa-f]{4,6})$/.exec(name);
  if (uni) return String.fromCodePoint(parseInt(uni[1], 16));
  const base = name.split('.')[0];
  return base !== name ? glyphToText(base) : '';
}

function simpleEncoding(dict: PDFDict): string[] {
  const table: string[] = [];
  for (let c = 0; c < 256; c++) table[c] = c < 0x20 ? '' : (CP1252[c] ?? String.fromCharCode(c));
  const enc = dict.lookup(PDFName.of('Encoding'));
  if (enc instanceof PDFDict) {
    const diffs = enc.lookup(PDFName.of('Differences'));
    if (diffs instanceof PDFArray) {
      let code = 0;
      for (const v of diffs.asArray()) {
        if (v instanceof PDFNumber) code = v.asNumber();
        else if (v instanceof PDFName) table[code++] = glyphToText(v.decodeText());
      }
    }
  }
  return table;
}

function toLines(items: TextItem[]): Line[] {
  const lines: Line[] = [];
  let line: Line | null = null;
  const keep = (l: Line | null) => {
    if (l && l.items.some((it) => it.text.trim() !== '')) lines.push(l);
  };
  for (const it of items) {
    const sameLine = line !== null && Math.abs(it.y - line.y) < Math.max(it.size, line.size) * 0.5 && it.x >= line.end - it.size * 2;
    if (!sameLine) {
      keep(line);
      line = { items: [], x: it.x, end: it.x, y: it.y, size: 0 };
    }
    const l = line!;
    if (it.text.trim() !== '') {
      if (l.size === 0) {
        l.x = it.x;
        l.y = it.y;
      }
      l.size = Math.max(l.size, it.size);
    }
    l.items.push(it);
    l.end = Math.max(l.end, it.end);
  }
  keep(line);
  for (const l of lines) {
    while (l.items.length > 0 && l.items[l.items.length - 1].text.trim() === '') l.items.pop();
    l.end = Math.max(...l.items.map((it) => it.end));
  }
  return lines;
}

// Content streams do not have to run top to bottom (text boxes often come first), so stretches of text are
// sorted into bands by baseline and left to right within a band. A stretch stays whole so overlapping text
// is never interleaved glyph by glyph.
function readingOrder(items: TextItem[]): TextItem[] {
  interface Stretch {
    items: TextItem[];
    x: number;
    y: number;
    end: number;
    size: number;
  }
  const stretches: Stretch[] = [];
  for (const it of items) {
    const last = stretches[stretches.length - 1];
    if (last && Math.abs(it.y - last.y) < Math.max(it.size, last.size) * 0.3 && it.x >= last.end - it.size * 2) {
      last.items.push(it);
      last.end = Math.max(last.end, it.end);
      last.size = Math.max(last.size, it.size);
    } else stretches.push({ items: [it], x: it.x, y: it.y, end: it.end, size: it.size });
  }
  const sorted = [...stretches].sort((a, b) => b.y - a.y);
  const bands: Stretch[][] = [];
  for (const st of sorted) {
    const band = bands[bands.length - 1];
    if (band && Math.abs(band[0].y - st.y) < Math.max(band[0].size, st.size) * 0.4) band.push(st);
    else bands.push([st]);
  }
  return bands.flatMap((band) => band.sort((a, b) => a.x - b.x).flatMap((st) => st.items));
}

function underline(lines: Line[], rules: Rule[]): void {
  if (rules.length === 0) return;
  for (const l of lines) {
    const near = rules.filter((r) => r.y < l.y - l.size * 0.02 && r.y > l.y - l.size * 0.35 && r.x2 - r.x1 <= l.end - l.x + l.size * 2);
    if (near.length === 0) continue;
    for (const it of l.items) {
      if (it.text.trim() === '') continue;
      const hit = near.find((r) => r.x1 <= it.x + 1 && r.x2 >= it.end - 1);
      if (hit) hit.used = true;
      it.underline = hit !== undefined;
    }
    // Spaces between two underlined words carry the line too.
    l.items.forEach((it, i) => {
      if (it.text.trim() === '' && l.items[i - 1]?.underline && l.items[i + 1]?.underline) it.underline = true;
    });
  }
}

// The smallest value at least three lines agree on, so one stray line does not set the margin.
function edge(values: number[], dir: 1 | -1, tol: number): { value: number; agreed: boolean } | null {
  const sorted = [...values].sort((a, b) => (a - b) * dir);
  for (let i = 0; i + 2 < sorted.length; i++) if (Math.abs(sorted[i + 2] - sorted[i]) <= tol) return { value: sorted[i], agreed: true };
  return sorted.length > 0 ? { value: sorted[0], agreed: false } : null;
}

function geometry(scans: Scan[]): Geometry {
  const { width, height } = scans[0];
  const lines = scans.flatMap((s) => s.lines);
  const sizes = lines.flatMap((l) => Array<number>(Math.min(50, l.items.length)).fill(l.size)).sort((a, b) => a - b);
  const body = sizes[Math.floor(sizes.length / 2)] || 11;
  // Pictures, and rules or bars running most of the page width, mark the column as much as text does.
  const spans = scans.flatMap((s) => [
    ...s.images.map((im) => ({ x1: im.x, x2: im.x + im.width })),
    ...[...s.rules, ...s.fills].filter((r) => r.x2 - r.x1 > width * 0.5),
  ]);
  const left = Math.max(18, Math.min(edge(lines.map((l) => l.x), 1, 1.5)?.value ?? 72, ...spans.map((r) => r.x1)));
  // Ragged text that never fills the line says little about the right margin; assume it mirrors the left.
  const ends = edge(lines.map((l) => l.end), -1, 2);
  const textRight = ends?.agreed ? ends.value : Math.max(ends?.value ?? 0, width - left);
  const right = Math.min(width - 18, Math.max(textRight, ...spans.map((r) => r.x2)));
  const tops = scans.map((s) => Math.max(...s.lines.map((l) => l.y + l.size), ...s.images.map((im) => im.top))).filter(Number.isFinite);
  const bottoms = scans.map((s) => Math.min(...s.lines.map((l) => l.y - l.size * 0.3), ...s.images.map((im) => im.top - im.height))).filter(Number.isFinite);
  // Line pitch of body text, the most common baseline-to-baseline step.
  const steps = new Map<number, number>();
  for (const s of scans) {
    for (let i = 1; i < s.lines.length; i++) {
      const [a, b] = [s.lines[i - 1], s.lines[i]];
      const step = Math.round((a.y - b.y) * 4) / 4;
      if (Math.abs(a.size - body) < 0.6 && Math.abs(b.size - body) < 0.6 && step > body * 0.9 && step < body * 3) steps.set(step, (steps.get(step) ?? 0) + 1);
    }
  }
  const pitch = [...steps.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return {
    width,
    height,
    left,
    right: Math.max(left + 72, right),
    top: Math.min(144, Math.max(18, height - Math.max(...tops, 0) - 4)),
    bottom: Math.min(144, Math.max(18, Math.min(...bottoms, height) - 8)),
    body,
    pitch,
  };
}

function bold(l: Line): number {
  const chars = l.items.filter((it) => it.text.trim() !== '');
  return chars.filter((it) => it.bold).length / Math.max(1, chars.length);
}

function toParagraphs(lines: Line[], g: Geometry): OutPara[] {
  const paras: OutPara[] = [];
  let cur: OutPara | null = null;
  for (const l of lines) {
    const prev: Line | undefined = cur?.lines[cur.lines.length - 1];
    let breaks = !cur || !prev;
    if (cur && prev) {
      const gap = prev.y - l.y;
      const usual = g.pitch !== null && Math.abs(l.size - g.body) < 0.6 ? g.pitch * 1.25 + 0.5 : l.size * 1.5;
      const sizeJump = Math.abs(l.size - cur.size) > Math.min(l.size, cur.size) * 0.15;
      const first = l.items.find((it) => it.text.trim() !== '');
      const bullet = first !== undefined && BULLET.test(first.text.trim()) && l.items.length > 1;
      const numbered = /^\(?\d{1,2}[.)]\s|^[a-z][.)]\s/.test(l.items.map((it) => it.text).join('').slice(0, 5));
      // Indent changes after the second line mean a new block; the first line may differ from the rest.
      const shifted = cur.lines.length >= 2 ? Math.abs(l.x - cur.lines[1].x) > l.size : Math.abs(l.x - prev.x) > l.size * 4;
      // A short line ends its paragraph: the next word would have fitted otherwise.
      const wordWidth = firstWordEnd(l) - l.x;
      const short = g.right - prev.end > wordWidth + l.size * 1.5;
      const weight = Math.abs(bold(l) - bold(prev)) > 0.8;
      breaks = sizeJump || gap > usual || gap < -l.size * 0.5 || bullet || numbered || shifted || short || weight;
    }
    if (breaks) {
      cur = { lines: [l], size: l.size, shade: null, top: null, bottom: null };
      paras.push(cur);
    } else cur!.lines.push(l);
  }
  return paras;
}

function firstWordEnd(l: Line): number {
  let end = l.x;
  for (const [i, it] of l.items.entries()) {
    if (it.text.trim() === '' || (i > 0 && it.x - end > it.size * 0.18)) break;
    end = it.end;
  }
  return end;
}

// Filled boxes behind a paragraph become its shading; long rules just above or below it become borders.
function decorate(paras: OutPara[], scan: Scan, g: Geometry): void {
  for (const p of paras) {
    const x1 = Math.min(...p.lines.map((l) => l.x));
    const x2 = Math.max(...p.lines.map((l) => l.end));
    const top = p.lines[0].y + p.size * 0.75;
    const bottom = p.lines[p.lines.length - 1].y - p.size * 0.2;
    const behind = scan.fills.filter((f) => f.x1 <= x1 + 1 && f.x2 >= x2 - 1 && f.y2 >= top - 1 && f.y1 <= bottom + 1);
    behind.sort((a, b) => (a.x2 - a.x1) * (a.y2 - a.y1) - (b.x2 - b.x1) * (b.y2 - b.y1));
    p.shade = behind[0] ?? null;
  }
  const column = g.right - g.left;
  for (const r of scan.rules) {
    if (r.used || r.x2 - r.x1 < column * 0.3) continue;
    let best: { p: OutPara; side: 'top' | 'bottom'; space: number } | null = null;
    for (const p of paras) {
      const last = p.lines[p.lines.length - 1];
      const below = last.y - last.size * 0.25 - r.y;
      const above = r.y - (p.lines[0].y + p.size * 0.8);
      if (below >= 0 && below < 20 && (!best || below < best.space)) best = { p, side: 'bottom', space: below };
      if (above >= 0 && above < 20 && (!best || above < best.space)) best = { p, side: 'top', space: above };
    }
    if (best && !best.p[best.side]) {
      best.p[best.side] = { width: r.width, space: Math.min(31, best.space), color: r.color };
      r.used = true;
    }
  }
}

function pitchOf(p: OutPara, g: Geometry): number {
  if (p.lines.length > 1) {
    const steps = p.lines.slice(1).map((l, i) => p.lines[i].y - l.y).sort((a, b) => a - b);
    return steps[Math.floor(steps.length / 2)];
  }
  return g.pitch !== null && Math.abs(p.size - g.body) < 0.6 ? g.pitch : p.size * 1.17;
}

function runsOf(p: OutPara, g: Geometry): { runs: Run[]; stops: Stop[] } {
  const runs: Run[] = [];
  const stops: Stop[] = [];
  const add = (it: TextItem | null, text: string, tab = false) => {
    const last = runs[runs.length - 1];
    const style = it ? { bold: it.bold, italic: it.italic, size: Math.round(it.size * 2) / 2, family: it.family, color: ink(it.color, p.shade?.color ?? null), underline: it.underline } : null;
    if (!tab && last && !last.tab && (!style || (last.bold === style.bold && last.italic === style.italic && last.size === style.size && last.family === style.family && last.color === style.color && last.underline === style.underline))) {
      last.text += text;
      return;
    }
    const base = style ?? (last ? { ...last } : { bold: false, italic: false, size: g.body, family: 'Calibri', color: null, underline: false });
    runs.push({ ...base, text, tab });
  };
  for (const [li, l] of p.lines.entries()) {
    if (li > 0) {
      const last = runs[runs.length - 1];
      const next = l.items[0]?.text ?? '';
      if (last && !last.tab && /[A-Za-z]-$/.test(last.text) && /^[a-z]/.test(next)) last.text = last.text.slice(0, -1);
      else add(null, ' ');
    }
    let end = l.items[0]?.x ?? 0;
    for (const [i, it] of l.items.entries()) {
      const gap = it.x - end;
      const lead = i === 1 && BULLET.test(l.items[0].text.trim()) && gap > it.size * 0.4;
      if (i > 0 && (lead || gap > Math.max(it.size * 2.5, 18))) {
        // Text after the last gap that reaches the right margin was right-aligned.
        const rest = l.items.slice(i);
        const tail = rest.every((r, k) => k === 0 || r.x - rest[k - 1].end < Math.max(r.size * 2.5, 18));
        const right = !lead && tail && g.right - l.end < it.size * 0.6;
        const pos = right ? g.right - g.left : it.x - g.left;
        if (!stops.some((s) => Math.abs(s.pos - pos) < 2)) stops.push({ pos, right });
        add(it, '', true);
      } else if (i > 0 && it.text !== ' ' && gap > it.size * 0.18 && !runs[runs.length - 1]?.text.endsWith(' ')) add(it, ' ');
      add(it, it.text);
      end = Math.max(end, it.end);
    }
  }
  for (const r of runs) r.text = r.text.replace(/\s+/g, ' ');
  return { runs: runs.filter((r) => r.tab || r.text !== ''), stops: stops.sort((a, b) => a.pos - b.pos) };
}

const twip = (pt: number) => Math.round(pt * TWIPS);

function ink(hex: string | null, shade: string | null): string | null {
  if (!hex) return null;
  const n = parseInt(hex, 16);
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  if (channels.every((c) => c < 48)) return null;
  if (!shade && channels.every((c) => c > 230)) return null;
  return hex;
}

function edgeXml(side: 'top' | 'bottom', e: Edge | null): string {
  if (!e) return '';
  return `<w:${side} w:val="single" w:sz="${Math.round(Math.min(12, Math.max(0.25, e.width)) * 8)}" w:space="${Math.round(e.space)}" w:color="${e.color}"/>`;
}

function paragraphXml(p: OutPara, g: Geometry, before: number, pageBreak: boolean): { xml: string; heading: boolean } {
  const { runs, stops } = runsOf(p, g);
  const text = runs.map((r) => r.text).join('');
  const style = text.length <= 160 ? (p.size >= g.body * 1.45 ? 'Heading1' : p.size >= g.body * 1.18 ? 'Heading2' : null) : null;
  // A shaded paragraph is measured against its box, which is what Word stretches the shading across.
  const box = p.shade ? { left: Math.max(g.left, p.shade.x1), right: Math.min(g.right, p.shade.x2) } : { left: g.left, right: g.right };
  const xs = p.lines.map((l) => l.x - box.left);
  const ends = p.lines.map((l) => box.right - l.end);
  const tol = Math.max(p.size, 6);
  const centred = !runs.some((r) => r.tab) && p.lines.every((l, i) => Math.abs(xs[i] - ends[i]) < tol) && Math.max(...xs) > p.size * 2;
  const tabbed = runs.some((r) => r.tab);
  const rightAligned = !centred && !tabbed && p.lines.every((l, i) => ends[i] < p.size * 0.6) && Math.min(...xs) > (g.right - g.left) * 0.25;
  const justified = !centred && p.lines.length > 1 && p.lines.slice(0, -1).every((l, i) => ends[i] < Math.max(1.5, p.size * 0.25));
  const rest = p.lines.length > 1 ? Math.min(...xs.slice(1)) : xs[0];
  const inset = { left: box.left - g.left, right: g.right - box.right };
  const left = (centred || rightAligned ? 0 : Math.max(0, rest)) + inset.left;
  const firstLine = centred || rightAligned ? 0 : xs[0] - (left - inset.left);
  const right = (centred || rightAligned || justified || tabbed || p.lines.length < 2 ? 0 : Math.max(0, Math.min(...ends))) + inset.right;
  const jc = centred ? 'center' : rightAligned ? 'right' : justified && !tabbed ? 'both' : null;
  const pitch = pitchOf(p, g);
  const keepRight = right > p.size * 3 || (p.shade !== null && right > 0.5);
  const ind = left > 0.5 || firstLine !== 0 || keepRight ? `<w:ind w:left="${twip(left)}"${keepRight ? ` w:right="${twip(right)}"` : ''}${firstLine > 0.5 ? ` w:firstLine="${twip(firstLine)}"` : firstLine < -0.5 ? ` w:hanging="${twip(-firstLine)}"` : ''}/>` : '';
  const tabs = stops.length > 0 ? `<w:tabs>${stops.map((s) => `<w:tab w:val="${s.right ? 'right' : 'left'}" w:pos="${twip(s.pos)}"/>`).join('')}</w:tabs>` : '';
  const borders = p.top || p.bottom ? `<w:pBdr>${edgeXml('top', p.top)}${edgeXml('bottom', p.bottom)}</w:pBdr>` : '';
  const shade = p.shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${p.shade.color}"/>` : '';
  const pPr = `<w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${pageBreak ? '<w:pageBreakBefore/>' : ''}${borders}${shade}${tabs}<w:spacing w:before="${twip(before)}" w:after="0" w:line="${twip(pitch)}" w:lineRule="atLeast"/>${ind}${jc ? `<w:jc w:val="${jc}"/>` : ''}</w:pPr>`;
  return { xml: `<w:p>${pPr}${runs.map((r) => runXml(r, style !== null)).join('')}</w:p>`, heading: style !== null };
}

// Heading styles are bold, so plain runs inside a heading switch it off again.
function runXml(r: Run, heading: boolean): string {
  const font = escapeXml(r.family);
  const rPr =
    `<w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}"/>${r.bold ? '<w:b/>' : heading ? '<w:b w:val="0"/>' : ''}${r.italic ? '<w:i/>' : ''}` +
    `${r.color ? `<w:color w:val="${r.color}"/>` : ''}<w:sz w:val="${Math.round(Math.min(72, Math.max(4, r.size)) * 2)}"/><w:szCs w:val="${Math.round(Math.min(72, Math.max(4, r.size)) * 2)}"/>${r.underline ? '<w:u w:val="single"/>' : ''}</w:rPr>`;
  return r.tab ? `<w:r>${rPr}<w:tab/></w:r>` : `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(r.text)}</w:t></w:r>`;
}

type Media = { name: string; bytes: Uint8Array }[];

// Adds the picture to the package and returns its graphic, or null when its encoding cannot be carried over.
function graphic(im: ImageItem, width: number, height: number, media: Media, doc: PDFDocument): { xml: string; n: number; cx: number; cy: number } | null {
  const pic = imageFile(im.stream, doc);
  if (!pic) return null;
  const cx = Math.round(width * EMU);
  const cy = Math.round(height * EMU);
  const n = media.length + 1;
  const name = `image${n}.${pic.ext}`;
  media.push({ name, bytes: pic.bytes });
  const xml =
    `<a:graphic xmlns:a="${NS_A}"><a:graphicData uri="${NS_PIC}"><pic:pic xmlns:pic="${NS_PIC}"><pic:nvPicPr><pic:cNvPr id="${n}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="rIdImg${n}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>`;
  return { xml, n, cx, cy };
}

// Pictures under text (form scans, letterheads, stamps) float behind it at their place on the page.
function anchorXml(im: ImageItem, g: Geometry, media: Media, doc: PDFDocument): string {
  const pic = graphic(im, im.width, im.height, media, doc);
  if (!pic) return '';
  return (
    `<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${pic.n}" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1">` +
    `<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>${Math.round(im.x * EMU)}</wp:posOffset></wp:positionH>` +
    `<wp:positionV relativeFrom="page"><wp:posOffset>${Math.round((g.height - im.top) * EMU)}</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="${pic.cx}" cy="${pic.cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="${pic.n}" name="Picture ${pic.n}"/><wp:cNvGraphicFramePr/>` +
    `${pic.xml}</wp:anchor></w:drawing></w:r>`
  );
}

function pictureXml(row: ImageItem[], g: Geometry, before: number, pageBreak: boolean, media: Media, doc: PDFDocument): string | null {
  const drawn: string[] = [];
  const stops: number[] = [];
  const room = g.right - g.left;
  let x0: number | null = null;
  for (const im of row) {
    const scale = Math.min(1, room / im.width, (g.height - g.top - g.bottom) / im.height);
    const pic = graphic(im, im.width * scale, im.height * scale, media, doc);
    if (!pic) continue;
    if (x0 === null) x0 = Math.max(0, im.x - g.left);
    else {
      stops.push(Math.max(0, im.x - g.left));
      drawn.push('<w:r><w:tab/></w:r>');
    }
    drawn.push(`<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${pic.cx}" cy="${pic.cy}"/><wp:docPr id="${pic.n}" name="Picture ${pic.n}"/>${pic.xml}</wp:inline></w:drawing></w:r>`);
  }
  if (x0 === null) return null;
  const only = row.length === 1 ? row[0] : null;
  const centred = only !== null && Math.abs(only.x - g.left - (g.right - only.x - only.width)) < 6 && only.x - g.left > 12;
  const tabs = stops.length > 0 ? `<w:tabs>${stops.map((s) => `<w:tab w:val="left" w:pos="${twip(s)}"/>`).join('')}</w:tabs>` : '';
  const pPr = `<w:pPr>${pageBreak ? '<w:pageBreakBefore/>' : ''}${tabs}<w:spacing w:before="${twip(before)}" w:after="0" w:line="240" w:lineRule="auto"/>${centred || x0 < 1 ? '' : `<w:ind w:left="${twip(x0)}"/>`}${centred ? '<w:jc w:val="center"/>' : ''}</w:pPr>`;
  return `<w:p>${pPr}${drawn.join('')}</w:p>`;
}

function filters(dict: PDFDict): string[] {
  const f = dict.lookup(PDFName.of('Filter'));
  if (f instanceof PDFName) return [f.decodeText()];
  if (f instanceof PDFArray) return f.asArray().map((v) => (v instanceof PDFName ? v.decodeText() : ''));
  return [];
}

interface Pixels {
  data: Uint8Array;
  width: number;
  height: number;
  channels: 1 | 3;
}

// JPEGs go into Word as they are; everything else is unpacked to 8-bit gray or RGB and written as PNG.
function imageFile(stream: PDFStream, doc: PDFDocument): { bytes: Uint8Array; ext: 'png' | 'jpeg' } | null {
  const dict = stream.dict;
  const f = filters(dict);
  const smask = dict.lookup(PDFName.of('SMask'));
  if (f.length === 1 && f[0] === 'DCTDecode' && stream instanceof PDFRawStream && !(smask instanceof PDFStream)) {
    const cs = colorSpace(dict.lookup(PDFName.of('ColorSpace')), doc);
    if (cs?.kind !== 'cmyk') return { bytes: stream.getContents(), ext: 'jpeg' };
    return null;
  }
  const plain = smask instanceof PDFStream ? null : plainPng(stream, doc);
  if (plain) return { bytes: plain, ext: 'png' };
  const px = pixels(stream, doc);
  if (!px) return null;
  if (smask instanceof PDFStream) {
    const alpha = pixels(smask, doc);
    if (alpha && alpha.channels === 1 && alpha.width === px.width && alpha.height === px.height) {
      for (let i = 0; i < px.width * px.height; i++) {
        const a = alpha.data[i] / 255;
        for (let c = 0; c < px.channels; c++) px.data[i * px.channels + c] = Math.round(px.data[i * px.channels + c] * a + 255 * (1 - a));
      }
    }
  }
  const row = px.width * px.channels;
  const scanlines = new Uint8Array(px.height * (row + 1));
  for (let y = 0; y < px.height; y++) scanlines.set(px.data.subarray(y * row, (y + 1) * row), y * (row + 1) + 1);
  return { bytes: pngFromScanlines(scanlines, px.width, px.height, px.channels), ext: 'png' };
}

// 8-bit gray or RGB with nothing to remap goes straight into PNG rows, skipping the per-pixel walk.
function plainPng(stream: PDFStream, doc: PDFDocument): Uint8Array | null {
  const dict = stream.dict;
  const n = (d: PDFDict, key: string) => numberOf(d.lookup(PDFName.of(key)));
  if (dict.get(PDFName.of('Decode')) || dict.lookup(PDFName.of('ImageMask'))?.toString() === 'true' || (n(dict, 'BitsPerComponent') || 8) !== 8) return null;
  const cs = colorSpace(dict.lookup(PDFName.of('ColorSpace')), doc);
  if (cs?.kind !== 'gray' && cs?.kind !== 'rgb') return null;
  const channels = cs.kind === 'gray' ? 1 : 3;
  const width = n(dict, 'Width');
  const height = n(dict, 'Height');
  if (width <= 0 || height <= 0) return null;
  const f = filters(dict);
  const parms = dict.lookup(PDFName.of('DecodeParms'));
  const predictor = parms instanceof PDFDict ? n(parms, 'Predictor') : 0;
  if (predictor >= 10 && parms instanceof PDFDict) {
    // A Flate stream with a PNG predictor already is a PNG's IDAT.
    const fits = (n(parms, 'Colors') || 1) === channels && (n(parms, 'Columns') || 1) === width && (n(parms, 'BitsPerComponent') || 8) === 8;
    if (fits && f.length === 1 && f[0] === 'FlateDecode' && stream instanceof PDFRawStream) return pngFromIdat(stream.getContents(), width, height, channels);
    return null;
  }
  if (predictor > 1 || f.some((x) => x !== 'FlateDecode' && x !== 'Fl')) return null;
  const raw = inflate(stream);
  const row = width * channels;
  if (raw.length < row * height) return null;
  const scanlines = new Uint8Array(height * (row + 1));
  for (let y = 0; y < height; y++) scanlines.set(raw.subarray(y * row, (y + 1) * row), y * (row + 1) + 1);
  return pngFromScanlines(scanlines, width, height, channels);
}

type Space = { kind: 'gray' | 'rgb' | 'cmyk' } | { kind: 'indexed'; base: 'gray' | 'rgb' | 'cmyk'; table: Uint8Array };

function colorSpace(cs: PDFObject | undefined, doc: PDFDocument): Space | null {
  const v = cs ? doc.context.lookup(cs) : undefined;
  if (v instanceof PDFName) {
    const n = v.decodeText();
    return n === 'DeviceGray' || n === 'CalGray' || n === 'G' ? { kind: 'gray' } : n === 'DeviceRGB' || n === 'CalRGB' || n === 'RGB' ? { kind: 'rgb' } : n === 'DeviceCMYK' || n === 'CMYK' ? { kind: 'cmyk' } : null;
  }
  if (!(v instanceof PDFArray) || v.size() === 0) return null;
  const head = v.lookup(0);
  const kind = head instanceof PDFName ? head.decodeText() : '';
  if (kind === 'ICCBased') {
    const s = v.lookup(1);
    const n = s instanceof PDFStream ? numberOf(s.dict.lookup(PDFName.of('N'))) : 3;
    return n === 1 ? { kind: 'gray' } : n === 4 ? { kind: 'cmyk' } : { kind: 'rgb' };
  }
  if (kind === 'CalRGB') return { kind: 'rgb' };
  if (kind === 'CalGray') return { kind: 'gray' };
  if (kind === 'Indexed' || kind === 'I') {
    const base = colorSpace(v.get(1), doc);
    const lookup = v.lookup(3);
    const table = lookup instanceof PDFStream ? streamBytes(lookup) : lookup instanceof PDFString || lookup instanceof PDFHexString ? lookup.asBytes() : null;
    if (!base || base.kind === 'indexed' || !table) return null;
    return { kind: 'indexed', base: base.kind, table };
  }
  return null;
}

function pixels(stream: PDFStream, doc: PDFDocument): Pixels | null {
  const dict = stream.dict;
  const f = filters(dict);
  if (f.some((n) => n !== 'FlateDecode' && n !== 'Fl' && n !== 'LZWDecode' && n !== 'ASCII85Decode' && n !== 'ASCIIHexDecode' && n !== 'RunLengthDecode')) return null;
  const width = numberOf(dict.lookup(PDFName.of('Width')));
  const height = numberOf(dict.lookup(PDFName.of('Height')));
  const mask = dict.lookup(PDFName.of('ImageMask'));
  const bpc = mask?.toString() === 'true' ? 1 : numberOf(dict.lookup(PDFName.of('BitsPerComponent'))) || 8;
  const cs = mask?.toString() === 'true' ? ({ kind: 'gray' } as Space) : colorSpace(dict.lookup(PDFName.of('ColorSpace')), doc);
  if (!cs || width <= 0 || height <= 0 || width * height > 25_000_000 || ![1, 2, 4, 8].includes(bpc)) return null;
  const comps = cs.kind === 'indexed' ? 1 : cs.kind === 'gray' ? 1 : cs.kind === 'rgb' ? 3 : 4;
  let raw = streamBytes(stream);
  const parms = dict.lookup(PDFName.of('DecodeParms'));
  const predictor = parms instanceof PDFDict ? numberOf(parms.lookup(PDFName.of('Predictor'))) : 0;
  const stride = Math.ceil((width * comps * bpc) / 8);
  if (predictor >= 10) raw = unfilter(raw, stride, Math.max(1, Math.ceil((comps * bpc) / 8)), height);
  if (raw.length < stride * height) return null;
  const decode = dict.lookup(PDFName.of('Decode'));
  const invert = decode instanceof PDFArray && numberOf(decode.lookup(0)) === 1 && numberOf(decode.lookup(1)) === 0;
  const max = (1 << bpc) - 1;
  const sample = (y: number, i: number) => {
    if (bpc === 8) return raw[y * stride + i];
    const bit = i * bpc;
    return (raw[y * stride + (bit >> 3)] >> (8 - bpc - (bit & 7))) & max;
  };
  const outChannels: 1 | 3 = cs.kind === 'gray' || (cs.kind === 'indexed' && cs.base === 'gray') ? 1 : 3;
  const data = new Uint8Array(width * height * outChannels);
  const put = (o: number, c: number, m: number, yy: number, k: number) => {
    data[o] = Math.round(255 * (1 - c) * (1 - k));
    data[o + 1] = Math.round(255 * (1 - m) * (1 - k));
    data[o + 2] = Math.round(255 * (1 - yy) * (1 - k));
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * outChannels;
      if (cs.kind === 'indexed') {
        const idx = sample(y, x);
        const n = cs.base === 'gray' ? 1 : cs.base === 'rgb' ? 3 : 4;
        const t = cs.table.subarray(idx * n, idx * n + n);
        if (n === 4) put(o, t[0] / 255, t[1] / 255, t[2] / 255, t[3] / 255);
        else for (let c = 0; c < n; c++) data[o + c] = t[c] ?? 0;
        continue;
      }
      const s = (c: number) => {
        const v = Math.round((sample(y, x * comps + c) * 255) / max);
        return invert ? 255 - v : v;
      };
      if (comps === 4) put(o, s(0) / 255, s(1) / 255, s(2) / 255, s(3) / 255);
      else for (let c = 0; c < comps; c++) data[o + c] = s(c);
    }
  }
  return { data, width, height, channels: outChannels };
}

// Undoes PNG row filters, which PDF writers use as the Flate predictor.
function unfilter(src: Uint8Array, stride: number, bpp: number, rows: number): Uint8Array {
  const out = new Uint8Array(stride * rows);
  for (let y = 0; y < rows; y++) {
    const s = y * (stride + 1);
    if (s >= src.length) break;
    const type = src[s];
    const o = y * stride;
    for (let i = 0; i < stride; i++) {
      const raw = src[s + 1 + i] ?? 0;
      const a = i >= bpp ? out[o + i - bpp] : 0;
      const b = y > 0 ? out[o - stride + i] : 0;
      const c = y > 0 && i >= bpp ? out[o - stride + i - bpp] : 0;
      let v = raw;
      if (type === 1) v = raw + a;
      else if (type === 2) v = raw + b;
      else if (type === 3) v = raw + ((a + b) >> 1);
      else if (type === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v = raw + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      out[o + i] = v & 0xff;
    }
  }
  return out;
}

const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';

function buildDocx(bodyXml: string, g: Geometry, media: Media): Uint8Array {
  const landscape = g.width > g.height;
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Default Extension="png" ContentType="image/png"/>' +
        '<Default Extension="jpeg" ContentType="image/jpeg"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        '</Types>',
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '</Relationships>',
    ),
    'word/_rels/document.xml.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        media.map((m, i) => `<Relationship Id="rIdImg${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${m.name}"/>`).join('') +
        '</Relationships>',
    ),
    'word/styles.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${NS_W}">` +
        '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault>' +
        '<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
        '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
        '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>' +
        '<w:pPr><w:keepNext/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>' +
        '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>' +
        '<w:pPr><w:keepNext/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>' +
        '</w:styles>',
    ),
    'word/document.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${NS_W}" xmlns:r="${NS_R}" xmlns:wp="${NS_WP}" xmlns:a="${NS_A}" xmlns:pic="${NS_PIC}"><w:body>${bodyXml}` +
        `<w:sectPr><w:pgSz w:w="${twip(g.width)}" w:h="${twip(g.height)}"${landscape ? ' w:orient="landscape"' : ''}/>` +
        `<w:pgMar w:top="${twip(g.top)}" w:right="${twip(g.width - g.right)}" w:bottom="${twip(g.bottom)}" w:left="${twip(g.left)}" w:header="${twip(Math.min(36, g.top / 2))}" w:footer="${twip(Math.min(36, g.bottom / 2))}" w:gutter="0"/></w:sectPr>` +
        '</w:body></w:document>',
    ),
  };
  // PNG and JPEG are compressed already; deflating them again only costs time.
  for (const m of media) files[`word/media/${m.name}`] = [m.bytes, { level: 0 }];
  return zipSync(files, { level: 6 });
}
