import { FrameRng } from './frameRng';

/**
 * Which blocks a frame with a given seed combines.
 *
 * The stream runs in cycles of `K + R` frames. The first K frames of a cycle
 * are the in-order pass (frame q is block q, untouched). The next R are dense
 * repair frames: every block is included with probability 1/2, drawn from a
 * generator keyed by the seed. A receiver that missed `u` blocks in the pass
 * needs about `u + 2` repair frames to get back to full rank, no matter which
 * blocks it missed, which is as good as no feedback allows. Then the cycle
 * repeats for receivers that joined late.
 *
 * Seeds keep counting up across cycles, so every frame has a unique seed and
 * duplicates are cheap to drop.
 */
export class BlockSelector {
  readonly repairPerCycle: number;
  /** 32-bit words in a mask. */
  readonly words: number;

  constructor(readonly blockCount: number) {
    if (blockCount < 1) throw new Error('blockCount must be at least 1');
    this.repairPerCycle = Math.max(2, Math.ceil(blockCount * 0.35));
    this.words = (blockCount + 31) >> 5;
  }

  get cycle(): number {
    return this.blockCount + this.repairPerCycle;
  }

  isSystematic(seed: number): boolean {
    return seed % this.cycle < this.blockCount;
  }

  /** Block index for a systematic seed; meaningless for repair seeds. */
  systematicIndex(seed: number): number {
    return seed % this.cycle;
  }

  /** Bit mask over the K blocks, bit `i` set when block `i` is in the frame. */
  maskFor(seed: number): Uint32Array {
    const mask = new Uint32Array(this.words);
    const q = seed % this.cycle;
    if (q < this.blockCount) {
      mask[q >> 5] |= 1 << (q & 31);
      return mask;
    }
    const rng = new FrameRng(FrameRng.mix(seed));
    for (let w = 0; w < this.words; w++) mask[w] = rng.nextWord();
    const extra = this.words * 32 - this.blockCount;
    if (extra > 0) mask[this.words - 1] &= 0xffffffff >>> extra;
    let any = false;
    for (let w = 0; w < this.words; w++) if (mask[w] !== 0) any = true;
    if (!any) mask[0] = 1;
    return mask;
  }
}

export function maskHas(mask: Uint32Array, block: number): boolean {
  return (mask[block >> 5] & (1 << (block & 31))) !== 0;
}
