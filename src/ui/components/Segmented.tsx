import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { COLOR, haptic, SNAP } from '../motion';
import { radius, usePalette } from '../theme';
import { sans } from '../type';

interface Props<T extends string> {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}

/**
 * Pill segmented control. The thumb slides on a spring; label colors cross
 * fade in 180 ms; a selection haptic marks the change.
 */
export function Segmented<T extends string>({ options, value, onChange }: Props<T>) {
  const c = usePalette();
  const [width, setWidth] = useState(0);
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const pos = useSharedValue(index);

  useEffect(() => {
    pos.value = withSpring(index, SNAP);
  }, [index, pos]);

  const slot = width > 0 ? (width - 6) / options.length : 0;
  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: pos.value * slot }] }));

  return (
    <View style={[styles.track, { backgroundColor: c.paper3 }]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} accessibilityRole="radiogroup">
      {slot > 0 && (
        <Animated.View
          style={[
            styles.thumb,
            { width: slot, backgroundColor: c.paper2, shadowColor: '#000' },
            thumb,
          ]}
        />
      )}
      <View style={styles.row}>
        {options.map((o, i) => (
          <Label key={o.value} label={o.label} selected={i === index} onPress={() => {
            if (o.value === value) return;
            haptic('selection');
            onChange(o.value);
          }} />
        ))}
      </View>
    </View>
  );
}

function Label({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const c = usePalette();
  const t = useSharedValue(selected ? 1 : 0);
  useEffect(() => {
    t.value = withTiming(selected ? 1 : 0, COLOR);
  }, [selected, t]);
  const style = useAnimatedStyle(() => ({ color: interpolateColor(t.value, [0, 1], [c.muted, c.text]) }));
  return (
    <Pressable onPress={onPress} style={styles.cell} accessibilityRole="radio" accessibilityState={{ selected }}>
      <Animated.Text style={[sans(13.5, 600), style]}>{label}</Animated.Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: { height: 42, borderRadius: radius.pill, padding: 3, justifyContent: 'center' },
  thumb: {
    position: 'absolute',
    top: 3,
    bottom: 3,
    left: 3,
    borderRadius: radius.pill,
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  row: { flexDirection: 'row' },
  cell: { flex: 1, height: 36, alignItems: 'center', justifyContent: 'center' },
});
