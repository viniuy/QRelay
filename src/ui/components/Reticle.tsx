import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { COLOR, SNAP } from '../motion';
import { usePalette } from '../theme';
import type { PhaseTint } from './parts';

export function Reticle({ tint }: { tint: PhaseTint }) {
  const c = usePalette();
  const locked = tint !== 'neutral';
  const inset = useSharedValue(locked ? 40 : 26);
  const color = useSharedValue(tint === 'amber' ? 1 : tint === 'green' ? 2 : 0);
  useEffect(() => {
    inset.value = withSpring(locked ? 40 : 26, SNAP);
    color.value = withTiming(tint === 'amber' ? 1 : tint === 'green' ? 2 : 0, COLOR);
  }, [tint, locked, inset, color]);

  const colors = ['#FFFFFF', c.key, c.lock];
  const useCorner = (top: boolean, left: boolean) =>
    useAnimatedStyle(() => ({
      top: top ? inset.value : undefined,
      bottom: top ? undefined : inset.value,
      left: left ? inset.value : undefined,
      right: left ? undefined : inset.value,
      borderColor: interpolateColor(color.value, [0, 1, 2], colors),
    }));

  const tl = useCorner(true, true);
  const tr = useCorner(true, false);
  const bl = useCorner(false, true);
  const br = useCorner(false, false);

  return (
    <View style={styles.fill} pointerEvents="none">
      <Animated.View style={[styles.c, styles.tl, tl]} />
      <Animated.View style={[styles.c, styles.tr, tr]} />
      <Animated.View style={[styles.c, styles.bl, bl]} />
      <Animated.View style={[styles.c, styles.br, br]} />
    </View>
  );
}

const w = 3;
const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  c: { position: 'absolute', width: 24, height: 24, borderColor: '#fff' },
  tl: { borderTopWidth: w, borderLeftWidth: w, borderTopLeftRadius: 6 },
  tr: { borderTopWidth: w, borderRightWidth: w, borderTopRightRadius: 6 },
  bl: { borderBottomWidth: w, borderLeftWidth: w, borderBottomLeftRadius: 6 },
  br: { borderBottomWidth: w, borderRightWidth: w, borderBottomRightRadius: 6 },
});
