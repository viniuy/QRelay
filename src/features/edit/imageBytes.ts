import { zlibSync } from 'fflate';

import { crc32 } from '../../core/codec/crc32';

/**
 * Two compression levels, shared by the image and PDF operations. "Sharp"
 * keeps a scanned A4 page readable at 150 dpi; "small" is for photos that
 * only need to look right on a phone.
 */
export type CompressLevel = 'sharp' | 'small';

export interface LevelSpec {
  /** Longest edge after resizing, in pixels. */
  maxEdge: number;
  /** JPEG quality, 0..1. */
  quality: number;
}

export const IMAGE_LEVELS: Record<CompressLevel, LevelSpec> = {
  sharp: { maxEdge: 2048, quality: 0.75 },
  small: { maxEdge: 1280, quality: 0.6 },
};

export const PDF_LEVELS: Record<CompressLevel, LevelSpec> = {
  sharp: { maxEdge: 1800, quality: 0.7 },
  small: { maxEdge: 1200, quality: 0.55 },
};

export interface RecodedImage {
  bytes: Uint8Array;
  width: number;
  height: number;
  /** Colour channels in the JPEG: 1 grey, 3 RGB, 4 CMYK. */
  components: number;
  resized: boolean;
}

/** Decodes an image file (bytes or a file URI) and writes a JPEG to `spec`. The app's one runs in the OS codecs. */
export type Recoder = (source: Uint8Array | string, ext: string, spec: LevelSpec) => Promise<RecodedImage>;

export interface JpegInfo {
  width: number;
  height: number;
  components: number;
}

/** Reads the start-of-frame marker. Null when `b` is not a JPEG. */
export function jpegInfo(b: Uint8Array): JpegInfo | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let p = 2;
  while (p + 4 <= b.length) {
    if (b[p] !== 0xff) {
      p++;
      continue;
    }
    const marker = b[p + 1];
    if (marker === 0xff) {
      p++;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      p += 2;
      continue;
    }
    const len = (b[p + 2] << 8) | b[p + 3];
    const sof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (sof) {
      if (p + 9 >= b.length) return null;
      return { height: (b[p + 5] << 8) | b[p + 6], width: (b[p + 7] << 8) | b[p + 8], components: b[p + 9] };
    }
    if (marker === 0xda) return null; // scan data before any SOF: broken file
    p += 2 + len;
  }
  return null;
}

/**
 * Wraps PNG-filtered scanlines (one filter byte, then the row) into a PNG
 * file, so raw pixels pulled out of a PDF can go through the OS image
 * codecs. Deflate level 1: it only has to be valid, the JPEG that follows is
 * what gets kept.
 */
export function pngFromScanlines(scanlines: Uint8Array, width: number, height: number, channels: 1 | 3): Uint8Array {
  const idat = zlibSync(scanlines, { level: 1 });
  const ihdr = new Uint8Array(13);
  writeU32(ihdr, 0, width);
  writeU32(ihdr, 4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = channels === 1 ? 0 : 2; // greyscale or truecolour
  const chunks = [chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(8 + chunks.reduce((n, c) => n + c.length, 0));
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  let p = 8;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  writeU32(out, 0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  writeU32(out, 8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

function writeU32(out: Uint8Array, p: number, v: number): void {
  out[p] = (v >>> 24) & 0xff;
  out[p + 1] = (v >>> 16) & 0xff;
  out[p + 2] = (v >>> 8) & 0xff;
  out[p + 3] = v & 0xff;
}
