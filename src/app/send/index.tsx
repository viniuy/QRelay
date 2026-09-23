import { router } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInUp, FadeOutDown } from 'react-native-reanimated';

import { blocksFor, estimateSeconds, PRESETS, type PresetId, presetById, WARN_ABOVE_BYTES } from '@/core/transfer/presets';
import { type PickOutcome, streamBytes, useSend } from '@/state/send';
import { Button, IconButton } from '@/ui/components/Button';
import { BigTitle, FileCard, formatBytes, formatSeconds, Gap, NoteBox } from '@/ui/components/parts';
import { ScreenFrame } from '@/ui/components/ScreenFrame';
import { Segmented } from '@/ui/components/Segmented';
import { toast } from '@/ui/components/Toast';
import { reduceMotion } from '@/ui/motion';
import { usePalette } from '@/ui/theme';
import { mono, sans } from '@/ui/type';

export default function Send() {
  const c = usePalette();
  const { file, packed, preset: presetId, error, pick, setPreset } = useSend();
  const [picking, setPicking] = useState(false);
  const opened = useRef(false);

  const afterPick = (result: PickOutcome, popOnCancel: boolean) => {
    if (result === 'error') toast(useSend.getState().error ?? 'That file could not be read.');
    if (result === 'merged') toast('Merged into one PDF');
    if (result === 'cancelled' && popOnCancel && useSend.getState().file === null) router.back();
  };

  const doPick = async (popOnCancel: boolean) => {
    if (picking) return;
    setPicking(true);
    const result = await pick();
    setPicking(false);
    afterPick(result, popOnCancel);
  };

  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    if (file !== null) return;
    void pick().then((result) => afterPick(result, true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const preset = presetById(presetId);
  const size = file?.bytes.length ?? 0;
  const bytes = streamBytes({ file, packed });
  const packing = file !== null && packed === null;
  const saved = packed !== null && packed.method === 'deflate' ? 1 - packed.bytes.length / packed.rawSize : 0;
  const blocks = blocksFor(bytes, preset);
  const estimate = formatSeconds(estimateSeconds(bytes, preset));

  return (
    <ScreenFrame
      title="Send"
      actions={
        file && (
          <>
            <Button label="Edit first" kind="secondary" onPress={() => router.push('/send/edit')} />
            <Button label="Continue" onPress={() => router.push('/send/check')} />
          </>
        )
      }
    >
      {file === null ? (
        <View style={styles.empty}>
          <Text style={[sans(16, 400, { color: c.muted }), { textAlign: 'center' }]}>{error ?? 'Pick a file to send'}</Text>
          <Text style={[sans(13, 400, { color: c.muted }), { textAlign: 'center', marginTop: 6 }]}>Pick several PDFs to merge them into one.</Text>
          <Gap />
          <Button label="Choose a file" expand={false} busy={picking} onPress={() => doPick(false)} />
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 12 }}>
          <BigTitle>Ready to send</BigTitle>
          <Gap />
          <FileCard
            name={file.name}
            meta={packing ? `${formatBytes(size)} · packing…` : saved > 0 ? `${formatBytes(size)} → ${formatBytes(bytes)} packed · ${blocks} blocks` : `${formatBytes(size)} · ${blocks} blocks`}
            trailing={<IconButton icon="folder" label="Choose a different file" onPress={() => doPick(false)} />}
          />
          <Gap />
          <Segmented<PresetId> options={PRESETS.map((p) => ({ value: p.id, label: p.label }))} value={presetId} onChange={setPreset} />
          <Gap />
          <Row label="Estimated time" value={packing ? '…' : estimate} />
          <Row label="Frame" value={`${preset.blockSize} B · ${preset.fps} fps · QR v${preset.qrVersion}`} />
          <Row label="Packing" value={packing ? 'working…' : saved > 0 ? `deflate, −${Math.round(saved * 100)}%` : 'none (already compact)'} />
          <Row label="Encryption" value="AES-256-GCM, key shown once" animate={false} />
          {!packing && bytes > WARN_ABOVE_BYTES && (
            <>
              <Gap />
              <NoteBox>
                {`${formatBytes(bytes)} over a QR stream means both phones stay put for ${estimate.replace('about ', '')}. ${
                  file.mime === 'application/pdf' || file.mime.startsWith('image/') ? 'Edit first → Compress usually cuts that by more than half.' : 'The Fast preset halves it on recent phones.'
                }`}
              </NoteBox>
            </>
          )}
        </ScrollView>
      )}
    </ScreenFrame>
  );
}

function Row({ label, value, animate = true }: { label: string; value: string; animate?: boolean }) {
  const c = usePalette();
  return (
    <View style={styles.row}>
      <Text style={sans(14, 400, { color: c.muted })}>{label}</Text>
      <View style={styles.valueWrap}>
        {animate ? (
          <Animated.Text key={value} entering={FadeInUp.duration(220).reduceMotion(reduceMotion())} exiting={FadeOutDown.duration(120).reduceMotion(reduceMotion())} style={[mono(13, 500, { color: c.text }), styles.value]} numberOfLines={1}>
            {value}
          </Animated.Text>
        ) : (
          <Text style={[mono(13, 500, { color: c.text }), styles.value]} numberOfLines={1}>
            {value}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 40, paddingHorizontal: 12 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 6, minHeight: 32 },
  valueWrap: { flexShrink: 1, alignItems: 'flex-end' },
  value: { textAlign: 'right' },
});
