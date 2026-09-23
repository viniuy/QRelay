import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { Icon, type IconName } from '../Icons';
import { COLOR, FAST } from '../motion';
import { radius, stage, usePalette } from '../theme';
import { sans } from '../type';
import { Press } from './Press';

export type ButtonKind =
  | 'primary'
  | 'secondary'
  | 'key'
  | 'lock'
  | 'ghost'
  | 'onBlack'
  | 'onBlackSecondary';

interface Props {
  label: string;
  onPress?: () => void;
  kind?: ButtonKind;
  busy?: boolean;
  disabled?: boolean;
  icon?: IconName;
  expand?: boolean;
}

export function Button({ label, onPress, kind = 'primary', busy = false, disabled = false, icon, expand = true }: Props) {
  const c = usePalette();
  const enabled = !disabled && !busy && onPress !== undefined;

  let bg: string;
  let fg: string;
  let outline: string | undefined;
  switch (kind) {
    case 'primary':
      bg = c.ink;
      fg = c.paper;
      break;
    case 'secondary':
      bg = 'transparent';
      fg = c.text;
      outline = c.line2;
      break;
    case 'key':
      bg = c.key;
      fg = c.onKey;
      break;
    case 'lock':
      bg = c.lock;
      fg = c.onLock;
      break;
    case 'ghost':
      bg = 'transparent';
      fg = c.muted;
      break;
    case 'onBlack':
      bg = stage.card;
      fg = '#000000';
      break;
    case 'onBlackSecondary':
      bg = 'transparent';
      fg = stage.text;
      outline = stage.outline;
      break;
  }

  const dim = useSharedValue(disabled && !busy ? 0.4 : 1);
  const labelOpacity = useSharedValue(busy ? 0 : 1);
  useEffect(() => {
    dim.value = withTiming(disabled && !busy ? 0.4 : 1, COLOR);
    labelOpacity.value = withTiming(busy ? 0 : 1, FAST);
  }, [disabled, busy, dim, labelOpacity]);

  const dimStyle = useAnimatedStyle(() => ({ opacity: dim.value }));
  const labelStyle = useAnimatedStyle(() => ({ opacity: labelOpacity.value }));

  return (
    <Animated.View style={[dimStyle, expand && styles.expand]}>
      <Press onPress={onPress} disabled={!enabled} haptic={kind === 'ghost' ? 'none' : 'light'} accessibilityLabel={label} style={expand && styles.expand}>
        <View
          style={[
            styles.pill,
            kind === 'ghost' && styles.ghost,
            { backgroundColor: bg },
            outline !== undefined && { borderWidth: 1.5, borderColor: outline },
          ]}
        >
          <Animated.View style={[styles.row, labelStyle]}>
            {icon !== undefined && <Icon name={icon} size={18} color={fg} />}
            <Text style={[sans(15, 600, { color: fg, letterSpacing: -0.1, lineHeight: 20 })]} numberOfLines={1}>
              {label}
            </Text>
          </Animated.View>
          {busy && (
            <View style={styles.spinner} pointerEvents="none">
              <ActivityIndicator size="small" color={fg} />
            </View>
          )}
        </View>
      </Press>
    </Animated.View>
  );
}

export function IconButton({
  icon,
  label,
  onPress,
  background,
  foreground,
  size = 44,
}: {
  icon: IconName;
  label: string;
  onPress?: () => void;
  background?: string;
  foreground?: string;
  size?: number;
}) {
  const c = usePalette();
  return (
    <Press onPress={onPress} pressedScale={0.9} haptic="selection" accessibilityLabel={label}>
      <View style={[styles.round, { width: size, height: size, borderRadius: size / 2, backgroundColor: background ?? c.paper3 }]}>
        <Icon name={icon} size={20} color={foreground ?? c.text} />
      </View>
    </Press>
  );
}

const styles = StyleSheet.create({
  expand: { alignSelf: 'stretch' },
  pill: {
    height: 52,
    borderRadius: radius.pill,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghost: { height: 44 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  spinner: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  round: { alignItems: 'center', justifyContent: 'center' },
});
