import type { TextStyle } from 'react-native';

export const fontAssets = {
  'Bricolage-400': require('../../assets/fonts/BricolageGrotesque-400.ttf'),
  'Bricolage-500': require('../../assets/fonts/BricolageGrotesque-500.ttf'),
  'Bricolage-600': require('../../assets/fonts/BricolageGrotesque-600.ttf'),
  'Bricolage-700': require('../../assets/fonts/BricolageGrotesque-700.ttf'),
  'Mono-400': require('../../assets/fonts/JetBrainsMono-400.ttf'),
  'Mono-500': require('../../assets/fonts/JetBrainsMono-500.ttf'),
  'Mono-600': require('../../assets/fonts/JetBrainsMono-600.ttf'),
};

export type SansWeight = 400 | 500 | 600 | 700;
export type MonoWeight = 400 | 500 | 600;

interface Opts {
  color?: string;
  lineHeight?: number;
  letterSpacing?: number;
}

export function sans(size: number, weight: SansWeight = 400, opts: Opts = {}): TextStyle {
  return {
    fontFamily: `Bricolage-${weight}`,
    fontSize: size,
    lineHeight: opts.lineHeight ?? Math.round(size * 1.3),
    letterSpacing: opts.letterSpacing ?? (size >= 20 ? -size * 0.02 : 0),
    color: opts.color,
  };
}

export function mono(size: number, weight: MonoWeight = 400, opts: Opts = {}): TextStyle {
  return {
    fontFamily: `Mono-${weight}`,
    fontSize: size,
    lineHeight: opts.lineHeight ?? Math.round(size * 1.4),
    letterSpacing: opts.letterSpacing ?? 0,
    color: opts.color,
    fontVariant: ['tabular-nums'],
  };
}

export function eyebrow(color: string): TextStyle {
  return { ...mono(11, 500, { color, letterSpacing: 0.9 }), textTransform: 'uppercase' };
}
