import { unzipSync, strFromU8 } from 'fflate';
import { PDFDocument, type PDFFont, type PDFImage, type PDFPage, rgb, StandardFonts } from 'pdf-lib';

import { tokenizeXml } from './xml';

type ParaStyle = 'title' | 'h1' | 'h2' | 'h3' | 'body';
type Align = 'left' | 'center' | 'right';

interface Span {
  kind: 'span';
  text: string;
  bold: boolean;
  italic: boolean;
  size: number | null;
}

interface InlineImage {
  kind: 'image';
  target: string;
  width: number;
  height: number;
}

type Inline = Span | InlineImage | { kind: 'break'; page: boolean };

interface Para {
  kind: 'para';
  style: ParaStyle;
  align: Align;
  marker: string | null;
  level: number;
  inlines: Inline[];
}

interface Table {
  kind: 'table';
  grid: number[];
  rows: Para[][][];
}

type Block = Para | Table;

interface Page {
  width: number;
  height: number;
  margin: { top: number; right: number; bottom: number; left: number };
}

export interface DocxToPdfReport {
  bytes: Uint8Array;
  pages: number;
  paragraphs: number;
  images: number;
  skippedImages: number;
  replacedChars: number;
}

export class DocxUnreadable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocxUnreadable';
  }
}

const EMU_PER_PT = 12700;
const TWIPS_PER_PT = 20;
const BODY_SIZE = 11;
const STYLE_SIZE: Record<ParaStyle, number> = { title: 26, h1: 20, h2: 16, h3: 13, body: BODY_SIZE };
const SKIP = new Set(['w:del', 'w:delText', 'w:instrText', 'mc:Fallback', 'w:footnoteReference', 'w:commentReference']);
const OFF = new Set(['0', 'false', 'off', 'none']);

export async function docxToPdf(input: Uint8Array, title?: string): Promise<DocxToPdfReport> {
  let zip: Record<string, Uint8Array>;
  try {
    zip = unzipSync(input);
  } catch {
    throw new DocxUnreadable('This is not a .docx file. Old .doc files need to be saved as .docx in Word first.');
  }
  const main = zip['word/document.xml'];
  if (!main) throw new DocxUnreadable('This file has no Word document inside.');
  const styles = readStyleNames(zip['word/styles.xml']);
  const numbering = readNumbering(zip['word/numbering.xml']);
  const rels = readRels(zip['word/_rels/document.xml.rels']);
  const { blocks, page } = parseDocument(strFromU8(main), styles, numbering);
  return layout(blocks, page, zip, rels, title);
}

function readStyleNames(bytes: Uint8Array | undefined): Map<string, ParaStyle> {
  const out = new Map<string, ParaStyle>();
  if (!bytes) return out;
  let id: string | null = null;
  for (const t of tokenizeXml(strFromU8(bytes))) {
    if (t.kind === 'text') continue;
    if (t.name === 'w:style' && t.kind !== 'close') id = t.attrs['w:styleId'] ?? null;
    else if (t.name === 'w:name' && id) {
      const style = styleFromName(t.attrs['w:val'] ?? '');
      if (style !== 'body') out.set(id, style);
    }
  }
  return out;
}

function styleFromName(name: string): ParaStyle {
  const n = name.toLowerCase().replace(/\s+/g, '');
  if (n === 'title') return 'title';
  const m = /^heading(\d)$/.exec(n);
  if (!m) return 'body';
  return m[1] === '1' ? 'h1' : m[1] === '2' ? 'h2' : 'h3';
}

interface Numbering {
  formats: Map<string, string[]>;
}

function readNumbering(bytes: Uint8Array | undefined): Numbering {
  const abstract = new Map<string, string[]>();
  const formats = new Map<string, string[]>();
  if (!bytes) return { formats };
  let absId: string | null = null;
  let lvl = 0;
  let numId: string | null = null;
  for (const t of tokenizeXml(strFromU8(bytes))) {
    if (t.kind === 'text') continue;
    if (t.name === 'w:abstractNum' && t.kind === 'open') {
      absId = t.attrs['w:abstractNumId'] ?? null;
      if (absId) abstract.set(absId, []);
    } else if (t.name === 'w:lvl' && t.kind === 'open') lvl = Number(t.attrs['w:ilvl'] ?? 0);
    else if (t.name === 'w:numFmt' && absId) abstract.get(absId)![lvl] = t.attrs['w:val'] ?? 'bullet';
    else if (t.name === 'w:abstractNum' && t.kind === 'close') absId = null;
    else if (t.name === 'w:num' && t.kind === 'open') numId = t.attrs['w:numId'] ?? null;
    else if (t.name === 'w:abstractNumId' && numId) formats.set(numId, abstract.get(t.attrs['w:val'] ?? '') ?? []);
  }
  return { formats };
}

function readRels(bytes: Uint8Array | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!bytes) return out;
  for (const t of tokenizeXml(strFromU8(bytes))) {
    if (t.kind === 'text' || t.name !== 'Relationship') continue;
    const target = t.attrs.Target ?? '';
    if (t.attrs.TargetMode === 'External') continue;
    out.set(t.attrs.Id ?? '', target.startsWith('/') ? target.slice(1) : `word/${target}`);
  }
  return out;
}

function parseDocument(xml: string, styles: Map<string, ParaStyle>, numbering: Numbering): { blocks: Block[]; page: Page } {
  const blocks: Block[] = [];
  const page: Page = { width: 595.28, height: 841.89, margin: { top: 72, right: 72, bottom: 72, left: 72 } };
  const counters = new Map<string, number[]>();
  let skip = 0;
  let para: Para | null = null;
  let numId: string | null = null;
  let inPPr = false;
  let inRun = false;
  let inText = false;
  let run = { bold: false, italic: false, size: null as number | null };
  let extent: { width: number; height: number } | null = null;
  let tblDepth = 0;
  let table: Table | null = null;
  let row: Para[][] | null = null;
  let cell: Para[] | null = null;

  const on = (attrs: Record<string, string>) => !OFF.has((attrs['w:val'] ?? '').toLowerCase());
  const push = (inline: Inline) => para?.inlines.push(inline);

  for (const t of tokenizeXml(xml)) {
    if (t.kind === 'text') {
      if (inText && skip === 0 && para) push({ kind: 'span', text: t.text, ...run });
      continue;
    }
    if (SKIP.has(t.name)) {
      if (t.kind === 'open') skip++;
      else if (t.kind === 'close') skip--;
      continue;
    }
    if (skip > 0) continue;
    const opening = t.kind !== 'close';
    switch (t.name) {
      case 'w:tbl':
        if (t.kind === 'open') {
          tblDepth++;
          if (tblDepth === 1) table = { kind: 'table', grid: [], rows: [] };
        } else if (t.kind === 'close') {
          if (tblDepth === 1 && table) blocks.push(table);
          if (tblDepth === 1) table = null;
          tblDepth--;
        }
        break;
      case 'w:gridCol':
        if (tblDepth === 1 && table) table.grid.push(Number(t.attrs['w:w'] ?? 0) / TWIPS_PER_PT);
        break;
      case 'w:tr':
        if (tblDepth !== 1 || !table) break;
        if (t.kind === 'open') row = [];
        else if (t.kind === 'close' && row) {
          table.rows.push(row);
          row = null;
        }
        break;
      case 'w:tc':
        if (tblDepth !== 1 || !row) break;
        if (t.kind === 'open') cell = [];
        else if (t.kind === 'close' && cell) {
          row.push(cell);
          cell = null;
        }
        break;
      case 'w:p':
        if (t.kind === 'open' || t.kind === 'empty') {
          para = { kind: 'para', style: 'body', align: 'left', marker: null, level: 0, inlines: [] };
          numId = null;
        }
        if (t.kind === 'close' || t.kind === 'empty') {
          if (para) {
            if (cell) cell.push(para);
            else if (tblDepth === 0) blocks.push(para);
          }
          para = null;
        }
        break;
      case 'w:pPr':
        inPPr = t.kind === 'open';
        if (t.kind === 'close' && para && numId !== null) para.marker = listMarker(numbering, counters, numId, para.level);
        break;
      case 'w:pStyle':
        if (para) para.style = styles.get(t.attrs['w:val'] ?? '') ?? styleFromName(t.attrs['w:val'] ?? '');
        break;
      case 'w:numId':
        if (para && inPPr && t.attrs['w:val'] !== '0') numId = t.attrs['w:val'] ?? null;
        break;
      case 'w:ilvl':
        if (para && inPPr) para.level = Math.min(8, Number(t.attrs['w:val'] ?? 0));
        break;
      case 'w:jc':
        if (para && inPPr) {
          const v = t.attrs['w:val'];
          para.align = v === 'center' ? 'center' : v === 'right' || v === 'end' ? 'right' : 'left';
        }
        break;
      case 'w:r':
        inRun = opening && t.kind === 'open';
        if (t.kind === 'open') run = { bold: false, italic: false, size: null };
        break;
      case 'w:b':
        if (inRun && !inPPr) run.bold = on(t.attrs);
        break;
      case 'w:i':
        if (inRun && !inPPr) run.italic = on(t.attrs);
        break;
      case 'w:sz':
        if (inRun && !inPPr) run.size = Number(t.attrs['w:val'] ?? BODY_SIZE * 2) / 2;
        break;
      case 'w:t':
        inText = t.kind === 'open';
        break;
      case 'w:tab':
        if (inRun) push({ kind: 'span', text: '    ', ...run });
        break;
      case 'w:br':
      case 'w:cr':
        if (inRun) push({ kind: 'break', page: t.attrs['w:type'] === 'page' });
        break;
      case 'wp:extent':
        extent = { width: Number(t.attrs.cx ?? 0) / EMU_PER_PT, height: Number(t.attrs.cy ?? 0) / EMU_PER_PT };
        break;
      case 'a:blip':
      case 'v:imagedata': {
        const target = t.attrs['r:embed'] ?? t.attrs['r:id'];
        if (target && para) push({ kind: 'image', target, width: extent?.width ?? 0, height: extent?.height ?? 0 });
        extent = null;
        break;
      }
      case 'w:pgSz':
        if (t.attrs['w:w'] && t.attrs['w:h']) {
          page.width = Number(t.attrs['w:w']) / TWIPS_PER_PT;
          page.height = Number(t.attrs['w:h']) / TWIPS_PER_PT;
        }
        break;
      case 'w:pgMar':
        page.margin = {
          top: Math.max(18, Number(t.attrs['w:top'] ?? 1440) / TWIPS_PER_PT),
          right: Math.max(18, Number(t.attrs['w:right'] ?? 1440) / TWIPS_PER_PT),
          bottom: Math.max(18, Number(t.attrs['w:bottom'] ?? 1440) / TWIPS_PER_PT),
          left: Math.max(18, Number(t.attrs['w:left'] ?? 1440) / TWIPS_PER_PT),
        };
        break;
      default:
        break;
    }
  }
  return { blocks, page };
}

function listMarker(numbering: Numbering, counters: Map<string, number[]>, numId: string, level: number): string {
  const format = numbering.formats.get(numId)?.[level] ?? 'bullet';
  if (format === 'bullet' || format === 'none') return format === 'none' ? '' : '•';
  const c = counters.get(numId) ?? [];
  c[level] = (c[level] ?? 0) + 1;
  c.length = level + 1;
  counters.set(numId, c);
  const n = c[level];
  switch (format) {
    case 'lowerLetter':
      return `${letters(n)}.`;
    case 'upperLetter':
      return `${letters(n).toUpperCase()}.`;
    case 'lowerRoman':
      return `${roman(n)}.`;
    case 'upperRoman':
      return `${roman(n).toUpperCase()}.`;
    default:
      return `${n}.`;
  }
}

function letters(n: number): string {
  let s = '';
  for (let v = n; v > 0; v = Math.floor((v - 1) / 26)) s = String.fromCharCode(97 + ((v - 1) % 26)) + s;
  return s;
}

function roman(n: number): string {
  const table: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let s = '';
  let v = n;
  for (const [k, r] of table) while (v >= k) {
    s += r;
    v -= k;
  }
  return s;
}

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  boldItalic: PDFFont;
}

interface Piece {
  text: string;
  font: PDFFont;
  size: number;
  width: number;
}

interface Line {
  pieces: Piece[];
  width: number;
  size: number;
}

const SUBSTITUTE: Record<string, string> = {
  '‐': '-',
  '‑': '-',
  '‒': '-',
  '−': '-',
  ' ': ' ',
  ' ': ' ',
  ' ': ' ',
  '​': '',
  '­': '',
  ' ': ' ',
};

async function layout(blocks: Block[], page: Page, zip: Record<string, Uint8Array>, rels: Map<string, string>, title?: string): Promise<DocxToPdfReport> {
  const doc = await PDFDocument.create();
  if (title) doc.setTitle(title);
  doc.setCreator('QRelay');
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
    boldItalic: await doc.embedFont(StandardFonts.HelveticaBoldOblique),
  };
  const charset = new Set(fonts.regular.getCharacterSet());
  let replacedChars = 0;
  const clean = (s: string) => {
    let out = '';
    for (const ch of s) {
      const sub = SUBSTITUTE[ch];
      if (sub !== undefined) out += sub;
      else if (charset.has(ch.codePointAt(0)!)) out += ch;
      else {
        out += '?';
        replacedChars++;
      }
    }
    return out;
  };

  const images = new Map<string, PDFImage | null>();
  let imageCount = 0;
  let skippedImages = 0;
  const loadImage = async (rid: string): Promise<PDFImage | null> => {
    if (images.has(rid)) return images.get(rid)!;
    const path = rels.get(rid);
    const data = path ? zip[path] : undefined;
    let img: PDFImage | null = null;
    if (data && data[0] === 0x89 && data[1] === 0x50) img = await doc.embedPng(data).catch(() => null);
    else if (data && data[0] === 0xff && data[1] === 0xd8) img = await doc.embedJpg(data).catch(() => null);
    images.set(rid, img);
    return img;
  };

  const contentW = page.width - page.margin.left - page.margin.right;
  const contentH = page.height - page.margin.top - page.margin.bottom;
  let current: PDFPage = doc.addPage([page.width, page.height]);
  let y = page.height - page.margin.top;
  let pageHasContent = false;
  const bottom = page.margin.bottom;
  const newPage = () => {
    current = doc.addPage([page.width, page.height]);
    y = page.height - page.margin.top;
    pageHasContent = false;
  };
  const ensure = (h: number) => {
    if (y - h < bottom && pageHasContent) newPage();
  };

  const fontFor = (bold: boolean, italic: boolean) => (bold ? (italic ? fonts.boldItalic : fonts.bold) : italic ? fonts.italic : fonts.regular);

  const wrap = (spans: Span[], width: number, para: Para): Line[] => {
    const lines: Line[] = [];
    let line: Line = { pieces: [], width: 0, size: 0 };
    const baseSize = STYLE_SIZE[para.style];
    const headingBold = para.style !== 'body';
    const flush = () => {
      if (line.size === 0) line.size = baseSize;
      lines.push(line);
      line = { pieces: [], width: 0, size: 0 };
    };
    for (const span of spans) {
      const size = span.size ?? baseSize;
      const font = fontFor(span.bold || headingBold, span.italic);
      for (const word of clean(span.text).split(/(\s+)/)) {
        if (word === '') continue;
        const space = /^\s+$/.test(word);
        if (space && line.pieces.length === 0) continue;
        let w = font.widthOfTextAtSize(word, size);
        if (!space && line.width + w > width && line.pieces.length > 0) {
          while (line.pieces.length > 0 && /^\s+$/.test(line.pieces[line.pieces.length - 1].text)) line.width -= line.pieces.pop()!.width;
          flush();
        }
        let rest = word;
        while (!space && w > width) {
          let cut = rest.length - 1;
          while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > width - line.width) cut--;
          const head = rest.slice(0, cut);
          const hw = font.widthOfTextAtSize(head, size);
          line.pieces.push({ text: head, font, size, width: hw });
          line.width += hw;
          line.size = Math.max(line.size, size);
          flush();
          rest = rest.slice(cut);
          w = font.widthOfTextAtSize(rest, size);
        }
        line.pieces.push({ text: rest, font, size, width: w });
        line.width += w;
        line.size = Math.max(line.size, size);
      }
    }
    if (line.pieces.length > 0 || lines.length === 0) flush();
    return lines;
  };

  const drawLine = (target: PDFPage, line: Line, x: number, top: number, width: number, align: Align) => {
    const offset = align === 'center' ? (width - line.width) / 2 : align === 'right' ? width - line.width : 0;
    let cx = x + Math.max(0, offset);
    const baseline = top - line.size * 0.95;
    for (let i = 0; i < line.pieces.length; ) {
      const { font, size } = line.pieces[i];
      let text = '';
      let width = 0;
      for (; i < line.pieces.length && line.pieces[i].font === font && line.pieces[i].size === size; i++) {
        text += line.pieces[i].text;
        width += line.pieces[i].width;
      }
      if (text.trim() !== '') target.drawText(text, { x: cx, y: baseline, size, font, color: rgb(0.1, 0.1, 0.1) });
      cx += width;
    }
  };

  const spacing = (style: ParaStyle) => (style === 'body' ? { before: 0, after: 6 } : style === 'title' ? { before: 0, after: 12 } : { before: 10, after: 4 });

  const drawPara = async (para: Para) => {
    const gap = spacing(para.style);
    const indent = para.marker !== null ? 18 * (para.level + 1) : 0;
    const width = contentW - indent;
    let spans: Span[] = [];
    let first = true;
    if (pageHasContent) y -= gap.before;
    const flushSpans = () => {
      const lines = wrap(spans, width, para);
      for (const line of lines) {
        const h = line.size * 1.25;
        ensure(h);
        if (first && para.marker) current.drawText(clean(para.marker), { x: page.margin.left + indent - 14, y: y - line.size * 0.95, size: line.size, font: fonts.regular, color: rgb(0.1, 0.1, 0.1) });
        first = false;
        drawLine(current, line, page.margin.left + indent, y, width, para.align);
        y -= h;
        pageHasContent = true;
      }
      spans = [];
    };
    for (const inline of para.inlines) {
      if (inline.kind === 'span') spans.push(inline);
      else if (inline.kind === 'break') {
        flushSpans();
        if (inline.page) newPage();
      } else {
        if (spans.some((s) => s.text.trim() !== '')) flushSpans();
        else spans = [];
        const img = await loadImage(inline.target);
        if (!img) {
          skippedImages++;
          continue;
        }
        imageCount++;
        let w = inline.width > 0 ? inline.width : img.width * 0.75;
        let h = inline.height > 0 ? inline.height : img.height * 0.75;
        const scale = Math.min(1, contentW / w, contentH / h);
        w *= scale;
        h *= scale;
        ensure(h);
        const x = para.align === 'center' ? page.margin.left + (contentW - w) / 2 : para.align === 'right' ? page.margin.left + contentW - w : page.margin.left + indent;
        current.drawImage(img, { x, y: y - h, width: w, height: h });
        y -= h + 4;
        pageHasContent = true;
        first = false;
      }
    }
    if (spans.length > 0 || first) flushSpans();
    y -= gap.after;
  };

  const drawTable = (table: Table) => {
    const cols = Math.max(1, ...table.rows.map((r) => r.length));
    const gridSum = table.grid.slice(0, cols).reduce((a, b) => a + b, 0);
    const widths = table.grid.length >= cols && gridSum > 0 ? table.grid.slice(0, cols).map((g) => (g / gridSum) * Math.min(contentW, gridSum)) : Array.from({ length: cols }, () => contentW / cols);
    const pad = 4;
    for (const r of table.rows) {
      const cellLines = r.map((paras, i) => {
        const w = (widths[i] ?? widths[widths.length - 1]) - pad * 2;
        return paras.flatMap((p) => {
          const spans = p.inlines.filter((n): n is Span => n.kind === 'span');
          skippedImages += p.inlines.filter((n) => n.kind === 'image').length;
          return wrap(spans, w, { ...p, style: p.style === 'body' ? 'body' : 'h3' }).map((line) => ({ line, align: p.align }));
        });
      });
      const height = Math.max(BODY_SIZE * 1.25, ...cellLines.map((ls) => ls.reduce((a, l) => a + l.line.size * 1.25, 0))) + pad * 2;
      ensure(height);
      let x = page.margin.left;
      for (let i = 0; i < cols; i++) {
        const w = widths[i] ?? widths[widths.length - 1];
        current.drawRectangle({ x, y: y - height, width: w, height, borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 0.5 });
        let top = y - pad;
        for (const { line, align } of cellLines[i] ?? []) {
          drawLine(current, line, x + pad, top, w - pad * 2, align);
          top -= line.size * 1.25;
        }
        x += w;
      }
      y -= height;
      pageHasContent = true;
    }
    y -= 8;
  };

  let paragraphs = 0;
  for (const block of blocks) {
    if (block.kind === 'para') {
      paragraphs++;
      await drawPara(block);
    } else drawTable(block);
  }
  if (!pageHasContent && doc.getPageCount() > 1) doc.removePage(doc.getPageCount() - 1);
  const bytes = await doc.save({ useObjectStreams: true });
  return { bytes, pages: doc.getPageCount(), paragraphs, images: imageCount, skippedImages, replacedChars };
}
