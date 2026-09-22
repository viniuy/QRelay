import { crc32 } from './crc32';
import type { PackMethod } from './pack';

/** Wire format version. Bump when a layout below changes. */
export const PROTOCOL_VERSION = 2;

export const SESSION_ID_LENGTH = 4;
export const KEY_LENGTH = 32;
export const NONCE_LENGTH = 12;
export const SHA256_LENGTH = 32;

/** AES-GCM appends a 16-byte tag; the stream carries `fileSize + 16` bytes. */
export const GCM_TAG_LENGTH = 16;

const MAGIC_KEY = [0x51, 0x4b]; // 'QK'
const MAGIC_DATA = [0x51, 0x44]; // 'QD'

const utf8 = new TextEncoder();
const utf8d = new TextDecoder();

/**
 * The one QR shown before the stream. Everything the receiver needs, nothing
 * the stream repeats.
 *
 * ```
 * magic 'QK' (2) · ver (1) · session (4) · key (32) · nonce (12) · K (2) ·
 * block size (2) · payload size (4) · flags (1) · raw size (4) ·
 * sha-256 (32) · mime (1+n) · name (1+n)
 * ```
 *
 * Flags, bit 0: the payload is deflated; inflate it to `rawSize` bytes after
 * decrypting. The SHA-256 is always over the original file, so what gets
 * saved is what gets checked.
 */
export interface KeyFrame {
  sessionId: Uint8Array;
  key: Uint8Array;
  nonce: Uint8Array;
  blockCount: number;
  blockSize: number;
  /** Plaintext bytes in the stream (after packing, before the GCM tag). */
  fileSize: number;
  packed: PackMethod;
  /** Size of the original file. Equal to `fileSize` when not packed. */
  rawSize: number;
  sha256: Uint8Array;
  mime: string;
  name: string;
}

const FLAG_DEFLATE = 0x01;
const KEY_FIXED_LENGTH = 3 + SESSION_ID_LENGTH + KEY_LENGTH + NONCE_LENGTH + 2 + 2 + 4 + 1 + 4 + SHA256_LENGTH;

export function cipherLength(key: KeyFrame): number {
  return key.fileSize + GCM_TAG_LENGTH;
}

export function encodeKeyFrame(k: KeyFrame): Uint8Array {
  const mime = utf8.encode(k.mime);
  const name = utf8.encode(k.name);
  if (mime.length > 255) throw new Error('mime longer than 255 bytes');
  if (name.length > 255) throw new Error('name longer than 255 bytes');
  if (k.sessionId.length !== SESSION_ID_LENGTH) throw new Error('bad session id');
  if (k.key.length !== KEY_LENGTH) throw new Error('bad key length');
  if (k.nonce.length !== NONCE_LENGTH) throw new Error('bad nonce length');
  if (k.sha256.length !== SHA256_LENGTH) throw new Error('bad hash length');
  const out = new Uint8Array(KEY_FIXED_LENGTH + 1 + mime.length + 1 + name.length);
  let p = 0;
  out[p++] = MAGIC_KEY[0];
  out[p++] = MAGIC_KEY[1];
  out[p++] = PROTOCOL_VERSION;
  out.set(k.sessionId, p); p += SESSION_ID_LENGTH;
  out.set(k.key, p); p += KEY_LENGTH;
  out.set(k.nonce, p); p += NONCE_LENGTH;
  p = writeU16(out, p, k.blockCount);
  p = writeU16(out, p, k.blockSize);
  p = writeU32(out, p, k.fileSize);
  out[p++] = k.packed === 'deflate' ? FLAG_DEFLATE : 0;
  p = writeU32(out, p, k.rawSize);
  out.set(k.sha256, p); p += SHA256_LENGTH;
  out[p++] = mime.length;
  out.set(mime, p); p += mime.length;
  out[p++] = name.length;
  out.set(name, p);
  return out;
}

/** Null when `bytes` is not a key frame of this version. */
export function decodeKeyFrame(bytes: Uint8Array): KeyFrame | null {
  if (bytes.length < KEY_FIXED_LENGTH + 2) return null;
  if (bytes[0] !== MAGIC_KEY[0] || bytes[1] !== MAGIC_KEY[1] || bytes[2] !== PROTOCOL_VERSION) return null;
  let p = 3;
  const sessionId = bytes.slice(p, p + SESSION_ID_LENGTH); p += SESSION_ID_LENGTH;
  const key = bytes.slice(p, p + KEY_LENGTH); p += KEY_LENGTH;
  const nonce = bytes.slice(p, p + NONCE_LENGTH); p += NONCE_LENGTH;
  const blockCount = readU16(bytes, p); p += 2;
  const blockSize = readU16(bytes, p); p += 2;
  const fileSize = readU32(bytes, p); p += 4;
  const flags = bytes[p++];
  const rawSize = readU32(bytes, p); p += 4;
  const sha256 = bytes.slice(p, p + SHA256_LENGTH); p += SHA256_LENGTH;
  const mimeLen = bytes[p++];
  if (bytes.length < p + mimeLen + 1) return null;
  const mime = utf8d.decode(bytes.subarray(p, p + mimeLen)); p += mimeLen;
  const nameLen = bytes[p++];
  if (bytes.length < p + nameLen) return null;
  const name = utf8d.decode(bytes.subarray(p, p + nameLen));
  if (blockCount === 0 || blockSize === 0) return null;
  if ((flags & ~FLAG_DEFLATE) !== 0) return null;
  const packed: PackMethod = flags & FLAG_DEFLATE ? 'deflate' : 'none';
  if (packed === 'none' && rawSize !== fileSize) return null;
  return { sessionId, key, nonce, blockCount, blockSize, fileSize, packed, rawSize, sha256, mime, name };
}

/** Four hex characters of the session id, for labels. */
export function sessionLabel(sessionId: Uint8Array): string {
  return Array.from(sessionId.subarray(0, 2), (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/**
 * One frame of the stream.
 *
 * ```
 * magic 'QD' (2) · ver (1) · session (4) · seed (4) · K (2) · payload (B) · crc-32 (4)
 * ```
 */
export interface DataFrame {
  sessionId: Uint8Array;
  seed: number;
  blockCount: number;
  payload: Uint8Array;
}

export const DATA_HEADER_LENGTH = 3 + SESSION_ID_LENGTH + 4 + 2;
export const DATA_TRAILER_LENGTH = 4;
export const DATA_OVERHEAD = DATA_HEADER_LENGTH + DATA_TRAILER_LENGTH;

export function encodeDataFrame(f: DataFrame): Uint8Array {
  const out = new Uint8Array(DATA_HEADER_LENGTH + f.payload.length + DATA_TRAILER_LENGTH);
  let p = 0;
  out[p++] = MAGIC_DATA[0];
  out[p++] = MAGIC_DATA[1];
  out[p++] = PROTOCOL_VERSION;
  out.set(f.sessionId, p); p += SESSION_ID_LENGTH;
  p = writeU32(out, p, f.seed);
  p = writeU16(out, p, f.blockCount);
  out.set(f.payload, p); p += f.payload.length;
  writeU32(out, p, crc32(out, 0, p));
  return out;
}

/** Null on wrong magic, version, length or CRC. */
export function decodeDataFrame(bytes: Uint8Array): DataFrame | null {
  if (bytes.length < DATA_OVERHEAD + 1) return null;
  if (bytes[0] !== MAGIC_DATA[0] || bytes[1] !== MAGIC_DATA[1] || bytes[2] !== PROTOCOL_VERSION) return null;
  const bodyEnd = bytes.length - DATA_TRAILER_LENGTH;
  if (crc32(bytes, 0, bodyEnd) !== readU32(bytes, bodyEnd)) return null;
  const sessionId = bytes.slice(3, 3 + SESSION_ID_LENGTH);
  const seed = readU32(bytes, 3 + SESSION_ID_LENGTH);
  const blockCount = readU16(bytes, 3 + SESSION_ID_LENGTH + 4);
  const payload = bytes.slice(DATA_HEADER_LENGTH, bodyEnd);
  return { sessionId, seed, blockCount, payload };
}

export function sameSession(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function writeU16(out: Uint8Array, p: number, v: number): number {
  out[p] = (v >> 8) & 0xff;
  out[p + 1] = v & 0xff;
  return p + 2;
}

function writeU32(out: Uint8Array, p: number, v: number): number {
  out[p] = (v >>> 24) & 0xff;
  out[p + 1] = (v >>> 16) & 0xff;
  out[p + 2] = (v >>> 8) & 0xff;
  out[p + 3] = v & 0xff;
  return p + 4;
}

function readU16(b: Uint8Array, p: number): number {
  return (b[p] << 8) | b[p + 1];
}

function readU32(b: Uint8Array, p: number): number {
  return ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0;
}
