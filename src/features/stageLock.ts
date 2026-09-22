import * as Brightness from 'expo-brightness';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

/**
 * Full brightness and no sleep while a QR is on screen. Reference counted so
 * key → stream → key hand-offs keep it held; released when the last screen in
 * the flow goes away.
 */
let holders = 0;
let previous: number | null = null;
const TAG = 'qrelay-stage';

export async function acquireStage(keepAwake: boolean): Promise<void> {
  holders++;
  if (holders > 1) return;
  try {
    previous = await Brightness.getBrightnessAsync();
    await Brightness.setBrightnessAsync(1);
  } catch {
    previous = null;
  }
  if (keepAwake) {
    try {
      await activateKeepAwakeAsync(TAG);
    } catch {
      // Not available in this runtime; the screen may sleep. Nothing else to do.
    }
  }
}

export async function releaseStage(): Promise<void> {
  if (holders === 0) return;
  holders--;
  if (holders > 0) return;
  try {
    if (previous !== null) await Brightness.setBrightnessAsync(previous);
  } catch {
    // Ignore: the system takes brightness back when the app closes anyway.
  }
  previous = null;
  try {
    await deactivateKeepAwake(TAG);
  } catch {
    // Same.
  }
}
