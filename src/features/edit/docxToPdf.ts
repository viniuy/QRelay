import { unzipSync, strFromU8 } from 'fflate';
import { concatTransformationMatrix, drawObject, PDFDocument, type PDFFont, type PDFPage, popGraphicsState, pushGraphicsState, rgb, StandardFonts } from 'pdf-lib';

import { readPng } from './imageBytes';

import { tokenizeXml, type XmlTag } from './xml';

type ParaStyle = 'title' | 'h1' | 'h2' | 'h3' | 'body';
type Align = 'left' | 'center' | 'right' | 'justify';
type LineRule = 'auto' | 'exact' | 'atLeast';
type Face = 'sans' | 'serif' | 'mono';
type Side = 'top' | 'bottom' | 'left' | 'right';
type Edge = Side | 'insideH' | 'insideV';

interface Border {
  width: number;
  color: string | null;
  space: number;
}

// A null edge is one the document switched off, which must win over the style underneath.
type Borders = Partial<Record<Edge, Border | null>>;

interface TabStop {
  pos: number;
  align: 'left' | 'center' | 'right' | 'decimal' | 'clear';
  leader: boolean;
}

// Formatting as Word stores it: every field is optional so style layers can be merged with spread.
interface RunProps {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  caps?: boolean;
  smallCaps?: boolean;
  vanish?: boolean;
  size?: number;
  color?: string;
  font?: string;
  vert?: 'super' | 'sub' | 'base';
  highlight?: string;
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
  borders?: Borders;
  shading?: string;
  tabs?: TabStop[];
}

interface Span {
  kind: 'span';
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  size: number;
  color: string | null;
  face: Face;
  scale: number;
  vert: 'super' | 'sub' | null;
  highlight: string | null;
  tab?: boolean;
  field?: 'page' | 'pages';
}

interface Float {
  hRel: string;
  hOff: number;
  hAlign: string | null;
  vRel: string;
  vOff: number;
  vAlign: string | null;
}

interface InlineImage {
  kind: 'image';
  path: string;
  width: number;
  height: number;
  float: Float | null;
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
  markSize: number;
  marker: string | null;
  markerFace: Face;
  borders: Borders;
  shading: string | null;
  tabs: TabStop[];
  inlines: Inline[];
}

interface Cell {
  paras: Para[];
  span: number;
  vMerge: 'restart' | 'continue' | null;
  fill: string | null;
  borders: Borders;
  vAlign: 'top' | 'center' | 'bottom';
}

interface Row {
  cells: Cell[];
  height: number;
  exact: boolean;
  header: boolean;
}

interface Table {
  kind: 'table';
  styleId: string | null;
  grid: number[];
  rows: Row[];
  borders: Borders;
  cellMar: Partial<Record<Side, number>>;
  align: 'left' | 'center' | 'right';
  indent: number;
}

type Block = Para | Table;

interface Page {
  width: number;
  height: number;
  margin: { top: number; right: number; bottom: number; left: number };
  header: number;
  footer: number;
}

interface Section {
  headers: Partial<Record<'default' | 'first', string>>;
  footers: Partial<Record<'default' | 'first', string>>;
  titlePg: boolean;
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
// Elements whose children (w:top, w:left, w:tab ...) mean different things depending on the parent.
const BOXES = new Set(['w:pBdr', 'w:tabs', 'w:tblBorders', 'w:tcBorders', 'w:tblCellMar', 'w:tcMar']);
const OFF = new Set(['0', 'false', 'off', 'none']);
const HIGHLIGHT: Record<string, string> = {
  yellow: 'FFFF00',
  green: '00FF00',
  cyan: '00FFFF',
  magenta: 'FF00FF',
  blue: '0000FF',
  red: 'FF0000',
  darkBlue: '000080',
  darkCyan: '008080',
  darkGreen: '008000',
  darkMagenta: '800080',
  darkRed: '800000',
  darkYellow: '808000',
  darkGray: '808080',
  lightGray: 'C0C0C0',
  black: '000000',
  white: 'FFFFFF',
};

const on = (attrs: Record<string, string>) => !OFF.has((attrs['w:val'] ?? '').toLowerCase());
const flag = (v: string | undefined) => v !== undefined && !OFF.has(v.toLowerCase());
const twips = (v: string | undefined) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? undefined : Number(v) / TWIPS_PER_PT);
const hex = (v: string | undefined) => (v && /^[0-9a-f]{6}$/i.test(v) ? v : null);

function side(name: string): Edge | null {
  switch (name) {
    case 'w:top':
    case 'w:bottom':
    case 'w:left':
    case 'w:right':
    case 'w:insideH':
    case 'w:insideV':
      return name.slice(2) as Edge;
    case 'w:start':
      return 'left';
    case 'w:end':
      return 'right';
    default:
      return null;
  }
}

function border(attrs: Record<string, string>): Border | null {
  const v = attrs['w:val'] ?? 'single';
  if (v === 'nil' || v === 'none') return null;
  return { width: Math.max(0.25, Number(attrs['w:sz'] ?? 4) / 8), color: hex(attrs['w:color']), space: Number(attrs['w:space'] ?? 0) };
}

export async function docxToPdf(input: Uint8Array, title?: string): Promise<DocxToPdfReport> {
  let zip: Record<string, Uint8Array>;
  try {
    zip = unzipSync(input);
  } catch {
    throw new DocxUnreadable('This is not a .docx file. Old .doc files need to be saved as .docx in Word first.');
  }
  const main = zip['word/document.xml'];
  if (!main) throw new DocxUnreadable('This file has no Word document inside.');
  const ctx: Context = {
    styles: readStyles(zip['word/styles.xml']),
    numbering: readNumbering(zip['word/numbering.xml']),
    theme: readTheme(zip['word/theme/theme1.xml']),
    defaultTab: readDefaultTab(zip['word/settings.xml']),
  };
  const body = parseDocument(strFromU8(main), ctx, readRels(zip['word/_rels/document.xml.rels']));
  const part = (path: string | undefined): Block[] => {
    const bytes = path ? zip[path] : undefined;
    if (!path || !bytes) return [];
    const name = path.slice(path.lastIndexOf('/') + 1);
    return parseDocument(strFromU8(bytes), ctx, readRels(zip[`word/_rels/${name}.rels`])).blocks;
  };
  const { headers, footers, titlePg } = body.section;
  const decor = {
    header: part(headers.default),
    footer: part(footers.default),
    firstHeader: titlePg ? part(headers.first) : null,
    firstFooter: titlePg ? part(footers.first) : null,
  };
  return layout(body.blocks, body.page, decor, ctx.defaultTab, zip, title);
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
    case 'w:smallCaps':
      r.smallCaps = on(t.attrs);
      break;
    case 'w:u':
      r.underline = on(t.attrs);
      break;
    case 'w:strike':
    case 'w:dstrike':
      r.strike = on(t.attrs);
      break;
    case 'w:vanish':
      r.vanish = on(t.attrs);
      break;
    case 'w:sz':
      if (v) r.size = Number(v) / 2;
      break;
    case 'w:color':
      if (v) r.color = v;
      break;
    case 'w:vertAlign':
      r.vert = v === 'superscript' ? 'super' : v === 'subscript' ? 'sub' : 'base';
      break;
    case 'w:highlight':
      if (v && HIGHLIGHT[v]) r.highlight = HIGHLIGHT[v];
      break;
    case 'w:shd': {
      const fill = hex(t.attrs['w:fill']);
      if (fill && fill.toUpperCase() !== 'FFFFFF') r.highlight = fill;
      break;
    }
    case 'w:rFonts': {
      const theme = t.attrs['w:asciiTheme'] ?? t.attrs['w:hAnsiTheme'];
      const name = t.attrs['w:ascii'] ?? t.attrs['w:hAnsi'];
      if (theme) r.font = theme.startsWith('major') ? '@major' : '@minor';
      else if (name) r.font = name;
      break;
    }
    default:
      break;
  }
}

function applyPara(p: ParaProps, t: XmlTag, box: string | null): void {
  const a = t.attrs;
  if (box === 'w:pBdr') {
    const s = side(t.name);
    if (s) p.borders = { ...p.borders, [s]: border(a) };
    return;
  }
  if (box === 'w:tabs') {
    if (t.name !== 'w:tab') return;
    const pos = twips(a['w:pos']);
    const val = a['w:val'];
    if (pos === undefined) return;
    const align = val === 'clear' ? 'clear' : val === 'right' || val === 'end' ? 'right' : val === 'center' ? 'center' : val === 'decimal' ? 'decimal' : 'left';
    p.tabs = [...(p.tabs ?? []), { pos, align, leader: a['w:leader'] === 'dot' || a['w:leader'] === 'middleDot' }];
    return;
  }
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
    case 'w:shd': {
      const fill = hex(a['w:fill']);
      if (fill) p.shading = fill;
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

interface TblProps {
  borders: Borders;
  cellMar: Partial<Record<Side, number>>;
}

interface StyleDef {
  basedOn: string | null;
  kind: ParaStyle;
  ppr: ParaProps;
  rpr: RunProps;
  tbl: TblProps;
}

interface Styles {
  defs: Map<string, StyleDef>;
  defaultPara: string | null;
  docP: ParaProps;
  docR: RunProps;
}

interface Context {
  styles: Styles;
  numbering: Numbering;
  theme: { major: string | null; minor: string | null };
  defaultTab: number;
}

function readStyles(bytes: Uint8Array | undefined): Styles {
  const styles: Styles = { defs: new Map(), defaultPara: null, docP: {}, docR: {} };
  if (!bytes) return styles;
  let cur: StyleDef | null = null;
  let inDefaults = false;
  let inPPr = false;
  let inRPr = false;
  let inTblPr = false;
  let box: string | null = null;
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
    if (BOXES.has(t.name)) {
      box = t.kind === 'open' ? t.name : null;
      continue;
    }
    switch (t.name) {
      case 'w:docDefaults':
        inDefaults = t.kind === 'open';
        break;
      case 'w:style':
        if (t.kind !== 'open') {
          cur = null;
          break;
        }
        cur = { basedOn: null, kind: 'body', ppr: {}, rpr: {}, tbl: { borders: {}, cellMar: {} } };
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
      case 'w:tblPr':
        inTblPr = t.kind === 'open';
        break;
      default: {
        const ppr = cur ? cur.ppr : inDefaults ? styles.docP : null;
        const rpr = cur ? cur.rpr : inDefaults ? styles.docR : null;
        if (inRPr && rpr) applyRun(rpr, t);
        else if (inPPr && ppr) applyPara(ppr, t, box);
        else if (inTblPr && cur) applyTable(cur.tbl, t, box);
        break;
      }
    }
  }
  return styles;
}

function applyTable(tbl: TblProps, t: XmlTag, box: string | null): void {
  const s = side(t.name);
  if (!s) return;
  if (box === 'w:tblBorders') tbl.borders[s] = border(t.attrs);
  else if (box === 'w:tblCellMar' && s !== 'insideH' && s !== 'insideV') {
    const w = twips(t.attrs['w:w']);
    if (w !== undefined) tbl.cellMar[s] = w;
  }
}

function readTheme(bytes: Uint8Array | undefined): Context['theme'] {
  const theme: Context['theme'] = { major: null, minor: null };
  if (!bytes) return theme;
  let which: 'major' | 'minor' | null = null;
  for (const t of tokenizeXml(strFromU8(bytes))) {
    if (t.kind === 'text') continue;
    if (t.name === 'a:majorFont' || t.name === 'a:minorFont') which = t.kind === 'open' ? (t.name === 'a:majorFont' ? 'major' : 'minor') : null;
    else if (t.name === 'a:latin' && which && theme[which] === null) theme[which] = t.attrs.typeface || null;
  }
  return theme;
}

function readDefaultTab(bytes: Uint8Array | undefined): number {
  if (!bytes) return 36;
  for (const t of tokenizeXml(strFromU8(bytes))) {
    if (t.kind !== 'text' && t.name === 'w:defaultTabStop') return Math.max(6, twips(t.attrs['w:val']) ?? 36);
  }
  return 36;
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

const NO_STYLE: StyleDef = { basedOn: null, kind: 'body', ppr: {}, rpr: {}, tbl: { borders: {}, cellMar: {} } };

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
      tbl: { borders: { ...base.tbl.borders, ...def.tbl.borders }, cellMar: { ...base.tbl.cellMar, ...def.tbl.cellMar } },
    };
    cache.set(id, out);
    return out;
  };
  return (id) => resolve(id, 0);
}

interface Level {
  format: string;
  text: string | null;
  start: number;
  ppr: ParaProps;
  rpr: RunProps;
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
  let inRPr = false;
  let box: string | null = null;
  let numId: string | null = null;
  for (const t of tokenizeXml(strFromU8(bytes))) {
    if (t.kind === 'text') continue;
    if (BOXES.has(t.name)) box = t.kind === 'open' ? t.name : null;
    else if (t.name === 'w:abstractNum' && t.kind === 'open') {
      absId = t.attrs['w:abstractNumId'] ?? null;
      if (absId) abstract.set(absId, []);
    } else if (t.name === 'w:abstractNum' && t.kind === 'close') absId = null;
    else if (t.name === 'w:lvl' && t.kind === 'open' && absId) {
      lvl = { format: 'bullet', text: null, start: 1, ppr: {}, rpr: {} };
      abstract.get(absId)![Number(t.attrs['w:ilvl'] ?? 0)] = lvl;
    } else if (t.name === 'w:lvl' && t.kind === 'close') lvl = null;
    else if (t.name === 'w:numFmt' && lvl) lvl.format = t.attrs['w:val'] ?? 'bullet';
    else if (t.name === 'w:lvlText' && lvl) lvl.text = t.attrs['w:val'] ?? null;
    else if (t.name === 'w:start' && lvl) lvl.start = Number(t.attrs['w:val'] ?? 1);
    else if (t.name === 'w:pPr') inPPr = t.kind === 'open';
    else if (t.name === 'w:rPr') inRPr = t.kind === 'open';
    else if (lvl && inPPr) applyPara(lvl.ppr, t, box);
    else if (lvl && inRPr) applyRun(lvl.rpr, t);
    else if (t.name === 'w:num' && t.kind === 'open') numId = t.attrs['w:numId'] ?? null;
    else if (t.name === 'w:abstractNumId' && numId) levels.set(numId, abstract.get(t.attrs['w:val'] ?? '') ?? []);
  }
  return { levels };
}

// Maps relationship ids to zip paths. Targets are relative to the word/ folder.
function readRels(bytes: Uint8Array | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!bytes) return out;
  for (const t of tokenizeXml(strFromU8(bytes))) {
    if (t.kind === 'text' || t.name !== 'Relationship') continue;
    const target = t.attrs.Target ?? '';
    if (t.attrs.TargetMode === 'External') continue;
    out.set(t.attrs.Id ?? '', target.startsWith('/') ? target.slice(1) : normalize(`word/${target}`));
  }
  return out;
}

function normalize(path: string): string {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (part === '..') out.pop();
    else if (part !== '.' && part !== '') out.push(part);
  }
  return out.join('/');
}

function spacing(style: ParaStyle): { before: number; after: number } {
  return style === 'body' ? { before: 0, after: 6 } : style === 'title' ? { before: 0, after: 12 } : { before: 10, after: 4 };
}

const MONO = /courier|consolas|mono|menlo|lucida console|source code|inconsolata/i;
const SERIF = /times|cambria|georgia|garamond|antiqua|palatino|century(?! gothic)|bookman|constantia|baskerville|bodoni|didot|minion|caslon|rockwell|sylfaen|perpetua|goudy|charter|serif|tinos|merriweather|lora|playfair|crimson|book/i;
// Helvetica is wider than Calibri and narrower than Georgia; scaling keeps line breaks close to Word's.
const WIDTH: [RegExp, number][] = [
  [/arial narrow/i, 0.82],
  [/calibri|carlito|candara|corbel/i, 0.9],
  [/segoe/i, 0.97],
  [/cambria|caladea/i, 1.05],
  [/georgia/i, 1.1],
  [/verdana|tahoma/i, 1.08],
];

function faceOf(family: string): { face: Face; scale: number } {
  const face: Face = MONO.test(family) ? 'mono' : /sans/i.test(family) ? 'sans' : SERIF.test(family) ? 'serif' : 'sans';
  return { face, scale: WIDTH.find(([re]) => re.test(family))?.[1] ?? 1 };
}

interface Draft {
  styleId: string;
  direct: ParaProps;
  markSize: number | undefined;
  inlines: Inline[];
}

interface Field {
  instr: string;
  result: boolean;
  kind: 'page' | 'pages' | null;
}

function parseDocument(xml: string, ctx: Context, rels: Map<string, string>): { blocks: Block[]; page: Page; section: Section } {
  const { styles, numbering, theme } = ctx;
  const blocks: Block[] = [];
  const page: Page = { width: 595.28, height: 841.89, margin: { top: 72, right: 72, bottom: 72, left: 72 }, header: 36, footer: 36 };
  const section: Section = { headers: {}, footers: {}, titlePg: false };
  const counters = new Map<string, number[]>();
  const resolve = styleResolver(styles);
  const family = (font: string | undefined) => (font === '@major' ? theme.major : font === '@minor' ? theme.minor : font) ?? 'Times New Roman';

  // What a run looks like before its own formatting: document defaults, the table style, then the paragraph style.
  // Heading styles that set no size or weight still get one, so they stand out from body text.
  const baseRuns = new Map<string, RunProps>();
  const baseRun = (styleId: string, tableStyle: string | null): RunProps => {
    const key = `${styleId}\u0000${tableStyle ?? ''}`;
    const hit = baseRuns.get(key);
    if (hit) return hit;
    const st = resolve(styleId);
    const heading = st.kind !== 'body';
    const r: RunProps = {
      ...styles.docR,
      ...resolve(tableStyle).rpr,
      ...st.rpr,
      size: st.rpr.size ?? (heading ? STYLE_SIZE[st.kind] : (resolve(tableStyle).rpr.size ?? styles.docR.size ?? BODY_SIZE)),
      bold: st.rpr.bold ?? (heading || !!styles.docR.bold),
    };
    baseRuns.set(key, r);
    return r;
  };

  const finish = (d: Draft, tableStyle: string | null): Para => {
    const st = resolve(d.styleId);
    const numId = d.direct.numId ?? st.ppr.numId;
    const level = d.direct.level ?? st.ppr.level ?? 0;
    const listed = numId !== undefined && numId !== '0';
    const lvl = listed ? numbering.levels.get(numId)?.[level] : undefined;
    const layers = [styles.docP, resolve(tableStyle).ppr, st.ppr, lvl?.ppr ?? {}, d.direct];
    const p: ParaProps = Object.assign({}, ...layers);
    const tabs: TabStop[] = [];
    for (const layer of layers) {
      for (const stop of layer.tabs ?? []) {
        const at = tabs.findIndex((s) => Math.abs(s.pos - stop.pos) < 0.5);
        if (at >= 0) tabs.splice(at, 1);
        if (stop.align !== 'clear') tabs.push(stop);
      }
    }
    tabs.sort((a, b) => a.pos - b.pos);
    const style = d.direct.outline !== undefined ? styleFromOutline(d.direct.outline) : st.kind;
    const marker = listed ? listMarker(numbering, counters, numId, level) : null;
    const gap = spacing(style);
    const size = baseRun(d.styleId, tableStyle).size ?? BODY_SIZE;
    const markerFont = family(lvl?.rpr.font ?? baseRun(d.styleId, tableStyle).font ?? styles.docR.font);
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
      size,
      markSize: d.markSize ?? size,
      marker,
      markerFace: /symbol|wingdings/i.test(markerFont) ? 'sans' : faceOf(markerFont).face,
      borders: p.borders ?? {},
      shading: p.shading && p.shading.toUpperCase() !== 'FFFFFF' ? p.shading : null,
      tabs,
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
  let inInstr = false;
  let box: string | null = null;
  let runStyle: string | null = null;
  let runDirect: RunProps = {};
  let run: Omit<Span, 'kind' | 'text'> & { caps: boolean; smallCaps: boolean; vanish: boolean } | null = null;
  let extent: { width: number; height: number } | null = null;
  let anchor: (Float & { wrapNone: boolean }) | null = null;
  let anchorAxis: 'h' | 'v' | null = null;
  let anchorText: 'offset' | 'align' | null = null;
  const fields: Field[] = [];
  let simpleField = 0;
  let tblDepth = 0;
  let table: Table | null = null;
  let row: Row | null = null;
  let cell: Cell | null = null;
  let inTblPr = false;
  let inTrPr = false;
  let inTcPr = false;

  const push = (inline: Inline) => draft?.inlines.push(inline);
  const runProps = () => {
    if (run) return run;
    const r: RunProps = { ...baseRun(draft?.styleId ?? '', table?.styleId ?? null), ...resolve(runStyle).rpr, ...runDirect };
    const { face, scale } = faceOf(family(r.font));
    run = {
      bold: !!r.bold,
      italic: !!r.italic,
      underline: !!r.underline,
      strike: !!r.strike,
      caps: !!r.caps,
      smallCaps: !!r.smallCaps,
      vanish: !!r.vanish,
      size: r.size ?? BODY_SIZE,
      color: hex(r.color),
      face,
      scale,
      vert: r.vert === 'super' || r.vert === 'sub' ? r.vert : null,
      highlight: r.highlight ?? null,
    };
    return run;
  };
  // Result text of a PAGE or NUMPAGES field is replaced when the page is drawn.
  const hidingField = () => simpleField > 0 || fields.some((f) => f.result && f.kind !== null);
  const span = (text: string, extra: Partial<Span> = {}) => {
    const { caps, smallCaps, vanish, ...rest } = runProps();
    if (vanish) return;
    push({ kind: 'span', text: caps || smallCaps ? text.toUpperCase() : text, ...rest, ...(smallCaps ? { size: rest.size * 0.8 } : {}), ...extra });
  };
  const fieldKind = (instr: string) => {
    const m = /^\s*(PAGE|NUMPAGES|SECTIONPAGES)\b/i.exec(instr);
    return m ? (m[1].toUpperCase() === 'PAGE' ? 'page' : 'pages') : null;
  };

  for (const t of tokenizeXml(xml)) {
    if (t.kind === 'text') {
      if (skip > 0) continue;
      if (inInstr && fields.length > 0) fields[fields.length - 1].instr += t.text;
      else if (anchor && anchorAxis && anchorText) {
        if (anchorText === 'offset') anchor[anchorAxis === 'h' ? 'hOff' : 'vOff'] = Number(t.text) / EMU_PER_PT || 0;
        else anchor[anchorAxis === 'h' ? 'hAlign' : 'vAlign'] = t.text.trim();
      } else if (inText && draft && !hidingField()) span(t.text);
      continue;
    }
    if (SKIP.has(t.name)) {
      if (t.kind === 'open') skip++;
      else if (t.kind === 'close') skip--;
      continue;
    }
    if (skip > 0) continue;
    if (BOXES.has(t.name)) {
      box = t.kind === 'open' ? t.name : null;
      continue;
    }
    switch (t.name) {
      case 'w:tbl':
        if (t.kind === 'open') {
          tblDepth++;
          if (tblDepth === 1) table = { kind: 'table', styleId: null, grid: [], rows: [], borders: {}, cellMar: {}, align: 'left', indent: 0 };
        } else if (t.kind === 'close') {
          if (tblDepth === 1 && table) {
            const st = resolve(table.styleId).tbl;
            const grid = !styles.defs.has(table.styleId ?? '') && /grid/i.test(table.styleId ?? '');
            const line: Border = { width: 0.5, color: null, space: 0 };
            const fallback: Borders = grid ? { top: line, bottom: line, left: line, right: line, insideH: line, insideV: line } : {};
            table.borders = { ...fallback, ...st.borders, ...table.borders };
            table.cellMar = { ...st.cellMar, ...table.cellMar };
            blocks.push(table);
            table = null;
          }
          tblDepth--;
        }
        break;
      case 'w:tblPr':
        if (tblDepth === 1) inTblPr = t.kind === 'open';
        break;
      case 'w:trPr':
        if (tblDepth === 1) inTrPr = t.kind === 'open';
        break;
      case 'w:tcPr':
        if (tblDepth === 1) inTcPr = t.kind === 'open';
        break;
      case 'w:gridCol':
        if (tblDepth === 1 && table) table.grid.push(Number(t.attrs['w:w'] ?? 0) / TWIPS_PER_PT);
        break;
      case 'w:tr':
        if (tblDepth !== 1 || !table) break;
        if (t.kind === 'open') row = { cells: [], height: 0, exact: false, header: false };
        else if (t.kind === 'close' && row) {
          table.rows.push(row);
          row = null;
        }
        break;
      case 'w:tc':
        if (tblDepth !== 1 || !row) break;
        if (t.kind === 'open') cell = { paras: [], span: 1, vMerge: null, fill: null, borders: {}, vAlign: 'top' };
        else if (t.kind === 'close' && cell) {
          row.cells.push(cell);
          cell = null;
        }
        break;
      case 'w:p':
        if (t.kind === 'open' || t.kind === 'empty') {
          if (draft) outer.push(draft);
          draft = { styleId: styles.defaultPara ?? '', direct: {}, markSize: undefined, inlines: [] };
          inPPr = false;
        }
        if (t.kind === 'close' || t.kind === 'empty') {
          if (draft) {
            const para = finish(draft, table?.styleId ?? null);
            if (cell) cell.paras.push(para);
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
      case 'w:instrText':
        inInstr = t.kind === 'open';
        break;
      case 'w:fldChar': {
        const type = t.attrs['w:fldCharType'];
        if (type === 'begin') fields.push({ instr: '', result: false, kind: null });
        else if (type === 'separate' && fields.length > 0) {
          const f = fields[fields.length - 1];
          f.result = true;
          f.kind = fieldKind(f.instr);
          if (f.kind && draft) span('1', { field: f.kind });
        } else if (type === 'end') {
          const f = fields.pop();
          if (f && !f.result && fieldKind(f.instr) && draft) span('1', { field: fieldKind(f.instr)! });
        }
        break;
      }
      case 'w:fldSimple': {
        const kind = fieldKind(t.attrs['w:instr'] ?? '');
        if (!kind) break;
        if (t.kind !== 'close' && draft) span('1', { field: kind });
        if (t.kind === 'open') simpleField++;
        else if (t.kind === 'close') simpleField--;
        break;
      }
      case 'w:tab':
        if (inPPr) {
          if (draft) applyPara(draft.direct, t, box);
        } else if (inRun && !inRPr && !hidingField()) span('\t', { tab: true });
        break;
      case 'w:noBreakHyphen':
        if (inRun) span('-');
        break;
      case 'w:br':
      case 'w:cr':
        if (inRun) push({ kind: 'break', page: t.attrs['w:type'] === 'page' });
        break;
      case 'wp:anchor':
        anchor = t.kind === 'open' ? { hRel: 'column', hOff: 0, hAlign: null, vRel: 'paragraph', vOff: 0, vAlign: null, wrapNone: false } : null;
        break;
      case 'wp:positionH':
      case 'wp:positionV':
        if (!anchor) break;
        anchorAxis = t.kind === 'open' ? (t.name === 'wp:positionH' ? 'h' : 'v') : null;
        if (anchorAxis) anchor[anchorAxis === 'h' ? 'hRel' : 'vRel'] = t.attrs.relativeFrom ?? '';
        break;
      case 'wp:posOffset':
      case 'wp:align':
        anchorText = t.kind === 'open' ? (t.name === 'wp:posOffset' ? 'offset' : 'align') : null;
        break;
      case 'wp:wrapNone':
        if (anchor) anchor.wrapNone = true;
        break;
      case 'wp:extent':
        extent = { width: Number(t.attrs.cx ?? 0) / EMU_PER_PT, height: Number(t.attrs.cy ?? 0) / EMU_PER_PT };
        break;
      case 'a:blip':
      case 'v:imagedata': {
        const rid = t.attrs['r:embed'] ?? t.attrs['r:id'];
        const path = rid ? rels.get(rid) : undefined;
        if (path && draft) {
          const float = anchor?.wrapNone ? { hRel: anchor.hRel, hOff: anchor.hOff, hAlign: anchor.hAlign, vRel: anchor.vRel, vOff: anchor.vOff, vAlign: anchor.vAlign } : null;
          push({ kind: 'image', path, width: extent?.width ?? 0, height: extent?.height ?? 0, float });
        }
        extent = null;
        break;
      }
      case 'w:headerReference':
      case 'w:footerReference': {
        const type = t.attrs['w:type'];
        const path = rels.get(t.attrs['r:id'] ?? '');
        if (path && (type === 'default' || type === 'first')) section[t.name === 'w:headerReference' ? 'headers' : 'footers'][type] = path;
        break;
      }
      case 'w:titlePg':
        section.titlePg = on(t.attrs);
        break;
      case 'w:pgSz':
        if (t.attrs['w:w'] && t.attrs['w:h']) {
          page.width = Number(t.attrs['w:w']) / TWIPS_PER_PT;
          page.height = Number(t.attrs['w:h']) / TWIPS_PER_PT;
        }
        break;
      case 'w:pgMar':
        page.margin = {
          top: Math.max(18, Math.abs(Number(t.attrs['w:top'] ?? 1440)) / TWIPS_PER_PT),
          right: Math.max(18, Number(t.attrs['w:right'] ?? 1440) / TWIPS_PER_PT),
          bottom: Math.max(18, Math.abs(Number(t.attrs['w:bottom'] ?? 1440)) / TWIPS_PER_PT),
          left: Math.max(18, Number(t.attrs['w:left'] ?? 1440) / TWIPS_PER_PT),
        };
        page.header = Number(t.attrs['w:header'] ?? 720) / TWIPS_PER_PT;
        page.footer = Number(t.attrs['w:footer'] ?? 720) / TWIPS_PER_PT;
        break;
      default:
        if (inRun && inRPr) {
          applyRun(runDirect, t);
          run = null;
        } else if (draft && inPPr) {
          if (!inRPr) applyPara(draft.direct, t, box);
          else if (t.name === 'w:sz' && t.attrs['w:val']) draft.markSize = Number(t.attrs['w:val']) / 2;
        } else if (inTcPr && cell) applyCell(cell, t, box);
        else if (inTrPr && row) {
          if (t.name === 'w:trHeight') {
            row.height = twips(t.attrs['w:val']) ?? 0;
            row.exact = t.attrs['w:hRule'] === 'exact';
          } else if (t.name === 'w:tblHeader') row.header = on(t.attrs);
        } else if (inTblPr && table) {
          if (t.name === 'w:tblStyle') table.styleId = t.attrs['w:val'] ?? null;
          else if (t.name === 'w:jc') table.align = t.attrs['w:val'] === 'center' ? 'center' : t.attrs['w:val'] === 'right' || t.attrs['w:val'] === 'end' ? 'right' : 'left';
          else if (t.name === 'w:tblInd') table.indent = twips(t.attrs['w:w']) ?? 0;
          else applyTable(table, t, box);
        }
        break;
    }
  }
  return { blocks, page, section };
}

function applyCell(cell: Cell, t: XmlTag, box: string | null): void {
  const s = side(t.name);
  if (box === 'w:tcBorders' && s) {
    cell.borders[s] = border(t.attrs);
    return;
  }
  switch (t.name) {
    case 'w:gridSpan':
      cell.span = Math.max(1, Number(t.attrs['w:val'] ?? 1));
      break;
    case 'w:vMerge':
      cell.vMerge = t.attrs['w:val'] === 'restart' ? 'restart' : 'continue';
      break;
    case 'w:shd': {
      const fill = hex(t.attrs['w:fill']);
      if (fill && fill.toUpperCase() !== 'FFFFFF') cell.fill = fill;
      break;
    }
    case 'w:vAlign':
      cell.vAlign = t.attrs['w:val'] === 'center' ? 'center' : t.attrs['w:val'] === 'bottom' ? 'bottom' : 'top';
      break;
    default:
      break;
  }
}

function listMarker(numbering: Numbering, counters: Map<string, number[]>, numId: string, level: number): string {
  const levels = numbering.levels.get(numId) ?? [];
  const lvl = levels[level];
  const format = lvl?.format ?? 'bullet';
  if (format === 'none') return '';
  // Word bullets are usually private-use Symbol glyphs that Helvetica cannot draw.
  if (format === 'bullet') return lvl?.text && /^[-–*>]$/.test(lvl.text) ? lvl.text : '•';
  const c = counters.get(numId) ?? [];
  c[level] = (c[level] ?? (lvl?.start ?? 1) - 1) + 1;
  c.length = level + 1;
  counters.set(numId, c);
  const text = lvl?.text ?? `%${level + 1}.`;
  return text.replace(/%(\d)/g, (_, k: string) => {
    const i = Number(k) - 1;
    return formatNumber(c[i] ?? levels[i]?.start ?? 1, levels[i]?.format ?? 'decimal');
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
    case 'decimalZero':
      return String(n).padStart(2, '0');
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

interface Picture {
  width: number;
  height: number;
  draw: (page: PDFPage, x: number, y: number, width: number, height: number) => void;
}

type FontSet = Record<Face, [PDFFont, PDFFont, PDFFont, PDFFont]>;

interface Piece {
  text: string;
  font: PDFFont;
  size: number;
  em: number;
  width: number;
  underline: boolean;
  strike: boolean;
  color: string | null;
  highlight: string | null;
  rise: number;
  tab: boolean;
  leader: boolean;
  peso: boolean;
}

interface Line {
  pieces: Piece[];
  width: number;
  size: number;
  last: boolean;
}

interface Box {
  x: number;
  width: number;
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
  ' ': ' ',
};

const INK = rgb(0.1, 0.1, 0.1);
// The standard fonts have no peso sign, so it is drawn as a P with two bars instead of a question mark.
const PESO = '\u20b1';
const FACES: Record<Face, [StandardFonts, StandardFonts, StandardFonts, StandardFonts]> = {
  sans: [StandardFonts.Helvetica, StandardFonts.HelveticaBold, StandardFonts.HelveticaOblique, StandardFonts.HelveticaBoldOblique],
  serif: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold, StandardFonts.TimesRomanItalic, StandardFonts.TimesRomanBoldItalic],
  mono: [StandardFonts.Courier, StandardFonts.CourierBold, StandardFonts.CourierOblique, StandardFonts.CourierBoldOblique],
};

function ink(hexColor: string | null) {
  if (!hexColor) return INK;
  const n = parseInt(hexColor, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function lineHeight(para: Para, size: number): number {
  const natural = size * 1.2;
  if (para.lineRule === 'exact') return para.line / TWIPS_PER_PT;
  if (para.lineRule === 'atLeast') return Math.max(natural, para.line / TWIPS_PER_PT);
  return natural * (para.line / 240);
}

interface Decor {
  header: Block[];
  footer: Block[];
  firstHeader: Block[] | null;
  firstFooter: Block[] | null;
}

async function layout(blocks: Block[], page: Page, decor: Decor, defaultTab: number, zip: Record<string, Uint8Array>, title?: string): Promise<DocxToPdfReport> {
  const doc = await PDFDocument.create();
  if (title) doc.setTitle(title);
  doc.setCreator('QRelay');
  const embedded = await Promise.all((Object.keys(FACES) as Face[]).map(async (face) => [face, await Promise.all(FACES[face].map((f) => doc.embedFont(f)))] as const));
  const fonts = Object.fromEntries(embedded) as FontSet;
  const charset = new Set(fonts.sans[0].getCharacterSet());
  let replacedChars = 0;
  const clean = (s: string) => {
    let out = '';
    for (const ch of s) {
      const sub = SUBSTITUTE[ch];
      if (sub !== undefined) out += sub;
      else if (charset.has(ch.codePointAt(0)!) || ch === PESO) out += ch;
      else {
        out += '?';
        replacedChars++;
      }
    }
    return out;
  };

  const images = new Map<string, Picture | null>();
  let imageCount = 0;
  let skippedImages = 0;
  const loadImage = async (path: string): Promise<Picture | null> => {
    if (images.has(path)) return images.get(path)!;
    const data = zip[path];
    let pic: Picture | null = null;
    const png = data ? readPng(data) : null;
    if (png && png.depth === 8 && (png.colorType === 0 || png.colorType === 2) && !png.interlaced) {
      // Plain PNG rows are what a Flate stream with a PNG predictor holds, so the data goes in without decoding.
      const colors = png.colorType === 0 ? 1 : 3;
      const stream = doc.context.stream(png.idat, {
        Type: 'XObject',
        Subtype: 'Image',
        Width: png.width,
        Height: png.height,
        ColorSpace: colors === 1 ? 'DeviceGray' : 'DeviceRGB',
        BitsPerComponent: 8,
        Filter: 'FlateDecode',
        DecodeParms: { Predictor: 15, Colors: colors, BitsPerComponent: 8, Columns: png.width },
      });
      const ref = doc.context.register(stream);
      pic = {
        width: png.width,
        height: png.height,
        draw: (target, x, at, w, h) => target.pushOperators(pushGraphicsState(), concatTransformationMatrix(w, 0, 0, h, x, at), drawObject(target.node.newXObject('Im', ref)), popGraphicsState()),
      };
    } else {
      const img = png ? await doc.embedPng(data!).catch(() => null) : data && data[0] === 0xff && data[1] === 0xd8 ? await doc.embedJpg(data).catch(() => null) : null;
      if (img) pic = { width: img.width, height: img.height, draw: (target, x, at, w, h) => target.drawImage(img, { x, y: at, width: w, height: h }) };
    }
    images.set(path, pic);
    return pic;
  };

  const contentW = page.width - page.margin.left - page.margin.right;
  const contentH = page.height - page.margin.top - page.margin.bottom;
  const body: Box = { x: page.margin.left, width: contentW };
  let current: PDFPage = doc.addPage([page.width, page.height]);
  let y = page.height - page.margin.top;
  let pageHasContent = false;
  // Pages are only added while laying out the body; headers, footers and table cells draw into a fixed place.
  let flow = true;
  let dry = false;
  let fieldPage = 1;
  let fieldTotal = 0;
  const bottom = page.margin.bottom;
  const newPage = () => {
    current = doc.addPage([page.width, page.height]);
    y = page.height - page.margin.top;
    pageHasContent = false;
  };
  const ensure = (h: number) => {
    if (flow && y - h < bottom && pageHasContent) newPage();
  };

  const fontFor = (face: Face, bold: boolean, italic: boolean) => fonts[face][(bold ? 1 : 0) + (italic ? 2 : 0)];
  const fieldText = (s: Span) => {
    if (!s.field) return s.text;
    if (s.field === 'page') return String(flow ? doc.getPageCount() : fieldPage);
    return fieldTotal > 0 ? String(fieldTotal) : s.text;
  };

  // firstIndent shifts the first line only; negative values (hanging indents) widen it.
  // indent is where the box starts relative to the margin, which is what tab stops are measured from.
  const wrap = (spans: Span[], width: number, fallbackSize: number, firstIndent: number, tabs: TabStop[], indent: number): Line[] => {
    const lines: Line[] = [];
    let line: Line = { pieces: [], width: 0, size: 0, last: false };
    const room = () => width - (lines.length === 0 ? firstIndent : 0);
    const flush = () => {
      if (line.size === 0) line.size = fallbackSize;
      lines.push(line);
      line = { pieces: [], width: 0, size: 0, last: false };
    };
    const look = (s: Span) => {
      const size = s.vert ? s.size * 0.65 : s.size;
      return { font: fontFor(s.face, s.bold, s.italic), size: size * s.scale, rise: s.vert === 'super' ? s.size * 0.33 : s.vert === 'sub' ? -s.size * 0.14 : 0 };
    };
    const texts = spans.map((s) => (s.tab ? '' : clean(fieldText(s))));
    // How much text follows each tab up to the next one, for right and centre stops.
    const following = spans.map((s, i) => {
      if (!s.tab) return 0;
      let w = 0;
      for (let k = i + 1; k < spans.length && !spans[k].tab; k++) {
        const { font, size } = look(spans[k]);
        w += font.widthOfTextAtSize(texts[k].replaceAll(PESO, 'P'), size);
      }
      return w;
    });
    for (const [i, span] of spans.entries()) {
      const { underline, strike, color, highlight } = span;
      const { font, size, rise } = look(span);
      const em = span.size;
      if (span.tab) {
        const at = indent + (lines.length === 0 ? firstIndent : 0) + line.width;
        const implicit = firstIndent < 0 && lines.length === 0 ? [{ pos: indent, align: 'left' as const, leader: false }] : [];
        const stop = [...implicit, ...tabs].find((s) => s.pos > at + 0.5) ?? { pos: (Math.floor(at / defaultTab) + 1) * defaultTab, align: 'left' as const, leader: false };
        // The half point of slack keeps right-aligned text from wrapping on rounding.
        let w = stop.pos - at - (stop.align === 'right' ? following[i] + 0.5 : stop.align === 'center' ? following[i] / 2 : 0);
        w = Math.max(stop.align === 'right' || stop.align === 'center' ? 0 : 1, Math.min(w, room() - line.width));
        line.pieces.push({ text: '', font, size, em, width: w, underline: false, strike: false, color, highlight: null, rise: 0, tab: true, leader: stop.leader, peso: false });
        line.width += w;
        line.size = Math.max(line.size, em);
        continue;
      }
      for (const part of texts[i].split(/(\s+|\u20b1)/)) {
        if (part === '') continue;
        const peso = part === PESO;
        const word = peso ? 'P' : part;
        const space = /^\s+$/.test(word);
        if (space && line.pieces.length === 0) continue;
        let w = font.widthOfTextAtSize(word, size);
        const glued = line.pieces[line.pieces.length - 1]?.peso ?? false;
        if (!space && !glued && line.width + w > room() && line.pieces.length > 0) {
          while (line.pieces.length > 0 && /^\s+$/.test(line.pieces[line.pieces.length - 1].text)) line.width -= line.pieces.pop()!.width;
          flush();
        }
        let rest = word;
        while (!space && w > room()) {
          let cut = rest.length - 1;
          while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > room() - line.width) cut--;
          const head = rest.slice(0, cut);
          const hw = font.widthOfTextAtSize(head, size);
          line.pieces.push({ text: head, font, size, em, width: hw, underline, strike, color, highlight, rise, tab: false, leader: false, peso: false });
          line.width += hw;
          line.size = Math.max(line.size, em);
          flush();
          rest = rest.slice(cut);
          w = font.widthOfTextAtSize(rest, size);
        }
        line.pieces.push({ text: rest, font, size, em, width: w, underline, strike, color, highlight, rise, tab: false, leader: false, peso });
        line.width += w;
        line.size = Math.max(line.size, em);
      }
    }
    if (line.pieces.length > 0 || lines.length === 0) flush();
    lines[lines.length - 1].last = true;
    return lines;
  };

  const drawLine = (line: Line, x: number, top: number, height: number, width: number, align: Align) => {
    const offset = align === 'center' ? (width - line.width) / 2 : align === 'right' ? width - line.width : 0;
    const tabbed = line.pieces.some((p) => p.tab);
    const gaps = align === 'justify' && !line.last && !tabbed ? line.pieces.filter((p) => /^\s+$/.test(p.text)).length : 0;
    const stretch = gaps > 0 ? Math.max(0, width - line.width) / gaps : 0;
    let cx = x + Math.max(0, offset);
    const baseline = top - height + line.size * 0.25;
    for (let i = 0; i < line.pieces.length; ) {
      const first = line.pieces[i];
      const { font, size, underline, strike, color, highlight, rise } = first;
      let text = '';
      let w = 0;
      // Justified lines place every word on its own so the spaces between them can stretch.
      do {
        text += line.pieces[i].text;
        w += line.pieces[i].width;
        i++;
      } while (!first.tab && !first.peso && stretch === 0 && i < line.pieces.length && !line.pieces[i].tab && !line.pieces[i].peso && line.pieces[i].font === font && line.pieces[i].size === size && line.pieces[i].underline === underline && line.pieces[i].strike === strike && line.pieces[i].color === color && line.pieces[i].highlight === highlight && line.pieces[i].rise === rise);
      const blank = text.trim() === '';
      if (first.tab) {
        if (first.leader && !dry) {
          // Dots are placed one by one so viewers that swap in their own Helvetica still line them up.
          const pitch = font.widthOfTextAtSize('. ', size);
          for (let dx = cx + w - pitch * 1.5; dx > cx + pitch * 0.5; dx -= pitch) current.drawText('.', { x: dx, y: baseline, size, font, color: ink(color) });
        }
        cx += w;
        continue;
      }
      if (!dry) {
        if (highlight) current.drawRectangle({ x: cx, y: baseline - size * 0.22, width: w + (blank ? stretch : 0), height: size * 1.12, color: ink(highlight) });
        if (!blank) current.drawText(text, { x: cx, y: baseline + rise, size, font, color: ink(color) });
        const thickness = Math.max(0.5, size * 0.05);
        if (first.peso) {
          for (const h of [0.45, 0.57]) current.drawLine({ start: { x: cx - size * 0.06, y: baseline + rise + size * h }, end: { x: cx + w * 0.92, y: baseline + rise + size * h }, thickness: thickness * 0.9, color: ink(color) });
        }
        if (underline && !blank) current.drawLine({ start: { x: cx, y: baseline - size * 0.12 }, end: { x: cx + w, y: baseline - size * 0.12 }, thickness, color: ink(color) });
        if (strike && !blank) current.drawLine({ start: { x: cx, y: baseline + rise + size * 0.3 }, end: { x: cx + w, y: baseline + rise + size * 0.3 }, thickness, color: ink(color) });
      }
      cx += w + (blank ? stretch : 0);
    }
  };

  const rule = (b: Border, x: number, at: number, w: number) => {
    if (!dry) current.drawLine({ start: { x, y: at }, end: { x: x + w, y: at }, thickness: b.width, color: ink(b.color) });
  };

  const drawFloat = (img: Picture, inline: InlineImage, paraTop: number, area: Box) => {
    const f = inline.float!;
    const w = inline.width > 0 ? inline.width : img.width * 0.75;
    const h = inline.height > 0 ? inline.height : img.height * 0.75;
    const [hx, hw] = f.hRel === 'page' ? [0, page.width] : f.hRel === 'margin' || f.hRel === 'column' ? [page.margin.left, contentW] : [area.x, area.width];
    const x = f.hAlign === 'center' ? hx + (hw - w) / 2 : f.hAlign === 'right' ? hx + hw - w : hx + (f.hAlign === 'left' ? 0 : f.hOff);
    const [vy, vh] = f.vRel === 'page' ? [page.height, page.height] : f.vRel === 'margin' || f.vRel === 'topMargin' ? [page.height - page.margin.top, contentH] : [paraTop, 0];
    const top = f.vAlign === 'center' ? vy - (vh - h) / 2 : f.vAlign === 'bottom' ? vy - vh + h : vy - (f.vAlign === 'top' ? 0 : f.vOff);
    if (!dry) img.draw(current, x, top - h, w, h);
  };

  const drawPara = async (para: Para, area: Box, before: number, after: number) => {
    if (flow && para.pageBreak && pageHasContent) newPage();
    const left = Math.max(area === body ? -page.margin.left : 0, para.left);
    const x0 = area.x + left;
    const width = area.width - left - Math.max(area === body ? -page.margin.right : 0, para.right);
    const marker = para.marker ? clean(para.marker) : '';
    const markerFont = fonts[para.markerFace][0];
    const markerX = x0 + para.firstLine;
    // List text starts at the left indent, or just past the marker when the marker runs longer than the hanging indent.
    const firstIndent = para.marker !== null ? Math.max(0, markerX + markerFont.widthOfTextAtSize(marker, para.size) + 4 - x0) : para.firstLine;
    const { top: topBorder, bottom: bottomBorder } = para.borders;
    if (!flow || pageHasContent) y -= before;
    if (para.shading && !dry) {
      const h = await measure(() => drawPara({ ...para, shading: null, pageBreak: false }, area, 0, 0));
      ensure(h);
      current.drawRectangle({ x: x0 - 2, y: y - h, width: width + 4, height: h, color: ink(para.shading) });
    }
    if (topBorder) {
      ensure(topBorder.width + topBorder.space + para.size * 1.2);
      rule(topBorder, x0, y - topBorder.width / 2, width);
      y -= topBorder.width + topBorder.space;
    }
    const paraTop = y;
    let spans: Span[] = [];
    let first = true;
    const flushSpans = () => {
      const lines = wrap(spans, width, spans.length > 0 ? para.size : para.markSize, first ? firstIndent : 0, para.tabs, left);
      for (const [i, line] of lines.entries()) {
        const h = lineHeight(para, line.size);
        ensure(h);
        const indent = first && i === 0 ? firstIndent : 0;
        if (first && marker && !dry) current.drawText(marker, { x: markerX, y: y - h + line.size * 0.25, size: para.size, font: markerFont, color: INK });
        first = false;
        drawLine(line, x0 + indent, y, h, width - indent, para.align);
        y -= h;
        if (flow) pageHasContent = true;
      }
      spans = [];
    };
    for (const inline of para.inlines) {
      if (inline.kind === 'span') spans.push(inline);
      else if (inline.kind === 'break') {
        // A page break that opens a paragraph leaves no empty line behind on the old page.
        if (!(inline.page && first && spans.length === 0)) flushSpans();
        if (inline.page && flow && pageHasContent) newPage();
      } else {
        const img = await loadImage(inline.path);
        if (!img) {
          if (!dry) skippedImages++;
          continue;
        }
        if (!dry) imageCount++;
        if (inline.float) {
          drawFloat(img, inline, paraTop, area);
          continue;
        }
        if (spans.some((s) => s.text.trim() !== '')) flushSpans();
        else spans = [];
        let w = inline.width > 0 ? inline.width : img.width * 0.75;
        let h = inline.height > 0 ? inline.height : img.height * 0.75;
        const scale = Math.min(1, width / w, contentH / h);
        w *= scale;
        h *= scale;
        ensure(h);
        const x = para.align === 'center' ? x0 + (width - w) / 2 : para.align === 'right' ? x0 + width - w : x0;
        if (!dry) img.draw(current, x, y - h, w, h);
        y -= h + 2;
        if (flow) pageHasContent = true;
        first = false;
      }
    }
    if (spans.length > 0 || first) flushSpans();
    if (bottomBorder) {
      y -= bottomBorder.space;
      rule(bottomBorder, x0, y - bottomBorder.width / 2, width);
      y -= bottomBorder.width;
    }
    y -= after;
  };

  const measure = async (draw: () => Promise<void>) => {
    const start = y;
    const was = { dry, flow };
    dry = true;
    flow = false;
    await draw();
    ({ dry, flow } = was);
    const h = start - y;
    y = start;
    return h;
  };

  // With contextual spacing, Word drops the gap between neighbouring paragraphs of the same style (list items, mostly).
  const sameStyle = (a: Para, b: Block | undefined) => b?.kind === 'para' && b.styleId === a.styleId;
  const drawParas = async (list: Para[], area: Box) => {
    for (const [i, para] of list.entries()) {
      const before = para.contextual && sameStyle(para, list[i - 1]) ? 0 : para.before;
      const after = para.contextual && sameStyle(para, list[i + 1]) ? 0 : para.after;
      await drawPara(para, area, before, after);
    }
  };

  const drawTable = async (table: Table, area: Box) => {
    const cols = Math.max(table.grid.length, ...table.rows.map((r) => r.cells.reduce((a, c) => a + c.span, 0)), 1);
    const gridSum = table.grid.slice(0, cols).reduce((a, b) => a + b, 0);
    const widths = table.grid.length >= cols && gridSum > 0 ? table.grid.slice(0, cols).map((g) => g * Math.min(1, area.width / gridSum)) : Array.from({ length: cols }, () => area.width / cols);
    const tableW = widths.reduce((a, b) => a + b, 0);
    const left = table.align === 'center' ? area.x + (area.width - tableW) / 2 : table.align === 'right' ? area.x + area.width - tableW : area.x + Math.max(-page.margin.left, table.indent);
    const mar = { top: table.cellMar.top ?? 0, bottom: table.cellMar.bottom ?? 0, left: table.cellMar.left ?? 5.4, right: table.cellMar.right ?? 5.4 };
    const starts = (r: Row) => {
      let col = 0;
      return r.cells.map((c) => {
        const at = col;
        col += c.span;
        return at;
      });
    };
    const columns = table.rows.map(starts);
    const cellBox = (col: number, span: number): Box => {
      const x = left + widths.slice(0, col).reduce((a, b) => a + b, 0);
      const w = widths.slice(col, col + span).reduce((a, b) => a + b, 0) || widths[widths.length - 1];
      return { x, width: w };
    };
    const headers = table.rows.filter((r, i) => r.header && table.rows.slice(0, i).every((p) => p.header));

    const drawRow = async (r: Row, ri: number, repeat: boolean) => {
      const heights: number[] = [];
      for (const [ci, c] of r.cells.entries()) {
        const b = cellBox(columns[ri][ci], c.span);
        heights.push(c.vMerge === 'continue' ? 0 : mar.top + mar.bottom + (await measure(() => drawParas(c.paras, { x: b.x + mar.left, width: b.width - mar.left - mar.right }))));
      }
      const content = Math.max(BODY_SIZE * 0.5, ...heights);
      const height = r.exact && r.height > 0 ? r.height : Math.max(r.height, content);
      if (flow && y - height < bottom && pageHasContent) {
        newPage();
        if (!repeat) for (const h of headers) await drawRow(h, table.rows.indexOf(h), true);
      }
      const top = y;
      const wasFlow = flow;
      flow = false;
      for (const [ci, c] of r.cells.entries()) {
        const col = columns[ri][ci];
        const b = cellBox(col, c.span);
        if (c.fill && !dry) current.drawRectangle({ x: b.x, y: top - height, width: b.width, height, color: ink(c.fill) });
        if (c.vMerge !== 'continue') {
          const free = height - heights[ci];
          y = top - mar.top - (c.vAlign === 'center' ? free / 2 : c.vAlign === 'bottom' ? free : 0);
          await drawParas(c.paras, { x: b.x + mar.left, width: b.width - mar.left - mar.right });
        }
        const last = col + c.span >= cols;
        const below = table.rows[ri + 1];
        const merged = below?.cells.some((n, ni) => n.vMerge === 'continue' && columns[ri + 1][ni] === col);
        const edge = (s: Side, shared: Border | null | undefined) => (s in c.borders ? c.borders[s] : shared) ?? null;
        const topB = c.vMerge === 'continue' ? null : edge('top', ri === 0 || repeat ? table.borders.top : table.borders.insideH);
        const bottomB = merged ? null : edge('bottom', ri === table.rows.length - 1 ? table.borders.bottom : table.borders.insideH);
        const leftB = edge('left', col === 0 ? table.borders.left : table.borders.insideV);
        const rightB = edge('right', last ? table.borders.right : table.borders.insideV);
        if (!dry) {
          const line = (bd: Border | null | undefined, x1: number, y1: number, x2: number, y2: number) => {
            if (bd) current.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: bd.width, color: ink(bd.color) });
          };
          line(topB, b.x, top, b.x + b.width, top);
          line(bottomB, b.x, top - height, b.x + b.width, top - height);
          line(leftB, b.x, top, b.x, top - height);
          line(rightB, b.x + b.width, top, b.x + b.width, top - height);
        }
      }
      flow = wasFlow;
      y = top - height;
      if (flow) pageHasContent = true;
    };
    for (const [ri, r] of table.rows.entries()) await drawRow(r, ri, false);
  };

  const drawBlocks = async (list: Block[], area: Box) => {
    for (let i = 0; i < list.length; ) {
      const block = list[i];
      if (block.kind === 'table') {
        await drawTable(block, area);
        i++;
        continue;
      }
      let j = i;
      while (j < list.length && list[j].kind === 'para') j++;
      await drawParas(list.slice(i, j) as Para[], area);
      i = j;
    }
  };

  const paragraphs = blocks.filter((b) => b.kind === 'para').length;
  await drawBlocks(blocks, body);
  if (!pageHasContent && doc.getPageCount() > 1) doc.removePage(doc.getPageCount() - 1);

  flow = false;
  fieldTotal = doc.getPageCount();
  for (let i = 0; i < fieldTotal; i++) {
    current = doc.getPage(i);
    fieldPage = i + 1;
    const header = i === 0 && decor.firstHeader ? decor.firstHeader : decor.header;
    const footer = i === 0 && decor.firstFooter ? decor.firstFooter : decor.footer;
    if (header.length > 0) {
      y = page.height - page.header;
      await drawBlocks(header, body);
    }
    if (footer.length > 0) {
      y = 0;
      const h = await measure(() => drawBlocks(footer, body));
      y = page.footer + h;
      await drawBlocks(footer, body);
    }
  }

  const bytes = await doc.save({ useObjectStreams: true });
  return { bytes, pages: doc.getPageCount(), paragraphs, images: imageCount, skippedImages, replacedChars };
}
