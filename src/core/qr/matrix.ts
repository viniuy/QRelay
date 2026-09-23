import QRCode from 'qrcode';

/** A rendered QR symbol: `size` × `size` modules, one byte each, 1 = dark. */
export interface BitMatrix {
  size: number;
  data: Uint8Array;
  version: number;
}

/**
 * Encodes base45 text at error correction M.
 *
 * `version` must be pinned for stream frames. Left to choose, `qrcode` packs
 * runs of digits into numeric mode, and since every frame carries different
 * ciphertext the digits fall differently each time: at 500 bytes the symbol
 * wanders between version 14 and 18, so it physically changes size on screen
 * and the receiver refocuses on every frame. A fixed version keeps the module
 * pitch constant for the whole stream, which is what lets the camera lock on
 * once and stay locked.
 */
export function renderMatrix(text: string, version?: number): BitMatrix {
  const code = QRCode.create(text, { errorCorrectionLevel: 'M', version });
  return { size: code.modules.size, data: Uint8Array.from(code.modules.data), version: code.version };
}

/**
 * One SVG path for the dark modules, in module units. Runs of dark modules
 * on a row merge into one rectangle, so a v18 frame is a few hundred
 * subpaths instead of thousands. Rows overlap by 3% so anti-aliasing never
 * opens a hairline between them.
 */
export function matrixToPath(m: BitMatrix, quiet: number): string {
  const parts: string[] = [];
  const n = m.size;
  for (let r = 0; r < n; r++) {
    let c = 0;
    const row = r * n;
    while (c < n) {
      if (m.data[row + c] === 0) {
        c++;
        continue;
      }
      let end = c;
      while (end < n && m.data[row + end] !== 0) end++;
      parts.push(`M${c + quiet} ${r + quiet}h${end - c}v1.03h${-(end - c)}z`);
      c = end;
    }
  }
  return parts.join('');
}
