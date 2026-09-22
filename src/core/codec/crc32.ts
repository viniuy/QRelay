/**
 * CRC-32 (IEEE 802.3, reflected, polynomial 0xEDB88320), the zlib/PNG variant.
 *
 * QR has its own Reed-Solomon correction, so a wrong decode is rare. It is
 * also catastrophic for a fountain decoder, because one bad payload poisons
 * every block it touches. The CRC is the belt to that suspender.
 */
const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
