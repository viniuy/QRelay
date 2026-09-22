import React, { useEffect } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { COLOR, haptic, SNAP } from '../motion';
import { usePalette } from '../theme';

interface Props {
  value: boolean;
  onChange: (value: boolean) => void;
  label: string;
}

/** Knob springs 20 pt; the track color changes in 180 ms. */
export function Toggle({ value, onChange, label }: Props) {
  const c = usePalette();
  const x = useSharedValue(value ? 1 : 0);
  useEffect(() => {
    x.value = withSpring(value ? 1 : 0, SNAP);
  }, [value, x]);
  const t = useSharedValue(value ? 1 : 0);
  useEffect(() => {
    t.value = withTiming(value ? 1 : 0, COLOR);
  }, [value, t]);

  const track = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(t.value, [0, 1], [c.line2, c.lock]) }));
  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: 3 + x.value * 20 }] }));

  return (
    <Pressable
      onPress={() => {
        haptic('selection');
        onChange(!value);
      }}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
      hitSlop={8}
    >
      <Animated.View style={[styles.track, track]}>
        <Animated.View style={[styles.knob, knob]} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: { width: 52, height: 32, borderRadius: 999, justifyContent: 'center' },
  knob: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
});
