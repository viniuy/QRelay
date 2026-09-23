import type { SenderSession } from '../transfer/senderSession';
import { matrixToPath, renderMatrix, type BitMatrix } from './matrix';

export interface RenderedFrame {
  seed: number;
  matrix: BitMatrix;
  path: string;
}

/**
 * Builds frames ahead of the stream, one per event-loop turn, so the UI
 * thread never blocks for more than a few milliseconds. A v18 frame takes
 * about 3 ms to XOR, base45-encode, QR-encode and turn into a path.
 */
export class FrameCache {
  private readonly frames = new Map<number, RenderedFrame>();
  private queue: number[] = [];
  private pumping = false;
  private disposed = false;

  constructor(private readonly session: SenderSession, readonly window = 40) {}

  get(seed: number): RenderedFrame | null {
    return this.frames.get(seed) ?? null;
  }

  /** Makes sure seeds `from .. from + window` are built or queued. */
  ensure(from: number): void {
    for (let s = from; s < from + this.window; s++) {
      if (!this.frames.has(s) && !this.queue.includes(s)) this.queue.push(s);
    }
    for (const seed of Array.from(this.frames.keys())) if (seed < from - 4) this.frames.delete(seed);
    this.pump();
  }

  /** Builds one frame right now (used for the very first frame). */
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
