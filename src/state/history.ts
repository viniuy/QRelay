import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export interface HistoryEntry {
  id: string;
  name: string;
  size: number;
  direction: "sent" | "received";
  at: number;
  /** Where the received copy lives, while it still exists. */
  uri?: string;
  mime?: string;
  seconds?: number;
}

interface HistoryState {
  entries: HistoryEntry[];
  add: (entry: Omit<HistoryEntry, "id">) => void;
  remove: (id: string) => void;
}

export const useHistory = create<HistoryState>()(
  persist(
    (set) => ({
      entries: [],
      add: (entry) =>
        set((s) => ({
          entries: [
            {
              ...entry,
              id: `${entry.at}-${Math.random().toString(36).slice(2, 8)}`,
            },
            ...s.entries,
          ].slice(0, 50),
        })),
      remove: (id) =>
        set((s) => ({ entries: s.entries.filter((e) => e.id !== id) })),
    }),
    { name: "qrelay.history", storage: createJSONStorage(() => AsyncStorage) },
  ),
);
