import { Encodings, Font as StandardFont, FontNames } from '@pdf-lib/standard-fonts';
import { strFromU8, strToU8, zipSync } from 'fflate';
import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, type PDFObject, PDFRawStream, PDFStream } from 'pdf-lib';

import { escapeXml } from './xml';

export interface PdfToDocxReport {
  bytes: Uint8Array;
  pages: number;
  paragraphs: number;
  headings: number;
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
}

interface OutPara {
  text: string;
  size: number;
  bold: boolean;
  italic: boolean;
  pageBreak: boolean;
}

type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function mul(m: Matrix, n: Matrix): Matrix {
  return [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
}

export async function pdfToDocx(input: Uint8Array): Promise<PdfToDocxReport> {
  const doc = await PDFDocument.load(input, { ignoreEncryption: true, updateMetadata: false });
  const pages = doc.getPages();
  const paras: OutPara[] = [];
  let emptyPages = 0;
  for (let i = 0; i < pages.length; i++) {
    const node = pages[i].node;
    const resources = node.Resources() ?? null;
    const items: TextItem[] = [];
    const contents = node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray().map((r) => doc.context.lookup(r)) : [contents];
    const chunks: Uint8Array[] = [];
    for (const s of streams) if (s instanceof PDFStream) chunks.push(streamBytes(s));
    runContent(concat(chunks), resources, doc, IDENTITY, items, 0);
    const pageParas = toParagraphs(items);
    if (pageParas.length === 0) emptyPages++;
    if (pageParas.length > 0 && paras.length > 0) pageParas[0].pageBreak = true;
    paras.push(...pageParas);
  }
  if (paras.length === 0) throw new PdfHasNoText('This PDF has no text layer, so it is probably a scan. There is nothing to turn into Word text.');

  const sizes = paras.flatMap((p) => Array<number>(Math.min(50, p.text.length)).fill(p.size)).sort((a, b) => a - b);
  const body = sizes[Math.floor(sizes.length / 2)] || 11;
  let headings = 0;
  const xml = paras
    .map((p) => {
      const style = p.text.length <= 160 ? (p.size >= body * 1.45 ? 'Heading1' : p.size >= body * 1.18 ? 'Heading2' : null) : null;
      if (style) headings++;
      return paragraphXml(p, style, Math.round(Math.min(72, Math.max(6, style ? p.size : body)) * 2));
    })
    .join('');
  return { bytes: buildDocx(xml), pages: pages.length, paragraphs: paras.length, headings, emptyPages };
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
}

const fontCache = new WeakMap<PDFDict, Font>();

function runContent(bytes: Uint8Array, resources: PDFDict | null, doc: PDFDocument, ctm0: Matrix, items: TextItem[], depth: number) {
  if (depth > 6) return;
  let ctm = ctm0;
  const gstack: Matrix[] = [];
  let tm: Matrix = IDENTITY;
  let tlm: Matrix = IDENTITY;
  let font: Font | null = null;
  let size = 0;
  let leading = 0;
  let charSpace = 0;
  let wordSpace = 0;
  let hScale = 1;
  let rise = 0;
  const operands: Token[] = [];

  const lookupDict = (dict: PDFDict | null, key: string): PDFDict | null => {
    const v = dict?.lookup(PDFName.of(key));
    return v instanceof PDFDict ? v : null;
  };
  const fonts = lookupDict(resources, 'Font');
  const xobjects = lookupDict(resources, 'XObject');

  const show = (str: Uint8Array) => {
    if (!font) return;
    for (const g of font.decode(str)) {
      const trm = mul([size * hScale, 0, 0, size, 0, rise], mul(tm, ctm));
      const eff = Math.hypot(trm[2], trm[3]) || size;
      const tx = (g.width * size + charSpace + (g.text === ' ' ? wordSpace : 0)) * hScale;
      const x = trm[4];
      const y = trm[5];
      tm = mul([1, 0, 0, 1, tx, 0], tm);
      const endX = mul(mul([size * hScale, 0, 0, size, 0, rise], tm), ctm)[4];
      if (g.text !== '') items.push({ text: g.text, x, y, end: endX, size: eff, bold: font.bold, italic: font.italic });
    }
  };
  const nextLine = () => {
    tlm = mul([1, 0, 0, 1, 0, -leading], tlm);
    tm = tlm;
  };

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
        gstack.push(ctm);
        break;
      case 'Q':
        ctm = gstack.pop() ?? ctm0;
        break;
      case 'cm':
        ctm = mul([num(6), num(5), num(4), num(3), num(2), num(1)], ctm);
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
        if (!(xo instanceof PDFStream) || xo.dict.lookup(PDFName.of('Subtype')) !== PDFName.of('Form')) break;
        const m = xo.dict.lookup(PDFName.of('Matrix'));
        const fm: Matrix = m instanceof PDFArray && m.size() === 6 ? (m.asArray().map((v) => (doc.context.lookup(v) instanceof PDFNumber ? (doc.context.lookup(v) as PDFNumber).asNumber() : 0)) as Matrix) : IDENTITY;
        const res = xo.dict.lookup(PDFName.of('Resources'));
        runContent(streamBytes(xo), res instanceof PDFDict ? res : resources, doc, mul(fm, ctm), items, depth + 1);
        break;
      }
      default:
        break;
    }
    operands.length = 0;
  }
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

function toParagraphs(items: TextItem[]): OutPara[] {
  interface Line {
    text: string;
    y: number;
    size: number;
    bold: number;
    italic: number;
    chars: number;
    end: number;
  }
  const lines: Line[] = [];
  let line: Line | null = null;
  for (const it of items) {
    const sameLine = line !== null && Math.abs(it.y - line.y) < Math.max(it.size, line.size) * 0.5 && it.x >= line.end - it.size * 2;
    if (!sameLine) {
      if (line && line.text.trim() !== '') lines.push(line);
      line = { text: '', y: it.y, size: it.size, bold: 0, italic: 0, chars: 0, end: it.x };
    }
    const l = line!;
    if (l.text !== '' && !l.text.endsWith(' ') && it.text !== ' ' && it.x - l.end > it.size * 0.18) l.text += ' ';
    l.text += it.text;
    l.end = Math.max(l.end, it.end);
    if (it.text.trim() !== '') {
      l.size = l.chars === 0 ? it.size : Math.max(l.size, it.size);
      l.chars += it.text.length;
      if (it.bold) l.bold += it.text.length;
      if (it.italic) l.italic += it.text.length;
    }
  }
  if (line && line.text.trim() !== '') lines.push(line);

  const paras: OutPara[] = [];
  let cur: (OutPara & { y: number; chars: number; boldChars: number; italicChars: number }) | null = null;
  for (const l of lines) {
    const text = l.text.replace(/\s+/g, ' ').trim();
    const gap = cur ? cur.y - l.y : 0;
    const sizeJump = cur ? Math.abs(l.size - cur.size) > Math.min(l.size, cur.size) * 0.15 : false;
    const breaks = !cur || sizeJump || gap > l.size * 1.5 || gap < -l.size * 0.5;
    if (breaks) {
      if (cur) paras.push(finish(cur));
      cur = { text, size: l.size, bold: false, italic: false, pageBreak: false, y: l.y, chars: l.chars, boldChars: l.bold, italicChars: l.italic };
    } else if (cur) {
      cur.text = /[A-Za-z]-$/.test(cur.text) && /^[a-z]/.test(text) ? cur.text.slice(0, -1) + text : `${cur.text} ${text}`;
      cur.y = l.y;
      cur.chars += l.chars;
      cur.boldChars += l.bold;
      cur.italicChars += l.italic;
    }
  }
  if (cur) paras.push(finish(cur));
  return paras;
}

function finish(p: OutPara & { chars: number; boldChars: number; italicChars: number }): OutPara {
  return { text: p.text, size: p.size, bold: p.boldChars > p.chars * 0.6, italic: p.italicChars > p.chars * 0.6, pageBreak: p.pageBreak };
}

function paragraphXml(p: OutPara, style: string | null, halfPoints: number): string {
  const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : '';
  const brk = p.pageBreak ? '<w:r><w:br w:type="page"/></w:r>' : '';
  const rPr = `<w:rPr>${p.bold && !style ? '<w:b/>' : ''}${p.italic ? '<w:i/>' : ''}${style ? '' : `<w:sz w:val="${halfPoints}"/>`}</w:rPr>`;
  return `<w:p>${pPr}${brk}<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(p.text)}</w:t></w:r></w:p>`;
}

const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function buildDocx(bodyXml: string): Uint8Array {
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
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
        '</Relationships>',
    ),
    'word/styles.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${NS_W}">` +
        '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault>' +
        '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
        '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
        '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>' +
        '<w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>' +
        '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>' +
        '<w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>' +
        '</w:styles>',
    ),
    'word/document.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${NS_W}"><w:body>${bodyXml}` +
        '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>' +
        '</w:body></w:document>',
    ),
  };
  return zipSync(files, { level: 6 });
}
