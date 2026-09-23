import { type BarcodeScanningResult, CameraView } from "expo-camera";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import {
  etaSeconds,
  goodputBytesPerSecond,
  type ReceivePhase,
  useReceive,
} from "@/state/receive";
import { useSettings } from "@/state/settings";
import { BlockGrid } from "@/ui/components/BlockGrid";
import { Button } from "@/ui/components/Button";
import {
  formatBytes,
  NoteBox,
  PhaseTag,
  type PhaseTint,
  StatCell,
} from "@/ui/components/parts";
import { Reticle } from "@/ui/components/Reticle";
import { ScreenFrame } from "@/ui/components/ScreenFrame";
import { COLOR, haptic, reduceMotion } from "@/ui/motion";
import { radius, usePalette } from "@/ui/theme";
import { mono, sans } from "@/ui/type";

/**
 * Viewfinder with a reticle that snaps tight and turns amber on the key,
 * green on data; a block grid that fills as the fountain solves; six live
 * stats. Lands on Done when the file verifies.
 */
export default function Camera() {
  const c = usePalette();
  const state = useReceive();
  const keepAwake = useSettings((s) => s.keepAwake);
  const lastPhase = useRef<ReceivePhase>("searching");
  const [, forceTick] = useState(0);
  const active = state.phase !== "done" && state.phase !== "failed";

  useEffect(() => {
    useReceive.getState().reset();
    if (keepAwake) void activateKeepAwakeAsync("qrelay-camera");
    return () => {
      void deactivateKeepAwake("qrelay-camera");
    };
  }, [keepAwake]);

  // The ETA and goodput read the clock; refresh them twice a second while receiving.
  useEffect(() => {
    if (state.phase !== "receiving" && state.phase !== "keyLocked") return;
    const t = setInterval(() => forceTick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, [state.phase]);

  useEffect(() => {
    if (state.phase === lastPhase.current) return;
    lastPhase.current = state.phase;
    switch (state.phase) {
      case "keyLocked":
        haptic("medium");
        break;
      case "done":
        haptic("success");
        router.replace("/receive/done");
        break;
      case "failed":
        haptic("warning");
        break;
      default:
        break;
    }
  }, [state.phase]);

  const onScan = useCallback((result: BarcodeScanningResult) => {
    if (result.data) useReceive.getState().feed(result.data);
  }, []);

  const tint: PhaseTint =
    state.phase === "searching" || state.phase === "failed"
      ? "neutral"
      : state.phase === "keyLocked"
        ? "amber"
        : "green";

  const status =
    state.phase === "searching"
      ? state.needKeySeen
        ? "Stream found, need the key"
        : state.otherSessionSeen
          ? "Different sender, looking for the key"
          : "Looking for the key"
      : state.phase === "keyLocked"
        ? `Key locked · session ${state.label}`
        : state.phase === "receiving"
          ? state.otherSessionSeen
            ? "Receiving · ignoring another sender"
            : "Receiving"
          : state.phase === "verifying"
            ? "Verifying SHA-256"
            : state.phase === "done"
              ? "Done"
              : "Did not verify";

  const eta = etaSeconds(state);
  const finishing = state.phase === "verifying" || state.phase === "done";

  return (
    <ScreenFrame
      title="Receiving"
      trailing={
        <PhaseTag
          text={
            state.phase === "searching"
              ? "no key"
              : state.phase === "failed"
                ? "failed"
                : "key locked"
          }
          tint={tint}
        />
      }
      actions={
        state.phase === "failed" ? (
          <Button
            label="Try again"
            onPress={() => {
              lastPhase.current = "searching";
              useReceive.getState().reset();
            }}
          />
        ) : (
          <Button
            label="Cancel"
            kind="ghost"
            onPress={() => {
              router.dismissAll();
              router.replace("/");
            }}
          />
        )
      }
    >
      <View style={styles.viewfinder}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          active={active}
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={active ? onScan : undefined}
        />
        <Reticle tint={tint} />
        <View style={styles.pillWrap}>
          <StatePill
            text={status}
            tint={tint}
            live={state.phase !== "failed"}
          />
        </View>
      </View>

      <View style={styles.fileRow}>
        <Text
          style={[
            sans(14, 600, { color: state.name ? c.text : c.muted }),
            { flex: 1 },
          ]}
          numberOfLines={1}
        >
          {state.name ?? "Waiting for a sender"}
        </Text>
        {state.size !== null && (
          <Text style={mono(12, 400, { color: c.muted })}>
            {formatBytes(state.size)} · {state.blockCount} blocks
          </Text>
        )}
      </View>

      <View style={{ minHeight: 24, marginTop: 10 }}>
        {state.blockCount > 0 && (
          <BlockGrid
            count={state.blockCount}
            isSolved={state.isSolved}
            tick={state.tick}
          />
        )}
      </View>

      <View style={styles.stats}>
        <StatCell label="decode" value={`${state.decodeFps} fps`} />
        <StatCell label="frames" value={`${state.frames}`} />
        <StatCell label="dupes" value={`${state.duplicates}`} />
        <StatCell
          label="goodput"
          value={`${(goodputBytesPerSecond(state) / 1024).toFixed(1)} KB/s`}
        />
        <StatCell
          label="left"
          value={finishing ? "done" : eta === null ? "–" : `~${eta} s`}
        />
        <StatCell
          label="blocks"
          value={
            state.blockCount === 0 ? "–" : `${state.solved}/${state.blockCount}`
          }
        />
      </View>

      {state.phase === "failed" && state.error && (
        <View style={{ marginTop: 12 }}>
          <NoteBox tint="neutral">{state.error}</NoteBox>
        </View>
      )}
    </ScreenFrame>
  );
}

/** Status pill over the viewfinder. Background eases between the three phases; the dot blinks while live. */
function StatePill({
  text,
  tint,
  live,
}: {
  text: string;
  tint: PhaseTint;
  live: boolean;
}) {
  const c = usePalette();
  const t = useSharedValue(tint === "amber" ? 1 : tint === "green" ? 2 : 0);
  useEffect(() => {
    t.value = withTiming(
      tint === "amber" ? 1 : tint === "green" ? 2 : 0,
      COLOR,
    );
  }, [tint, t]);
  const bg = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      t.value,
      [0, 1, 2],
      ["rgba(0,0,0,0.62)", c.key, c.lock],
    ),
  }));
  const fg = useAnimatedStyle(() => ({
    color: interpolateColor(t.value, [0, 1, 2], ["#FFFFFF", c.onKey, c.onLock]),
  }));
  const o = useSharedValue(1);
  useEffect(() => {
    o.value = live
      ? withRepeat(
          withSequence(
            withTiming(0.25, { duration: 500, easing: Easing.linear }),
            withTiming(1, { duration: 500, easing: Easing.linear }),
          ),
          -1,
          false,
          undefined,
          reduceMotion(),
        )
      : withTiming(1);
  }, [live, o]);
  const dot = useAnimatedStyle(() => ({
    opacity: o.value,
    backgroundColor: interpolateColor(
      t.value,
      [0, 1, 2],
      ["#FFFFFF", c.onKey, c.onLock],
    ),
  }));
  return (
    <Animated.View style={[styles.pill, bg]}>
      {live && <Animated.View style={[styles.dot, dot]} />}
      <Animated.Text style={[mono(12, 400), fg]} numberOfLines={1}>
        {text}
      </Animated.Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  viewfinder: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: "#0C0E0D",
  },
  pillWrap: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 12,
    alignItems: "center",
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.pill,
    maxWidth: "100%",
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  fileRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 12,
    marginTop: 12,
  },
  stats: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 12 },
});
