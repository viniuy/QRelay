import { PDFDocument, PDFName, PDFNumber, PDFRawStream } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { jpegInfo, type LevelSpec, pngFromScanlines, type Recoder } from '../src/features/edit/imageBytes';
import { compressPdf } from '../src/features/edit/pdfCompress';

function jpegStub(width: number, height: number, components: number, padding = 0): Uint8Array {
  const sof = [0xff, 0xc0, 0x00, 8 + 3 * components, 8, height >> 8, height & 0xff, width >> 8, width & 0xff, components];
  for (let i = 0; i < components; i++) sof.push(i + 1, 0x11, 0);
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const pad = Array.from({ length: padding }, (_, i) => i & 0x7f);
  const body = padding > 0 ? [0xff, 0xfe, (padding + 2) >> 8, (padding + 2) & 0xff, ...pad] : [];
  return Uint8Array.from([0xff, 0xd8, ...app0, ...sof, ...body, 0xff, 0xd9]);
}

const spec: LevelSpec = { maxEdge: 200, quality: 0.6 };

const fakeRecode: Recoder = async (source, ext, s) => {
  const info = ext === 'jpg' ? jpegInfo(source as Uint8Array) : pngSize(source as Uint8Array);
  if (info === null) throw new Error('not decodable');
  const resized = Math.max(info.width, info.height) > s.maxEdge;
  const w = resized ? Math.round(info.width / 2) : info.width;
  const h = resized ? Math.round(info.height / 2) : info.height;
  const bytes = jpegStub(w, h, 3, 40);
  return { bytes, width: w, height: h, components: 3, resized };
};

function pngSize(png: Uint8Array): { width: number; height: number } {
  const u32 = (p: number) => ((png[p] << 24) | (png[p + 1] << 16) | (png[p + 2] << 8) | png[p + 3]) >>> 0;
  return { width: u32(16), height: u32(20) };
}

async function images(bytes: Uint8Array): Promise<PDFRawStream[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.context
    .enumerateIndirectObjects()
    .map(([, o]) => o)
    .filter((o): o is PDFRawStream => o instanceof PDFRawStream && o.dict.lookup(PDFName.of('Subtype')) === PDFName.of('Image'));
}

describe('jpegInfo', () => {
  it('reads the frame header and rejects other bytes', () => {
    expect(jpegInfo(jpegStub(640, 480, 3))).toEqual({ width: 640, height: 480, components: 3 });
    expect(jpegInfo(jpegStub(10, 20, 1, 100))).toEqual({ width: 10, height: 20, components: 1 });
    expect(jpegInfo(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
  });
});

describe('pngFromScanlines', () => {
  it('writes a PNG pdf-lib can embed', async () => {
    const w = 300;
    const h = 200;
    const lines = new Uint8Array((w * 3 + 1) * h);
    for (let r = 0; r < h; r++) for (let x = 0; x < w; x++) lines.set([x & 0xff, r & 0xff, 128], r * (w * 3 + 1) + 1 + x * 3);
    const png = pngFromScanlines(lines, w, h, 3);
    const doc = await PDFDocument.create();
    const img = await doc.embedPng(png);
    expect(img.width).toBe(w);
    expect(img.height).toBe(h);
  });
});

describe('compressPdf', () => {
  it('re-encodes a large JPEG and a Flate image, leaves small ones and masks alone', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([600, 800]);
    const big = await doc.embedJpg(jpegStub(1600, 1200, 3, 5000));
    const small = await doc.embedJpg(jpegStub(100, 100, 3, 3000));
    const w = 400;
    const h = 300;
    const rgba = new Uint8Array((w * 4 + 1) * h);
    for (let r = 0; r < h; r++) for (let x = 0; x < w; x++) rgba.set([x & 0xff, r & 0xff, 64, 200], r * (w * 4 + 1) + 1 + x * 4);
    const pngWithAlpha = pngWithAlphaFrom(rgba, w, h);
    const flat = await doc.embedPng(pngWithAlpha);
    page.drawImage(big, { x: 0, y: 0, width: 600, height: 450 });
    page.drawImage(small, { x: 0, y: 500, width: 50, height: 50 });
    page.drawImage(flat, { x: 100, y: 500, width: 200, height: 150 });
    const input = await doc.save({ useObjectStreams: false });

    const before = await images(input);
    expect(before).toHaveLength(4);

    const report = await compressPdf(input, spec, fakeRecode);
    expect(report.images).toBe(2);
    expect(report.recoded).toBe(2);
    expect(report.resized).toBe(2);
    expect(report.bytes.length).toBeLessThan(input.length);

    const after = await images(report.bytes);
    expect(after).toHaveLength(4);
    const byFilter = (name: string) => after.filter((s) => s.dict.lookup(PDFName.of('Filter')) === PDFName.of(name));
    const jpegs = byFilter('DCTDecode');
    const flates = byFilter('FlateDecode');
    expect(jpegs).toHaveLength(3);
    expect(flates).toHaveLength(1);
    const widths = jpegs.map((s) => (s.dict.lookup(PDFName.of('Width')) as PDFNumber).asNumber()).sort((a, b) => a - b);
    expect(widths).toEqual([100, 200, 800]);
    for (const s of jpegs) {
      expect(s.dict.lookup(PDFName.of('ColorSpace'))).toBe(PDFName.of('DeviceRGB'));
      expect(jpegInfo(s.contents)).not.toBeNull();
    }
    const mask = flates[0];
    expect(mask.dict.lookup(PDFName.of('ColorSpace'))).toBe(PDFName.of('DeviceGray'));
    expect((mask.dict.lookup(PDFName.of('Width')) as PDFNumber).asNumber()).toBe(400);
  });

  it('keeps an image the recoder cannot shrink', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([600, 800]);
    const img = await doc.embedJpg(jpegStub(1600, 1200, 3, 10));
    page.drawImage(img, { x: 0, y: 0, width: 600, height: 450 });
    const input = await doc.save({ useObjectStreams: false });
    const report = await compressPdf(input, spec, fakeRecode);
    expect(report.images).toBe(1);
    expect(report.recoded).toBe(0);
    const after = await images(report.bytes);
    expect((after[0].dict.lookup(PDFName.of('Width')) as PDFNumber).asNumber()).toBe(1600);
  });
});

function pngWithAlphaFrom(lines: Uint8Array, width: number, height: number): Uint8Array {
  const png = pngFromScanlines(lines, width, height, 3);
  png[8 + 8 + 9] = 6;
  const crcAt = 8 + 8 + 13;
  const crc = crc32(png, 8 + 4, crcAt);
  png[crcAt] = (crc >>> 24) & 0xff;
  png[crcAt + 1] = (crc >>> 16) & 0xff;
  png[crcAt + 2] = (crc >>> 8) & 0xff;
  png[crcAt + 3] = crc & 0xff;
  return png;
}

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}
