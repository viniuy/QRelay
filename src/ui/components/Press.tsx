import React from 'react';
import { Pressable, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { haptic, type HapticKind, PRESS, PRESSED_SCALE, SPRING } from '../motion';

interface Props {
  children: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  haptic?: HapticKind;
  pressedScale?: number;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessibilityRole?: 'button' | 'switch' | 'radio' | 'checkbox' | 'tab';
  accessibilityState?: { disabled?: boolean; selected?: boolean; checked?: boolean };
  hitSlop?: number;
}

export function Press({
  children,
  onPress,
  onLongPress,
  disabled = false,
  haptic: kind = 'light',
  pressedScale = PRESSED_SCALE,
  style,
  accessibilityLabel,
  accessibilityRole = 'button',
  accessibilityState,
  hitSlop,
}: Props) {
  const scale = useSharedValue(1);
  const active = !disabled && (onPress !== undefined || onLongPress !== undefined);

  const down = () => {
    if (!active) return;
    haptic(kind);
    scale.value = withTiming(pressedScale, PRESS);
  };

  const up = () => {
    scale.value = withSpring(1, { ...SPRING, velocity: 2.5 });
  };

  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Pressable
      onPressIn={down}
      onPressOut={up}
      onPress={active ? onPress : undefined}
      onLongPress={active ? onLongPress : undefined}
      disabled={!active}
      hitSlop={hitSlop}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !active, ...accessibilityState }}
    >
      <Animated.View style={[style, animated]}>{children}</Animated.View>
    </Pressable>
  );
}
