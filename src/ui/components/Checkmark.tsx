import React, { useEffect } from 'react';
import Animated, { useAnimatedProps, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';

import { REVEAL } from '../motion';
import { usePalette } from '../theme';

const AnimatedPath = Animated.createAnimatedComponent(Path);

/** The check draws itself in 550 ms after a short beat. Path length is about 54 units. */
export function Checkmark({ size = 96 }: { size?: number }) {
  const c = usePalette();
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(180, withTiming(1, REVEAL));
  }, [t]);
  const props = useAnimatedProps(() => ({ strokeDashoffset: 60 * (1 - t.value) }));
  return (
    <Svg width={size} height={size} viewBox="0 0 96 96">
      <Circle cx="48" cy="48" r="46" fill={c.lockSoft} stroke={c.lock} strokeWidth={2} />
      <AnimatedPath
        d="M30 49l12 12 25-27"
        stroke={c.lockInk}
        strokeWidth={5}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        strokeDasharray="60"
        animatedProps={props}
      />
    </Svg>
  );
}
