import { Directory, File, Paths } from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

export interface PickedFile {
  name: string;
  mime: string;
  bytes: Uint8Array;
  uri?: string;
}

export interface SavedFile {
  uri: string;
  name: string;
}

export function mimeFor(name: string): string {
  const dot = name.lastIndexOf('.');
  const ext = dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
  const table: Record<string, string> = {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    doc: 'application/msword',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    heic: 'image/heic',
    webp: 'image/webp',
    gif: 'image/gif',
    txt: 'text/plain',
    md: 'text/plain',
    csv: 'text/csv',
    json: 'application/json',
    zip: 'application/zip',
  };
  return table[ext] ?? 'application/octet-stream';
}

export type PickResult =
  | { kind: 'picked'; files: PickedFile[] }
  | { kind: 'cancelled' }
  | { kind: 'tooLarge'; name: string; size: number };

export async function pickFiles(options: { maxBytes?: number; mimeTypes?: string | string[] } = {}): Promise<PickResult> {
  const max = options.maxBytes ?? Number.POSITIVE_INFINITY;
  const picked = await File.pickFileAsync({ multipleFiles: true, mimeTypes: options.mimeTypes });
  if (picked.canceled || picked.result === null || picked.result.length === 0) return { kind: 'cancelled' };
  for (const file of picked.result) if (file.size > max) return { kind: 'tooLarge', name: file.name, size: file.size };
  const files: PickedFile[] = [];
  for (const file of picked.result) {
    const type = file.type;
    files.push({ name: file.name, mime: type && type !== 'application/octet-stream' ? type : mimeFor(file.name), bytes: await file.bytes(), uri: file.uri });
  }
  return { kind: 'picked', files };
}

function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_') || 'received.bin';
}

export function saveBytes(bytes: Uint8Array, name: string, sub: 'received' | 'edited'): SavedFile {
  const dir = new Directory(Paths.document, sub);
  if (!dir.exists) dir.create({ intermediates: true });
  const safe = safeName(name);
  const dot = safe.lastIndexOf('.');
  const stem = dot > 0 ? safe.slice(0, dot) : safe;
  const ext = dot > 0 ? safe.slice(dot) : '';
  let candidate = new File(dir, safe);
  let n = 2;
  while (candidate.exists) {
    candidate = new File(dir, `${stem} (${n})${ext}`);
    n++;
  }
  candidate.create();
  candidate.write(bytes);
  return { uri: candidate.uri, name: candidate.name };
}

export type ExportResult = 'saved' | 'shared' | 'cancelled';

export async function exportCopy(bytes: Uint8Array, name: string, mime: string): Promise<ExportResult> {
  const safe = safeName(name);
  if (Platform.OS === 'android') {
    let dir: Directory;
    try {
      dir = await Directory.pickDirectoryAsync();
    } catch {
      return 'cancelled';
    }
    const file = dir.createFile(safe, mime);
    file.write(bytes);
    return 'saved';
  }
  const dir = new Directory(Paths.cache, `export-${Date.now()}`);
  dir.create({ intermediates: true });
  const file = new File(dir, safe);
  file.write(bytes);
  await shareFile(file.uri, mime);
  return 'shared';
}

export function scratchFile(bytes: Uint8Array, ext: string): File {
  const file = new File(Paths.cache, `qrelay-${Date.now()}-${Math.floor(Math.random() * 1e6)}.${ext}`);
  file.write(bytes);
  return file;
}

export function fileExists(uri: string): boolean {
  try {
    return new File(uri).exists;
  } catch {
    return false;
  }
}

export async function shareFile(uri: string, mime: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
  await Sharing.shareAsync(uri, { mimeType: mime, dialogTitle: 'QRelay' });
}

export async function openFile(uri: string, mime: string): Promise<void> {
  if (Platform.OS === 'android') {
    const contentUri = new File(uri).contentUri;
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', { data: contentUri, flags: 1, type: mime });
    return;
  }
  await shareFile(uri, mime);
}
