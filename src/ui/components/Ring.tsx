import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedProps, useAnimatedStyle, useSharedValue, withRepeat, withTiming, type SharedValue } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { reduceMotion } from '../motion';
import { usePalette } from '../theme';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export function Ring({ size, progress, children }: { size: number; progress: SharedValue<number>; children: React.ReactNode }) {
  const c = usePalette();
  const r = size / 2 - 3;
  const circumference = 2 * Math.PI * r;
  const props = useAnimatedProps(() => ({ strokeDashoffset: circumference * progress.value }));
  return (
    <View style={{ width: size, height: size }}>
      <Pulse size={size} delay={0} />
      <Pulse size={size} delay={700} />
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={styles.ring}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={c.keySoft} strokeWidth={4} fill="none" />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={c.key}
          strokeWidth={4}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${circumference}`}
          animatedProps={props}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={styles.center}>{children}</View>
    </View>
  );
}

function Pulse({ size, delay }: { size: number; delay: number }) {
  const c = usePalette();
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = 0;
    const start = setTimeout(() => {
      t.value = withRepeat(withTiming(1, { duration: 2000, easing: Easing.out(Easing.quad) }), -1, false, undefined, reduceMotion());
    }, delay);
    return () => clearTimeout(start);
  }, [delay, t]);
  const style = useAnimatedStyle(() => ({
    opacity: 0.6 * (1 - t.value),
    transform: [{ scale: 0.9 + 0.32 * t.value }],
  }));
  return <Animated.View pointerEvents="none" style={[styles.pulse, { width: size, height: size, borderRadius: size / 2, borderColor: c.key }, style]} />;
}

const styles = StyleSheet.create({
  ring: { position: 'absolute', top: 0, left: 0 },
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  pulse: { position: 'absolute', top: 0, left: 0, borderWidth: 2 },
});
