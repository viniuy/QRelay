import { base45Decode } from '../codec/base45';
import { FountainDecoder } from '../codec/decoder';
import { cipherLength, decodeDataFrame, decodeKeyFrame, KeyFrame, sameSession } from '../codec/framing';
import { unpack } from '../codec/pack';
import { decrypt, VerificationError, verifyHash, verifyHashAsync } from '../crypto/sessionCrypto';

/** What one scanned QR meant to the receiver. */
export type ScanEvent =
  /** Not one of ours (or a malformed frame). Nothing changes. */
  | 'ignored'
  /** A data frame arrived before any key. The sender needs to show the key. */
  | 'needKey'
  /** The key frame was read; receiving can start. */
  | 'keyLocked'
  /** A frame from a different session than the locked key. */
  | 'otherSession'
  /** Same frame seen again (cameras catch each frame two or three times). */
  | 'duplicate'
  /** A new frame that advanced or fed the decode. */
  | 'frame'
  /** The last block landed; call finish(). */
  | 'complete';

/**
 * Receiver state machine: waits for a key, then feeds data frames to the
 * decoder, then decrypts and verifies.
 */
export class ReceiverSession {
  key: KeyFrame | null = null;
  decoder: FountainDecoder | null = null;
  framesSeen = 0;
  duplicates = 0;
  rejected = 0;

  get hasKey(): boolean {
    return this.key !== null;
  }

  get isComplete(): boolean {
    return this.decoder?.isComplete ?? false;
  }

  get solvedCount(): number {
    return this.decoder?.solvedCount ?? 0;
  }

  get blockCount(): number {
    return this.key?.blockCount ?? 0;
  }

  isSolved(block: number): boolean {
    return this.decoder?.isSolved(block) ?? false;
  }

  feed(text: string): ScanEvent {
    let bytes: Uint8Array;
    try {
      bytes = base45Decode(text);
    } catch {
      return 'ignored';
    }

    const k = this.key;
    if (k === null) {
      const found = decodeKeyFrame(bytes);
      if (found !== null) {
        this.key = found;
        this.decoder = new FountainDecoder(found.blockCount, found.blockSize);
        return 'keyLocked';
      }
      return decodeDataFrame(bytes) !== null ? 'needKey' : 'ignored';
    }

    const frame = decodeDataFrame(bytes);
    if (frame === null) {
      const anotherKey = decodeKeyFrame(bytes);
      if (anotherKey !== null && !sameSession(anotherKey.sessionId, k.sessionId)) return 'otherSession';
      return 'ignored';
    }
    if (!sameSession(frame.sessionId, k.sessionId)) return 'otherSession';
    if (frame.payload.length !== k.blockSize || frame.blockCount !== k.blockCount) {
      this.rejected++;
      return 'ignored';
    }

    this.framesSeen++;
    switch (this.decoder!.add(frame.seed, frame.payload)) {
      case 'duplicate':
        this.duplicates++;
        return 'duplicate';
      case 'complete':
        return 'complete';
      default:
        return 'frame';
    }
  }

  /**
   * Decrypts, unpacks and verifies the rebuilt file. Throws
   * VerificationError on a bad tag, a payload that does not inflate to the
   * announced size, or a wrong hash.
   */
  async finish(): Promise<Uint8Array> {
    const file = this.rebuild();
    await verifyHashAsync(file, this.key!.sha256);
    return file;
  }

  /** Synchronous twin of `finish` for tests. */
  finishSync(): Uint8Array {
    const file = this.rebuild();
    verifyHash(file, this.key!.sha256);
    return file;
  }

  private rebuild(): Uint8Array {
    const k = this.key;
    const d = this.decoder;
    if (k === null || d === null || !d.isComplete) throw new Error('not complete');
    const payload = decrypt(k.key, k.nonce, d.assemble(cipherLength(k)));
    try {
      return unpack(payload, k.packed, k.rawSize);
    } catch (e) {
      throw new VerificationError(`payload did not unpack: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
