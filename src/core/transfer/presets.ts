/**
 * How much each frame carries and how fast frames change.
 *
 * Starting values; the first real-phone session measures decode rates and
 * adjusts them.
 */
export type PresetId = 'reliable' | 'balanced' | 'fast';

export interface Preset {
  id: PresetId;
  label: string;
  blockSize: number;
  fps: number;
  /** QR version at error correction M for a full frame (computed, see plan). */
  qrVersion: number;
  when: string;
}

export const PRESETS: readonly Preset[] = [
  { id: 'reliable', label: 'Reliable', blockSize: 300, fps: 8, qrVersion: 13, when: 'Older cameras, cracked screens, low light' },
  { id: 'balanced', label: 'Balanced', blockSize: 500, fps: 10, qrVersion: 18, when: 'Any phone from 2019 on' },
  { id: 'fast', label: 'Fast', blockSize: 900, fps: 12, qrVersion: 25, when: 'Recent phones, steady hands, 20 cm' },
];

export function presetById(id: PresetId): Preset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[1];
}

export function blocksFor(fileSize: number, preset: Preset): number {
  return Math.max(1, Math.ceil((fileSize + 16) / preset.blockSize));
}

/**
 * Wall-clock estimate in seconds for one transfer, including the key hold and
 * a 5% repair allowance. A camera that misses frames adds to this; the app
 * says "about" for a reason.
 */
export function estimateSeconds(fileSize: number, preset: Preset, keySeconds = 3): number {
  return keySeconds + (blocksFor(fileSize, preset) * 1.05) / preset.fps + 0.4;
}

/** Soft warning above this size (the time estimate is shown either way). */
export const WARN_ABOVE_BYTES = 1024 * 1024;

/** Hard stop. 20 MB at 5 KB/s is over an hour; nobody will hold a phone that long. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
