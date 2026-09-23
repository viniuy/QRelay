import { useColorScheme } from 'react-native';

export const light = {
  paper: '#F3F4F0',
  paper2: '#FFFFFF',
  paper3: '#E8EBE4',
  paper4: '#DCE0D8',
  ink: '#131614',
  text: '#131614',
  muted: '#66706A',
  faint: '#98A29B',
  line: '#D5D9D1',
  line2: '#BCC3BA',
  key: '#E39A00',
  keyInk: '#8A5C00',
  keySoft: '#FFF0CF',
  lock: '#159A5C',
  lockInk: '#0B6A3F',
  lockSoft: '#D8F3E3',
  danger: '#CE3E2B',
  onKey: '#1A1200',
  onLock: '#03160C',
  bezel: '#1A1D1B',
  isDark: false,
} as const;

export const dark = {
  paper: '#0F1210',
  paper2: '#171B18',
  paper3: '#1F2521',
  paper4: '#2A312C',
  ink: '#F1F3EE',
  text: '#EDF0EA',
  muted: '#98A29B',
  faint: '#66706A',
  line: '#2A312C',
  line2: '#3D463F',
  key: '#FFB92E',
  keyInk: '#FFCD62',
  keySoft: '#3A2905',
  lock: '#37CF87',
  lockInk: '#7FE7B6',
  lockSoft: '#0E3423',
  danger: '#F06A57',
  onKey: '#1A1200',
  onLock: '#03160C',
  bezel: '#2A2E2B',
  isDark: true,
} as const;

export type Palette = { [K in keyof typeof light]: (typeof light)[K] extends string ? string : boolean };

export function usePalette(): Palette {
  return useColorScheme() === 'dark' ? dark : light;
}

export const stage = {
  bg: '#000000',
  card: '#FFFFFF',
  text: '#FFFFFF',
  muted: '#7D857F',
  control: '#1C1C1C',
  outline: '#3A3A3A',
} as const;

export const radius = {
  pill: 999,
  card: 16,
  cardLarge: 22,
  field: 14,
  small: 10,
} as const;
