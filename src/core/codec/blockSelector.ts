import { FrameRng } from './frameRng';

export class BlockSelector {
  readonly repairPerCycle: number;
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

  systematicIndex(seed: number): number {
    return seed % this.cycle;
  }

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
