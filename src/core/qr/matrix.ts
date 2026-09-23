import QRCode from 'qrcode';

export interface BitMatrix {
  size: number;
  data: Uint8Array;
  version: number;
}

export function renderMatrix(text: string, version?: number): BitMatrix {
  const code = QRCode.create(text, { errorCorrectionLevel: 'M', version });
  return { size: code.modules.size, data: Uint8Array.from(code.modules.data), version: code.version };
}

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
