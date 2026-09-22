import { base45Encode } from '../codec/base45';
import { FountainEncoder } from '../codec/encoder';
import { encodeDataFrame, encodeKeyFrame, KeyFrame, SESSION_ID_LENGTH, sessionLabel } from '../codec/framing';
import { packAsync, type Packed, packSync } from '../codec/pack';
import { randomBytes, seal, type SealedFile, sealWithHash, sha256Async } from '../crypto/sessionCrypto';
import { Preset } from './presets';

export interface SourceFile {
  bytes: Uint8Array;
  name: string;
  mime: string;
}

export type PrepareStep = 'packing' | 'hashing' | 'encrypting';
export type PrepareProgress = (step: PrepareStep, fraction: number) => void;

/**
 * Everything the sender needs once a file is sealed: the key frame to show
 * first and an endless supply of data frames.
 *
 * Build one with `create` (packs, hashes and encrypts, yielding to the event
 * loop while it packs) or `createSync` in tests.
 */
export class SenderSession {
  readonly keyFrame: KeyFrame;
  readonly encoder: FountainEncoder;
  readonly keyBytes: Uint8Array;

  private constructor(file: SourceFile, packed: Packed, sealed: SealedFile, readonly preset: Preset) {
    this.encoder = new FountainEncoder(sealed.cipher, preset.blockSize);
    this.keyFrame = {
      sessionId: randomBytes(SESSION_ID_LENGTH),
      key: sealed.key,
      nonce: sealed.nonce,
      blockCount: this.encoder.blockCount,
      blockSize: preset.blockSize,
      fileSize: packed.bytes.length,
      packed: packed.method,
      rawSize: packed.rawSize,
      sha256: sealed.sha256,
      mime: file.mime,
      name: file.name,
    };
    this.keyBytes = encodeKeyFrame(this.keyFrame);
  }

  /**
   * `packed` may be passed in when the caller already packed the file (the
   * Send screen does, so the block count it shows is the one that streams).
   */
  static async create(file: SourceFile, preset: Preset, onProgress?: PrepareProgress, packed?: Packed): Promise<SenderSession> {
    const p = packed ?? (await packAsync(file.bytes, (f) => onProgress?.('packing', f)));
    onProgress?.('hashing', 0);
    const hash = await sha256Async(file.bytes);
    onProgress?.('encrypting', 0);
    // Let that label paint: the AES-GCM pass is one synchronous run over the payload.
    await new Promise((resolve) => setTimeout(resolve, 16));
    const sealed = sealWithHash(p.bytes, hash);
    onProgress?.('encrypting', 1);
    return new SenderSession(file, p, sealed, preset);
  }

  static createSync(file: SourceFile, preset: Preset): SenderSession {
    const packed = packSync(file.bytes);
    return new SenderSession(file, packed, seal(packed.bytes, file.bytes), preset);
  }

  get blockCount(): number {
    return this.encoder.blockCount;
  }

  get label(): string {
    return sessionLabel(this.keyFrame.sessionId);
  }

  /** Frames in one pass-plus-repair cycle. */
  get cycle(): number {
    return this.encoder.selector.cycle;
  }

  /** The key QR, ready for alphanumeric mode. */
  get keyText(): string {
    return base45Encode(this.keyBytes);
  }

  /** Frame `seed` as QR alphanumeric text. */
  frameText(seed: number): string {
    return base45Encode(
      encodeDataFrame({
        sessionId: this.keyFrame.sessionId,
        seed,
        blockCount: this.blockCount,
        payload: this.encoder.payloadFor(seed),
      }),
    );
  }

  isRepair(seed: number): boolean {
    return !this.encoder.isSystematic(seed);
  }

  /** Position inside the current cycle: block index during the pass, K.. during repair. */
  position(seed: number): number {
    return seed % this.cycle;
  }
}
