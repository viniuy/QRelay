/**
 * Runtime wiring the core cannot do for itself. Imported once, first, from
 * the root layout.
 *
 * Hermes has no `crypto` global, so session keys and nonces come from
 * expo-crypto's hardware-backed generator, and SHA-256 over a whole file
 * runs in the OS instead of in JavaScript (seconds versus milliseconds on a
 * multi-megabyte PDF).
 */
import { CryptoDigestAlgorithm, digest, getRandomValues } from 'expo-crypto';

import { setHashSource, setRandomSource } from '@/core/crypto/sessionCrypto';

setRandomSource((out) => {
  getRandomValues(out);
});

setHashSource(async (data) => {
  // expo-crypto wants a view over a plain ArrayBuffer; a subarray of a larger buffer is copied first.
  const view = data.byteOffset === 0 && data.byteLength === data.buffer.byteLength && data.buffer instanceof ArrayBuffer ? (data as Uint8Array<ArrayBuffer>) : Uint8Array.from(data);
  return new Uint8Array(await digest(CryptoDigestAlgorithm.SHA256, view));
});
