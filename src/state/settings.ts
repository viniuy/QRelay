import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { PresetId } from '../core/transfer/presets';
import type { MotionMode } from '../ui/motion';

interface SettingsState {
  preset: PresetId;
  /** How long the key QR stays up before the stream starts, 2 to 10. */
  keyHoldSeconds: number;
  haptics: boolean;
  keepAwake: boolean;
  /** Follow the OS reduce-motion setting, or animate regardless. */
  motion: MotionMode;
  setPreset: (preset: PresetId) => void;
  setKeyHoldSeconds: (seconds: number) => void;
  setHaptics: (on: boolean) => void;
  setKeepAwake: (on: boolean) => void;
  setMotion: (mode: MotionMode) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      preset: 'balanced',
      keyHoldSeconds: 3,
      haptics: true,
      keepAwake: true,
      motion: 'system',
      setPreset: (preset) => set({ preset }),
      setKeyHoldSeconds: (seconds) => set({ keyHoldSeconds: Math.min(10, Math.max(2, Math.round(seconds))) }),
      setHaptics: (haptics) => set({ haptics }),
      setKeepAwake: (keepAwake) => set({ keepAwake }),
      setMotion: (motion) => set({ motion }),
    }),
    { name: 'qrelay.settings', storage: createJSONStorage(() => AsyncStorage) },
  ),
);
