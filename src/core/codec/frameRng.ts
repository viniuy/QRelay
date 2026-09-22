/**
 * Deterministic 32-bit generator shared by the encoder and the decoder.
 *
 * Both sides must derive the same block set from the same seed, so this is
 * pinned down to the bit and never replaced by Math.random. Not a
 * cryptographic generator; the stream is already ciphertext by the time it
 * reaches here.
 */
export class FrameRng {
  private a: number;

  constructor(seed: number) {
    this.a = seed >>> 0;
  }

  /** A double in [0, 1). */
  nextDouble(): number {
    this.a = (this.a + 0x6d2b79f5) >>> 0;
    let t = this.a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** An int in [0, max). */
  nextInt(max: number): number {
    return Math.floor(this.nextDouble() * max);
  }

  /** 32 random bits. */
  nextWord(): number {
    return Math.floor(this.nextDouble() * 4294967296) >>> 0;
  }

  /** Spreads a small seed (frame index) across 32 bits before it is used. */
  static mix(seed: number): number {
    return (Math.imul(seed, 2654435761) ^ 0x9e3779b9) >>> 0;
  }
}
