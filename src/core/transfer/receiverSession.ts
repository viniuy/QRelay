import { base45Decode } from '../codec/base45';
import { FountainDecoder } from '../codec/decoder';
import { cipherLength, decodeDataFrame, decodeKeyFrame, KeyFrame, sameSession } from '../codec/framing';
import { unpack } from '../codec/pack';
import { decrypt, VerificationError, verifyHash, verifyHashAsync } from '../crypto/sessionCrypto';

export type ScanEvent =
  | 'ignored'
  | 'needKey'
  | 'keyLocked'
  | 'otherSession'
  | 'duplicate'
  | 'frame'
  | 'complete';

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

  get pendingCount(): number {
    return this.decoder?.pendingCount ?? 0;
  }

  get blockCount(): number {
    return this.key?.blockCount ?? 0;
  }

  isSolved(block: number): boolean {
    return this.decoder?.isSolved(block) ?? false;
  }

  solvedMap(): Uint8Array {
    return this.decoder?.solvedMap() ?? new Uint8Array(0);
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

  async finish(): Promise<Uint8Array> {
    const file = this.rebuild();
    await verifyHashAsync(file, this.key!.sha256);
    return file;
  }

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
