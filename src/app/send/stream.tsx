import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

import { FrameCache, type RenderedFrame } from '@/core/qr/frameCache';
import { acquireStage, releaseStage } from '@/features/stageLock';
import { useHistory } from '@/state/history';
import { useSend } from '@/state/send';
import { useSettings } from '@/state/settings';
import { Button, IconButton } from '@/ui/components/Button';
import { Tele } from '@/ui/components/parts';
import { QrCard } from '@/ui/components/QrCard';
import { ScreenFrame } from '@/ui/components/ScreenFrame';
import { reduceMotion } from '@/ui/motion';
import { stage, usePalette } from '@/ui/theme';
import { mono, sans } from '@/ui/type';

export default function Stream() {
  const c = usePalette();
  const { session, file, endSession } = useSend();
  const keepAwake = useSettings((s) => s.keepAwake);
  const addHistory = useHistory((s) => s.add);

  const cache = useMemo(() => (session ? new FrameCache(session) : null), [session]);
  const [frame, setFrame] = useState<RenderedFrame | null>(() => (cache ? cache.build(0) : null));
  const [paused, setPaused] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [stalls, setStalls] = useState(0);
  const seed = useRef(0);
  const focused = useRef(true);

  useEffect(() => {
    if (!session || !cache) {
      router.replace('/');
      return;
    }
    void acquireStage(keepAwake);
    cache.ensure(1);
    return () => {
      cache.dispose();
      void releaseStage();
    };
  }, [session, cache, keepAwake]);

  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      return () => {
        focused.current = false;
      };
    }, []),
  );

  useEffect(() => {
    if (!session || !cache) return;
    const period = 1000 / session.preset.fps;
    let last = Date.now();
    const timer = setInterval(() => {
      const now = Date.now();
      const dt = now - last;
      last = now;
      if (paused || !focused.current) return;
      setElapsedMs((e) => e + dt);
      const next = seed.current + 1;
      const rendered = cache.get(next);
      if (rendered === null) {
        setStalls((s) => s + 1);
        cache.ensure(next);
        return;
      }
      seed.current = next;
      setFrame(rendered);
      cache.ensure(next + 1);
    }, period);
    return () => clearInterval(timer);
  }, [session, cache, paused]);

  const done = () => {
    if (file) addHistory({ name: file.name, size: file.bytes.length, direction: 'sent', at: Date.now(), seconds: elapsedMs / 1000 });
    endSession();
    router.dismissAll();
    router.replace('/');
  };

  if (!session) return null;
  const k = session.blockCount;
  const current = frame?.seed ?? -1;
  const repair = current >= 0 && session.isRepair(current);
  const position = current >= 0 ? session.position(current) : 0;
  const secs = elapsedMs / 1000;

  return (
    <ScreenFrame
      dark
      still
      onBack={done}
      titleNode={
        <View>
          <Text style={sans(15, 600, { color: stage.text })} numberOfLines={1}>
            {file?.name ?? ''}
          </Text>
          <View style={styles.live}>
            <Blink color={paused ? stage.muted : c.lock} on={!paused} />
            <Text style={mono(11.5, 400, { color: paused ? stage.muted : c.lock })}>{paused ? 'paused' : 'streaming'}</Text>
          </View>
        </View>
      }
      trailing={<IconButton icon={paused ? 'play' : 'pause'} label={paused ? 'Resume' : 'Pause'} background={stage.control} foreground={stage.text} onPress={() => setPaused((p) => !p)} />}
      actions={
        <>
          <Button label="Show the key again" kind="onBlackSecondary" onPress={() => router.push({ pathname: '/send/key', params: { again: '1' } })} />
          <Button label="Done" kind="onBlack" onPress={done} />
        </>
      }
    >
      <View style={styles.center}>
        <QrCard matrix={frame?.matrix ?? null} path={frame?.path} />
        <View style={{ height: 16 }} />
        <View style={styles.tele}>
          {[
            ['frame', current < 0 ? '–' : `${current + 1}`],
            ['pass', current < 0 ? '–' : repair ? 'repair' : 'in order'],
            ['fps', session.preset.fps.toFixed(1)],
            ['sent', current < 0 ? '–' : repair ? `repair ${position - k + 1}` : `${position + 1}/${k}`],
            ['elapsed', `${secs.toFixed(1)} s`],
            ['rate', `${((session.preset.blockSize * session.preset.fps) / 1024).toFixed(1)} KB/s`],
          ].map(([label, value]) => (
            <View key={label} style={styles.cell}>
              <Tele label={label} value={value} onDark />
            </View>
          ))}
        </View>
        {stalls > 0 && <Text style={[mono(11, 400, { color: stage.muted }), { marginTop: 8 }]}>{stalls} frames waited on rendering</Text>}
      </View>
    </ScreenFrame>
  );
}

function Blink({ color, on }: { color: string; on: boolean }) {
  const o = useSharedValue(1);
  useEffect(() => {
    o.value = on ? withRepeat(withSequence(withTiming(0.25, { duration: 500, easing: Easing.linear }), withTiming(1, { duration: 500, easing: Easing.linear })), -1, false, undefined, reduceMotion()) : withTiming(1);
  }, [on, o]);
  const style = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[styles.dot, { backgroundColor: color }, style]} />;
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center' },
  live: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  tele: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 10 },
  cell: { width: '33.33%' },
});
