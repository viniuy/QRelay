import { BlockSelector } from './blockSelector';

/** What one incoming frame did. */
export type AddResult =
  /** Seed already seen (the camera caught the same frame twice). */
  | 'duplicate'
  /** Carried nothing new: every block in it was already known, or it was a combination of frames already held. */
  | 'redundant'
  /** Stored as an equation; needs more frames before it resolves. */
  | 'kept'
  /** Solved at least one new block. */
  | 'solved'
  /** That frame finished the file. */
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

/**
 * Incremental Gaussian elimination over GF(2).
 *
 * Each frame is one equation over the K blocks. Known blocks are XORed out on
 * arrival, then the row is reduced against the pivot rows held so far. A row
 * that ends with one bit solves that block on the spot and the solution is
 * pushed through every stored row (which is what makes the in-order pass
 * decode instantly). When every unsolved block has a pivot, one
 * back-substitution finishes the rest. Cost per frame is one pass over the
 * stored rows, well under a millisecond at K = 2000.
 */
export class FountainDecoder {
  private readonly selector: BlockSelector;
  private readonly solved: (Uint8Array | null)[];
  /** Echelon rows keyed by pivot column (the row's lowest set bit). */
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

  /** Equations held that have not resolved yet. */
  get pendingCount(): number {
    return this.pivots.size;
  }

  isSolved(block: number): boolean {
    return this.solved[block] !== null;
  }

  /** Feed one frame. `payload` must be exactly `blockSize` bytes. */
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

  /** The ciphertext, trimmed to `length`. Only valid once complete. */
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

  /**
   * With a pivot for every unsolved column the system is triangular: walk
   * pivots from the highest column down, substituting as we go.
   */
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
          // Not triangular after all (a column without a pivot above us);
          // keep the row and wait for more frames.
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
