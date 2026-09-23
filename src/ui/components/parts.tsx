import React, { useEffect } from 'react';
import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { COLOR } from '../motion';
import { radius, stage, usePalette } from '../theme';
import { eyebrow, mono, sans } from '../type';

export type PhaseTint = 'neutral' | 'amber' | 'green';
const TINT_INDEX: Record<PhaseTint, number> = { neutral: 0, amber: 1, green: 2 };

export function BigTitle({ children, center = false, color, style }: { children: string; center?: boolean; color?: string; style?: StyleProp<TextStyle> }) {
  const c = usePalette();
  return (
    <Text style={[sans(30, 600, { color: color ?? c.text, lineHeight: 33, letterSpacing: -0.66 }), center && { textAlign: 'center' }, style]}>
      {children}
    </Text>
  );
}

export function Sub({ children, center = false, onDark = false }: { children: string; center?: boolean; onDark?: boolean }) {
  const c = usePalette();
  return <Text style={[sans(14.5, 400, { color: onDark ? stage.muted : c.muted, lineHeight: 21 }), center && { textAlign: 'center' }]}>{children}</Text>;
}

export function Eyebrow({ children }: { children: string }) {
  const c = usePalette();
  return <Text style={eyebrow(c.muted)}>{children}</Text>;
}

export function Tele({ label, value, onDark = false }: { label: string; value: string; onDark?: boolean }) {
  const c = usePalette();
  return (
    <View>
      <Text style={[mono(10, 500, { color: onDark ? stage.muted : c.muted, letterSpacing: 0.6 }), { textTransform: 'uppercase' }]}>{label}</Text>
      <Text style={mono(13.5, 500, { color: onDark ? stage.text : c.text })} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

export function StatCell({ label, value }: { label: string; value: string }) {
  const c = usePalette();
  return (
    <View style={[styles.stat, { backgroundColor: c.paper2, borderColor: c.line }]}>
      <Tele label={label} value={value} />
    </View>
  );
}

export function PhaseTag({ text, tint = 'neutral' }: { text: string; tint?: PhaseTint }) {
  const c = usePalette();
  const t = useSharedValue(TINT_INDEX[tint]);
  useEffect(() => {
    t.value = withTiming(TINT_INDEX[tint], COLOR);
  }, [tint, t]);
  const bg = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(t.value, [0, 1, 2], [c.paper3, c.keySoft, c.lockSoft]) }));
  const fg = useAnimatedStyle(() => ({ color: interpolateColor(t.value, [0, 1, 2], [c.muted, c.keyInk, c.lockInk]) }));
  return (
    <Animated.View style={[styles.tag, bg]}>
      <Animated.Text style={[mono(11, 500), fg]}>{text}</Animated.Text>
    </Animated.View>
  );
}

export function NoteBox({ children, tint = 'amber' }: { children: string; tint?: PhaseTint }) {
  const c = usePalette();
  const [bg, fg] = tint === 'amber' ? [c.keySoft, c.keyInk] : tint === 'green' ? [c.lockSoft, c.lockInk] : [c.paper3, c.text];
  return (
    <View style={[styles.note, { backgroundColor: bg }]}>
      <Text style={sans(13.5, 400, { color: fg, lineHeight: 19 })}>{children}</Text>
    </View>
  );
}

export function FileCard({ name, meta, badge, trailing }: { name: string; meta: string; badge?: string; trailing?: React.ReactNode }) {
  const c = usePalette();
  return (
    <View style={[styles.fileCard, { backgroundColor: c.paper2, borderColor: c.line }]}>
      <View style={[styles.badge, { backgroundColor: c.paper3 }]}>
        <Text style={mono(10, 600, { color: c.muted })}>{badge ?? badgeFor(name)}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={sans(15, 600, { color: c.text })} numberOfLines={1}>
          {name}
        </Text>
        <Text style={mono(12, 400, { color: c.muted })} numberOfLines={1}>
          {meta}
        </Text>
      </View>
      {trailing}
    </View>
  );
}

export function EstRow({ label, value }: { label: string; value: string }) {
  const c = usePalette();
  return (
    <View style={styles.est}>
      <Text style={sans(14, 400, { color: c.muted })}>{label}</Text>
      <Text style={[mono(13, 500, { color: c.text }), { flexShrink: 1, textAlign: 'right' }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

export function Gap({ h = 14 }: { h?: number }) {
  return <View style={{ height: h }} />;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatSeconds(s: number): string {
  if (s < 60) return `about ${Math.round(s)} s`;
  return `about ${(s / 60).toFixed(1)} min`;
}

export function badgeFor(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot < 0 || dot === name.length - 1) return 'FILE';
  const ext = name.slice(dot + 1).toUpperCase();
  return ext.length > 4 ? ext.slice(0, 4) : ext;
}

export function whenLabel(at: number): string {
  const d = new Date(at);
  const now = new Date();
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  if (sameDay) return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const days = Math.floor((now.getTime() - at) / 86400000);
  if (days <= 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const cardStyle: ViewStyle = { borderWidth: 1, borderRadius: radius.card };

const styles = StyleSheet.create({
  stat: { ...cardStyle, borderRadius: radius.small, paddingHorizontal: 10, paddingVertical: 7, flexGrow: 1, flexBasis: '30%' },
  tag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  note: { paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12 },
  fileCard: { ...cardStyle, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  badge: { width: 42, height: 50, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  est: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, paddingVertical: 6 },
});
