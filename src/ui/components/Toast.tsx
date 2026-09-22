import React, { useEffect } from 'react';
import { StyleSheet, Text } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';

import { reduceMotion, SPRING } from '../motion';
import { usePalette } from '../theme';
import { sans } from '../type';

interface ToastState {
  text: string;
  shownAt: number;
  show: (text: string) => void;
}

export const useToast = create<ToastState>((set) => ({
  text: '',
  shownAt: 0,
  show: (text) => set({ text, shownAt: Date.now() }),
}));

export function toast(text: string): void {
  useToast.getState().show(text);
}

/** Ink pill at the bottom of the screen. Springs up, holds 1.5 s, drops. */
export function ToastHost() {
  const c = usePalette();
  const insets = useSafeAreaInsets();
  const { text, shownAt } = useToast();
  const y = useSharedValue(40);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (shownAt === 0) return;
    y.value = 40;
    opacity.value = 0;
    y.value = withSequence(withSpring(0, SPRING), withDelay(1500, withTiming(40, { duration: 220, reduceMotion: reduceMotion() })));
    opacity.value = withSequence(withTiming(1, { duration: 160, reduceMotion: reduceMotion() }), withDelay(1500, withTiming(0, { duration: 200, reduceMotion: reduceMotion() })));
  }, [shownAt, y, opacity]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ translateY: y.value }] }));

  if (shownAt === 0) return null;
  return (
    <Animated.View pointerEvents="none" style={[styles.toast, { bottom: insets.bottom + 24, backgroundColor: c.ink }, style]} accessibilityLiveRegion="polite">
      <Text style={[sans(13.5, 600, { color: c.paper }), { textAlign: 'center' }]}>{text}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: { position: 'absolute', left: 20, right: 20, paddingVertical: 11, paddingHorizontal: 14, borderRadius: 12 },
});
