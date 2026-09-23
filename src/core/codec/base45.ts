export const BASE45_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

const LOOKUP = new Int16Array(128).fill(-1);
for (let i = 0; i < BASE45_ALPHABET.length; i++) {
  LOOKUP[BASE45_ALPHABET.charCodeAt(i)] = i;
}

export function base45Encode(bytes: Uint8Array): string {
  const out: string[] = [];
  const n = bytes.length;
  for (let i = 0; i < n; i += 2) {
    if (i + 1 < n) {
      const v = bytes[i] * 256 + bytes[i + 1];
      out.push(BASE45_ALPHABET[v % 45], BASE45_ALPHABET[Math.floor(v / 45) % 45], BASE45_ALPHABET[Math.floor(v / 2025)]);
    } else {
      const v = bytes[i];
      out.push(BASE45_ALPHABET[v % 45], BASE45_ALPHABET[Math.floor(v / 45)]);
    }
  }
  return out.join('');
}

export function base45Decode(text: string): Uint8Array {
  const n = text.length;
  if (n % 3 === 1) throw new Error('base45: length mod 3 must not be 1');
  const out = new Uint8Array(Math.floor(n / 3) * 2 + (n % 3 === 2 ? 1 : 0));
  let p = 0;
  for (let i = 0; i < n; i += 3) {
    const c = value(text.charCodeAt(i));
    const d = value(text.charCodeAt(i + 1));
    if (i + 2 < n) {
      const e = value(text.charCodeAt(i + 2));
      const v = c + d * 45 + e * 2025;
      if (v > 0xffff) throw new Error('base45: group exceeds 0xFFFF');
      out[p++] = v >> 8;
      out[p++] = v & 0xff;
    } else {
      const v = c + d * 45;
      if (v > 0xff) throw new Error('base45: tail exceeds 0xFF');
      out[p++] = v;
    }
  }
  return out;
}

function value(code: number): number {
  const v = code < 128 ? LOOKUP[code] : -1;
  if (v < 0) throw new Error(`base45: bad character U+${code.toString(16)}`);
  return v;
}
