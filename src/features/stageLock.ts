import * as Brightness from 'expo-brightness';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

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
  }
  previous = null;
  try {
    await deactivateKeepAwake(TAG);
  } catch {
  }
}
