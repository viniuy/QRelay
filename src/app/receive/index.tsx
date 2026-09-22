import { useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Linking } from 'react-native';

import { Button } from '@/ui/components/Button';
import { BigTitle, Gap, NoteBox, Sub } from '@/ui/components/parts';
import { ScreenFrame } from '@/ui/components/ScreenFrame';

/**
 * Why the camera is needed and where to hold the phone. The OS permission
 * prompt appears from here, so the camera screen opens straight into a live
 * viewfinder.
 */
export default function Receive() {
  const [permission, request] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const denied = permission !== null && !permission.granted && !permission.canAskAgain;

  const open = async () => {
    if (permission?.granted) {
      router.replace('/receive/camera');
      return;
    }
    if (denied) {
      await Linking.openSettings();
      return;
    }
    setBusy(true);
    const result = await request();
    setBusy(false);
    if (result.granted) router.replace('/receive/camera');
  };

  return (
    <ScreenFrame
      title="Receive"
      actions={<Button label={denied ? 'Open Settings' : 'Open the camera'} busy={busy} onPress={open} />}
    >
      <BigTitle>Camera needed</BigTitle>
      <Gap h={12} />
      <Sub>{"QRelay reads the sender's screen through the camera. Frames are decoded on this phone and never stored or uploaded."}</Sub>
      <Gap />
      <NoteBox tint="neutral">Hold 20 to 30 cm from the sender. The amber key comes first; the stream follows on its own.</NoteBox>
      {denied && (
        <>
          <Gap />
          <NoteBox>Camera access is off for QRelay. Turn it on in Settings to receive.</NoteBox>
        </>
      )}
    </ScreenFrame>
  );
}
