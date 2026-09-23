import { BlockSelector, maskHas } from './blockSelector';

export class FountainEncoder {
  readonly blocks: Uint8Array[];
  readonly selector: BlockSelector;

  constructor(data: Uint8Array, readonly blockSize: number) {
    if (blockSize < 1) throw new Error('blockSize must be at least 1');
    const k = Math.max(1, Math.ceil(data.length / blockSize));
    if (k > 0xffff) throw new Error(`too many blocks (${k}); raise the block size`);
    this.blocks = [];
    for (let i = 0; i < k; i++) {
      const block = new Uint8Array(blockSize);
      const start = i * blockSize;
      const end = Math.min(data.length, start + blockSize);
      if (end > start) block.set(data.subarray(start, end), 0);
      this.blocks.push(block);
    }
    this.selector = new BlockSelector(k);
  }

  get blockCount(): number {
    return this.blocks.length;
  }

  isSystematic(seed: number): boolean {
    return this.selector.isSystematic(seed);
  }

  payloadFor(seed: number): Uint8Array {
    const out = new Uint8Array(this.blockSize);
    if (this.selector.isSystematic(seed)) {
      out.set(this.blocks[this.selector.systematicIndex(seed)]);
      return out;
    }
    const mask = this.selector.maskFor(seed);
    for (let i = 0; i < this.blocks.length; i++) {
      if (!maskHas(mask, i)) continue;
      const block = this.blocks[i];
      for (let j = 0; j < this.blockSize; j++) out[j] ^= block[j];
    }
    return out;
  }
}
