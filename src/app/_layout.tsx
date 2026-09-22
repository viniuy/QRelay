import '@/features/runtime';

import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { Platform, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useSettings } from '@/state/settings';
import { ToastHost } from '@/ui/components/Toast';
import { applyMotionMode, setHapticsEnabled } from '@/ui/motion';
import { usePalette } from '@/ui/theme';
import { fontAssets } from '@/ui/type';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const c = usePalette();
  const [loaded, error] = useFonts(fontAssets);
  const motion = useSettings((s) => s.motion);
  const haptics = useSettings((s) => s.haptics);

  useEffect(() => {
    applyMotionMode(motion);
  }, [motion]);

  useEffect(() => {
    setHapticsEnabled(haptics);
  }, [haptics]);

  useEffect(() => {
    if (loaded || error) SplashScreen.hideAsync();
  }, [loaded, error]);

  if (!loaded && !error) return <View style={{ flex: 1, backgroundColor: c.paper }} />;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: c.paper }}>
      <SafeAreaProvider>
        <StatusBar style={c.isDark ? 'light' : 'dark'} />
        <Stack
          screenOptions={{
            headerShown: false,
            animation: Platform.OS === 'ios' ? 'ios_from_right' : 'slide_from_right',
            animationDuration: 320,
            contentStyle: { backgroundColor: c.paper },
            gestureEnabled: true,
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="settings" />
          <Stack.Screen name="send/index" />
          <Stack.Screen name="send/edit" />
          <Stack.Screen name="send/check" />
          <Stack.Screen name="send/key" />
          <Stack.Screen name="send/stream" options={{ contentStyle: { backgroundColor: '#000' }, gestureEnabled: false }} />
          <Stack.Screen name="receive/index" />
          <Stack.Screen name="receive/camera" options={{ gestureEnabled: false }} />
          <Stack.Screen name="receive/done" options={{ gestureEnabled: false }} />
        </Stack>
        <ToastHost />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
