import { PDFDocument } from 'pdf-lib';

import { mimeFor, type PickedFile, pickFiles } from '../../files/files';
import { type CompressLevel, IMAGE_LEVELS, PDF_LEVELS, recodeToJpeg } from './imageCodec';
import { compressPdf } from './pdfCompress';

export type EditOp = 'merge' | 'compress' | 'pdfToWord' | 'wordToPdf' | 'imageToPdf' | 'imageToWord';

export interface EditOpInfo {
  id: EditOp;
  label: string;
  hint: string;
  action: string;
  accepts: (mime: string) => boolean;
  available: boolean;
  why?: string;
}

const isImage = (mime: string) => mime.startsWith('image/');
const isPdf = (mime: string) => mime === 'application/pdf';
const isWord = (mime: string) => mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || mime === 'application/msword';

export const EDIT_OPS: readonly EditOpInfo[] = [
  { id: 'compress', label: 'Compress', hint: 'Smaller file, fewer frames', action: 'Compress', accepts: (m) => isImage(m) || isPdf(m), available: true },
  { id: 'merge', label: 'Merge PDFs', hint: 'Add PDFs after this one', action: 'Pick the PDFs to add', accepts: isPdf, available: true },
  { id: 'imageToPdf', label: 'Image to PDF', hint: 'One A4 page', action: 'Make a PDF', accepts: isImage, available: true },
  { id: 'pdfToWord', label: 'PDF to Word', hint: 'Text, headings, images', action: 'Convert to Word', accepts: isPdf, available: false, why: 'Not in this build yet' },
  { id: 'wordToPdf', label: 'Word to PDF', hint: 'Fixed layout, any device', action: 'Convert to PDF', accepts: isWord, available: false, why: 'Not in this build yet' },
  { id: 'imageToWord', label: 'Image to Word', hint: 'Reads the text (OCR)', action: 'Read the text', accepts: isImage, available: false, why: 'Not in this build yet' },
];

export function opsFor(mime: string): EditOpInfo[] {
  const fit = EDIT_OPS.filter((o) => o.accepts(mime));
  return [...fit.filter((o) => o.available), ...fit.filter((o) => !o.available)];
}

export interface EditOptions {
  level: CompressLevel;
}

export interface EditResult {
  file: PickedFile;
  line: string;
  delta: string;
  note: string;
  before: number;
}

export class EditNotReady extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EditNotReady';
  }
}

export type EditProgress = (step: string, progress: number) => void;

const A4 = { w: 595.28, h: 841.89 };
const MARGIN_MM = 12;
const PT_PER_MM = 72 / 25.4;

export async function runEdit(op: EditOp, input: PickedFile, options: EditOptions, onProgress?: EditProgress): Promise<EditResult | null> {
  const info = EDIT_OPS.find((o) => o.id === op)!;
  if (!info.accepts(input.mime)) throw new EditNotReady(`${info.label} does not apply to this file.`);
  if (!info.available) throw new EditNotReady(`${info.label} needs the full build with the document engine.`);
  switch (op) {
    case 'imageToPdf':
      return imageToPdf(input, onProgress);
    case 'compress':
      return isPdf(input.mime) ? compressPdfFile(input, options.level, onProgress) : compressImage(input, options.level, onProgress);
    case 'merge': {
      onProgress?.('Choosing files', 0.05);
      const picked = await pickFiles({ mimeTypes: 'application/pdf' });
      if (picked.kind !== 'picked') return null;
      return mergePdfs([input, ...picked.files], onProgress);
    }
    default:
      throw new EditNotReady(`${info.label} needs the full build with the document engine.`);
  }
}

async function imageToPdf(input: PickedFile, onProgress?: EditProgress): Promise<EditResult> {
  onProgress?.('Reading image', 0.15);
  const doc = await PDFDocument.create();
  doc.setTitle(stem(input.name));
  doc.setCreator('QRelay');
  let bytes = input.bytes;
  let mime = input.mime;
  if (mime !== 'image/png' && mime !== 'image/jpeg') {
    const jpeg = await recodeToJpeg(input.bytes, ext(input.name) || 'img', { maxEdge: 4096, quality: 0.9 });
    bytes = jpeg.bytes;
    mime = 'image/jpeg';
  }
  const image = mime === 'image/png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  onProgress?.('Fitting to A4', 0.5);
  const margin = MARGIN_MM * PT_PER_MM;
  const box = { w: A4.w - margin * 2, h: A4.h - margin * 2 };
  const scale = Math.min(box.w / image.width, box.h / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  const page = doc.addPage([A4.w, A4.h]);
  page.drawImage(image, { x: (A4.w - w) / 2, y: (A4.h - h) / 2, width: w, height: h });
  onProgress?.('Writing PDF', 0.85);
  const out = await doc.save({ useObjectStreams: true });
  onProgress?.('Done', 1);
  return {
    file: { name: `${stem(input.name)}.pdf`, mime: 'application/pdf', bytes: out },
    line: '1 image → 1 page',
    delta: 'A4',
    note: 'Fitted inside 12 mm margins. The image bytes are untouched.',
    before: input.bytes.length,
  };
}

export async function mergePdfs(sources: PickedFile[], onProgress?: EditProgress): Promise<EditResult> {
  const first = sources[0];
  const out = await PDFDocument.create();
  out.setTitle(stem(first.name));
  out.setCreator('QRelay');
  let pages = 0;
  for (let i = 0; i < sources.length; i++) {
    onProgress?.(`Copying ${sources[i].name}`, 0.1 + (0.75 * i) / sources.length);
    const src = await PDFDocument.load(sources[i].bytes, { ignoreEncryption: true });
    const copied = await out.copyPages(src, src.getPageIndices());
    for (const p of copied) out.addPage(p);
    pages += copied.length;
  }
  onProgress?.('Writing PDF', 0.9);
  const bytes = await out.save({ useObjectStreams: true });
  onProgress?.('Done', 1);
  return {
    file: { name: `${stem(first.name)}-merged.pdf`, mime: 'application/pdf', bytes },
    line: `${sources.length} files → 1 PDF`,
    delta: `${pages} pages`,
    note: `${sources.map((s) => s.name).join(', ')}, in that order.`,
    before: sources.reduce((a, s) => a + s.bytes.length, 0),
  };
}

async function compressImage(input: PickedFile, level: CompressLevel, onProgress?: EditProgress): Promise<EditResult> {
  const spec = IMAGE_LEVELS[level];
  onProgress?.('Re-encoding', 0.3);
  const out = await recodeToJpeg(input.uri ?? input.bytes, ext(input.name) || 'img', spec);
  onProgress?.('Done', 1);
  const before = input.bytes.length;
  const after = out.bytes.length;
  const grew = after >= before;
  return {
    file: grew ? input : { name: `${stem(input.name)}.jpg`, mime: 'image/jpeg', bytes: out.bytes },
    line: `${kb(before)} → ${kb(grew ? before : after)}`,
    delta: grew ? '0%' : `−${pct(before, after)}%`,
    note: grew
      ? 'It was already small; re-encoding would have made it larger, so the original is kept.'
      : `JPEG at quality ${Math.round(spec.quality * 100)}${out.resized ? `, longest edge ${spec.maxEdge} px` : ''}, EXIF removed.`,
    before,
  };
}

async function compressPdfFile(input: PickedFile, level: CompressLevel, onProgress?: EditProgress): Promise<EditResult> {
  const spec = PDF_LEVELS[level];
  onProgress?.('Reading PDF', 0.05);
  const report = await compressPdf(input.bytes, spec, recodeToJpeg, (done, total) => {
    onProgress?.(total === 0 ? 'No images inside' : `Image ${Math.min(done + 1, total)} of ${total}`, 0.1 + (0.8 * done) / Math.max(1, total));
  });
  onProgress?.('Done', 1);
  const before = input.bytes.length;
  const after = report.bytes.length;
  const grew = after >= before;
  const note = grew
    ? 'Nothing inside it compresses further, so the original is kept.'
    : report.recoded === 0
      ? report.images === 0
        ? 'No images inside; the file structure was re-saved with compressed object streams.'
        : `The ${report.images === 1 ? 'image' : `${report.images} images`} inside ${report.images === 1 ? 'was' : 'were'} already small enough; only the file structure was re-saved.`
      : `${report.recoded} of ${report.images} images re-encoded as JPEG at quality ${Math.round(spec.quality * 100)}${report.resized > 0 ? `, longest edge ${spec.maxEdge} px` : ''}. Text, vectors and fonts untouched.`;
  return {
    file: grew ? input : { name: input.name, mime: 'application/pdf', bytes: report.bytes },
    line: `${kb(before)} → ${kb(grew ? before : after)}`,
    delta: grew ? '0%' : `−${pct(before, after)}%`,
    note,
    before,
  };
}

function stem(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? name : name.slice(0, dot);
}

function ext(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}

function kb(b: number): string {
  return b >= 1024 * 1024 ? `${(b / (1024 * 1024)).toFixed(2)} MB` : `${(b / 1024).toFixed(1)} KB`;
}

function pct(before: number, after: number): number {
  return Math.round((1 - after / before) * 100);
}

export { mimeFor };
