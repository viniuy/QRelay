import { router } from 'expo-router';
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { fileExists, openFile } from '@/files/files';
import { type HistoryEntry, useHistory } from '@/state/history';
import { useSend } from '@/state/send';
import { IconButton } from '@/ui/components/Button';
import { Eyebrow, formatBytes, whenLabel } from '@/ui/components/parts';
import { Press } from '@/ui/components/Press';
import { ScreenFrame } from '@/ui/components/ScreenFrame';
import { toast } from '@/ui/components/Toast';
import { Icon, type IconName, Mark } from '@/ui/Icons';
import { radius, usePalette } from '@/ui/theme';
import { mono, sans } from '@/ui/type';

export default function Home() {
  const c = usePalette();
  const entries = useHistory((s) => s.entries);
  const resetSend = useSend((s) => s.reset);

  return (
    <ScreenFrame
      showBack={false}
      titleNode={
        <View style={styles.brand}>
          <Mark size={22} ink={c.ink} paper={c.paper} accent={c.key} />
          <Text style={sans(16, 600, { color: c.text })}>QRelay</Text>
        </View>
      }
      trailing={<IconButton icon="settings" label="Settings" size={38} onPress={() => router.push('/settings')} />}
    >
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <ActionCard
          primary
          icon="send"
          title="Send a file"
          subtitle="Show it as a stream of QR codes"
          onPress={() => {
            resetSend();
            router.push('/send');
          }}
        />
        <ActionCard icon="camera" title="Receive a file" subtitle="Point the camera at a sender's screen" onPress={() => router.push('/receive')} />
        <View style={{ height: 22 }} />
        <Eyebrow>Recent</Eyebrow>
        {entries.length === 0 ? (
          <Text style={[sans(14, 400, { color: c.muted }), { paddingVertical: 12 }]}>Nothing yet. Transfers you send or receive show up here.</Text>
        ) : (
          entries.slice(0, 8).map((e) => <HistoryRow key={e.id} entry={e} />)
        )}
      </ScrollView>
    </ScreenFrame>
  );
}

function ActionCard({ primary = false, icon, title, subtitle, onPress }: { primary?: boolean; icon: IconName; title: string; subtitle: string; onPress: () => void }) {
  const c = usePalette();
  const fg = primary ? c.paper : c.text;
  return (
    <Press onPress={onPress} pressedScale={0.97} accessibilityLabel={title} style={{ marginBottom: 12 }}>
      <View style={[styles.card, { backgroundColor: primary ? c.ink : c.paper2, borderColor: primary ? c.ink : c.line2 }]}>
        <Icon name={icon} size={28} color={fg} />
        <View style={{ height: 22 }} />
        <Text style={sans(21, 600, { color: fg, lineHeight: 24, letterSpacing: -0.4 })}>{title}</Text>
        <Text style={[sans(13, 400, { color: primary ? c.paper : c.muted }), primary && { opacity: 0.72 }, { marginTop: 3 }]}>{subtitle}</Text>
      </View>
    </Press>
  );
}

function HistoryRow({ entry }: { entry: HistoryEntry }) {
  const c = usePalette();
  const received = entry.direction === 'received';
  return (
    <Press
      pressedScale={0.985}
      haptic="selection"
      accessibilityLabel={`${entry.name}, ${received ? 'received' : 'sent'}`}
      onPress={async () => {
        if (received) {
          if (entry.uri && fileExists(entry.uri)) {
            await openFile(entry.uri, entry.mime ?? 'application/octet-stream').catch(() => toast('No app on this phone opens that file.'));
          } else {
            toast('That copy is gone. Receive it again.');
          }
        } else {
          router.push('/send');
        }
      }}
    >
      <View style={styles.row}>
        <View style={[styles.dot, { backgroundColor: received ? c.lock : c.key }]} />
        <View style={{ flex: 1 }}>
          <Text style={sans(14, 600, { color: c.text })} numberOfLines={1}>
            {entry.name}
          </Text>
          <Text style={mono(11.5, 400, { color: c.muted })}>
            {received ? 'received' : 'sent'} · {formatBytes(entry.size)} · {whenLabel(entry.at)}
          </Text>
        </View>
      </View>
    </Press>
  );
}

const styles = StyleSheet.create({
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  scroll: { paddingBottom: 24 },
  card: { padding: 18, borderRadius: radius.cardLarge, borderWidth: 1.5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
