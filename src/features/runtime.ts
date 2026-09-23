import { CryptoDigestAlgorithm, digest, getRandomValues } from 'expo-crypto';

import { setHashSource, setRandomSource } from '@/core/crypto/sessionCrypto';

setRandomSource((out) => {
  getRandomValues(out);
});

setHashSource(async (data) => {
  const view = data.byteOffset === 0 && data.byteLength === data.buffer.byteLength && data.buffer instanceof ArrayBuffer ? (data as Uint8Array<ArrayBuffer>) : Uint8Array.from(data);
  return new Uint8Array(await digest(CryptoDigestAlgorithm.SHA256, view));
});
