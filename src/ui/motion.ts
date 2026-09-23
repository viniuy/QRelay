import * as Haptics from "expo-haptics";
import {
  Easing,
  ReduceMotion,
  type WithSpringConfig,
  type WithTimingConfig,
} from "react-native-reanimated";

/**
 * One spring, used everywhere.
 *
 * A control gives 4% under the finger in 80 ms, then springs back with a small
 * overshoot. By default every spring and timing here follows the OS
 * reduce-motion setting; Settings → Animations → "Always on" overrides that
 * for people who want the motion anyway. Animations that carry meaning (the
 * key countdown) pass `ReduceMotion.Never` themselves and ignore both.
 */
export const SPRING: WithSpringConfig = {
  mass: 1,
  stiffness: 420,
  damping: 22,
};

/** Stiffer spring for small parts (segmented thumb, toggle knob). */
export const SNAP: WithSpringConfig = { mass: 1, stiffness: 600, damping: 26 };

export const PRESSED_SCALE = 0.96;

export const PRESS: WithTimingConfig = {
  duration: 80,
  easing: Easing.out(Easing.quad),
};
export const COLOR: WithTimingConfig = {
  duration: 180,
  easing: Easing.out(Easing.quad),
};
export const FAST: WithTimingConfig = {
  duration: 120,
  easing: Easing.out(Easing.quad),
};
export const ENTER: WithTimingConfig = {
  duration: 320,
  easing: Easing.bezier(0.2, 0.8, 0.2, 1),
};
export const REVEAL: WithTimingConfig = {
  duration: 550,
  easing: Easing.bezier(0.3, 0.7, 0.3, 1),
};

/** Overshooting ease for one-shot pops (checks, block cells). */
export const OVERSHOOT: WithTimingConfig = {
  duration: 300,
  easing: Easing.bezier(0.3, 1.6, 0.4, 1),
};

export type MotionMode = "system" | "always";

let currentReduce: ReduceMotion = ReduceMotion.System;

/** The reduce-motion policy for configs built inline (repeats, entrances). */
export function reduceMotion(): ReduceMotion {
  return currentReduce;
}

/** Applies the Settings choice to every shared config. Called on start and on change. */
export function applyMotionMode(mode: MotionMode): void {
  currentReduce = mode === "always" ? ReduceMotion.Never : ReduceMotion.System;
  for (const config of [
    SPRING,
    SNAP,
    PRESS,
    COLOR,
    FAST,
    ENTER,
    REVEAL,
    OVERSHOOT,
  ]) {
    config.reduceMotion = currentReduce;
  }
}

export type HapticKind =
  | "none"
  | "light"
  | "medium"
  | "selection"
  | "success"
  | "warning";

let hapticsOn = true;

export function setHapticsEnabled(on: boolean): void {
  hapticsOn = on;
}

export function haptic(kind: HapticKind): void {
  if (!hapticsOn) return;
  switch (kind) {
    case "none":
      return;
    case "light":
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      return;
    case "medium":
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      return;
    case "selection":
      void Haptics.selectionAsync();
      return;
    case "success":
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return;
    case "warning":
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
  }
}
