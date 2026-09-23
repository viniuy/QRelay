import { describe, expect, it } from 'vitest';

import { BASE45_ALPHABET } from '../src/core/codec/base45';
import { FrameRng } from '../src/core/codec/frameRng';
import { packAsync, packSync, unpack } from '../src/core/codec/pack';
import { open, seal, VerificationError } from '../src/core/crypto/sessionCrypto';
import { matrixToPath, renderMatrix } from '../src/core/qr/matrix';
import { PRESETS, presetById } from '../src/core/transfer/presets';
import { ReceiverSession } from '../src/core/transfer/receiverSession';
import { SenderSession } from '../src/core/transfer/senderSession';

function randomData(n: number, seed: number): Uint8Array {
  const r = new FrameRng(seed);
  return Uint8Array.from({ length: n }, () => r.nextInt(256));
}

describe('session crypto', () => {
  it('seal then open returns the plaintext', () => {
    const plain = randomData(5000, 1);
    const s = seal(plain);
    expect(s.cipher.length).toBe(plain.length + 16);
    expect(s.key.length).toBe(32);
    expect(s.nonce.length).toBe(12);
    expect(open(s.key, s.nonce, s.cipher, s.sha256)).toEqual(plain);
  });

  it('rejects a flipped ciphertext byte and a wrong key', () => {
    const plain = randomData(2000, 2);
    const s = seal(plain);
    const bad = Uint8Array.from(s.cipher);
    bad[10] ^= 1;
    expect(() => open(s.key, s.nonce, bad, s.sha256)).toThrow(VerificationError);
    const other = seal(plain);
    expect(() => open(other.key, s.nonce, s.cipher, s.sha256)).toThrow(VerificationError);
  });
});

const utf8 = new TextEncoder();

describe('pack', () => {
  it('leaves random bytes alone and squeezes repetitive ones', async () => {
    const noise = randomData(20000, 11);
    expect(packSync(noise).method).toBe('none');
    expect((await packAsync(noise)).method).toBe('none');
    const text = utf8.encode('abcdefgh'.repeat(5000));
    const a = packSync(text);
    const b = await packAsync(text);
    expect(a.method).toBe('deflate');
    expect(b.method).toBe('deflate');
    expect(a.bytes.length).toBeLessThan(text.length / 10);
    expect(unpack(a.bytes, 'deflate', text.length)).toEqual(text);
    expect(unpack(b.bytes, 'deflate', text.length)).toEqual(text);
    expect(() => unpack(a.bytes, 'deflate', text.length + 1)).toThrow();
  });

  it('chunked and one-shot packing agree on multi-chunk input', async () => {
    const big = new Uint8Array(700 * 1024);
    for (let i = 0; i < big.length; i++) big[i] = (i * 7 + (i >> 10)) & 0x3f;
    const a = packSync(big);
    const b = await packAsync(big);
    expect(unpack(b.bytes, b.method, big.length)).toEqual(big);
    expect(Math.abs(a.bytes.length - b.bytes.length)).toBeLessThan(big.length * 0.01);
  });
});

describe('sender to receiver', () => {
  it('key then frames with 20% loss rebuilds the file byte for byte', async () => {
    const file = randomData(23960, 4);
    const sender = SenderSession.createSync({ bytes: file, name: 'offer-letter.pdf', mime: 'application/pdf' }, presetById('balanced'));
    expect(sender.blockCount).toBe(48);

    const receiver = new ReceiverSession();
    expect(receiver.feed(sender.frameText(0))).toBe('needKey');
    expect(receiver.feed('not a frame at all')).toBe('ignored');
    expect(receiver.feed(sender.keyText)).toBe('keyLocked');
    expect(receiver.key!.name).toBe('offer-letter.pdf');
    expect(receiver.key!.fileSize).toBe(23960);

    const r = new FrameRng(42);
    let seed = 0;
    let last = 'frame';
    while (last !== 'complete') {
      const text = sender.frameText(seed++);
      if (r.nextDouble() < 0.2) continue;
      last = receiver.feed(text);
      expect(last).not.toBe('otherSession');
      expect(seed).toBeLessThan(2000);
    }
    expect(receiver.finishSync()).toEqual(file);
    expect(await receiver.finish()).toEqual(file);
  });

  it('packs a compressible file, streams fewer blocks and unpacks it on the other side', async () => {
    // 60 KB of text-like bytes: deflate takes it well under a fifth.
    const file = utf8.encode(Array.from({ length: 1500 }, (_, i) => `line ${i}: the quick brown fox jumps over the lazy dog
`).join(''));
    const plain = SenderSession.createSync({ bytes: randomData(file.length, 9), name: 'r.bin', mime: 'application/octet-stream' }, presetById('balanced'));
    const sender = await SenderSession.create({ bytes: file, name: 'notes.txt', mime: 'text/plain' }, presetById('balanced'));
    expect(sender.keyFrame.packed).toBe('deflate');
    expect(sender.keyFrame.rawSize).toBe(file.length);
    expect(sender.blockCount).toBeLessThan(plain.blockCount / 4);

    const receiver = new ReceiverSession();
    expect(receiver.feed(sender.keyText)).toBe('keyLocked');
    expect(receiver.key!.packed).toBe('deflate');
    let seed = 0;
    let last = 'frame';
    while (last !== 'complete') last = receiver.feed(sender.frameText(seed++));
    expect(await receiver.finish()).toEqual(file);
  });

  it('flags frames from another session', () => {
    const a = SenderSession.createSync({ bytes: randomData(3000, 5), name: 'a.bin', mime: 'application/octet-stream' }, presetById('fast'));
    const b = SenderSession.createSync({ bytes: randomData(3000, 6), name: 'b.bin', mime: 'application/octet-stream' }, presetById('fast'));
    const receiver = new ReceiverSession();
    expect(receiver.feed(a.keyText)).toBe('keyLocked');
    expect(receiver.feed(b.frameText(0))).toBe('otherSession');
    expect(receiver.feed(b.keyText)).toBe('otherSession');
    expect(receiver.feed(a.frameText(0))).toBe('frame');
  });

  it('frame text fits alphanumeric mode and the expected QR version at every preset', () => {
    for (const preset of PRESETS) {
      const s = SenderSession.createSync({ bytes: randomData(4000, 7), name: 'x.txt', mime: 'text/plain' }, preset);
      const text = s.frameText(0);
      const n = preset.blockSize + 17;
      expect(text.length).toBe(Math.floor(n / 2) * 3 + (n % 2 === 1 ? 2 : 0));
      for (const ch of text) expect(BASE45_ALPHABET.includes(ch)).toBe(true);
      const m = renderMatrix(text);
      expect(m.version).toBe(preset.qrVersion);
      expect(m.size).toBe(17 + 4 * preset.qrVersion);
      expect(matrixToPath(m, 4).length).toBeGreaterThan(100);
    }
    const key = SenderSession.createSync({ bytes: randomData(100, 8), name: 'offer-letter.pdf', mime: 'application/pdf' }, presetById('balanced'));
    expect(renderMatrix(key.keyText).version).toBe(8);
  });

  it('pins one QR version for a whole stream, so the symbol never changes size', () => {
    // Left to choose, the encoder packs digit runs into numeric mode and the
    // version wanders with the ciphertext, resizing the symbol every frame.
    const bytes = Uint8Array.from({ length: 60000 }, (_, i) => (i * 2654435761) & 255);
    for (const preset of PRESETS) {
      const s = SenderSession.createSync({ name: 'x.bin', mime: 'application/octet-stream', bytes }, preset);
      const sizes = new Set<number>();
      for (let seed = 0; seed < 60; seed++) sizes.add(renderMatrix(s.frameText(seed), preset.qrVersion).size);
      expect([...sizes]).toEqual([17 + 4 * preset.qrVersion]);
    }
  });
});
