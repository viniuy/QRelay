import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, interpolateColor, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { type EditOp, EditNotReady, type EditResult, opsFor, runEdit } from '@/features/edit/editService';
import { type CompressLevel } from '@/features/edit/imageCodec';
import { saveBytes } from '@/files/files';
import { useSend } from '@/state/send';
import { Button } from '@/ui/components/Button';
import { badgeFor, BigTitle, FileCard, formatBytes, Gap, NoteBox, Sub } from '@/ui/components/parts';
import { Press } from '@/ui/components/Press';
import { ScreenFrame } from '@/ui/components/ScreenFrame';
import { Segmented } from '@/ui/components/Segmented';
import { toast } from '@/ui/components/Toast';
import { Icon, type IconName } from '@/ui/Icons';
import { COLOR, ENTER, OVERSHOOT, reduceMotion, SNAP } from '@/ui/motion';
import { radius, usePalette } from '@/ui/theme';
import { mono, sans } from '@/ui/type';

const ICONS: Record<EditOp, IconName> = {
  merge: 'merge',
  compress: 'compress',
  pdfToWord: 'pdfToWord',
  wordToPdf: 'wordToPdf',
  imageToPdf: 'image',
  imageToWord: 'scan',
};

export default function Edit() {
  const c = usePalette();
  const { file, setFile, undoEdit, original } = useSend();
  const [selected, setSelected] = useState<EditOp | null>(null);
  const [level, setLevel] = useState<CompressLevel>('sharp');
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState('');
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<EditResult | null>(null);

  const run = async () => {
    if (!selected || !file) return;
    setRunning(true);
    setStep('Starting');
    setProgress(0);
    try {
      const out = await runEdit(selected, file, { level }, (s, p) => {
        setStep(s);
        setProgress(p);
      });
      if (out === null) {
        setRunning(false);
        return;
      }
      setFile(out.file);
      setResult(out);
    } catch (e) {
      toast(e instanceof EditNotReady ? e.message : `That did not work. ${e instanceof Error ? e.message : ''}`.trim());
    } finally {
      setRunning(false);
    }
  };

  const saveCopy = () => {
    if (!file) return;
    try {
      saveBytes(file.bytes, file.name, 'edited');
      toast('Saved a copy in QRelay > edited');
    } catch (e) {
      toast(`Could not save. ${e instanceof Error ? e.message : ''}`.trim());
    }
  };

  const undo = () => {
    undoEdit();
    setResult(null);
    setSelected(null);
  };

  const ops = file ? opsFor(file.mime) : [];
  const opInfo = ops.find((o) => o.id === selected);
  const isPdf = file?.mime === 'application/pdf';

  return (
    <ScreenFrame
      title="Edit"
      actions={
        result === null ? (
          <Button label={opInfo ? opInfo.action : 'Choose an edit'} busy={running} disabled={!selected || !file} onPress={run} />
        ) : (
          <>
            <View style={styles.pair}>
              <View style={{ flex: 1 }}>
                <Button label="Undo" kind="ghost" onPress={original ? undo : undefined} />
              </View>
              <View style={{ flex: 1 }}>
                <Button label="Save a copy" kind="secondary" onPress={saveCopy} />
              </View>
            </View>
            <Button label="Send this" onPress={() => router.push('/send/check')} />
          </>
        )
      }
    >
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 12 }}>
        <BigTitle>{result === null ? 'What should change?' : 'Done'}</BigTitle>
        {result === null && file && ops.length === 0 && (
          <>
            <Gap h={6} />
            <Sub>{`Nothing here applies to a ${badgeFor(file.name)} file. It goes as it is.`}</Sub>
          </>
        )}
        <Gap />
        {result === null ? (
          <>
            <View style={styles.grid}>
              {ops.map((op) => (
                <OpTile
                  key={op.id}
                  icon={ICONS[op.id]}
                  label={op.label}
                  hint={op.available ? op.hint : (op.why ?? op.hint)}
                  selected={selected === op.id}
                  disabled={running || !op.available}
                  muted={!op.available}
                  onPress={() => setSelected(selected === op.id ? null : op.id)}
                />
              ))}
            </View>
            {selected === 'compress' && !running && (
              <Animated.View entering={FadeIn.duration(200).reduceMotion(reduceMotion())} style={{ marginTop: 16 }}>
                <Segmented<CompressLevel> options={[{ value: 'sharp', label: 'Sharper' }, { value: 'small', label: 'Smaller' }]} value={level} onChange={setLevel} />
                <Gap h={8} />
                <Text style={sans(13, 400, { color: c.muted })}>
                  {isPdf
                    ? level === 'sharp'
                      ? 'Images inside re-encoded at up to 1800 px, quality 70. Scans stay readable; text and vectors are untouched.'
                      : 'Images inside re-encoded at up to 1200 px, quality 55. Fine on a phone screen; small print in scans may blur.'
                    : level === 'sharp'
                      ? 'JPEG at up to 2048 px, quality 75. Looks the same on a phone; prints slightly softer.'
                      : 'JPEG at up to 1280 px, quality 60. For photos that only need to look right on a screen.'}
                </Text>
              </Animated.View>
            )}
            {selected === 'merge' && !running && (
              <Animated.View entering={FadeIn.duration(200).reduceMotion(reduceMotion())} style={{ marginTop: 16 }}>
                <NoteBox tint="neutral">{`${file?.name ?? 'This file'} goes first. Next, pick the PDFs to add after it.`}</NoteBox>
              </Animated.View>
            )}
            {running && (
              <Animated.View entering={FadeIn.duration(200).reduceMotion(reduceMotion())} style={{ marginTop: 16 }}>
                <View style={styles.progressRow}>
                  <Text style={[sans(14, 400, { color: c.muted }), { flex: 1 }]}>{step}</Text>
                  <Text style={mono(13, 500, { color: c.text })}>{Math.round(progress * 100)}%</Text>
                </View>
                <ProgressBar value={progress} />
              </Animated.View>
            )}
          </>
        ) : (
          <Animated.View entering={FadeInDown.duration(ENTER.duration as number).reduceMotion(reduceMotion())}>
            <ResultCard result={result} />
            <Gap h={12} />
            {file && <FileCard name={file.name} meta={`${formatBytes(file.bytes.length)} · ready to send`} />}
          </Animated.View>
        )}
      </ScrollView>
    </ScreenFrame>
  );
}

/** Lifts 2 pt with a shadow when selected; the check pops in with an overshoot. Muted tiles are ops this build cannot run. */
function OpTile({ icon, label, hint, selected, disabled, muted = false, onPress }: { icon: IconName; label: string; hint: string; selected: boolean; disabled: boolean; muted?: boolean; onPress: () => void }) {
  const c = usePalette();
  const t = useSharedValue(selected ? 1 : 0);
  const check = useSharedValue(selected ? 1 : 0);
  useEffect(() => {
    t.value = withSpring(selected ? 1 : 0, SNAP);
    check.value = selected ? withTiming(1, OVERSHOOT) : withTiming(0, COLOR);
  }, [selected, t, check]);
  const card = useAnimatedStyle(() => ({
    transform: [{ translateY: -2 * t.value }],
    borderColor: interpolateColor(t.value, [0, 1], [c.line, c.text]),
    shadowOpacity: 0.12 * t.value,
  }));
  const tick = useAnimatedStyle(() => ({ transform: [{ scale: check.value }] }));
  return (
    <Press onPress={onPress} disabled={disabled} haptic="selection" accessibilityRole="checkbox" accessibilityState={{ checked: selected }} accessibilityLabel={label} style={styles.tileWrap}>
      <Animated.View style={[styles.tile, { backgroundColor: c.paper2, shadowColor: '#000', opacity: muted ? 0.5 : 1 }, card]}>
        <Icon name={icon} size={26} color={c.text} />
        <View>
          <Text style={sans(14, 600, { color: c.text })}>{label}</Text>
          <Text style={sans(12, 400, { color: c.muted })} numberOfLines={1}>
            {hint}
          </Text>
        </View>
        <Animated.View style={[styles.check, { backgroundColor: c.ink }, tick]}>
          <Icon name="check" size={12} color={c.paper} strokeWidth={2.6} />
        </Animated.View>
      </Animated.View>
    </Press>
  );
}

function ProgressBar({ value }: { value: number }) {
  const c = usePalette();
  const w = useSharedValue(0);
  useEffect(() => {
    w.value = withSpring(value, { mass: 1, stiffness: 200, damping: 26 });
  }, [value, w]);
  const style = useAnimatedStyle(() => ({ width: `${Math.min(100, Math.max(0, w.value * 100))}%` }));
  return (
    <View style={[styles.bar, { backgroundColor: c.paper3 }]}>
      <Animated.View style={[styles.fill, { backgroundColor: c.ink }, style]} />
    </View>
  );
}

/** Before/after with two bars that grow from the left. */
function ResultCard({ result }: { result: EditResult }) {
  const c = usePalette();
  const after = result.file.bytes.length;
  const ratio = result.before === 0 ? 1 : Math.min(1, Math.max(0.02, after / result.before));
  return (
    <View style={[styles.result, { backgroundColor: c.lockSoft, borderColor: c.lock }]}>
      <View style={styles.resultRow}>
        <Text style={[mono(13, 400, { color: c.text }), { flex: 1 }]}>{result.line}</Text>
        <Text style={mono(13, 600, { color: c.lockInk })}>{result.delta}</Text>
      </View>
      <Gap h={10} />
      <GrowBar fraction={1} color={c.line2} delay={0} />
      <Gap h={5} />
      <GrowBar fraction={ratio} color={c.lock} delay={120} />
      <Gap h={10} />
      <Text style={sans(14.5, 400, { color: c.muted })}>{result.note}</Text>
    </View>
  );
}

function GrowBar({ fraction, color, delay }: { fraction: number; color: string; delay: number }) {
  const s = useSharedValue(0);
  useEffect(() => {
    const t = setTimeout(() => {
      s.value = withTiming(1, { duration: 600, easing: ENTER.easing, reduceMotion: reduceMotion() });
    }, delay);
    return () => clearTimeout(t);
  }, [s, delay]);
  const style = useAnimatedStyle(() => ({ transform: [{ scaleX: s.value }] }));
  return (
    <View style={{ alignItems: 'flex-start' }}>
      <Animated.View style={[{ height: 8, borderRadius: 999, backgroundColor: color, width: `${fraction * 100}%`, transformOrigin: 'left' }, style]} />
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tileWrap: { width: '48%', flexGrow: 1 },
  tile: {
    borderWidth: 1.5,
    borderRadius: radius.card,
    padding: 14,
    gap: 12,
    minHeight: 112,
    justifyContent: 'space-between',
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
  },
  check: { position: 'absolute', top: 10, right: 10, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  progressRow: { flexDirection: 'row', alignItems: 'baseline', marginBottom: 8 },
  bar: { height: 6, borderRadius: 999, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 999 },
  result: { borderWidth: 1, borderRadius: radius.card, padding: 16 },
  resultRow: { flexDirection: 'row', alignItems: 'baseline', gap: 12 },
  pair: { flexDirection: 'row', gap: 10 },
});
