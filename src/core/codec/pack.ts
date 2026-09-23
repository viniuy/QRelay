import { Deflate, inflateSync } from 'fflate';

export type PackMethod = 'none' | 'deflate';

export interface Packed {
  method: PackMethod;
  bytes: Uint8Array;
  rawSize: number;
}

export const MIN_GAIN = 0.03;

const CHUNK = 128 * 1024;

const BAIL_AFTER = 1024 * 1024;

export type PackProgress = (fraction: number) => void;

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
    if (total >= raw.length * (1 - MIN_GAIN) || (end >= BAIL_AFTER && total >= end * 0.99)) {
      gaveUp = true;
      break;
    }
    if (end < raw.length) await nextTurn();
  }
  if (gaveUp || total >= raw.length * (1 - MIN_GAIN)) return { method: 'none', bytes: raw, rawSize: raw.length };
  return { method: 'deflate', bytes: concat(parts, total), rawSize: raw.length };
}

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
