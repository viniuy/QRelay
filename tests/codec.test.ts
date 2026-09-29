import { describe, expect, it } from 'vitest';

import { BASE45_ALPHABET, base45Decode, base45Encode } from '../src/core/codec/base45';
import { BlockSelector, maskHas } from '../src/core/codec/blockSelector';
import { crc32 } from '../src/core/codec/crc32';
import { FountainDecoder } from '../src/core/codec/decoder';
import { FountainEncoder } from '../src/core/codec/encoder';
import { DATA_OVERHEAD, decodeDataFrame, decodeKeyFrame, encodeDataFrame, encodeKeyFrame, sameSession } from '../src/core/codec/framing';
import { FrameRng } from '../src/core/codec/frameRng';

const utf8 = new TextEncoder();
const utf8d = new TextDecoder();

function bytes(n: number, seed = 1): Uint8Array {
  return Uint8Array.from({ length: n }, (_, i) => (i * seed + 7) & 0xff);
}

function randomData(n: number, seed: number): Uint8Array {
  const r = new FrameRng(seed);
  return Uint8Array.from({ length: n }, () => r.nextInt(256));
}

describe('base45', () => {
  const vectors: Record<string, string> = {
    AB: 'BB8',
    'Hello!!': '%69 VD92EX0',
    'base-45': 'UJCLQE7W581',
    'ietf!': 'QED8WEX0',
  };

  it('encodes the RFC 9285 vectors', () => {
    for (const [plain, enc] of Object.entries(vectors)) expect(base45Encode(utf8.encode(plain))).toBe(enc);
  });

  it('decodes the RFC 9285 vectors', () => {
    for (const [plain, enc] of Object.entries(vectors)) expect(utf8d.decode(base45Decode(enc))).toBe(plain);
  });

  it('round-trips odd and even lengths', () => {
    for (const len of [0, 1, 2, 3, 255, 256, 517, 1000]) {
      const b = bytes(len, 37);
      expect(base45Decode(base45Encode(b))).toEqual(b);
    }
  });

  it('only uses the QR alphanumeric alphabet', () => {
    const text = base45Encode(bytes(2048));
    for (const ch of text) expect(BASE45_ALPHABET.includes(ch)).toBe(true);
  });

  it('rejects bad input', () => {
    expect(() => base45Decode('A')).toThrow();
    expect(() => base45Decode('GGW')).toThrow();
    expect(() => base45Decode('ab')).toThrow();
  });
});

describe('crc32', () => {
  it('matches the zlib check value', () => {
    expect(crc32(utf8.encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe('framing', () => {
  const key = {
    sessionId: bytes(4),
    key: bytes(32, 3),
    nonce: bytes(12, 5),
    blockCount: 48,
    blockSize: 500,
    fileSize: 23960,
    packed: 'none' as const,
    rawSize: 23960,
    sha256: bytes(32, 9),
    mime: 'application/pdf',
    name: 'offer-letter.pdf',
  };

  it('key frame is 129 bytes for this name and round-trips', () => {
    const enc = encodeKeyFrame(key);
    expect(enc.length).toBe(129);
    const back = decodeKeyFrame(enc)!;
    expect(back).not.toBeNull();
    expect(back.blockCount).toBe(48);
    expect(back.blockSize).toBe(500);
    expect(back.fileSize).toBe(23960);
    expect(back.mime).toBe('application/pdf');
    expect(back.name).toBe('offer-letter.pdf');
    expect(back.key).toEqual(key.key);
    expect(back.nonce).toEqual(key.nonce);
    expect(back.sha256).toEqual(key.sha256);
    expect(back.packed).toBe('none');
    expect(back.rawSize).toBe(23960);
  });

  it('carries the deflate flag and raw size, and rejects unknown flags', () => {
    const enc = encodeKeyFrame({ ...key, fileSize: 9000, packed: 'deflate', rawSize: 23960 });
    const back = decodeKeyFrame(enc)!;
    expect(back.packed).toBe('deflate');
    expect(back.fileSize).toBe(9000);
    expect(back.rawSize).toBe(23960);
    const flagsAt = 3 + 4 + 32 + 12 + 2 + 2 + 4;
    const unknown = Uint8Array.from(enc);
    unknown[flagsAt] = 0x02;
    expect(decodeKeyFrame(unknown)).toBeNull();
    expect(decodeKeyFrame(encodeKeyFrame({ ...key, rawSize: 1 }))).toBeNull();
  });

  it('rejects truncation and the other magic', () => {
    const enc = encodeKeyFrame(key);
    expect(decodeKeyFrame(enc.subarray(0, 60))).toBeNull();
    const wrong = Uint8Array.from(enc);
    wrong[0] = 0x51;
    wrong[1] = 0x44;
    expect(decodeKeyFrame(wrong)).toBeNull();
    expect(decodeDataFrame(enc)).toBeNull();
  });

  it('data frame round-trips and a flipped bit fails the CRC', () => {
    const frame = { sessionId: bytes(4), seed: 0xdeadbeef, blockCount: 400, payload: bytes(500, 13) };
    const enc = encodeDataFrame(frame);
    expect(enc.length).toBe(500 + DATA_OVERHEAD);
    const back = decodeDataFrame(enc)!;
    expect(back.seed).toBe(0xdeadbeef);
    expect(back.blockCount).toBe(400);
    expect(back.payload).toEqual(frame.payload);
    expect(sameSession(back.sessionId, frame.sessionId)).toBe(true);
    const corrupt = Uint8Array.from(enc);
    corrupt[100] ^= 1;
    expect(decodeDataFrame(corrupt)).toBeNull();
  });
});

describe('BlockSelector', () => {
  it('in-order pass, then dense repair, then the pass again', () => {
    const s = new BlockSelector(48);
    expect(s.repairPerCycle).toBe(17);
    expect(s.cycle).toBe(65);
    for (let i = 0; i < 48; i++) {
      expect(s.isSystematic(i)).toBe(true);
      expect(s.systematicIndex(i)).toBe(i);
    }
    expect(s.isSystematic(48)).toBe(false);
    expect(s.isSystematic(64)).toBe(false);
    expect(s.isSystematic(65)).toBe(true);
  });

  it('repair masks are deterministic, dense and inside K', () => {
    const s = new BlockSelector(100);
    const a = s.maskFor(100);
    expect(a).toEqual(s.maskFor(100));
    expect(a).not.toEqual(s.maskFor(101));
    let bits = 0;
    for (let i = 0; i < 100; i++) if (maskHas(a, i)) bits++;
    expect(bits).toBeGreaterThanOrEqual(30);
    expect(bits).toBeLessThanOrEqual(70);
    for (let i = 100; i < 128; i++) expect(maskHas(a, i)).toBe(false);
  });

  it('K = 1 never yields an empty repair frame', () => {
    const s = new BlockSelector(1);
    for (let seed = 0; seed < 50; seed++) expect(s.maskFor(seed)[0] & 1).toBe(1);
  });
});

function transfer(enc: FountainEncoder, original: Uint8Array, loss: number, seed: number, startAt = 0): number {
  const dec = new FountainDecoder(enc.blockCount, enc.blockSize);
  const r = new FrameRng(seed);
  let shown = 0;
  let frame = startAt;
  while (!dec.isComplete) {
    if (shown > 50000) throw new Error('decoder never completed');
    const payload = enc.payloadFor(frame);
    shown++;
    if (r.nextDouble() >= loss) {
      dec.add(frame, payload);
      if (r.nextDouble() < 0.3) dec.add(frame, payload);
    }
    frame++;
  }
  expect(dec.assemble(original.length)).toEqual(original);
  return shown;
}

describe('fountain round trip', () => {
  it('no loss: exactly K frames', () => {
    const data = randomData(23960 + 16, 1);
    const enc = new FountainEncoder(data, 500);
    expect(enc.blockCount).toBe(48);
    expect(transfer(enc, data, 0, 1)).toBe(48);
  });

  it('15% loss, K = 48: within 15% of ideal', () => {
    const data = randomData(23960 + 16, 2);
    const shown = transfer(new FountainEncoder(data, 500), data, 0.15, 7);
    expect(shown).toBeLessThan((48 / 0.85) * 1.15 + 4);
  });

  it('30% loss, K = 48: second cycle finishes it', () => {
    const data = randomData(23960 + 16, 2);
    const shown = transfer(new FountainEncoder(data, 500), data, 0.3, 7);
    expect(shown).toBeLessThan((48 / 0.7) * 1.3);
  });

  it('50% loss, K = 48 still completes', () => {
    const data = randomData(23960 + 16, 2);
    expect(transfer(new FountainEncoder(data, 500), data, 0.5, 9)).toBeLessThan((48 * 2) / 0.5);
  });

  it('15% loss, K = 401 (200 KB at Balanced): within 6% of ideal', () => {
    const data = randomData(200000 + 16, 3);
    const enc = new FountainEncoder(data, 500);
    expect(enc.blockCount).toBe(401);
    expect(transfer(enc, data, 0.15, 11)).toBeLessThan((401 / 0.85) * 1.06);
  });

  it('a receiver that joins mid-stream still completes', () => {
    const data = randomData(60000, 5);
    const enc = new FountainEncoder(data, 500);
    expect(transfer(enc, data, 0.1, 13, enc.blockCount + 5)).toBeLessThan(enc.selector.cycle * 2);
  });

  it('tiny file, one block', () => {
    const data = randomData(40, 4);
    const enc = new FountainEncoder(data, 500);
    expect(enc.blockCount).toBe(1);
    expect(transfer(enc, data, 0.5, 5)).toBeGreaterThanOrEqual(1);
  });

  it('block size not dividing the length pads the tail', () => {
    const data = randomData(1234, 6);
    const enc = new FountainEncoder(data, 300);
    expect(enc.blockCount).toBe(5);
    transfer(enc, data, 0.2, 8);
  });

  it('reports duplicates, completion and redundancy', () => {
    const data = randomData(3000, 9);
    const enc = new FountainEncoder(data, 500);
    const dec = new FountainDecoder(enc.blockCount, 500);
    expect(dec.add(0, enc.payloadFor(0))).toBe('solved');
    expect(dec.add(0, enc.payloadFor(0))).toBe('duplicate');
    for (let i = 1; i < enc.blockCount - 1; i++) dec.add(i, enc.payloadFor(i));
    expect(dec.add(enc.blockCount - 1, enc.payloadFor(enc.blockCount - 1))).toBe('complete');
    expect(dec.add(500, enc.payloadFor(500))).toBe('redundant');
  });

  it('repair-only decode solves with K + few frames', () => {
    const data = randomData(20000, 10);
    const enc = new FountainEncoder(data, 500);
    const dec = new FountainDecoder(enc.blockCount, 500);
    const k = enc.blockCount;
    let used = 0;
    let seed = k;
    while (!dec.isComplete) {
      if (!enc.isSystematic(seed)) {
        dec.add(seed, enc.payloadFor(seed));
        used++;
      }
      seed++;
      if (used > k + 20) throw new Error('needed more than K + 20 dense frames');
    }
    expect(dec.assemble(data.length)).toEqual(data);
    expect(used).toBeLessThanOrEqual(k + 6);
  });
});

describe('repair progress', () => {
  it('counts every useful repair frame and finishes when the count reaches the holes', () => {
    const data = randomData(80 * 64, 11);
    const encoder = new FountainEncoder(data, 64);
    const k = encoder.blockCount;
    const decoder = new FountainDecoder(k, 64);
    for (let seed = 0; seed < k; seed++) if (seed % 4 !== 0) decoder.add(seed, encoder.payloadFor(seed));
    const holes = decoder.unsolvedCount;
    expect(holes).toBe(20);

    let recovered = decoder.solvedCount + decoder.pendingCount;
    let seed = k;
    while (!decoder.isComplete && seed < k * 4) {
      decoder.add(seed, encoder.payloadFor(seed));
      seed++;
      const now = decoder.solvedCount + decoder.pendingCount;
      if (!decoder.isComplete) {
        expect(now).toBeGreaterThanOrEqual(recovered);
        expect(decoder.pendingCount).toBeLessThan(decoder.unsolvedCount);
      }
      recovered = now;
    }
    expect(decoder.isComplete).toBe(true);
    expect(seed - k).toBeLessThanOrEqual(holes + 6);
  });
});
