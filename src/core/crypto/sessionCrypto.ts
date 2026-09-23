import { gcm } from '@noble/ciphers/aes.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { KEY_LENGTH, NONCE_LENGTH } from '../codec/framing';

export interface SealedFile {
  key: Uint8Array;
  nonce: Uint8Array;
  cipher: Uint8Array;
  sha256: Uint8Array;
}

export class VerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VerificationError';
  }
}

type RandomSource = (out: Uint8Array<ArrayBuffer>) => void;
type HashSource = (data: Uint8Array) => Promise<Uint8Array>;

let randomSource: RandomSource | null =
  typeof globalThis.crypto?.getRandomValues === 'function' ? (out) => void globalThis.crypto.getRandomValues(out) : null;
let hashSource: HashSource | null = null;

export function setRandomSource(source: RandomSource): void {
  randomSource = source;
}

export function setHashSource(source: HashSource | null): void {
  hashSource = source;
}

export function randomBytes(n: number): Uint8Array {
  if (randomSource === null) throw new Error('no secure random source installed');
  const out = new Uint8Array(n);
  randomSource(out);
  return out;
}

export async function sha256Async(data: Uint8Array): Promise<Uint8Array> {
  return hashSource ? hashSource(data) : sha256(data);
}

export function seal(payload: Uint8Array, original: Uint8Array = payload): SealedFile {
  return sealWithHash(payload, sha256(original));
}

export async function sealAsync(payload: Uint8Array, original: Uint8Array = payload): Promise<SealedFile> {
  return sealWithHash(payload, await sha256Async(original));
}

export function sealWithHash(payload: Uint8Array, hash: Uint8Array): SealedFile {
  const key = randomBytes(KEY_LENGTH);
  const nonce = randomBytes(NONCE_LENGTH);
  const cipher = gcm(key, nonce).encrypt(payload);
  return { key, nonce, cipher, sha256: hash };
}

export function decrypt(key: Uint8Array, nonce: Uint8Array, cipher: Uint8Array): Uint8Array {
  if (cipher.length < 16) throw new VerificationError('ciphertext shorter than the GCM tag');
  try {
    return gcm(key, nonce).decrypt(cipher);
  } catch {
    throw new VerificationError('GCM tag did not match');
  }
}

export function verifyHash(data: Uint8Array, hash: Uint8Array): void {
  if (!constantTimeEquals(sha256(data), hash)) throw new VerificationError('SHA-256 did not match');
}

export async function verifyHashAsync(data: Uint8Array, hash: Uint8Array): Promise<void> {
  if (!constantTimeEquals(await sha256Async(data), hash)) throw new VerificationError('SHA-256 did not match');
}

export function open(key: Uint8Array, nonce: Uint8Array, cipher: Uint8Array, hash: Uint8Array): Uint8Array {
  const plain = decrypt(key, nonce, cipher);
  verifyHash(plain, hash);
  return plain;
}

export function constantTimeEquals(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
