import { inflateSync, unzlibSync } from 'fflate';
import { PDFArray, PDFBool, PDFDict, PDFDocument, PDFName, PDFNumber, PDFObject, PDFRawStream, PDFRef, PDFStream } from 'pdf-lib';

import { type LevelSpec, pngFromScanlines, type Recoder } from './imageBytes';

export interface PdfCompressReport {
  bytes: Uint8Array;
  images: number;
  recoded: number;
  resized: number;
}

export type PdfProgress = (done: number, total: number) => void;

const MIN_PIXELS = 40_000;

const N = {
  Subtype: PDFName.of('Subtype'),
  Image: PDFName.of('Image'),
  Width: PDFName.of('Width'),
  Height: PDFName.of('Height'),
  BitsPerComponent: PDFName.of('BitsPerComponent'),
  ColorSpace: PDFName.of('ColorSpace'),
  Filter: PDFName.of('Filter'),
  DecodeParms: PDFName.of('DecodeParms'),
  Decode: PDFName.of('Decode'),
  ImageMask: PDFName.of('ImageMask'),
  SMask: PDFName.of('SMask'),
  Mask: PDFName.of('Mask'),
  Predictor: PDFName.of('Predictor'),
  Colors: PDFName.of('Colors'),
  Columns: PDFName.of('Columns'),
  DCTDecode: PDFName.of('DCTDecode'),
  FlateDecode: PDFName.of('FlateDecode'),
  DeviceRGB: PDFName.of('DeviceRGB'),
  DeviceGray: PDFName.of('DeviceGray'),
  DeviceCMYK: PDFName.of('DeviceCMYK'),
  CalRGB: PDFName.of('CalRGB'),
  CalGray: PDFName.of('CalGray'),
  ICCBased: PDFName.of('ICCBased'),
  N: PDFName.of('N'),
};

export async function compressPdf(input: Uint8Array, spec: LevelSpec, recode: Recoder, onProgress?: PdfProgress): Promise<PdfCompressReport> {
  const doc = await PDFDocument.load(input, { ignoreEncryption: true, updateMetadata: false });
  const ctx = doc.context;
  const objects = ctx.enumerateIndirectObjects();

  const masks = new Set<string>();
  for (const [, obj] of objects) {
    if (!(obj instanceof PDFStream)) continue;
    for (const key of [N.SMask, N.Mask]) {
      const ref = obj.dict.get(key);
      if (ref instanceof PDFRef) masks.add(ref.toString());
    }
  }

  const candidates: [PDFRef, PDFRawStream][] = [];
  for (const [ref, obj] of objects) {
    if (!(obj instanceof PDFRawStream)) continue;
    if (obj.dict.lookup(N.Subtype) !== N.Image) continue;
    if (masks.has(ref.toString())) continue;
    candidates.push([ref, obj]);
  }

  let images = 0;
  let recoded = 0;
  let resized = 0;
  for (let i = 0; i < candidates.length; i++) {
    const [ref, stream] = candidates[i];
    onProgress?.(i, candidates.length);
    const source = sourceFor(stream);
    if (source === null) continue;
    images++;
    try {
      const out = await recode(source.bytes, source.ext, spec);
      if (out.bytes.length >= stream.contents.length) continue;
      const colorSpace = out.components === 1 ? N.DeviceGray : out.components === 3 ? N.DeviceRGB : out.components === 4 ? N.DeviceCMYK : null;
      if (colorSpace === null) continue;
      const dict = stream.dict;
      dict.set(N.Width, PDFNumber.of(out.width));
      dict.set(N.Height, PDFNumber.of(out.height));
      dict.set(N.BitsPerComponent, PDFNumber.of(8));
      dict.set(N.ColorSpace, colorSpace);
      dict.set(N.Filter, N.DCTDecode);
      dict.delete(N.DecodeParms);
      dict.delete(N.Decode);
      ctx.assign(ref, PDFRawStream.of(dict, out.bytes));
      recoded++;
      if (out.resized) resized++;
    } catch {
    }
  }
  onProgress?.(candidates.length, candidates.length);

  const bytes = await doc.save({ useObjectStreams: true, updateFieldAppearances: false });
  return { bytes, images, recoded, resized };
}

interface ImageSource {
  bytes: Uint8Array;
  ext: 'jpg' | 'png';
}

function sourceFor(stream: PDFRawStream): ImageSource | null {
  const dict = stream.dict;
  const stencil = dict.lookup(N.ImageMask);
  if (stencil instanceof PDFBool && stencil.asBoolean()) return null;
  if (dict.has(N.Mask) || dict.has(N.Decode)) return null;
  const width = numberAt(dict, N.Width);
  const height = numberAt(dict, N.Height);
  if (width === null || height === null || width * height < MIN_PIXELS) return null;
  const filters = namesOf(dict.lookup(N.Filter));
  if (filters.length !== 1) return null;
  const channels = channelsOf(dict.lookup(N.ColorSpace));
  if (channels === null) return null;

  if (filters[0] === N.DCTDecode) return { bytes: stream.contents, ext: 'jpg' };

  if (filters[0] === N.FlateDecode) {
    if (numberAt(dict, N.BitsPerComponent) !== 8) return null;
    if (channels !== 1 && channels !== 3) return null;
    const parms = dict.lookup(N.DecodeParms);
    const predictor = parms instanceof PDFDict ? (numberAt(parms, N.Predictor) ?? 1) : 1;
    const raw = inflate(stream.contents);
    if (raw === null) return null;
    const rowBytes = width * channels;
    if (predictor >= 10) {
      const colors = parms instanceof PDFDict ? (numberAt(parms, N.Colors) ?? 1) : 1;
      const columns = parms instanceof PDFDict ? (numberAt(parms, N.Columns) ?? 1) : 1;
      if (colors !== channels || columns !== width || raw.length !== (rowBytes + 1) * height) return null;
      return { bytes: pngFromScanlines(raw, width, height, channels), ext: 'png' };
    }
    if (predictor !== 1 || raw.length !== rowBytes * height) return null;
    const lines = new Uint8Array((rowBytes + 1) * height);
    for (let r = 0; r < height; r++) lines.set(raw.subarray(r * rowBytes, (r + 1) * rowBytes), r * (rowBytes + 1) + 1);
    return { bytes: pngFromScanlines(lines, width, height, channels), ext: 'png' };
  }
  return null;
}

function inflate(data: Uint8Array): Uint8Array | null {
  try {
    return unzlibSync(data);
  } catch {
    try {
      return inflateSync(data);
    } catch {
      return null;
    }
  }
}

function numberAt(dict: PDFDict, key: PDFName): number | null {
  const v = dict.lookup(key);
  return v instanceof PDFNumber ? v.asNumber() : null;
}

function namesOf(v: PDFObject | undefined): PDFName[] {
  if (v instanceof PDFName) return [v];
  if (v instanceof PDFArray) {
    const out: PDFName[] = [];
    for (let i = 0; i < v.size(); i++) {
      const item = v.lookup(i);
      if (item instanceof PDFName) out.push(item);
    }
    return out;
  }
  return [];
}

function channelsOf(v: PDFObject | undefined): 1 | 3 | 4 | null {
  if (v === N.DeviceGray || v === N.CalGray) return 1;
  if (v === N.DeviceRGB || v === N.CalRGB) return 3;
  if (v === N.DeviceCMYK) return 4;
  if (v instanceof PDFArray && v.size() >= 1) {
    const family = v.lookup(0);
    if (family === N.CalGray) return 1;
    if (family === N.CalRGB) return 3;
    if (family === N.ICCBased && v.size() >= 2) {
      const profile = v.lookup(1);
      const n = profile instanceof PDFStream ? numberAt(profile.dict, N.N) : null;
      return n === 1 || n === 3 || n === 4 ? n : null;
    }
  }
  return null;
}
