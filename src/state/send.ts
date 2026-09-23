import { create } from 'zustand';

import { type Packed, packAsync } from '../core/codec/pack';
import { MAX_FILE_BYTES, type PresetId, presetById } from '../core/transfer/presets';
import { type PrepareProgress, SenderSession } from '../core/transfer/senderSession';
import { mergePdfs } from '../features/edit/editService';
import { type PickedFile, pickFiles } from '../files/files';
import { useSettings } from './settings';

export type PickOutcome = 'picked' | 'merged' | 'cancelled' | 'error';

interface SendState {
  file: PickedFile | null;
  original: PickedFile | null;
  packed: Packed | null;
  preset: PresetId;
  session: SenderSession | null;
  error: string | null;
  pick: () => Promise<PickOutcome>;
  setFile: (file: PickedFile, keepOriginal?: boolean) => void;
  undoEdit: () => void;
  setPreset: (preset: PresetId) => void;
  prepare: (onProgress?: PrepareProgress) => Promise<SenderSession>;
  endSession: () => void;
  reset: () => void;
}

let packGeneration = 0;
let packPromise: Promise<Packed> | null = null;

export const useSend = create<SendState>((set, get) => {
  const startPacking = (file: PickedFile) => {
    const generation = ++packGeneration;
    set({ packed: null });
    packPromise = packAsync(file.bytes)
      .catch((): Packed => ({ method: 'none', bytes: file.bytes, rawSize: file.bytes.length }))
      .then((packed) => {
        if (generation === packGeneration) set({ packed });
        return packed;
      });
  };

  const adopt = (file: PickedFile, original: PickedFile | null) => {
    set({ file, original, session: null, error: null });
    startPacking(file);
  };

  return {
    file: null,
    original: null,
    packed: null,
    preset: useSettings.getState().preset,
    session: null,
    error: null,

    pick: async () => {
      try {
        const result = await pickFiles({ maxBytes: MAX_FILE_BYTES });
        if (result.kind === 'cancelled') return 'cancelled';
        if (result.kind === 'tooLarge') {
          set({ error: `${result.name} is ${(result.size / (1024 * 1024)).toFixed(1)} MB. QRelay stops at 20 MB; a QR stream would take over an hour.` });
          return 'error';
        }
        const files = result.files;
        if (files.some((f) => f.bytes.length === 0)) {
          set({ error: files.length === 1 ? 'That file is empty.' : 'One of those files is empty.' });
          return 'error';
        }
        if (files.length === 1) {
          adopt(files[0], null);
          return 'picked';
        }
        if (!files.every((f) => f.mime === 'application/pdf')) {
          set({ error: 'Pick one file, or several PDFs to merge into one.' });
          return 'error';
        }
        const merged = await mergePdfs(files);
        if (merged.file.bytes.length > MAX_FILE_BYTES) {
          set({ error: `Merged, those come to ${(merged.file.bytes.length / (1024 * 1024)).toFixed(1)} MB. QRelay stops at 20 MB.` });
          return 'error';
        }
        adopt(merged.file, null);
        return 'merged';
      } catch (e) {
        set({ error: `That file could not be read. ${e instanceof Error ? e.message : ''}`.trim() });
        return 'error';
      }
    },

    setFile: (file, keepOriginal = true) => {
      const s = get();
      adopt(file, keepOriginal ? (s.original ?? s.file) : null);
    },

    undoEdit: () => {
      const s = get();
      if (s.original) adopt(s.original, null);
    },

    setPreset: (preset) => set((s) => (s.preset === preset ? {} : { preset, session: null })),

    prepare: async (onProgress) => {
      const s = get();
      if (s.session && s.session.preset.id === s.preset) return s.session;
      if (!s.file) throw new Error('no file');
      const file = s.file;
      onProgress?.('packing', 0);
      const packed = s.packed ?? (await (packPromise ?? packAsync(file.bytes)));
      const session = await SenderSession.create(file, presetById(get().preset), onProgress, packed);
      if (get().file === file) set({ session });
      return session;
    },

    endSession: () => set({ session: null }),

    reset: () => {
      packGeneration++;
      packPromise = null;
      set({ file: null, original: null, packed: null, session: null, error: null, preset: useSettings.getState().preset });
    },
  };
});

export function streamBytes(s: Pick<SendState, 'file' | 'packed'>): number {
  return s.packed?.bytes.length ?? s.file?.bytes.length ?? 0;
}
