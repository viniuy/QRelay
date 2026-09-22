import { router } from 'expo-router';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';

import { openFile, shareFile } from '@/files/files';
import { useReceive } from '@/state/receive';
import { Button } from '@/ui/components/Button';
import { Checkmark } from '@/ui/components/Checkmark';
import { BigTitle, FileCard, formatBytes, Gap, Sub } from '@/ui/components/parts';
import { ScreenFrame } from '@/ui/components/ScreenFrame';
import { toast } from '@/ui/components/Toast';
import { ENTER, reduceMotion } from '@/ui/motion';

export default function Done() {
  const state = useReceive();
  const saved = state.saved;
  const mime = state.mime ?? 'application/octet-stream';
  const seconds = state.finishedAt ? (state.finishedAt - state.startedAt) / 1000 : 0;

  const open = async () => {
    if (!saved) return;
    try {
      await openFile(saved.uri, mime);
    } catch {
      toast('No app on this phone opens that file. Share it instead.');
    }
  };

  const share = async () => {
    if (!saved) return;
    try {
      await shareFile(saved.uri, mime);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not share.');
    }
  };

  return (
    <ScreenFrame
      showBack={false}
      still
      actions={
        <>
          <Button label="Open" onPress={saved ? open : undefined} />
          <Button label="Share or save to Files" kind="secondary" icon="share" onPress={saved ? share : undefined} />
          <Button label="Receive another" kind="ghost" onPress={() => router.replace('/receive/camera')} />
        </>
      }
    >
      <View style={styles.center}>
        <Checkmark />
        <Gap h={10} />
        <Animated.View entering={FadeInUp.duration(ENTER.duration as number).delay(350).reduceMotion(reduceMotion())} style={{ alignSelf: 'stretch' }}>
          <BigTitle center>Received</BigTitle>
          <Gap h={6} />
          <Sub center>{"Decrypted and checked against the sender's SHA-256"}</Sub>
          <Gap h={20} />
          <FileCard
            name={saved?.name ?? state.name ?? ''}
            meta={`${formatBytes(state.size ?? state.bytes?.length ?? 0)} · ${state.blockCount} blocks · ${seconds.toFixed(1)} s`}
          />
        </Animated.View>
      </View>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', paddingTop: 18 },
});
