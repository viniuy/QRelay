import { create } from 'zustand';

import { sessionLabel } from '../core/codec/framing';
import { VerificationError } from '../core/crypto/sessionCrypto';
import { ReceiverSession } from '../core/transfer/receiverSession';
import { saveBytes, type SavedFile } from '../files/files';
import { useHistory } from './history';

export type ReceivePhase = 'searching' | 'keyLocked' | 'receiving' | 'verifying' | 'done' | 'failed';

interface ReceiveState {
  phase: ReceivePhase;
  name: string | null;
  mime: string | null;
  size: number | null;
  label: string | null;
  blockCount: number;
  blockSize: number;
  solved: number;
  frames: number;
  duplicates: number;
  decodeFps: number;
  /** A frame from another sender's session showed up. */
  otherSessionSeen: boolean;
  /** Data frames are arriving but no key has been read yet. */
  needKeySeen: boolean;
  startedAt: number;
  dataStartedAt: number | null;
  finishedAt: number | null;
  saved: SavedFile | null;
  bytes: Uint8Array | null;
  error: string | null;
  /** Changes whenever the solved set changes; the block grid keys off it. */
  tick: number;
  reset: () => void;
  feed: (raw: string) => void;
  isSolved: (block: number) => boolean;
}

let session = new ReceiverSession();
let decodeTimes: number[] = [];
let finishing = false;
let lastPublish = 0;
let publishTimer: ReturnType<typeof setTimeout> | null = null;

const initial = () => ({
  phase: 'searching' as ReceivePhase,
  name: null,
  mime: null,
  size: null,
  label: null,
  blockCount: 0,
  blockSize: 0,
  solved: 0,
  frames: 0,
  duplicates: 0,
  decodeFps: 0,
  otherSessionSeen: false,
  needKeySeen: false,
  startedAt: Date.now(),
  dataStartedAt: null,
  finishedAt: null,
  saved: null,
  bytes: null,
  error: null,
  tick: 0,
});

export const useReceive = create<ReceiveState>((set, get) => ({
  ...initial(),

  reset: () => {
    session = new ReceiverSession();
    decodeTimes = [];
    finishing = false;
    lastPublish = 0;
    if (publishTimer) clearTimeout(publishTimer);
    publishTimer = null;
    set(initial());
  },

  isSolved: (block) => session.isSolved(block),

  feed: (raw) => {
    const s = get();
    if (s.phase === 'verifying' || s.phase === 'done' || s.phase === 'failed') return;
    const event = session.feed(raw);
    const now = Date.now();

    switch (event) {
      case 'ignored':
        return;
      case 'needKey':
        if (!s.needKeySeen) set({ needKeySeen: true });
        return;
      case 'otherSession':
        if (!s.otherSessionSeen) set({ otherSessionSeen: true });
        return;
      case 'keyLocked': {
        const key = session.key!;
        set({
          phase: 'keyLocked',
          name: key.name,
          mime: key.mime,
          size: key.rawSize,
          label: sessionLabel(key.sessionId),
          blockCount: key.blockCount,
          blockSize: key.blockSize,
          needKeySeen: false,
        });
        return;
      }
      case 'duplicate':
      case 'frame':
      case 'complete': {
        decodeTimes.push(now);
        while (decodeTimes.length > 0 && now - decodeTimes[0] > 1000) decodeTimes.shift();
        const publish = () =>
          set((prev) => ({
            phase: event === 'complete' ? 'verifying' : 'receiving',
            solved: session.solvedCount,
            frames: session.framesSeen,
            duplicates: session.duplicates,
            decodeFps: decodeTimes.length,
            dataStartedAt: prev.dataStartedAt ?? now,
            tick: prev.solved === session.solvedCount ? prev.tick : prev.tick + 1,
          }));
        // Camera callbacks can arrive 20+ times a second; the screen needs about 10.
        if (event === 'complete' || now - lastPublish > 90) {
          lastPublish = now;
          if (publishTimer) clearTimeout(publishTimer);
          publishTimer = null;
          publish();
        } else if (!publishTimer) {
          publishTimer = setTimeout(() => {
            publishTimer = null;
            lastPublish = Date.now();
            publish();
          }, 100);
        }
        if (event === 'complete') void finish(set);
        return;
      }
    }
  },
}));

async function finish(set: (partial: Partial<ReceiveState>) => void): Promise<void> {
  if (finishing) return;
  finishing = true;
  const key = session.key!;
  try {
    // Let the "Verifying" frame paint before the decrypt burns the thread.
    await new Promise((r) => setTimeout(r, 30));
    const bytes = await session.finish();
    const saved = saveBytes(bytes, key.name, 'received');
    const finishedAt = Date.now();
    set({ phase: 'done', bytes, saved, finishedAt });
    const st = useReceive.getState();
    useHistory.getState().add({
      name: saved.name,
      size: bytes.length,
      direction: 'received',
      at: finishedAt,
      uri: saved.uri,
      mime: key.mime,
      seconds: (finishedAt - st.startedAt) / 1000,
    });
  } catch (e) {
    const verification = e instanceof VerificationError;
    set({
      phase: 'failed',
      finishedAt: Date.now(),
      error: verification
        ? 'The file did not verify. Nothing was saved. Ask the sender to start again, and try the Reliable preset.'
        : `Could not save the file. ${e instanceof Error ? e.message : ''}`.trim(),
    });
  }
}

/** Seconds left at the current solve rate, null before there is a rate. */
export function etaSeconds(s: ReceiveState): number | null {
  if (s.dataStartedAt === null || s.solved < 2) return null;
  const secs = (Date.now() - s.dataStartedAt) / 1000;
  if (secs < 0.5) return null;
  const rate = s.solved / secs;
  return Math.ceil((s.blockCount - s.solved) / rate);
}

export function goodputBytesPerSecond(s: ReceiveState): number {
  if (s.dataStartedAt === null || s.solved === 0) return 0;
  const secs = ((s.finishedAt ?? Date.now()) - s.dataStartedAt) / 1000;
  if (secs < 0.3) return 0;
  return (s.solved * s.blockSize) / secs;
}
