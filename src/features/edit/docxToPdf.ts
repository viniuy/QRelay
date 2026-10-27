import { unzipSync, strFromU8 } from 'fflate';
import { PDFDocument, type PDFFont, type PDFImage, type PDFPage, rgb, StandardFonts } from 'pdf-lib';

import { tokenizeXml, type XmlTag } from './xml';

type ParaStyle = 'title' | 'h1' | 'h2' | 'h3' | 'body';
type Align = 'left' | 'center' | 'right' | 'justify';
type LineRule = 'auto' | 'exact' | 'atLeast';

// Formatting as Word stores it: every field is optional so style layers can be merged with spread.
interface RunProps {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  caps?: boolean;
  size?: number;
  color?: string;
}

interface ParaProps {
  before?: number;
  after?: number;
  line?: number;
  lineRule?: LineRule;
  align?: Align;
  left?: number;
  right?: number;
  firstLine?: number;
  contextual?: boolean;
  pageBreak?: boolean;
  outline?: number;
  numId?: string;
  level?: number;
}

interface Span {
  kind: 'span';
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  size: number;
  color: string | null;
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
  styleId: string;
  style: ParaStyle;
  align: Align;
  before: number;
  after: number;
  line: number;
  lineRule: LineRule;
  left: number;
  right: number;
  firstLine: number;
  contextual: boolean;
  pageBreak: boolean;
  size: number;
  marker: string | null;
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
// Tracked changes keep the old text and the old formatting next to the new; only the new should render.
const SKIP = new Set([
  'w:del',
  'w:delText',
  'w:moveFrom',
  'w:instrText',
  'mc:Fallback',
  'w:footnoteReference',
  'w:commentReference',
  'w:pPrChange',
  'w:rPrChange',
  'w:sectPrChange',
  'w:tblPrChange',
  'w:trPrChange',
  'w:tcPrChange',
  'w:numberingChange',
]);
const OFF = new Set(['0', 'false', 'off', 'none']);

const on = (attrs: Record<string, string>) => !OFF.has((attrs['w:val'] ?? '').toLowerCase());
const flag = (v: string | undefined) => v !== undefined && !OFF.has(v.toLowerCase());
const twips = (v: string | undefined) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? undefined : Number(v) / TWIPS_PER_PT);

export async function docxToPdf(input: Uint8Array, title?: string): Promise<DocxToPdfReport> {
  let zip: Record<string, Uint8Array>;
  try {
    zip = unzipSync(input);
  } catch {
    throw new DocxUnreadable('This is not a .docx file. Old .doc files need to be saved as .docx in Word first.');
  }
  const main = zip['word/document.xml'];
  if (!main) throw new DocxUnreadable('This file has no Word document inside.');
  const styles = readStyles(zip['word/styles.xml']);
  const numbering = readNumbering(zip['word/numbering.xml']);
  const rels = readRels(zip['word/_rels/document.xml.rels']);
  const { blocks, page } = parseDocument(strFromU8(main), styles, numbering);
  return layout(blocks, page, zip, rels, title);
}

function applyRun(r: RunProps, t: XmlTag): void {
  const v = t.attrs['w:val'];
  switch (t.name) {
    case 'w:b':
      r.bold = on(t.attrs);
      break;
    case 'w:i':
      r.italic = on(t.attrs);
      break;
    case 'w:caps':
      r.caps = on(t.attrs);
      break;
    case 'w:u':
      r.underline = on(t.attrs);
      break;
    case 'w:sz':
      if (v) r.size = Number(v) / 2;
      break;
    case 'w:color':
      if (v) r.color = v;
      break;
    default:
      break;
  }
}

function applyPara(p: ParaProps, t: XmlTag): void {
  const a = t.attrs;
  switch (t.name) {
    case 'w:spacing': {
      const before = flag(a['w:beforeAutospacing']) ? 14 : twips(a['w:before']);
      const after = flag(a['w:afterAutospacing']) ? 14 : twips(a['w:after']);
      if (before !== undefined) p.before = before;
      if (after !== undefined) p.after = after;
      if (a['w:line']) {
        p.line = Number(a['w:line']);
        p.lineRule = a['w:lineRule'] === 'exact' ? 'exact' : a['w:lineRule'] === 'atLeast' ? 'atLeast' : 'auto';
      }
      break;
    }
    case 'w:jc': {
      const v = a['w:val'];
      p.align = v === 'center' ? 'center' : v === 'right' || v === 'end' ? 'right' : v === 'both' || v === 'distribute' ? 'justify' : 'left';
      break;
    }
    case 'w:ind': {
      const left = twips(a['w:left'] ?? a['w:start']);
      const right = twips(a['w:right'] ?? a['w:end']);
      const first = twips(a['w:firstLine']);
      const hanging = twips(a['w:hanging']);
      if (left !== undefined) p.left = left;
      if (right !== undefined) p.right = right;
      if (hanging !== undefined) p.firstLine = -hanging;
      else if (first !== undefined) p.firstLine = first;
      break;
    }
    case 'w:contextualSpacing':
      p.contextual = on(a);
      break;
    case 'w:pageBreakBefore':
      p.pageBreak = on(a);
      break;
    case 'w:outlineLvl':
      p.outline = Number(a['w:val'] ?? 9);
      break;
    case 'w:numId':
      if (a['w:val'] !== undefined) p.numId = a['w:val'];
      break;
    case 'w:ilvl':
      p.level = Math.min(8, Number(a['w:val'] ?? 0));
      break;
    default:
      break;
  }
}

interface StyleDef {
  basedOn: string | null;
  kind: ParaStyle;
  ppr: ParaProps;
  rpr: RunProps;
}

interface Styles {
  defs: Map<string, StyleDef>;
  defaultPara: string | null;
  docP: ParaProps;
  docR: RunProps;
}

function readStyles(bytes: Uint8Array | undefined): Styles {
  const styles: Styles = { defs: new Map(), defaultPara: null, docP: {}, docR: {} };
  if (!bytes) return styles;
  let cur: StyleDef | null = null;
  let inDefaults = false;
  let inPPr = false;
  let inRPr = false;
  let skip = 0;
  for (const t of tokenizeXml(strFromU8(bytes))) {
    if (t.kind === 'text') continue;
    // Conditional table formatting and the latent style list hold w:pPr/w:rPr that do not belong to the style itself.
    if (t.name === 'w:tblStylePr' || t.name === 'w:latentStyles') {
      if (t.kind === 'open') skip++;
      else if (t.kind === 'close') skip--;
      continue;
    }
    if (skip > 0) continue;
    switch (t.name) {
      case 'w:docDefaults':
        inDefaults = t.kind === 'open';
        break;
      case 'w:style':
        if (t.kind !== 'open') {
          cur = null;
          break;
        }
        cur = { basedOn: null, kind: 'body', ppr: {}, rpr: {} };
        styles.defs.set(t.attrs['w:styleId'] ?? '', cur);
        if (t.attrs['w:type'] === 'paragraph' && flag(t.attrs['w:default'])) styles.defaultPara = t.attrs['w:styleId'] ?? null;
        break;
      case 'w:name':
        if (cur) cur.kind = styleFromName(t.attrs['w:val'] ?? '');
        break;
      case 'w:basedOn':
        if (cur) cur.basedOn = t.attrs['w:val'] ?? null;
        break;
      case 'w:pPr':
        inPPr = t.kind === 'open';
        break;
      case 'w:rPr':
        inRPr = t.kind === 'open';
        break;
      default: {
        const ppr = cur ? cur.ppr : inDefaults ? styles.docP : null;
        const rpr = cur ? cur.rpr : inDefaults ? styles.docR : null;
        if (inRPr && rpr) applyRun(rpr, t);
        else if (inPPr && ppr) applyPara(ppr, t);
        break;
      }
    }
  }
  return styles;
}

function styleFromName(name: string): ParaStyle {
  const n = name.toLowerCase().replace(/\s+/g, '');
  if (n === 'title') return 'title';
  const m = /^heading(\d)$/.exec(n);
  if (!m) return 'body';
  return m[1] === '1' ? 'h1' : m[1] === '2' ? 'h2' : 'h3';
}

function styleFromOutline(level: number | undefined): ParaStyle {
  if (level === undefined || level >= 9) return 'body';
  return level === 0 ? 'h1' : level === 1 ? 'h2' : 'h3';
}

const NO_STYLE: StyleDef = { basedOn: null, kind: 'body', ppr: {}, rpr: {} };

// Flattens a style with everything it inherits through w:basedOn.
function styleResolver(styles: Styles): (id: string | null) => StyleDef {
  const cache = new Map<string, StyleDef>();
  const resolve = (id: string | null, depth: number): StyleDef => {
    if (!id) return NO_STYLE;
    const hit = cache.get(id);
    if (hit) return hit;
    const def = styles.defs.get(id);
    if (!def || depth > 20) return { ...NO_STYLE, kind: styleFromName(id) };
    const base = resolve(def.basedOn, depth + 1);
    const out: StyleDef = {
      basedOn: null,
      kind: def.kind !== 'body' ? def.kind : base.kind !== 'body' ? base.kind : styleFromOutline(def.ppr.outline ?? base.ppr.outline),
      ppr: { ...base.ppr, ...def.ppr },
      rpr: { ...base.rpr, ...def.rpr },
    };
    cache.set(id, out);
    return out;
  };
  return (id) => resolve(id, 0);
}

interface Level {
  format: string;
  text: string | null;
  ppr: ParaProps;
}

interface Numbering {
  levels: Map<string, Level[]>;
}

function readNumbering(bytes: Uint8Array | undefined): Numbering {
  const abstract = new Map<string, Level[]>();
  const levels = new Map<string, Level[]>();
  if (!bytes) return { levels };
  let absId: string | null = null;
  let lvl: Level | null = null;
  let inPPr = false;
  let numId: string | null = null;
  for (const t of tokenizeXml(strFromU8(bytes))) {
    if (t.kind === 'text') continue;
    if (t.name === 'w:abstractNum' && t.kind === 'open') {
      absId = t.attrs['w:abstractNumId'] ?? null;
      if (absId) abstract.set(absId, []);
    } else if (t.name === 'w:abstractNum' && t.kind === 'close') absId = null;
    else if (t.name === 'w:lvl' && t.kind === 'open' && absId) {
      lvl = { format: 'bullet', text: null, ppr: {} };
      abstract.get(absId)![Number(t.attrs['w:ilvl'] ?? 0)] = lvl;
    } else if (t.name === 'w:lvl' && t.kind === 'close') lvl = null;
    else if (t.name === 'w:numFmt' && lvl) lvl.format = t.attrs['w:val'] ?? 'bullet';
    else if (t.name === 'w:lvlText' && lvl) lvl.text = t.attrs['w:val'] ?? null;
    else if (t.name === 'w:pPr') inPPr = t.kind === 'open';
    else if (lvl && inPPr) applyPara(lvl.ppr, t);
    else if (t.name === 'w:num' && t.kind === 'open') numId = t.attrs['w:numId'] ?? null;
    else if (t.name === 'w:abstractNumId' && numId) levels.set(numId, abstract.get(t.attrs['w:val'] ?? '') ?? []);
  }
  return { levels };
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

function spacing(style: ParaStyle): { before: number; after: number } {
  return style === 'body' ? { before: 0, after: 6 } : style === 'title' ? { before: 0, after: 12 } : { before: 10, after: 4 };
}

interface Draft {
  styleId: string;
  direct: ParaProps;
  inlines: Inline[];
}

function parseDocument(xml: string, styles: Styles, numbering: Numbering): { blocks: Block[]; page: Page } {
  const blocks: Block[] = [];
  const page: Page = { width: 595.28, height: 841.89, margin: { top: 72, right: 72, bottom: 72, left: 72 } };
  const counters = new Map<string, number[]>();
  const resolve = styleResolver(styles);

  // What a run looks like before its own formatting: document defaults, then the paragraph style.
  // Heading styles that set no size or weight still get one, so they stand out from body text.
  const baseRuns = new Map<string, RunProps>();
  const baseRun = (styleId: string): RunProps => {
    const hit = baseRuns.get(styleId);
    if (hit) return hit;
    const st = resolve(styleId);
    const heading = st.kind !== 'body';
    const r: RunProps = {
      ...styles.docR,
      ...st.rpr,
      size: st.rpr.size ?? (heading ? STYLE_SIZE[st.kind] : (styles.docR.size ?? BODY_SIZE)),
      bold: st.rpr.bold ?? (heading || !!styles.docR.bold),
    };
    baseRuns.set(styleId, r);
    return r;
  };

  const finish = (d: Draft): Para => {
    const st = resolve(d.styleId);
    const numId = d.direct.numId ?? st.ppr.numId;
    const level = d.direct.level ?? st.ppr.level ?? 0;
    const listed = numId !== undefined && numId !== '0';
    const lvl = listed ? numbering.levels.get(numId)?.[level] : undefined;
    const p: ParaProps = { ...styles.docP, ...st.ppr, ...lvl?.ppr, ...d.direct };
    const style = d.direct.outline !== undefined ? styleFromOutline(d.direct.outline) : st.kind;
    const marker = listed ? listMarker(numbering, counters, numId, level) : null;
    const gap = spacing(style);
    return {
      kind: 'para',
      styleId: d.styleId,
      style,
      align: p.align ?? 'left',
      before: p.before ?? gap.before,
      after: p.after ?? gap.after,
      line: p.line ?? 240,
      lineRule: p.lineRule ?? 'auto',
      left: p.left ?? (marker !== null ? 18 * (level + 1) : 0),
      right: p.right ?? 0,
      firstLine: p.firstLine ?? (marker !== null ? -14 : 0),
      contextual: !!p.contextual,
      pageBreak: !!p.pageBreak,
      size: baseRun(d.styleId).size ?? BODY_SIZE,
      marker,
      inlines: d.inlines,
    };
  };

  let skip = 0;
  let draft: Draft | null = null;
  // Text boxes put whole paragraphs inside a run of another paragraph.
  const outer: Draft[] = [];
  let inPPr = false;
  let inRPr = false;
  let inRun = false;
  let inText = false;
  let runStyle: string | null = null;
  let runDirect: RunProps = {};
  let run: (Omit<Span, 'kind' | 'text'> & { caps: boolean }) | null = null;
  let extent: { width: number; height: number } | null = null;
  let tblDepth = 0;
  let table: Table | null = null;
  let row: Para[][] | null = null;
  let cell: Para[] | null = null;

  const push = (inline: Inline) => draft?.inlines.push(inline);
  const runProps = () => {
    if (run) return run;
    const r: RunProps = { ...baseRun(draft?.styleId ?? ''), ...resolve(runStyle).rpr, ...runDirect };
    run = {
      bold: !!r.bold,
      italic: !!r.italic,
      underline: !!r.underline,
      caps: !!r.caps,
      size: r.size ?? BODY_SIZE,
      color: r.color && /^[0-9a-f]{6}$/i.test(r.color) ? r.color : null,
    };
    return run;
  };
  const span = (text: string): Span => {
    const { caps, ...rest } = runProps();
    return { kind: 'span', text: caps ? text.toUpperCase() : text, ...rest };
  };

  for (const t of tokenizeXml(xml)) {
    if (t.kind === 'text') {
      if (inText && skip === 0 && draft) push(span(t.text));
      continue;
    }
    if (SKIP.has(t.name)) {
      if (t.kind === 'open') skip++;
      else if (t.kind === 'close') skip--;
      continue;
    }
    if (skip > 0) continue;
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
          if (draft) outer.push(draft);
          draft = { styleId: styles.defaultPara ?? '', direct: {}, inlines: [] };
          inPPr = false;
        }
        if (t.kind === 'close' || t.kind === 'empty') {
          if (draft) {
            const para = finish(draft);
            if (cell) cell.push(para);
            else if (tblDepth === 0) blocks.push(para);
          }
          draft = outer.pop() ?? null;
        }
        break;
      case 'w:pPr':
        inPPr = t.kind === 'open';
        break;
      case 'w:rPr':
        inRPr = t.kind === 'open';
        break;
      case 'w:pStyle':
        if (draft && inPPr && !inRPr) draft.styleId = t.attrs['w:val'] ?? '';
        break;
      case 'w:rStyle':
        if (inRun && inRPr) {
          runStyle = t.attrs['w:val'] ?? null;
          run = null;
        }
        break;
      case 'w:r':
        inRun = t.kind === 'open';
        if (t.kind === 'open') {
          runStyle = null;
          runDirect = {};
          run = null;
        }
        break;
      case 'w:t':
        inText = t.kind === 'open';
        break;
      case 'w:tab':
        if (inRun && !inRPr) push(span('    '));
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
        if (target && draft) push({ kind: 'image', target, width: extent?.width ?? 0, height: extent?.height ?? 0 });
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
        if (inRun && inRPr) {
          applyRun(runDirect, t);
          run = null;
        } else if (draft && inPPr && !inRPr) applyPara(draft.direct, t);
        break;
    }
  }
  return { blocks, page };
}

function listMarker(numbering: Numbering, counters: Map<string, number[]>, numId: string, level: number): string {
  const levels = numbering.levels.get(numId) ?? [];
  const lvl = levels[level];
  const format = lvl?.format ?? 'bullet';
  if (format === 'none') return '';
  // Word bullets are usually private-use Symbol glyphs that Helvetica cannot draw.
  if (format === 'bullet') return lvl?.text && /^[-–*>]$/.test(lvl.text) ? lvl.text : '•';
  const c = counters.get(numId) ?? [];
  c[level] = (c[level] ?? 0) + 1;
  c.length = level + 1;
  counters.set(numId, c);
  const text = lvl?.text ?? `%${level + 1}.`;
  return text.replace(/%(\d)/g, (_, k: string) => {
    const i = Number(k) - 1;
    return formatNumber(c[i] ?? 1, levels[i]?.format ?? 'decimal');
  });
}

function formatNumber(n: number, format: string): string {
  switch (format) {
    case 'lowerLetter':
      return letters(n);
    case 'upperLetter':
      return letters(n).toUpperCase();
    case 'lowerRoman':
      return roman(n);
    case 'upperRoman':
      return roman(n).toUpperCase();
    default:
      return String(n);
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
  underline: boolean;
  color: string | null;
}

interface Line {
  pieces: Piece[];
  width: number;
  size: number;
  last: boolean;
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

const INK = rgb(0.1, 0.1, 0.1);

function ink(hex: string | null) {
  if (!hex) return INK;
  const n = parseInt(hex, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function lineHeight(para: Para, size: number): number {
  const natural = size * 1.2;
  if (para.lineRule === 'exact') return para.line / TWIPS_PER_PT;
  if (para.lineRule === 'atLeast') return Math.max(natural, para.line / TWIPS_PER_PT);
  return natural * (para.line / 240);
}

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

  // firstIndent shifts the first line only; negative values (hanging indents) widen it.
  const wrap = (spans: Span[], width: number, fallbackSize: number, firstIndent = 0): Line[] => {
    const lines: Line[] = [];
    let line: Line = { pieces: [], width: 0, size: 0, last: false };
    const room = () => width - (lines.length === 0 ? firstIndent : 0);
    const flush = () => {
      if (line.size === 0) line.size = fallbackSize;
      lines.push(line);
      line = { pieces: [], width: 0, size: 0, last: false };
    };
    for (const span of spans) {
      const { size, underline, color } = span;
      const font = fontFor(span.bold, span.italic);
      for (const word of clean(span.text).split(/(\s+)/)) {
        if (word === '') continue;
        const space = /^\s+$/.test(word);
        if (space && line.pieces.length === 0) continue;
        let w = font.widthOfTextAtSize(word, size);
        if (!space && line.width + w > room() && line.pieces.length > 0) {
          while (line.pieces.length > 0 && /^\s+$/.test(line.pieces[line.pieces.length - 1].text)) line.width -= line.pieces.pop()!.width;
          flush();
        }
        let rest = word;
        while (!space && w > room()) {
          let cut = rest.length - 1;
          while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > room() - line.width) cut--;
          const head = rest.slice(0, cut);
          const hw = font.widthOfTextAtSize(head, size);
          line.pieces.push({ text: head, font, size, width: hw, underline, color });
          line.width += hw;
          line.size = Math.max(line.size, size);
          flush();
          rest = rest.slice(cut);
          w = font.widthOfTextAtSize(rest, size);
        }
        line.pieces.push({ text: rest, font, size, width: w, underline, color });
        line.width += w;
        line.size = Math.max(line.size, size);
      }
    }
    if (line.pieces.length > 0 || lines.length === 0) flush();
    lines[lines.length - 1].last = true;
    return lines;
  };

  const drawLine = (target: PDFPage, line: Line, x: number, top: number, height: number, width: number, align: Align) => {
    const offset = align === 'center' ? (width - line.width) / 2 : align === 'right' ? width - line.width : 0;
    const gaps = align === 'justify' && !line.last ? line.pieces.filter((p) => /^\s+$/.test(p.text)).length : 0;
    const stretch = gaps > 0 ? Math.max(0, width - line.width) / gaps : 0;
    let cx = x + Math.max(0, offset);
    const baseline = top - height + line.size * 0.25;
    for (let i = 0; i < line.pieces.length; ) {
      const { font, size, underline, color } = line.pieces[i];
      let text = '';
      let w = 0;
      // Justified lines place every word on its own so the spaces between them can stretch.
      do {
        text += line.pieces[i].text;
        w += line.pieces[i].width;
        i++;
      } while (stretch === 0 && i < line.pieces.length && line.pieces[i].font === font && line.pieces[i].size === size && line.pieces[i].underline === underline && line.pieces[i].color === color);
      const blank = text.trim() === '';
      if (!blank) target.drawText(text, { x: cx, y: baseline, size, font, color: ink(color) });
      if (underline && !blank) target.drawLine({ start: { x: cx, y: baseline - size * 0.12 }, end: { x: cx + w, y: baseline - size * 0.12 }, thickness: Math.max(0.5, size * 0.05), color: ink(color) });
      cx += w + (blank ? stretch : 0);
    }
  };

  const drawPara = async (para: Para, before: number, after: number) => {
    if (para.pageBreak && pageHasContent) newPage();
    const left = Math.max(-page.margin.left, para.left);
    const x0 = page.margin.left + left;
    const width = contentW - left - Math.max(-page.margin.right, para.right);
    const marker = para.marker ? clean(para.marker) : '';
    const markerX = x0 + para.firstLine;
    // List text starts at the left indent, or just past the marker when the marker runs longer than the hanging indent.
    const firstIndent = para.marker !== null ? Math.max(0, markerX + fonts.regular.widthOfTextAtSize(marker, para.size) + 4 - x0) : para.firstLine;
    let spans: Span[] = [];
    let first = true;
    if (pageHasContent) y -= before;
    const flushSpans = () => {
      const lines = wrap(spans, width, para.size, first ? firstIndent : 0);
      for (const [i, line] of lines.entries()) {
        const h = lineHeight(para, line.size);
        ensure(h);
        const indent = first && i === 0 ? firstIndent : 0;
        if (first && marker) current.drawText(marker, { x: markerX, y: y - h + line.size * 0.25, size: para.size, font: fonts.regular, color: INK });
        first = false;
        drawLine(current, line, x0 + indent, y, h, width - indent, para.align);
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
        const x = para.align === 'center' ? page.margin.left + (contentW - w) / 2 : para.align === 'right' ? page.margin.left + contentW - w : Math.max(page.margin.left, x0);
        current.drawImage(img, { x, y: y - h, width: w, height: h });
        y -= h + 4;
        pageHasContent = true;
        first = false;
      }
    }
    if (spans.length > 0 || first) flushSpans();
    y -= after;
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
          return wrap(spans, w, p.size).map((line) => ({ line, align: p.align, h: lineHeight(p, line.size) }));
        });
      });
      const height = Math.max(BODY_SIZE * 1.25, ...cellLines.map((ls) => ls.reduce((a, l) => a + l.h, 0))) + pad * 2;
      ensure(height);
      let x = page.margin.left;
      for (let i = 0; i < cols; i++) {
        const w = widths[i] ?? widths[widths.length - 1];
        current.drawRectangle({ x, y: y - height, width: w, height, borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 0.5 });
        let top = y - pad;
        for (const { line, align, h } of cellLines[i] ?? []) {
          drawLine(current, line, x + pad, top, h, w - pad * 2, align);
          top -= h;
        }
        x += w;
      }
      y -= height;
      pageHasContent = true;
    }
    y -= 8;
  };

  // With contextual spacing, Word drops the gap between neighbouring paragraphs of the same style (list items, mostly).
  const sameStyle = (a: Para, b: Block | undefined) => b?.kind === 'para' && b.styleId === a.styleId;
  let paragraphs = 0;
  for (const [i, block] of blocks.entries()) {
    if (block.kind === 'para') {
      paragraphs++;
      const before = block.contextual && sameStyle(block, blocks[i - 1]) ? 0 : block.before;
      const after = block.contextual && sameStyle(block, blocks[i + 1]) ? 0 : block.after;
      await drawPara(block, before, after);
    } else drawTable(block);
  }
  if (!pageHasContent && doc.getPageCount() > 1) doc.removePage(doc.getPageCount() - 1);
  const bytes = await doc.save({ useObjectStreams: true });
  return { bytes, pages: doc.getPageCount(), paragraphs, images: imageCount, skippedImages, replacedChars };
}
