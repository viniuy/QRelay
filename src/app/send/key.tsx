import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { cancelAnimation, Easing, ReduceMotion, runOnJS, useAnimatedReaction, useSharedValue, withTiming } from 'react-native-reanimated';

import { renderKey } from '@/core/qr/frameCache';
import { acquireStage, releaseStage } from '@/features/stageLock';
import { useSend } from '@/state/send';
import { useSettings } from '@/state/settings';
import { Button } from '@/ui/components/Button';
import { BigTitle, PhaseTag } from '@/ui/components/parts';
import { QrCard } from '@/ui/components/QrCard';
import { Ring } from '@/ui/components/Ring';
import { ScreenFrame } from '@/ui/components/ScreenFrame';
import { haptic } from '@/ui/motion';
import { usePalette } from '@/ui/theme';
import { mono } from '@/ui/type';

/**
 * The single key QR inside a countdown ring. When the ring completes the
 * stream starts; "Hold the key" pauses it; "Start the stream now" skips it.
 * With `again=1` the screen was opened from the stream for a receiver that
 * missed the key, and pops back to the stream when done.
 */
export default function Key() {
  const c = usePalette();
  const { again } = useLocalSearchParams<{ again?: string }>();
  const isAgain = again === '1';
  const session = useSend((s) => s.session);
  const { keyHoldSeconds, keepAwake } = useSettings();
  const [held, setHeld] = useState(false);
  const finished = useRef(false);
  const progress = useSharedValue(0);
  const [left, setLeft] = useState(keyHoldSeconds);

  const key = useMemo(() => (session ? renderKey(session) : null), [session]);

  useEffect(() => {
    if (!session) {
      router.replace('/');
      return;
    }
    void acquireStage(keepAwake);
    return () => {
      void releaseStage();
    };
  }, [session, keepAwake]);

  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    haptic('medium');
    if (isAgain) router.back();
    else router.replace('/send/stream');
  };

  // Run the ring on the UI thread; the remaining-seconds label follows it.
  useEffect(() => {
    if (!key) return;
    const remaining = (1 - progress.value) * keyHoldSeconds * 1000;
    if (held) {
      cancelAnimation(progress);
    } else {
      progress.value = withTiming(1, { duration: remaining, easing: Easing.linear, reduceMotion: ReduceMotion.Never }, (done) => {
        if (done) runOnJS(finish)();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [held, key]);

  useAnimatedReaction(
    () => Math.max(0, (1 - progress.value) * keyHoldSeconds),
    (value, prev) => {
      if (prev === null || Math.abs(value - prev) >= 0.1) runOnJS(setLeft)(value);
    },
    [keyHoldSeconds],
  );

  return (
    <ScreenFrame
      title="Key"
      trailing={<PhaseTag text="shown once" tint="amber" />}
      still
      actions={
        <>
          <Button label={isAgain ? 'Back to the stream' : 'Start the stream now'} onPress={finish} disabled={!key} />
          <Button label={held ? 'Resume the countdown' : 'Hold the key'} kind="ghost" onPress={() => setHeld((h) => !h)} disabled={!key} />
        </>
      }
    >
      <View style={styles.stage}>
        <BigTitle center>Scan this key</BigTitle>
        <View style={{ height: 22 }} />
        <Ring size={252} progress={progress}>
          <View style={styles.qr}>
            <QrCard matrix={key?.matrix ?? null} path={key?.path} padding={8} radius={10} />
          </View>
        </Ring>
        <View style={{ height: 18 }} />
        <Animated.Text style={mono(22, 600, { color: c.text })}>{left.toFixed(1)}</Animated.Text>
        <Text style={[mono(12, 400, { color: c.keyInk }), { marginTop: 4 }]}>
          {session ? `session ${session.label} · ${session.keyBytes.length} bytes · AES-256-GCM` : ''}
        </Text>
      </View>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 12 },
  qr: { width: 252 - 44, height: 252 - 44 },
});
