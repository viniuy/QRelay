import { Deflate, inflateSync } from 'fflate';

/**
 * Lossless squeeze before encryption. Ciphertext does not compress, so this
 * is the only place the stream can get shorter without touching the file.
 *
 * Deflate is kept only when it saves at least MIN_GAIN of the bytes; JPEGs,
 * ZIPs and most PDFs (whose streams are already deflated) go through as they
 * are, and the receiver never runs an inflate for nothing.
 */
export type PackMethod = 'none' | 'deflate';

export interface Packed {
  method: PackMethod;
  bytes: Uint8Array;
  /** Length of the original file. */
  rawSize: number;
}

/** Deflate has to beat this fraction of the original to be worth a flag. */
export const MIN_GAIN = 0.03;

/** Bytes pushed through the deflater between yields to the event loop. */
const CHUNK = 128 * 1024;

/** Input consumed before an incompressible file is given up on. */
const BAIL_AFTER = 1024 * 1024;

export type PackProgress = (fraction: number) => void;

/**
 * Deflates in chunks, giving the event loop a turn between them so the
 * screen keeps animating while a multi-megabyte file packs. Level 6 is the
 * zlib default: another level or two buys almost nothing on files this size
 * and costs twice the time on a phone.
 */
export async function packAsync(raw: Uint8Array, onProgress?: PackProgress): Promise<Packed> {
  if (raw.length < 64) return { method: 'none', bytes: raw, rawSize: raw.length };
  const parts: Uint8Array[] = [];
  let total = 0;
  let gaveUp = false;
  const deflater = new Deflate({ level: 6 }, (chunk) => {
    parts.push(chunk);
    total += chunk.length;
  });
  for (let offset = 0; offset < raw.length; offset += CHUNK) {
    const end = Math.min(raw.length, offset + CHUNK);
    deflater.push(raw.subarray(offset, end), end === raw.length);
    onProgress?.(end / raw.length);
    // Already over the line with input still to go, or a megabyte in with
    // under 1% saved (a JPEG, a ZIP): this file will not shrink.
    if (total >= raw.length * (1 - MIN_GAIN) || (end >= BAIL_AFTER && total >= end * 0.99)) {
      gaveUp = true;
      break;
    }
    if (end < raw.length) await nextTurn();
  }
  if (gaveUp || total >= raw.length * (1 - MIN_GAIN)) return { method: 'none', bytes: raw, rawSize: raw.length };
  return { method: 'deflate', bytes: concat(parts, total), rawSize: raw.length };
}

/** Synchronous twin for tests and tiny inputs. */
export function packSync(raw: Uint8Array): Packed {
  const parts: Uint8Array[] = [];
  let total = 0;
  const deflater = new Deflate({ level: 6 }, (chunk) => {
    parts.push(chunk);
    total += chunk.length;
  });
  deflater.push(raw, true);
  if (raw.length < 64 || total >= raw.length * (1 - MIN_GAIN)) return { method: 'none', bytes: raw, rawSize: raw.length };
  return { method: 'deflate', bytes: concat(parts, total), rawSize: raw.length };
}

/** Throws when the inflated length is not `rawSize`; the caller treats that as a failed verify. */
export function unpack(packed: Uint8Array, method: PackMethod, rawSize: number): Uint8Array {
  if (method === 'none') {
    if (packed.length !== rawSize) throw new Error(`packed length ${packed.length} does not match raw size ${rawSize}`);
    return packed;
  }
  const out = inflateSync(packed, { out: new Uint8Array(rawSize) });
  if (out.length !== rawSize) throw new Error(`inflated ${out.length} bytes, expected ${rawSize}`);
  return out;
}

function concat(parts: Uint8Array[], total: number): Uint8Array {
  if (parts.length === 1) return parts[0];
  const out = new Uint8Array(total);
  let p = 0;
  for (const part of parts) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

function nextTurn(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
