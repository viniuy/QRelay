export class FrameRng {
  private a: number;

  constructor(seed: number) {
    this.a = seed >>> 0;
  }

  nextDouble(): number {
    this.a = (this.a + 0x6d2b79f5) >>> 0;
    let t = this.a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  nextInt(max: number): number {
    return Math.floor(this.nextDouble() * max);
  }

  nextWord(): number {
    return Math.floor(this.nextDouble() * 4294967296) >>> 0;
  }

  static mix(seed: number): number {
    return (Math.imul(seed, 2654435761) ^ 0x9e3779b9) >>> 0;
  }
}
