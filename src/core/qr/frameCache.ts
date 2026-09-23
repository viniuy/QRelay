import type { SenderSession } from '../transfer/senderSession';
import { matrixToPath, renderMatrix, type BitMatrix } from './matrix';

export interface RenderedFrame {
  seed: number;
  matrix: BitMatrix;
  path: string;
}

export class FrameCache {
  private readonly frames = new Map<number, RenderedFrame>();
  private queue: number[] = [];
  private pumping = false;
  private disposed = false;

  constructor(private readonly session: SenderSession, readonly window = 40) {}

  get(seed: number): RenderedFrame | null {
    return this.frames.get(seed) ?? null;
  }

  ensure(from: number): void {
    for (let s = from; s < from + this.window; s++) {
      if (!this.frames.has(s) && !this.queue.includes(s)) this.queue.push(s);
    }
    for (const seed of Array.from(this.frames.keys())) if (seed < from - 4) this.frames.delete(seed);
    this.pump();
  }

  build(seed: number): RenderedFrame {
    const cached = this.frames.get(seed);
    if (cached) return cached;
    const matrix = renderMatrix(this.session.frameText(seed), this.session.preset.qrVersion);
    const frame = { seed, matrix, path: matrixToPath(matrix, 2) };
    this.frames.set(seed, frame);
    return frame;
  }

  dispose(): void {
    this.disposed = true;
    this.queue = [];
    this.frames.clear();
  }

  private pump(): void {
    if (this.pumping || this.disposed) return;
    this.pumping = true;
    const step = () => {
      if (this.disposed) return;
      const seed = this.queue.shift();
      if (seed === undefined) {
        this.pumping = false;
        return;
      }
      if (!this.frames.has(seed)) this.build(seed);
      setTimeout(step, 0);
    };
    setTimeout(step, 0);
  }
}

export function renderKey(session: SenderSession): RenderedFrame {
  const matrix = renderMatrix(session.keyText);
  return { seed: -1, matrix, path: matrixToPath(matrix, 2) };
}
