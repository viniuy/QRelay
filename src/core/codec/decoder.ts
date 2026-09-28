import { BlockSelector } from './blockSelector';

export type AddResult =
  | 'duplicate'
  | 'redundant'
  | 'kept'
  | 'solved'
  | 'complete';

class Row {
  constructor(readonly bits: Uint32Array, readonly data: Uint8Array) {}

  has(b: number): boolean {
    return (this.bits[b >> 5] & (1 << (b & 31))) !== 0;
  }

  clear(b: number): void {
    this.bits[b >> 5] &= ~(1 << (b & 31));
  }

  isEmpty(): boolean {
    for (let w = 0; w < this.bits.length; w++) if (this.bits[w] !== 0) return false;
    return true;
  }

  lowestBit(): number {
    for (let w = 0; w < this.bits.length; w++) {
      const v = this.bits[w];
      if (v === 0) continue;
      let bit = 0;
      while (((v >>> bit) & 1) === 0) bit++;
      return (w << 5) + bit;
    }
    return -1;
  }

  popcount(): number {
    let n = 0;
    for (let w = 0; w < this.bits.length; w++) {
      let v = this.bits[w] | 0;
      while (v !== 0) {
        v &= v - 1;
        n++;
      }
    }
    return n;
  }

  xorRow(other: Row): void {
    for (let w = 0; w < this.bits.length; w++) this.bits[w] ^= other.bits[w];
    xorInto(this.data, other.data);
  }
}

function xorInto(target: Uint8Array, other: Uint8Array): void {
  for (let i = 0; i < target.length; i++) target[i] ^= other[i];
}

export class FountainDecoder {
  private readonly selector: BlockSelector;
  private readonly solved: (Uint8Array | null)[];
  private readonly pivots = new Map<number, Row>();
  private readonly seen = new Set<number>();
  private solvedCountValue = 0;

  constructor(readonly blockCount: number, readonly blockSize: number) {
    if (blockCount < 1 || blockSize < 1) throw new Error('bad decoder dimensions');
    this.selector = new BlockSelector(blockCount);
    this.solved = new Array<Uint8Array | null>(blockCount).fill(null);
  }

  get solvedCount(): number {
    return this.solvedCountValue;
  }

  get unsolvedCount(): number {
    return this.blockCount - this.solvedCountValue;
  }

  get isComplete(): boolean {
    return this.solvedCountValue === this.blockCount;
  }

  get uniqueFrames(): number {
    return this.seen.size;
  }

  get pendingCount(): number {
    return this.pivots.size;
  }

  isSolved(block: number): boolean {
    return this.solved[block] !== null;
  }

  solvedMap(): Uint8Array {
    const map = new Uint8Array(this.blockCount);
    for (let i = 0; i < this.blockCount; i++) if (this.solved[i] !== null) map[i] = 1;
    return map;
  }

  add(seed: number, payload: Uint8Array): AddResult {
    if (payload.length !== this.blockSize) {
      throw new Error(`payload is ${payload.length} bytes, block size is ${this.blockSize}`);
    }
    if (this.isComplete) return 'redundant';
    if (this.seen.has(seed)) return 'duplicate';
    this.seen.add(seed);

    const row = new Row(this.selector.maskFor(seed), Uint8Array.from(payload));
    for (let b = 0; b < this.blockCount; b++) {
      if (!row.has(b)) continue;
      const known = this.solved[b];
      if (known !== null) {
        row.clear(b);
        xorInto(row.data, known);
      }
    }

    const before = this.solvedCountValue;
    this.reduceAndInsert(row);
    if (this.isComplete) return 'complete';
    if (this.solvedCountValue > before) return 'solved';
    if (this.pivots.size >= this.unsolvedCount) {
      this.backSubstitute();
      if (this.isComplete) return 'complete';
      if (this.solvedCountValue > before) return 'solved';
    }
    return row.isEmpty() ? 'redundant' : 'kept';
  }

  assemble(length: number): Uint8Array {
    if (!this.isComplete) throw new Error('decode is not complete');
    const out = new Uint8Array(this.blockCount * this.blockSize);
    for (let i = 0; i < this.blockCount; i++) out.set(this.solved[i]!, i * this.blockSize);
    return out.subarray(0, length);
  }

  private reduceAndInsert(row: Row): void {
    for (;;) {
      const c = row.lowestBit();
      if (c < 0) return;
      const pivot = this.pivots.get(c);
      if (pivot === undefined) {
        if (row.popcount() === 1) this.solve(c, row.data);
        else this.pivots.set(c, row);
        return;
      }
      row.xorRow(pivot);
    }
  }

  private solve(block: number, data: Uint8Array): void {
    if (this.solved[block] !== null) return;
    this.solved[block] = data;
    this.solvedCountValue++;
    const queue = [block];
    while (queue.length > 0) {
      const b = queue.pop()!;
      const known = this.solved[b]!;
      const resolved: number[] = [];
      for (const [c, row] of this.pivots) {
        if (!row.has(b)) continue;
        row.clear(b);
        xorInto(row.data, known);
        if (row.popcount() === 1) resolved.push(c);
      }
      for (const c of resolved) {
        const row = this.pivots.get(c)!;
        this.pivots.delete(c);
        if (this.solved[c] === null) {
          this.solved[c] = row.data;
          this.solvedCountValue++;
          queue.push(c);
        }
      }
    }
  }

  private backSubstitute(): void {
    const columns = Array.from(this.pivots.keys()).sort((a, b) => b - a);
    for (const c of columns) {
      const row = this.pivots.get(c);
      if (row === undefined) continue;
      this.pivots.delete(c);
      if (this.solved[c] !== null) continue;
      let stuck = false;
      for (let b = c + 1; b < this.blockCount; b++) {
        if (!row.has(b)) continue;
        const known = this.solved[b];
        if (known === null) {
          stuck = true;
          break;
        }
        row.clear(b);
        xorInto(row.data, known);
      }
      if (stuck) {
        this.pivots.set(c, row);
        continue;
      }
      this.solved[c] = row.data;
      this.solvedCountValue++;
    }
  }
}
