import Slider from '@react-native-community/slider';
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { PRESETS, presetById, type PresetId } from '@/core/transfer/presets';
import { useSettings } from '@/state/settings';
import { Eyebrow } from '@/ui/components/parts';
import { ScreenFrame } from '@/ui/components/ScreenFrame';
import { Segmented } from '@/ui/components/Segmented';
import { Toggle } from '@/ui/components/Toggle';
import { haptic, type MotionMode } from '@/ui/motion';
import { usePalette } from '@/ui/theme';
import { mono, sans } from '@/ui/type';

export default function Settings() {
  const c = usePalette();
  const s = useSettings();
  const preset = presetById(s.preset);

  return (
    <ScreenFrame title="Settings">
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
        <Section title="Default preset" first />
        <Segmented<PresetId> options={PRESETS.map((p) => ({ value: p.id, label: p.label }))} value={s.preset} onChange={s.setPreset} />
        <Text style={[sans(13, 400, { color: c.muted }), { marginTop: 8 }]}>
          {preset.blockSize} bytes a frame at {preset.fps} fps. {preset.when}.
        </Text>

        <Section title="Key hold time" />
        <View style={styles.sliderRow}>
          <Slider
            style={{ flex: 1, height: 40 }}
            minimumValue={2}
            maximumValue={10}
            step={1}
            value={s.keyHoldSeconds}
            minimumTrackTintColor={c.key}
            maximumTrackTintColor={c.paper4}
            thumbTintColor={c.paper2}
            onValueChange={(v) => {
              if (Math.round(v) !== s.keyHoldSeconds) haptic('selection');
              s.setKeyHoldSeconds(v);
            }}
            accessibilityLabel="Key hold time in seconds"
          />
          <Text style={[mono(14, 500, { color: c.text }), { width: 44, textAlign: 'right' }]}>{s.keyHoldSeconds} s</Text>
        </View>
        <Text style={sans(13, 400, { color: c.muted })}>How long the key QR stays up before the stream starts.</Text>

        <Section title="Animations" />
        <Segmented<MotionMode> options={[{ value: 'system', label: 'Follow system' }, { value: 'always', label: 'Always on' }]} value={s.motion} onChange={s.setMotion} />
        <Text style={[sans(13, 400, { color: c.muted }), { marginTop: 8 }]}>
          {s.motion === 'system' ? 'Springs and fades follow the Reduce Motion setting of this phone.' : 'Springs and fades run even with Reduce Motion on. The key countdown always runs.'}
        </Text>

        <Section title="Feel" />
        <ToggleRow label="Haptics" value={s.haptics} onChange={s.setHaptics} />
        <ToggleRow label="Keep the screen awake while sending or receiving" value={s.keepAwake} onChange={s.setKeepAwake} />

        <Text style={[sans(13, 400, { color: c.muted }), { marginTop: 28 }]}>QRelay keeps nothing off the phone: no accounts, no analytics, no uploads.</Text>
      </ScrollView>
    </ScreenFrame>
  );
}

function Section({ title, first = false }: { title: string; first?: boolean }) {
  return (
    <View style={{ paddingTop: first ? 6 : 24, paddingBottom: 10 }}>
      <Eyebrow>{title}</Eyebrow>
    </View>
  );
}

function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  const c = usePalette();
  return (
    <View style={styles.toggleRow}>
      <Text style={[sans(14.5, 500, { color: c.text }), { flex: 1 }]}>{label}</Text>
      <Toggle value={value} onChange={onChange} label={label} />
    </View>
  );
}

const styles = StyleSheet.create({
  sliderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
});
