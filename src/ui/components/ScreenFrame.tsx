import { router } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ENTER, reduceMotion } from '../motion';
import { stage, usePalette } from '../theme';
import { sans } from '../type';
import { IconButton } from './Button';

interface Props {
  title?: string;
  titleNode?: React.ReactNode;
  showBack?: boolean;
  onBack?: () => void;
  trailing?: React.ReactNode;
  children: React.ReactNode;
  actions?: React.ReactNode;
  /** The black stream stage. */
  dark?: boolean;
  /** Skip the body's entrance (screens that manage their own). */
  still?: boolean;
  scroll?: boolean;
}

/**
 * Screen layout every screen shares: top bar, body, action stack at the
 * bottom. The body slides up 12 pt and fades in on mount; the action stack
 * fades a beat later.
 */
export function ScreenFrame({ title, titleNode, showBack = true, onBack, trailing, children, actions, dark = false, still = false }: Props) {
  const c = usePalette();
  const insets = useSafeAreaInsets();
  const bg = dark ? stage.bg : c.paper;
  const fg = dark ? stage.text : c.text;
  const bodyEntering = still ? undefined : FadeInDown.duration(ENTER.duration as number).easing(ENTER.easing as (t: number) => number).withInitialValues({ transform: [{ translateY: 12 }] }).reduceMotion(reduceMotion());
  const actionsEntering = still ? undefined : FadeIn.duration(260).delay(80).reduceMotion(reduceMotion());

  return (
    <View style={[styles.root, { backgroundColor: bg, paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 12) }]}>
      <View style={styles.bar}>
        {showBack && (
          <IconButton
            icon="back"
            label="Back"
            size={38}
            background={dark ? stage.control : c.paper3}
            foreground={fg}
            onPress={onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/')))}
          />
        )}
        <View style={styles.titleWrap}>
          {titleNode ?? (title !== undefined ? <Text style={sans(16, 600, { color: fg })}>{title}</Text> : null)}
        </View>
        {trailing}
      </View>
      <Animated.View style={styles.body} entering={bodyEntering}>
        {children}
      </Animated.View>
      {actions !== undefined && (
        <Animated.View style={styles.actions} entering={actionsEntering}>
          {actions}
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  bar: { height: 60, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 10 },
  titleWrap: { flex: 1, justifyContent: 'center' },
  body: { flex: 1, paddingHorizontal: 20, paddingTop: 4 },
  actions: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 6, gap: 10 },
});
