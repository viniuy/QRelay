import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import Animated, { FadeIn, interpolateColor, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { useSend } from '@/state/send';
import { useSettings } from '@/state/settings';
import { Button } from '@/ui/components/Button';
import { BigTitle, Gap, NoteBox } from '@/ui/components/parts';
import { Press } from '@/ui/components/Press';
import { ScreenFrame } from '@/ui/components/ScreenFrame';
import { toast } from '@/ui/components/Toast';
import { Icon } from '@/ui/Icons';
import { COLOR, OVERSHOOT } from '@/ui/motion';
import { radius, usePalette } from '@/ui/theme';
import { mono, sans } from '@/ui/type';

export default function Check() {
  const c = usePalette();
  const hold = useSettings((s) => s.keyHoldSeconds);
  const prepare = useSend((s) => s.prepare);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [distance, setDistance] = useState(false);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);

  const go = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await prepare((s) => setStep(s === 'packing' ? 'Packing' : s === 'hashing' ? 'Hashing' : 'Encrypting'));
      router.push('/send/key');
    } catch (e) {
      toast(`Could not prepare the file. ${e instanceof Error ? e.message : ''}`.trim());
    } finally {
      setBusy(false);
      setStep(null);
    }
  };

  return (
    <ScreenFrame title="Before you start" actions={<Button label="Show the key" kind="key" busy={busy} disabled={!(cameraOpen && distance)} onPress={go} />}>
      <BigTitle>Two things first</BigTitle>
      <Gap />
      <CheckRow label="Receiver has the camera open" value={cameraOpen} onChange={setCameraOpen} />
      <Gap h={8} />
      <CheckRow label="Screens 20 to 30 cm apart, no glare" value={distance} onChange={setDistance} />
      <Gap />
      <NoteBox>
        {`The key shows for ${hold} seconds, then the stream starts. Only a receiver that scanned the key can read the stream. Your brightness goes to 100% until you leave this flow.`}
      </NoteBox>
      {step && (
        <Animated.Text entering={FadeIn.duration(160)} style={[mono(12, 400, { color: c.muted }), { marginTop: 14, textAlign: 'center' }]}>
          {`${step} the file…`}
        </Animated.Text>
      )}
    </ScreenFrame>
  );
}

function CheckRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  const c = usePalette();
  const t = useSharedValue(value ? 1 : 0);
  useEffect(() => {
    t.value = value ? withTiming(1, OVERSHOOT) : withTiming(0, COLOR);
  }, [value, t]);
  const border = useAnimatedStyle(() => ({ borderColor: interpolateColor(Math.min(1, t.value), [0, 1], [c.line, c.lock]) }));
  const disc = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(Math.min(1, t.value), [0, 1], ['rgba(0,0,0,0)', c.lock]),
    borderColor: interpolateColor(Math.min(1, t.value), [0, 1], [c.line2, c.lock]),
  }));
  const tick = useAnimatedStyle(() => ({ transform: [{ scale: t.value }] }));

  return (
    <Press onPress={() => onChange(!value)} pressedScale={0.98} haptic="selection" accessibilityRole="checkbox" accessibilityState={{ checked: value }} accessibilityLabel={label}>
      <Animated.View style={[styles.row, { backgroundColor: c.paper2 }, border]}>
        <Animated.View style={[styles.disc, disc]}>
          <Animated.View style={tick}>
            <Icon name="check" size={14} color="#fff" strokeWidth={2.4} />
          </Animated.View>
        </Animated.View>
        <Text style={[sans(14.5, 500, { color: c.text }), { flex: 1 }]}>{label}</Text>
      </Animated.View>
    </Press>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 13, borderRadius: radius.field, borderWidth: 1.5 },
  disc: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
});

